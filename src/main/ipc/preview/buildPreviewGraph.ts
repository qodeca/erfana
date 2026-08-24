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
import { BrowserWindow } from 'electron'
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
import { createPreviewFindController } from '../../services/preview/PreviewFindController'
import { createPreviewFailureLog } from '../../services/preview/PreviewFailureLog'
import { purge as purgePreviewSession } from '../../services/preview/PreviewStorageSeal'
import { createSingleFileWatcher } from '../../services/watcher/singleFileWatch'
import {
  PreviewViewService,
  type IPreviewViewService,
  type PreviewViewDeps
} from '../../services/preview/PreviewViewService'
import type { IPreviewEligibilityService } from '../../services/preview/PreviewEligibilityService'
import type { IPreviewAllowlistStore } from '../../services/preview/PreviewAllowlistStore'
import { createPreviewEmitters, type PreviewEmitTarget } from './emit'
import type { PreviewFindExportService } from './find-handlers'
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
    .map((win) => win.webContents)
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
  const sessionFactory = createPreviewSessionFactory({ registry, allowlistStore })
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
      purge: (session) => purgePreviewSession(session as unknown as never)
    },
    hostBlockNotifier,
    emit: emitters,
    createWatchCoordinator: (realRoot, onChanged) =>
      createPreviewWatchCoordinator({ realRoot, pool: createPreviewWatchPool(), onChanged }),
    createReloadPolicy: (onDecision) => createPreviewReloadPolicy({ onDecision }),
    createFindController: (wc, onCount) =>
      createPreviewFindController(wc as unknown as never, onCount),
    createFailureLog: (onEmit) => createPreviewFailureLog({ onEmit }),
    createEntryWatcher: (filePath, handlers) =>
      createSingleFileWatcher(filePath, handlers, PREVIEW_ENTRY_WATCH_OVERRIDES),
    getProjectPath,
    getZoomFactor,
    now: Date.now,
    onForwardedShortcut: (panelId, key) => emitters.forwardedShortcut(panelId, key)
  }

  const service = new PreviewViewService(viewDeps) as PreviewComposedService

  return {
    service,
    eligibility,
    allowlistStore,
    disposeEmitters: () => emitters.dispose()
  }
}
