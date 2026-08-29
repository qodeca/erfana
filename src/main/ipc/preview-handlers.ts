// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview IPC composition root (Issue #74, work item 47; design §1.6, §4.4, §5).
 *
 * Builds the preview object graph (via {@link buildPreviewGraph}), registers the
 * lifecycle / find / allowlist handler bundles (items 44–46), and wires the two
 * cross-cutting hops:
 *   - `globalSettings.onSettingsChanged` → `service.destroyAll('globally-disabled')`
 *     when `htmlPreview.enabled` flips false (AC21). Without this hop AC21 would
 *     only hold for previews opened AFTER the toggle (design §1.6).
 *   - project-change → `service.onProjectChanged` (design §5(f)), via the
 *     injectable `subscribeProjectChanged` seam.
 *
 * Returns a disposable bundle mirroring `claude-status-handlers.ts`: `dispose()`
 * removes every handler, unsubscribes both hops, cancels pending emissions and
 * disposes the service (tearing down any live view).
 *
 * Reconciliation with §4.4's `PreviewHandlerDeps`: the constructed collaborators
 * it lists (service, eligibility, allowlistStore, hostBlockNotifier) live in the
 * `PreviewGraph` this root builds; the registration deps here are the external
 * singleton surfaces (project path, global settings, sender predicate) plus an
 * injectable `graph` test seam.
 *
 * @see docs/designs/sd-074-html-preview.md §1.6, §4.4, §5
 * @see src/main/ipc/claude-status-handlers.ts (the disposable-bundle precedent)
 */
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type {
  GlobalSettings,
  GlobalSettingsChanged
} from '../../shared/ipc/global-settings-schema'
import { buildPreviewGraph, type PreviewGraph } from './preview/buildPreviewGraph'
import type { PreviewEmitTarget } from './preview/emit'
import { registerPreviewLifecycleHandlers } from './preview/lifecycle-handlers'
import { registerPreviewFindHandlers } from './preview/find-handlers'
import { registerPreviewAllowlistHandlers } from './preview/allowlist-handlers'
import { isTrustedPreviewSender } from './preview/isTrustedPreviewSender'
import { logger } from '../services/LoggingService'

/** The global-settings surface the composition root subscribes to. */
export interface PreviewGlobalSettingsLike {
  getSettings(): GlobalSettings
  onSettingsChanged(callback: (event: GlobalSettingsChanged) => void): () => void
}

/** Composition-root registration dependencies. */
export interface PreviewHandlerDeps {
  /** Current project root, resolved main-side (never from the renderer). */
  readonly getProjectPath: () => string | null
  /** Reads + observes global settings for the AC21 global-off toggle. */
  readonly globalSettings: PreviewGlobalSettingsLike
  /**
   * Subscribe to project changes; the returned function unsubscribes. Optional
   * because the renderer already drives `preview:close` on project switch
   * (design §5(f)); wired main-side as belt-and-braces when a source exists.
   */
  readonly subscribeProjectChanged?: (
    listener: (oldPath: string | null, newPath: string | null) => void
  ) => () => void
  /** Live renderer targets for main→renderer emissions (defaulted in the graph). */
  readonly resolveEmitTargets?: () => readonly PreviewEmitTarget[]
  /** Host-window zoom factor for bounds conversion (defaulted in the graph). */
  readonly getZoomFactor?: () => number
  /** Sender predicate; defaults to {@link isTrustedPreviewSender}. */
  readonly isTrustedSender?: (event: IpcMainInvokeEvent | IpcMainEvent) => boolean
  /** Test seam: a pre-built graph; defaults to {@link buildPreviewGraph}. */
  readonly graph?: PreviewGraph
}

/** The disposable handler bundle returned to the app entry (item 48). */
export interface PreviewHandlerBundle {
  /** Zoom a focused previewed page; `false` when none is focused. */
  zoomFocused(step: number): Promise<boolean>
  dispose: () => Promise<void>
}

/**
 * Register the preview IPC surface and construct its object graph.
 */
export function registerPreviewHandlers(deps: PreviewHandlerDeps): PreviewHandlerBundle {
  const { getProjectPath, globalSettings } = deps
  const isTrustedSender = deps.isTrustedSender ?? isTrustedPreviewSender

  const graph =
    deps.graph ??
    buildPreviewGraph({
      getProjectPath,
      getSettings: () => globalSettings.getSettings(),
      resolveEmitTargets: deps.resolveEmitTargets,
      getZoomFactor: deps.getZoomFactor
    })

  const unregisterLifecycle = registerPreviewLifecycleHandlers({
    service: graph.service,
    eligibility: graph.eligibility,
    getProjectPath,
    isTrustedSender
  })
  const unregisterFind = registerPreviewFindHandlers({
    service: graph.service,
    isTrustedSender
  })
  const unregisterAllowlist = registerPreviewAllowlistHandlers({
    allowlistStore: graph.allowlistStore,
    service: graph.service,
    isTrustedSender
  })

  // AC21: a global-off toggle tears down any live view immediately.
  const unsubscribeSettings = globalSettings.onSettingsChanged((event) => {
    if (!event.settings.htmlPreview.enabled) {
      void graph.service.destroyAll('globally-disabled')
    }
  })

  // §5(f): main-side belt-and-braces teardown on project switch.
  const unsubscribeProject =
    deps.subscribeProjectChanged?.((oldPath, newPath) => {
      void graph.service.onProjectChanged(oldPath, newPath)
    }) ?? (() => {})

  logger.info('✅ Preview IPC handlers registered')

  return {
    // Exposed so the composition root can route View-menu zoom here. Deliberately
    // a bundle member rather than this module importing the menu: the IPC layer
    // must not reach up into the app shell, and doing so also dragged the real
    // `electron` module into every test that loads this file.
    zoomFocused: (step: number): Promise<boolean> => graph.service.zoomFocused(step),

    dispose: async (): Promise<void> => {
      unregisterLifecycle()
      unregisterFind()
      unregisterAllowlist()
      unsubscribeSettings()
      unsubscribeProject()
      graph.disposeEmitters()
      await graph.service.dispose()
    }
  }
}
