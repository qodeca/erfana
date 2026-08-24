// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewFindShortcuts hook (Issue #74, work item 71).
 *
 * When the preview is the active tab its native `WebContentsView` sits on top
 * and receives keystrokes, so a renderer-level Cmd/Ctrl+F never fires. Main's
 * `before-input-event` forwarding sends the four enumerated accelerators
 * (design §1.9) back as `preview:forwardedShortcut`; this hook routes each one
 * to a panel-supplied action:
 *
 * - **Cmd/Ctrl+F** → open the find bar.
 * - **Cmd/Ctrl+S** → export the preview to PDF (UX-003).
 * - **Cmd/Ctrl+W** → close the panel (UX-006).
 * - **Escape** → close the find bar with full cleanup (UX-007).
 *
 * The panel owns the actions because the find close must run the *provider's*
 * `clearHighlights()` and restore focus — exactly like `SearchBar.handleClose`,
 * which this path previously bypassed. The renderer-focus case (placeholder
 * focused while the view is hidden) is covered separately by the global
 * {@link useSearchKeyboard} the panel also mounts.
 *
 * @module usePreviewFindShortcuts
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import { useEffect, useRef } from 'react'

/** The panel actions the forwarded accelerators drive. */
export interface PreviewShortcutActions {
  /** Open the find bar (forwarded Cmd/Ctrl+F). */
  openSearch: () => void
  /**
   * Close the find bar with full cleanup — clear the provider's highlights and
   * restore focus, matching `SearchBar.handleClose` (forwarded Escape, UX-007).
   * A no-op when the bar is not open.
   */
  closeSearch: () => void
  /** Export the preview to PDF (forwarded Cmd/Ctrl+S, UX-003). */
  exportPdf: () => void
  /** Close the preview panel (forwarded Cmd/Ctrl+W, UX-006). */
  closePanel: () => void
}

/**
 * Routes forwarded preview accelerators to the panel's actions, for the given
 * panel only.
 *
 * @param panelId - The preview panel whose forwarded shortcuts to honour.
 * @param actions - The panel actions each accelerator drives.
 *
 * @example
 * ```tsx
 * usePreviewFindShortcuts(panelId, {
 *   openSearch, closeSearch, exportPdf, closePanel
 * })
 * ```
 */
export function usePreviewFindShortcuts(
  panelId: string,
  actions: PreviewShortcutActions
): void {
  // Read the latest actions from the stable subscription without resubscribing
  // on every render (the actions are memoised in the panel but their identity
  // can still change).
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    const unsubscribe = window.api.preview.onForwardedShortcut((payload) => {
      if (payload.panelId !== panelId) return

      const current = actionsRef.current
      // `accel` = Cmd on macOS, Ctrl elsewhere (design §1.9).
      if (payload.key === 'f' && payload.accel) {
        current.openSearch()
      } else if (payload.key === 's' && payload.accel) {
        current.exportPdf()
      } else if (payload.key === 'w' && payload.accel) {
        current.closePanel()
      } else if (payload.key === 'Escape') {
        current.closeSearch()
      }
    })

    return unsubscribe
  }, [panelId])
}
