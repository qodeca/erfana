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
 * @see docs/designs/sd-074-html-preview.md §4.4, §5(a)
 */
import { BrowserWindow, dialog, shell, type Session } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { WatchOptions } from 'chokidar'
import { PREVIEW } from '../../../shared/constants'
import type { GlobalSettings } from '../../../shared/ipc/global-settings-schema'
import { createPreviewRootRegistry } from '../../services/preview/PreviewRootRegistry'
import { createPreviewAllowlistStore } from '../../services/preview/PreviewAllowlistStore'
import { createPreviewSessionFactory } from '../../services/preview/PreviewSessionFactory'
import { createPreviewHostBlockNotifier } from '../../services/preview/PreviewHostBlockNotifier'
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
  type PreviewViewDeps
} from '../../services/preview/PreviewViewService'
import type { IPreviewEligibilityService } from '../../services/preview/PreviewEligibilityService'
import type { IPreviewAllowlistStore } from '../../services/preview/PreviewAllowlistStore'
import { createPreviewEmitters, type PreviewEmitTarget } from './emit'
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
  /** Host-window zoom factor for bounds conversion (§4.3). */
  readonly getZoomFactor?: () => number
}

/** The constructed graph the composition root registers handlers against. */
export interface PreviewGraph {
  readonly service: PreviewComposedService
  readonly eligibility: IPreviewEligibilityService
  readonly allowlistStore: IPreviewAllowlistStore
  /** Cancels any pending coalesced emission; called on dispose. */
  readonly disposeEmitters: () => void
}

/** Preview-tuned entry-file watch timings (mirrors the pool's overrides, §1.4). */
const PREVIEW_ENTRY_WATCH_OVERRIDES: Partial<WatchOptions> = {
  awaitWriteFinish: {
    stabilityThreshold: PREVIEW.WATCH_STABILITY_MS,
    pollInterval: PREVIEW.WATCH_POLL_INTERVAL_MS
  }
}

/** All live top-level renderer webContents (the default emission targets). */
function defaultResolveEmitTargets(): readonly PreviewEmitTarget[] {
  return BrowserWindow.getAllWindows()
    .filter((win) => !win.isDestroyed())
    .map((win) => {
      // Carry the window id so an acting event (`openFileRequested`) can be sent
      // to exactly the window whose preview asked for it.
      const target = win.webContents as unknown as PreviewEmitTarget & { windowId?: number }
      return Object.assign(target, { windowId: win.id })
    })
}

/**
 * Show where an external link goes, then open it only if the user agrees
 * (sd-074b §5.5).
 *
 * The URL has already been parsed and allow-listed by the navigation policy, and
 * the click was a genuine user gesture — but a gesture is not informed consent.
 * A previewed page owns its whole viewport and can move an anchor under the
 * cursor between mousedown and click, and the preview has no address bar, no
 * status bar and no hover-URL, so the destination is otherwise invisible.
 *
 * The destination shown is the ORIGIN (or the address for `mailto:`), not the
 * full URL: it is the part that decides where you actually end up, and it keeps
 * a hostile path or query from filling the dialog.
 *
 * Cancel is the default button, so dismissing the dialog opens nothing.
 *
 * SERIALISED. Link routing is fire-and-forget (`void routeLinkActivation(…)`),
 * so without a queue several activations could each open a modal and stack them
 * on top of one another — consent fatigue at best, an unusable app at worst
 * (lens review F1). One dialog is in flight at a time, process-wide.
 */
let externalConfirmChain: Promise<void> = Promise.resolve()

async function confirmThenOpenExternal(url: string): Promise<void> {
  const run = externalConfirmChain.then(() => showConfirmAndOpen(url))
  // Keep the chain alive even if this link's dialog or hand-off rejects; a
  // failure must not wedge every later external link.
  externalConfirmChain = run.catch(() => undefined)
  return run
}

/**
 * What the consent dialog names as the destination.
 *
 * `URL.origin` is the STRING `"null"` for every non-special scheme — `tel:`,
 * `sms:`, `mailto:` — and `"null"` is truthy, so `origin || protocol` printed
 * the literal word "null" as the destination. That dialog is the only thing
 * between an untrusted page and an OS hand-off, and for those schemes it named
 * nothing at all.
 *
 * Never the full href: it is attacker-controlled, so it is both a leak surface
 * (a `mailto:` body, a query string) and a log/UI-injection surface. Scheme plus
 * the addressed target is enough to decide with.
 */
export function describeExternalDestination(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return '(unparseable link)'
  }
  if (parsed.origin !== 'null' && parsed.origin !== '') {
    return parsed.origin
  }
  // Opaque-origin scheme: the pathname carries the number or address.
  const target = parsed.pathname
  return target === '' ? parsed.protocol : `${parsed.protocol}${target}`
}

async function showConfirmAndOpen(url: string): Promise<void> {
  const destination = describeExternalDestination(url)

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', 'Open'],
    defaultId: 0,
    cancelId: 0,
    message: 'Open this link outside Erfana?',
    detail: `The preview wants to open:\n\n${destination}`
  })

  if (response === 1) {
    await shell.openExternal(url)
  }
}

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

/** The host window's zoom factor, or 1 when no window is available. */
function defaultZoomFactor(): number {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  return win?.webContents.getZoomFactor() ?? 1
}

/**
 * Build the preview object graph.
 */
export function buildPreviewGraph(deps: BuildPreviewGraphDeps): PreviewGraph {
  const { getProjectPath, getSettings } = deps
  const resolveTargets = deps.resolveEmitTargets ?? defaultResolveEmitTargets
  const getZoomFactor = deps.getZoomFactor ?? defaultZoomFactor

  const emitters = createPreviewEmitters({ resolveTargets })

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
    previewPagePreloadPath: resolvePreviewPagePreload()
  })
  const hostBlockNotifier = createPreviewHostBlockNotifier()
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
    hostBlockNotifier,
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
    // The OS hand-off for an external link, behind a confirmation.
    openExternal: (url) => confirmThenOpenExternal(url),
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
    now: Date.now,
    onForwardedShortcut: (panelId, key) => emitters.forwardedShortcut(panelId, key)
  }

  // No cast needed: the class `implements` both halves of the composed service,
  // so a signature drift on find/stopFind/exportPdf now fails to compile.
  const service: PreviewComposedService = new PreviewViewService(viewDeps)

  return {
    service,
    eligibility,
    allowlistStore,
    disposeEmitters: () => emitters.dispose()
  }
}
