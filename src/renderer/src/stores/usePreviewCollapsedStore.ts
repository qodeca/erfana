// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Per-panel "this preview's page area is clipped away" flags (issue #124, part 1
 * §1.4, cause C2).
 *
 * WHY IT EXISTS. With the terminal expanded over the editor, the editor area is
 * 0 wide, but dockview keeps the editor group at its 100 px floor. The preview's
 * placeholder therefore still measures a valid box – one that a 0-wide clipping
 * ancestor paints nowhere. Nothing was dropped and nothing hid the page, so it
 * stayed drawn as a strip over the project tree. `usePreviewBounds` now sees that
 * the visible area is empty and sets this flag; the overlay guard, the single
 * owner of show/hide, reads it as a gate term and hides the page.
 *
 * WHY NOT `usePreviewChromeGateStore`. That store has one reason slot per panel,
 * owned by `usePreviewChromeGate`. Two writers would overwrite each other's
 * reason, and one writer's clear would lift the other's hide.
 *
 * WHY NOT `useOverlayOccluderStore`. It is global: a collapsed panel would blank
 * a second preview that has nothing to do with it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never touches `usePreviewViewportStore`.
 * The bounds hook withdraws the published rect itself, keyed on geometry, so the
 * flag can never feed the toast placement loop that store's header warns about.
 *
 * FOR THE DRAG FREEZE (WI-11): a collapsed panel counts as "no visible preview" –
 * read {@link PreviewCollapsedState.isCollapsed}. The page is already hidden, so
 * waiting for a hide confirmation would wait for an event that never comes.
 *
 * @see src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewBounds.ts - the only writer
 * @see src/renderer/src/services/preview/OverlayGuardService.ts - the reader that hides
 */
import { create } from 'zustand'

/** Store contract. */
export interface PreviewCollapsedState {
  /** Panels whose page area is clipped away. Absent means "not collapsed". */
  collapsed: ReadonlySet<string>
  /**
   * Marks a panel collapsed. An identical write does not notify, so a hook that
   * re-measures every frame cannot make the guard recompute every frame.
   *
   * @param panelId - The preview panel whose page area is clipped away
   */
  setCollapsed: (panelId: string) => void
  /**
   * Clears a panel's flag.
   *
   * MUST run on unmount, or a panel stays hidden forever with nothing on screen
   * saying why – the hook that would have cleared it has gone.
   *
   * @param panelId - The preview panel whose page area is back
   */
  clearCollapsed: (panelId: string) => void
  /**
   * Live read for the overlay guard.
   *
   * Reads state at call time rather than through a render snapshot, so a guard
   * recomputing inside the same tick as a write sees the new value.
   *
   * @param panelId - The preview panel to ask about
   * @returns `true` while the panel's page area is clipped away
   */
  isCollapsed: (panelId: string) => boolean
}

/**
 * The collapsed-flag store.
 *
 * @example
 * ```ts
 * usePreviewCollapsedStore.getState().setCollapsed('preview-1')
 * usePreviewCollapsedStore.getState().isCollapsed('preview-1') // → true
 * usePreviewCollapsedStore.getState().clearCollapsed('preview-1')
 * ```
 */
export const usePreviewCollapsedStore = create<PreviewCollapsedState>((set, get) => ({
  collapsed: new Set(),

  setCollapsed: (panelId) =>
    set((state) => {
      if (state.collapsed.has(panelId)) return state
      const collapsed = new Set(state.collapsed)
      collapsed.add(panelId)
      return { collapsed }
    }),

  clearCollapsed: (panelId) =>
    set((state) => {
      if (!state.collapsed.has(panelId)) return state
      const collapsed = new Set(state.collapsed)
      collapsed.delete(panelId)
      return { collapsed }
    }),

  isCollapsed: (panelId) => get().collapsed.has(panelId)
}))
