// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview dependency-graph builder (Issue #74, work item 47; design §4.4, §5(a)).
 *
 * Constructs the full main-process preview object graph from the real singleton
 * collaborators and the injectable electron surfaces. Extracted from the
 * composition root (`preview-handlers.ts`) so each file stays under the 500-line
 * cap (design §7 constraint).
 *
 * The graph is upward-only: every module here depends solely on strictly-lower
 * work items. The per-view collaborators (watch coordinator, reload policy, find
 * controller, failure log, entry watcher) are wired as FACTORIES because each
 * binds to per-view data (the new view's realRoot / webContents) absent at
 * construction time.
 *
 * @see docs/designs/html-preview/sd-074-html-preview.md §4.4, §5(a)
 */
import { BrowserWindow, dialog, screen, type Session } from 'electron'
import { openExternalSafe } from '../../utils/openExternalSafe'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ChokidarOptions } from 'chokidar'
import { PREVIEW } from '../../../shared/constants'
import {
  isHtmlPreviewCommentsEnabled,
  type GlobalSettings
} from '../../../shared/ipc/global-settings-schema'
import { createPreviewRootRegistry } from '../../services/preview/PreviewRootRegistry'
import { createPreviewAllowlistStore } from '../../services/preview/PreviewAllowlistStore'
import { createPreviewSessionFactory } from '../../services/preview/PreviewSessionFactory'
import { createPreviewStillFrameCache } from '../../services/preview/PreviewStillFrameCache'
import { createPreviewExportController } from '../../services/preview/PreviewExportController'
import { createGitignoreEvaluator } from '../../services/preview/GitignoreEvaluator'
import { createPreviewEligibilityService } from '../../services/preview/PreviewEligibilityService'
import { createPreviewWatchPool } from '../../services/preview/PreviewWatchPool'
import { createPreviewWatchCoordinator } from '../../services/preview/PreviewWatchCoordinator'
import { createPreviewReloadPolicy } from '../../services/preview/PreviewReloadPolicy'
import {
  createPreviewFindController,
  type PreviewFindContents
} from '../../services/preview/PreviewFindController'
import { createPreviewFailureLog } from '../../services/preview/PreviewFailureLog'
import { purge as purgePreviewSession } from '../../services/preview/PreviewStorageSeal'
import { createRearmingSingleFileWatcher } from '../../services/watcher/rearmingSingleFileWatch'
import { classifyConfinement } from '../../utils/projectConfinement'
import { confinePath } from '../../services/preview/previewPathResolve'
import {
  PreviewViewService,
  type IPreviewViewService,
  type PreviewFindExportService,
  type PreviewViewDeps,
  type PreviewWindowLike
} from '../../services/preview/PreviewViewService'
import type { IPreviewEligibilityService } from '../../services/preview/PreviewEligibilityService'
import type { IPreviewAllowlistStore } from '../../services/preview/PreviewAllowlistStore'
import {
  createPreviewCommentRegistry,
  type PreviewCommentShared
} from '../../services/preview/comments/commentServiceTypes'
import type { CommentIdentity } from '../../services/comments/CommentWriter'
import { createCommentUnsavedSources } from '../../services/comments/commentUnsavedSources'
import { focusHostWhileKey } from '../../services/preview/previewHostFocus'
import { createPreviewEmitters, type PreviewEmitTarget } from './emit'
import { createPreviewCommentEmitters } from './commentEmit'
import { createExternalLinkConsent } from './externalLinkConsent'
import { logger } from '../../services/LoggingService'

/** The composed service surface the handlers drive (lifecycle + find/export). */
export type PreviewComposedService = IPreviewViewService & PreviewFindExportService

/** External electron/singleton surfaces the graph is built against. */
export interface BuildPreviewGraphDeps {
  /** Current project root, resolved main-side (feeds store, eligibility, view). */
  readonly getProjectPath: () => string | null
  /** Reads the current global settings (the `htmlPreview.enabled` toggle). */
  readonly getSettings: () => GlobalSettings
  /** Live renderer targets for main→renderer emissions. */
  readonly resolveEmitTargets?: () => readonly PreviewEmitTarget[]
  /**
   * The zoom a view is sized with, read from the window it is handed – its host
   * (§4.3; issue #124, C3). Defaults to that window's own zoom.
   */
  readonly getZoomFactor?: PreviewViewDeps['getZoomFactor']
}

