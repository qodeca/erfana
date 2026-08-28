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
 * Mounted next to the overlay guard, and like it, reads the dockview API from
 * the project store rather than from a component — `EditorAreaSplitPanel` only
 * sees the api inside a callback and retains none.
 *
 * @see src/main/services/preview/previewLinkNavigation.ts - what sends this
 */
import type { PreviewOpenFileRequestedPayload } from '../../../../shared/ipc/preview-schema'
import { useProjectStore } from '../../stores/useProjectStore'
import { openFileInPanel } from '../../utils/openFileInPanel'
import { resolvePanelKind } from '../../utils/resolvePanelKind'
import { logger } from '../../utils/logger'

/** A mounted router; call {@link PreviewLinkRouter.dispose} to unsubscribe. */
export interface PreviewLinkRouter {
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
}

/**
 * Start routing link-open requests into editor tabs.
 *
 * @param deps - Subscription source and dockview api reader.
 * @returns The mounted router.
 */
export function createPreviewLinkRouter(deps: PreviewLinkRouterDeps): PreviewLinkRouter {
  const resolveKind = deps.resolveKind ?? resolvePanelKind

  const unsubscribe = deps.subscribe((payload) => {
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
          // project tree passes it.
          kind === 'preview' ? { kind, renderer: 'always' } : { kind }
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
    dispose(): void {
      unsubscribe()
    }
  }
}

let singleton: PreviewLinkRouter | null = null

/**
 * The production router singleton, wired to the preview bridge and the project
 * store. Idempotent: calling it twice returns the same router rather than
 * double-subscribing.
 *
 * @returns The lazily-created singleton.
 */
export function getPreviewLinkRouter(): PreviewLinkRouter {
  if (singleton) return singleton
  singleton = createPreviewLinkRouter({
    subscribe: (callback) => window.api.preview.onOpenFileRequested(callback),
    getDockviewApi: () =>
      useProjectStore.getState().dockviewApi as Parameters<typeof openFileInPanel>[0] | null
  })
  return singleton
}

/** Disposes and clears the production singleton. For tests and hard teardown. */
export function resetPreviewLinkRouter(): void {
  singleton?.dispose()
  singleton = null
}
