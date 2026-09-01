// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Per-panel reasons the previewed page must stay hidden.
 *
 * WHY THIS IS NOT `useOverlayOccluderStore`. That store counts overlays by KIND
 * and yields one boolean for the whole window, which is right for a dialog or a
 * menu — those really do cover every preview. A permission band waiting for one
 * page to prove it moved is a fact about ONE panel, and routing it through a
 * global boolean would blank the other preview in a split view for a reason that
 * has nothing to do with it. Widening `isOccluded()` with a panel dimension would
 * also change the contract for every existing caller to model something none of
 * them mean.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never touches `usePreviewViewportStore`.
 * Withdrawing a panel's published rect would feed toast placement, which would
 * report `blocked`, which registers the global toast occluder, which hides every
 * preview, which changes the rect state, which changes the placement — the
 * per-frame loop that store's own header warns about. The gate hides the page;
 * the rect keeps describing where the page's box is.
 *
 * @see design/system/components/permission-band/index.html - status="decided"
 */
import { create } from 'zustand'

/** Why one panel's page is being held hidden. */
export type PreviewChromeGateReason =
  /** The page has not confirmed it repainted below the chrome that just grew. */
  | 'unconfirmed'
  /** The panel is too short to split between chrome and a usable page. */
  | 'too-short'

export interface PreviewChromeGateState {
  /** Panels currently gated, and why. Absent means "not gated". */
  gates: ReadonlyMap<string, PreviewChromeGateReason>
  setGate: (panelId: string, reason: PreviewChromeGateReason) => void
  clearGate: (panelId: string) => void
  /**
   * Live read for the overlay guard.
   *
   * Reads state at call time rather than through a render snapshot, so a guard
   * recomputing inside the same tick as a `setGate` sees the new value.
   */
  getGate: (panelId: string) => PreviewChromeGateReason | null
}

export const usePreviewChromeGateStore = create<PreviewChromeGateState>((set, get) => ({
  gates: new Map(),

  setGate: (panelId, reason) =>
    set((state) => {
      // An identical write must not notify: the guard subscribes to this, and a
      // no-op notification would recompute visibility for every live preview.
      if (state.gates.get(panelId) === reason) return state
      const gates = new Map(state.gates)
      gates.set(panelId, reason)
      return { gates }
    }),

  /**
   * MUST run on unmount, or a panel stays paused forever with nothing on screen
   * explaining why — the band that would have said so has gone with it.
   */
  clearGate: (panelId) =>
    set((state) => {
      if (!state.gates.has(panelId)) return state
      const gates = new Map(state.gates)
      gates.delete(panelId)
      return { gates }
    }),

  getGate: (panelId) => get().gates.get(panelId) ?? null
}))
