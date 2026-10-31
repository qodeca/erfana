// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview IPC composition root (Issue #74, work item 47; design §1.6, §4.4, §5).
 *
 * Builds the preview object graph (via {@link buildPreviewGraph}), registers the
 * lifecycle / find / allowlist handler bundles (items 44–46) and, beside the
 * lifecycle ones, `preview:navigate` and `preview:focusPage` (issue #124), the
 * HTML Preview comment channels (`comment-handlers.ts`), and wires the two
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
 * it lists (service, eligibility, allowlistStore) live in the
 * `PreviewGraph` this root builds; the registration deps here are the external
 * singleton surfaces (project path, global settings, sender predicate) plus an
 * injectable `graph` test seam.
 *
 * @see docs/designs/html-preview/sd-074-html-preview.md §1.6, §4.4, §5
 * @see src/main/ipc/claude-status-handlers.ts (the disposable-bundle precedent)
 */
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import type {
  GlobalSettings,
  GlobalSettingsChanged
} from '../../shared/ipc/global-settings-schema'
import {
  buildPreviewGraph,
  type BuildPreviewGraphDeps,
  type PreviewGraph
} from './preview/buildPreviewGraph'
import type { PreviewEmitTarget } from './preview/emit'
import { registerPreviewLifecycleHandlers } from './preview/lifecycle-handlers'
import { registerPreviewNavigationHandlers } from './preview/navigation-handlers'
import { registerPreviewFocusHandlers } from './preview/focus-handlers'
import { registerPreviewFindHandlers } from './preview/find-handlers'
import { registerPreviewAllowlistHandlers } from './preview/allowlist-handlers'
import { registerPreviewCommentHandlers } from './preview/comment-handlers'
import { isTrustedPreviewSender } from './preview/isTrustedPreviewSender'
import type { ProjectSession } from '../services/session/ProjectSession'
import { registerFileComments } from './comments/file-comments'
import { logger } from '../services/LoggingService'
import { redactedLogError } from '../utils/redactUserInput'

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
  /**
   * The project session. When given it feeds `subscribeProjectChanged` (unless
   * that is given too) and, with a graph that has comments, registers the
   * `file-comment:*` family (spec 024) on the same unsaved-files record as the
   * HTML Preview's comments, so a save is refused under any window's edits.
   */
  readonly session?: Pick<ProjectSession, 'current' | 'onChange'>
  /** Live renderer targets for main→renderer emissions (defaulted in the graph). */
  readonly resolveEmitTargets?: () => readonly PreviewEmitTarget[]
  /** The zoom a view is sized with, read from its host window (defaulted in the graph). */
  readonly getZoomFactor?: BuildPreviewGraphDeps['getZoomFactor']
  /** Sender predicate; defaults to {@link isTrustedPreviewSender}. */
  readonly isTrustedSender?: (event: IpcMainInvokeEvent | IpcMainEvent) => boolean
  /** Test seam: a pre-built graph; defaults to {@link buildPreviewGraph}. */
  readonly graph?: PreviewGraph
}

/** The disposable handler bundle returned to the app entry (item 48). */
export interface PreviewHandlerBundle {
  /** Zoom a focused previewed page; `false` when none is focused. */
  zoomFocused(step: number): Promise<boolean>
  /** Tear down every preview hosted by a window that is closing. */
  closeWindow(windowId: number): Promise<void>
  /**
   * A window-edge resize of `windowId` began (`held` true, `will-resize`) or
   * ended (`held` false, `resized`) (issue #124). Never throws: it runs inside
   * a window event, where a throw is an uncaught main-process exception.
   */
  setResizeHold(windowId: number, held: boolean): void
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
  // Same-tab moves and history steps (issue #124, part 3 §3.1).
  const unregisterNavigation = registerPreviewNavigationHandlers({
    service: graph.service,
    isTrustedSender
  })
  // The keyboard route into the page (issue #124, QG-8 U1).
  const unregisterFocus = registerPreviewFocusHandlers({
    service: graph.service,
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
  // HTML Preview comments (html-preview-comments.md §8), when the graph has them.
  const comments = graph.comments
  const unregisterComments =
    comments === undefined
      ? () => {}
      : registerPreviewCommentHandlers({ registry: comments.registry, unsaved: comments.unsaved, isTrustedSender })
  const session = deps.session
  const fileComments =
    comments === undefined || session === undefined
      ? null
      : registerFileComments({ session, unsaved: comments.unsaved, getSettings: () => globalSettings.getSettings() })

  // AC21: a global-off toggle tears down any live view immediately.
  const unsubscribeSettings = globalSettings.onSettingsChanged((event) => {
    if (!event.settings.htmlPreview.enabled) {
      void graph.service.destroyAll('globally-disabled')
    }
  })

  // §5(f): main-side belt-and-braces teardown on project switch.
  const subscribeProjectChanged =
    deps.subscribeProjectChanged ??
    (session === undefined
      ? undefined
      : (listener: (oldPath: string | null, newPath: string | null) => void) =>
          session.onChange((prev, next) => listener(prev?.root ?? null, next?.root ?? null)))
  const unsubscribeProject =
    subscribeProjectChanged?.((oldPath, newPath) => {
      void graph.service.onProjectChanged(oldPath, newPath)
    }) ?? (() => {})

  logger.info('✅ Preview IPC handlers registered')

  return {
    // Exposed so the composition root can route View-menu zoom here. Deliberately
    // a bundle member rather than this module importing the menu: the IPC layer
    // must not reach up into the app shell, and doing so also dragged the real
    // `electron` module into every test that loads this file.
    zoomFocused: (step: number): Promise<boolean> => graph.service.zoomFocused(step),

    closeWindow: (windowId: number): Promise<void> => graph.service.closeWindow(windowId),

    setResizeHold: (windowId: number, held: boolean): void => {
      try {
        graph.service.setResizeHold(windowId, held)
      } catch (error) {
        logger.error('Preview resize hold failed', redactedLogError(error), { windowId, held })
      }
    },

    dispose: async (): Promise<void> => {
      unregisterLifecycle()
      unregisterNavigation()
      unregisterFocus()
      unregisterFind()
      unregisterAllowlist()
      unregisterComments()
      unsubscribeSettings()
      unsubscribeProject()
      graph.disposeEmitters()
      await Promise.all([graph.service.dispose(), fileComments?.dispose()])
    }
  }
}
