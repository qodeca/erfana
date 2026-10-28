// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Per-panel "this preview's own chrome covers its whole page area" flags
 * (HTML Preview comments, docs/designs/html-preview-comments.md §10.6).
 *
 * WHY IT EXISTS. Under a 640 px panel the comments drawer takes the whole width
 * of the page area, so the page has nowhere to show – and a native view paints
 * over every sibling DOM, so it must be hidden, not left over the list. The
 * comments hook sets this flag; the overlay guard, the single owner of
 * show/hide, reads it as a gate term and hides THIS panel's page.
 *
 * WHY NOT `useOverlayOccluderStore`. It is global, and dockview keeps every
 * opened tab mounted: a drawer left open in a tab the reader switched away from
 * hid the preview of the tab on screen, which froze on its still frame (owner
 * bug, rev 4). A gate applies to its own panel only, and it may stay set while
 * the tab is hidden, so coming back to the tab hides its page before the guard
 * would show it – no flash of the page over the drawer.
 *
 * WHY NOT `usePreviewCollapsedStore` or `usePreviewChromeGateStore`. Each has a
 * single writer; a second one would overwrite the first's flag, and its clear
 * would lift the other's hide.
 *
 * @see src/renderer/src/components/Panels/HtmlPreviewPanel/comments/useDrawerSheet.ts - the only writer
 * @see src/renderer/src/services/preview/OverlayGuardService.ts - the reader that hides
 */
import { create } from 'zustand'

/** Store contract. */
export interface PreviewCoveredState {
  /** Panels whose page area is covered by their own chrome. Absent means "not covered". */
  covered: ReadonlySet<string>
  /**
   * Marks a panel covered. An identical write does not notify, so the guard
   * does not recompute for nothing.
   *
   * @param panelId - The preview panel whose page area is covered
   */
  setCovered: (panelId: string) => void
  /**
   * Clears a panel's flag.
   *
   * MUST run on unmount, or a panel stays hidden forever with nothing on screen
   * saying why – the drawer that covered it has gone.
   *
   * @param panelId - The preview panel whose page area is uncovered
   */
  clearCovered: (panelId: string) => void
  /**
   * Live read for the overlay guard: state at call time, so a guard
   * recomputing in the same tick as a write sees the new value.
   *
   * @param panelId - The preview panel to ask about
   * @returns `true` while the panel's page area is covered
   */
  isCovered: (panelId: string) => boolean
}

/**
 * The covered-flag store.
 *
 * @example
 * ```ts
 * usePreviewCoveredStore.getState().setCovered('preview-1')
 * usePreviewCoveredStore.getState().isCovered('preview-1') // → true
 * usePreviewCoveredStore.getState().clearCovered('preview-1')
 * ```
 */
export const usePreviewCoveredStore = create<PreviewCoveredState>((set, get) => ({
  covered: new Set(),

  setCovered: (panelId) =>
    set((state) => {
      if (state.covered.has(panelId)) return state
      const covered = new Set(state.covered)
      covered.add(panelId)
      return { covered }
    }),

  clearCovered: (panelId) =>
    set((state) => {
      if (!state.covered.has(panelId)) return state
      const covered = new Set(state.covered)
      covered.delete(panelId)
      return { covered }
    }),

  isCovered: (panelId) => get().covered.has(panelId)
}))