/** The constructed graph the composition root registers handlers against. */
export interface PreviewGraph {
  readonly service: PreviewComposedService
  readonly eligibility: IPreviewEligibilityService
  readonly allowlistStore: IPreviewAllowlistStore
  /** Cancels any pending coalesced emission; called on dispose. */
  readonly disposeEmitters: () => void
  /**
   * HTML Preview comments' shared collaborators – the registry the comment
   * handlers find a panel's service in, and the windows' unsaved files.
   * Optional so a test graph without comments stays valid.
   */
  readonly comments?: PreviewCommentShared
}

/** Preview-tuned entry-file watch timings (mirrors the pool's overrides, §1.4). */
const PREVIEW_ENTRY_WATCH_OVERRIDES: Partial<ChokidarOptions> = {
  awaitWriteFinish: {
    stabilityThreshold: PREVIEW.WATCH_STABILITY_MS,
    pollInterval: PREVIEW.WATCH_POLL_INTERVAL_MS
  }
}

/**
 * All live top-level renderer webContents (the default emission targets), each
 * wrapped with its window id. The id is routing metadata for an acting event
 * (`openFileRequested`), which goes to exactly the window whose preview asked
 * for it; it rides on the wrapper, never on the live Electron object (#120).
 */
export function defaultResolveEmitTargets(): readonly PreviewEmitTarget[] {
  return BrowserWindow.getAllWindows()
    .filter((win) => !win.isDestroyed())
    .map((win): PreviewEmitTarget => {
      const contents = win.webContents
      return {
        isDestroyed: () => contents.isDestroyed(),
        send: (channel, payload) => contents.send(channel, payload),
        windowId: win.id,
        focusHost: () => focusHostWhileKey(win)
      }
    })
}

/** The consent step for an external link, wired to the real Electron surfaces. */
const confirmThenOpenExternal = createExternalLinkConsent({
  resolveWindow: (windowId) => {
    const win = BrowserWindow.fromId(windowId)
    return win !== null && !win.isDestroyed() ? win : null
  },
  // `ConsentWindow` is a structural slice of `BrowserWindow`; `resolveWindow`
  // above only ever hands back a real one.
  showMessageBox: (win, options) => dialog.showMessageBox(win as BrowserWindow, options),
  openExternal: (url) => openExternalSafe(url)
})

/**
 * Absolute path of the built preview-page preload, or `null` when it is missing.
 *
 * Resolved HERE, at the composition root, and existence-checked — the frozen
 * `PREVIEW_WEB_PREFERENCES` literal must stay environment-independent, and
 * `__dirname` differs between a build and Vitest (sd-074b §5.2). A missing
 * bundle is logged loudly and degrades to inert links rather than a preview that
 * fails to open, mirroring `ScreenshotOverlayWindow`'s existsSync gate.
 */
function resolvePreviewPagePreload(): string | null {
  const preloadPath = join(__dirname, '../preload/previewPage.js')
  if (!existsSync(preloadPath)) {
    logger.error('Preview page preload missing; links inside previews will not work', undefined, {
      preloadPath
    })
    return null
  }
  return preloadPath
}

/**
 * The zoom factor of the window a view lives in (issue #124, C3). It used to be
 * the first of `BrowserWindow.getAllWindows()`, but Electron lists the newest
 * window first, so any second window sized the page with the wrong zoom.
 */
function defaultZoomFactor(window: Pick<PreviewWindowLike, 'webContents'>): number {
  return window.webContents.getZoomFactor()
}

/** The reviewer from the app-level settings; the writer checks and trims it (§7.9). */
function commentIdentityOf(settings: GlobalSettings): CommentIdentity | undefined {
  const { authorName, authorEmail } = settings.comments
  if (authorName === undefined) return undefined
  return authorEmail === undefined || authorEmail === '' ? { name: authorName } : { name: authorName, email: authorEmail }
}

/** What every view's comment service shares (html-preview-comments.md §4.2). */
function buildCommentShared(
  getSettings: () => GlobalSettings,
  resolveTargets: () => readonly PreviewEmitTarget[],
  getProjectPath: () => string | null
): PreviewCommentShared {
  return {
    registry: createPreviewCommentRegistry(),
    unsaved: createCommentUnsavedSources({ projectRoot: getProjectPath }),
    emit: createPreviewCommentEmitters({ resolveTargets }),
    identity: () => commentIdentityOf(getSettings()),
    isEnabled: () => isHtmlPreviewCommentsEnabled(getSettings()),
    cursor: () => screen.getCursorScreenPoint()
  }
}

