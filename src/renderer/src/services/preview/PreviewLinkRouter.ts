// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Opens the file a previewed page's link pointed at (sd-074b §5.4).
 *
 * Main decides only "is this a real, confined, in-project path" and emits
 * `preview:openFileRequested` to the window that owns the preview. Everything
 * after that is the ordinary open path — the SAME one the project tree and the
 * terminal use:
 *
 *     resolvePanelKind(filePath) → openFileInPanel(dockviewApi, filePath, …)
 *
 * That is deliberate. Main deliberately sends no panel kind: keeping
 * `resolvePanelKind` the single owner means an ineligible `.html`
 * (`node_modules/`, `dist/`, gitignored) opens as SOURCE for a link click
 * exactly as it does for a tree click, without the rule existing twice. It also
 * keeps `preview-` ids minted inside `openFileInPanel`, which the ESLint guard
 * requires.
 *
 * A new preview tab opened by a link inherits the SOURCE tab's link mode
 * (issue #124, part 3 §3.3), passed as `params.linkMode`. `openFileInPanel`
 * applies params to a new panel only, so a tab that already shows the target
 * keeps its own mode.
 *
 * SAME-TAB LINKS (issue #124, part 3 §3.1, §3.6). Main sends a `disposition`:
 * `new-tab` (or none) takes the path above; `by-mode` becomes the SOURCE tab's
 * link mode; `same-tab` goes to the move coordinator (`previewTabMove.ts`),
 * which checks with main, asks about unsaved edits, commits and closes the
 * other tabs showing the page.
 *
 * ONE CREATOR (RA2-5). `EditorAreaSplitPanel` mounts the router on mount with
 * the unsaved-changes prompt and `closePanel` ({@link mountPreviewLinkRouter})
 * and disposes it on unmount. {@link getPreviewLinkRouter} only READS it and
 * returns `null` until then, so no early caller can create a router without a
 * prompt – which would refuse every move that needs one for good. The panel's
 * Back and Forward go through the same instance.
 *
 * The router reads the dockview API from the project store rather than from a
 * component — `EditorAreaSplitPanel` only sees the api inside a callback and
 * retains none.
 *
 * @see src/main/services/preview/previewLinkNavigation.ts - what sends this
 */
import type { DockviewApi } from 'dockview'

import type { PreviewOpenFileRequestedPayload } from '../../../../shared/ipc/preview-schema'
import { showGlobalToast } from '../../components/Toast/toastService'
import { useProjectStore } from '../../stores/useProjectStore'
import { usePreviewTabStore, type PreviewLinkMode } from '../../stores/usePreviewTabStore'
import { openFileInPanel } from '../../utils/openFileInPanel'
import { resolvePanelKind } from '../../utils/resolvePanelKind'
import { logger } from '../../utils/logger'
import { editorSaveRegistry } from '../editorSaveRegistry'
import {
  createPreviewBackFocuser,
  createPreviewTabMove,
  type PreviewMoveOutcome,
  type PreviewMovePrompt,
  type PreviewMoveRequest,
  type PreviewTabMove
} from './previewTabMove'

/** A mounted router; call {@link PreviewLinkRouter.dispose} to unsubscribe. */
export interface PreviewLinkRouter {
  /**
   * Moves a tab – a same-tab link, Back or Forward – through the coordinator.
   * Never rejects.
   *
   * @param request - The tab and where it goes
   * @returns How the move ended
   */
  move(request: PreviewMoveRequest): Promise<PreviewMoveOutcome>
  dispose(): void
}

/** Injected seams, so the routing is testable without the real bridge or store. */
export interface PreviewLinkRouterDeps {
  /** Subscribe to the main→renderer open request; returns an unsubscribe. */
  subscribe: (callback: (payload: PreviewOpenFileRequestedPayload) => void) => () => void
  /** The dockview api to open into, or `null` when no project is mounted. */
  getDockviewApi: () => Parameters<typeof openFileInPanel>[0] | null
  /** Decide which panel kind a path opens in; defaults to {@link resolvePanelKind}. */
  resolveKind?: typeof resolvePanelKind
  /** Read a tab's link mode; defaults to the preview tab store. */
  getLinkMode?: (panelId: string) => PreviewLinkMode
  /** The move coordinator a same-tab link goes through. */
  tabMove: Pick<PreviewTabMove, 'move'>
}

/** The production link-mode reader: the tab store, default mode when unknown. */
function readLinkMode(panelId: string): PreviewLinkMode {
  return usePreviewTabStore.getState().getTab(panelId).linkMode
}

/**
 * Start routing link-open requests into editor tabs.
 *
 * @param deps - Subscription source, dockview api reader and move coordinator.
 * @returns The mounted router.
 */
export function createPreviewLinkRouter(deps: PreviewLinkRouterDeps): PreviewLinkRouter {
  const resolveKind = deps.resolveKind ?? resolvePanelKind
  const getLinkMode = deps.getLinkMode ?? readLinkMode

  const unsubscribe = deps.subscribe((payload) => {
    // `by-mode` is a plain link: the source tab's mode decides (RA7). An
    // absent disposition is today's `new-tab`.
    const disposition = payload.disposition ?? 'new-tab'
    const sameTab =
      disposition === 'same-tab' ||
      (disposition === 'by-mode' && getLinkMode(payload.sourcePanelId) === 'same-tab')
    if (sameTab) {
      // Main already found the target eligible to run as a preview (table row
      // 6); the coordinator's check asks again before anything happens.
      void deps.tabMove.move({
        panelId: payload.sourcePanelId,
        origin: 'page',
        action: 'open',
        filePath: payload.filePath,
        anchor: payload.anchor
      })
      return
    }

    void (async () => {
      const dockviewApi = deps.getDockviewApi()
      if (dockviewApi === null) {
        // The project closed between the click and this event.
        return
      }

      try {
        const kind = await resolveKind(payload.filePath)
        openFileInPanel(
          dockviewApi,
          payload.filePath,
          // A running preview needs the always-mounted renderer, exactly as the
          // project tree passes it, and a new one inherits the source tab's
          // mode. A link mode means nothing to an editor or an image tab.
          kind === 'preview'
            ? {
                kind,
                renderer: 'always',
                params: { linkMode: getLinkMode(payload.sourcePanelId) }
              }
            : { kind }
        )
      } catch (error) {
        logger.error(
          'Failed to open a file requested by a preview link',
          error instanceof Error ? error : undefined,
          { sourcePanelId: payload.sourcePanelId }
        )
      }
    })()
  })

  return {
    move: (request) => deps.tabMove.move(request),
    dispose(): void {
      unsubscribe()
    }
  }
}

/** What the one creator hands the production router. */
export interface MountPreviewLinkRouterDeps {
  /**
   * The unsaved-changes prompt (the dialog context's `showUnsavedChanges`).
   * Without one, a move that would need it is refused, never guessed.
   */
  prompt?: PreviewMovePrompt | null
  /** Closes a tab by id and clears its dirty flag (`tabOperations.closePanel`). */
  closePanel: (panelId: string) => void
}

let mounted: PreviewLinkRouter | null = null

/**
 * Creates the production router and its move coordinator, wired to the preview
 * bridge, the project store, the save registry and the given prompt. Called by
 * `EditorAreaSplitPanel` on mount – the only creator (RA2-5).
 *
 * A second call disposes the router it replaces, so a remounted dialog
 * provider binds its own prompt. Disposing the returned router unsubscribes it
 * and, while it is still the mounted one, empties {@link getPreviewLinkRouter}.
 *
 * @param deps - The prompt and `closePanel`
 * @returns The mounted router
 *
 * @example
 * ```tsx
 * useEffect(() => {
 *   const router = mountPreviewLinkRouter({ prompt: showUnsavedChanges, closePanel: closeTab })
 *   return () => router.dispose()
 * }, [showUnsavedChanges])
 * ```
 */
export function mountPreviewLinkRouter(deps: MountPreviewLinkRouterDeps): PreviewLinkRouter {
  mounted?.dispose()

  const getDockviewApi = (): DockviewApi | null => useProjectStore.getState().dockviewApi
  const tabMove = createPreviewTabMove({
    getDockviewApi,
    navigate: (request) => window.api.preview.navigate(request),
    closePanel: deps.closePanel,
    isDirty: (panelId) => useProjectStore.getState().dirtyPanelIds.has(panelId),
    hasConflict: (panelId) => editorSaveRegistry.hasConflict(panelId),
    save: (panelId) => editorSaveRegistry.save(panelId),
    holdAutosave: (panelId) => editorSaveRegistry.holdAutosave(panelId),
    prompt: deps.prompt ?? null,
    focusBack: createPreviewBackFocuser(getDockviewApi),
    showToast: showGlobalToast,
    logger
  })
  const router = createPreviewLinkRouter({
    subscribe: (callback) => {
      // Always there in the app. Without it, routing is off rather than the
      // editor area crashing in this mount effect; a move's `navigate` then
      // fails too, which the coordinator reads as "not ready".
      const bridge = window.api?.preview
      if (!bridge) {
        logger.warn('Preview link router: no preview bridge; links from pages are not routed')
        return () => {}
      }
      return bridge.onOpenFileRequested(callback)
    },
    getDockviewApi,
    tabMove
  })

  const instance: PreviewLinkRouter = {
    move: router.move,
    dispose(): void {
      router.dispose()
      if (mounted === instance) mounted = null
    }
  }
  mounted = instance
  return instance
}

/**
 * The mounted production router, or `null` before `EditorAreaSplitPanel`
 * mounts it and after it unmounts. A reader only: it never creates one.
 *
 * @returns The mounted router, or `null`
 */
export function getPreviewLinkRouter(): PreviewLinkRouter | null {
  return mounted
}

/** Disposes and clears the mounted router. For tests and hard teardown. */
export function resetPreviewLinkRouter(): void {
  mounted?.dispose()
  mounted = null
}