/**
 * Build the preview object graph.
 */
export function buildPreviewGraph(deps: BuildPreviewGraphDeps): PreviewGraph {
  const { getProjectPath, getSettings } = deps
  const resolveTargets = deps.resolveEmitTargets ?? defaultResolveEmitTargets
  const getZoomFactor = deps.getZoomFactor ?? defaultZoomFactor

  const emitters = createPreviewEmitters({ resolveTargets })
  const comments = buildCommentShared(getSettings, resolveTargets, getProjectPath)

  const registry = createPreviewRootRegistry()
  const allowlistStore = createPreviewAllowlistStore({
    getProjectRoot: getProjectPath,
    // Parse-time badges are logged main-side; the built store is view-independent
    // and carries no panel context, so it cannot address a per-view failure log.
    onBadge: (badge) => logger.warn('Preview allowlist badge', { type: badge.type })
  })
  const sessionFactory = createPreviewSessionFactory({
    registry,
    allowlistStore,
    previewPagePreloadPath: resolvePreviewPagePreload(),
    // HTML Preview comments: the flag is read per request, so turning it off
    // serves the next page raw (docs/designs/comments/html-preview-comments.md §3).
    comments: { isEnabled: comments.isEnabled }
  })
  const stillFrameCache = createPreviewStillFrameCache()
  const exportController = createPreviewExportController()
  const gitignore = createGitignoreEvaluator()
  const eligibility = createPreviewEligibilityService({ gitignore, getSettings })

  const viewDeps: PreviewViewDeps = {
    sessionFactory,
    registry,
    stillFrameCache,
    exportController,
    storageSeal: {
      // Bridge the narrow structural session type to electron's own `Session`.
      purge: (session) => purgePreviewSession(session as unknown as Session)
    },
    getAllowedHosts: () => [...allowlistStore.getOrigins()],
    emit: emitters,
    createWatchCoordinator: (realRoot, onChanged) =>
      createPreviewWatchCoordinator({
        realRoot,
        // The pool re-arms each subresource watch across an atomic save; give it
        // the same realpath gate the coordinator uses so a re-arm re-confines the
        // path an external writer just replaced (TOCTOU).
        pool: createPreviewWatchPool({
          isPathConfined: async (candidate) => (await confinePath(realRoot, candidate)).ok
        }),
        onChanged
      }),
    createReloadPolicy: (onDecision) => createPreviewReloadPolicy({ onDecision }),
    // The OS hand-off for an external link, behind a confirmation owned by
    // the window whose preview asked.
    openExternal: confirmThenOpenExternal,
    createFindController: (wc, onCount) =>
      createPreviewFindController(wc as unknown as PreviewFindContents, onCount),
    createFailureLog: (onEmit) => createPreviewFailureLog({ onEmit }),
    createEntryWatcher: (filePath, handlers) =>
      createRearmingSingleFileWatcher(
        filePath,
        {
          onChange: handlers.onChange,
          // A genuine delete is the entry-file "missing" case; an atomic-save
          // rename re-arms instead, so live-reload survives editor saves.
          onDeleted: handlers.onUnlink,
          onError: handlers.onError
        },
        {
          overrides: PREVIEW_ENTRY_WATCH_OVERRIDES,
          isPathConfined: async (candidate) => {
            const root = getProjectPath()
            if (root === null) return true
            const verdict = await classifyConfinement(candidate, root)
            return verdict === 'inside' || verdict === 'missing'
          }
        }
      ),
    getProjectPath,
    getZoomFactor,
    // Same-tab links, `preview:navigate` and a resume run as a preview only
    // when this says so (issue #124, part 3 §3.5).
    checkEligibility: (filePath, projectPath) => eligibility.check(filePath, projectPath),
    now: Date.now,
    onForwardedShortcut: (panelId, key) => emitters.forwardedShortcut(panelId, key),
    comments
  }

  // No cast needed: the class `implements` both halves of the composed service,
  // so a signature drift on find/stopFind/exportPdf now fails to compile.
  const service: PreviewComposedService = new PreviewViewService(viewDeps)

  return {
    service,
    eligibility,
    allowlistStore,
    disposeEmitters: () => emitters.dispose(),
    comments
  }
}
