// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview UI store (Issue #74, work item 68).
 *
 * Holds the renderer-side UI state for HTML preview panels: per-panel load
 * state, failure list + badge count, and the current still frame, plus the
 * single global `holderPanelId` that drives the "a preview is already open"
 * refusal message (design §1.4 X20/NEW-9, §1.8).
 *
 * State is keyed by `panelId` in a `Map` (mirroring `useSearchStore`'s
 * `providerStates` convention) so multiple refused/closing panels stay isolated;
 * only ONE preview is ever live, but a refused panel still renders its own
 * limit-reached UI keyed by its own id. Payload shapes come from the shared
 * schema (item 41) and types (item 4) — this store never re-defines them.
 */

import { create } from 'zustand'
import type { PreviewBlockedKind } from '../../../shared/ipc/previewBlockedKind'
import type { PreviewStillFrame } from '../../../shared/ipc/preview-types'
import type {
  PreviewFailure,
  PreviewLoadStatePayload
} from '../../../shared/ipc/preview-schema'

/**
 * The four load states a preview panel can be in.
 *
 * Derived from the `preview:loadStateChanged` payload (item 41) so the union
 * never drifts from the IPC contract: `idle | loading | ready | failed`.
 */
export type PreviewLoadState = PreviewLoadStatePayload['state']

/**
 * Per-panel preview UI state.
 *
 * `dropped` is the count of watch-set candidates confined out of the project
 * root (design §1.4); it is surfaced alongside `loadState` as a badge and is
 * distinct from `failures`, which are resource/CSP/network problems (AC20).
 */
export interface PreviewPanelState {
  /** Current load lifecycle state for this panel. */
  loadState: PreviewLoadState
  /** Number of watch candidates dropped for escaping the project root. */
  dropped: number
  /** Coalesced failure entries most recently reported for this panel. */
  failures: PreviewFailure[]
  /** `true` when the failure ring buffer overflowed `MAX_FAILURES` main-side. */
  truncated: boolean
  /** Latest still frame captured on hide, or `null` to fall back to the placeholder. */
  stillFrame: PreviewStillFrame | null
  /**
   * The colour main is painting BEHIND the page (`#RRGGBB`), or `null` before the
   * first report.
   *
   * The panel paints the identical value on its placeholder. That equality is
   * the invariant replacing sd-074 §1.8's "both are brand black", which no
   * longer holds now the backdrop follows the page's own paper: keeping the two
   * sides equal is what stops a bounds update, or a show with no cached still
   * frame, flashing a band of the wrong colour.
   */
  backdrop: string | null
  /**
   * Every remote host this panel has been refused, in first-seen order.
   *
   * DELIBERATELY NOT DERIVED FROM `failures`. Approving a host runs
   * `applyApprovedHosts`, which calls `failureLog.clear()` — so a list built on
   * the failure log empties the moment the reader approves anything, exactly
   * when they are mid-way through a cascade and about to approve the next one.
   * This slice is fed by `hostBlocked` events and is never cleared by
   * `clearFailures`.
   *
   * It survives the page reload that follows an approval, because the React
   * panel does not unmount when the previewed page reloads. It dies with the
   * panel, which is right: a fresh panel re-discovers on load.
   */
  blockedHosts: PreviewBlockedHost[]
}

/** One remote host the preview was refused, and what it wanted. */
export interface PreviewBlockedHost {
  readonly host: string
  /** What it was refused FOR, accumulated across sightings. */
  readonly kinds: readonly PreviewBlockedKind[]
  /** `false` for a host that may never be approved (an IP literal, localhost). */
  readonly approvable: boolean
}

/** The state a panel occupies before any event has arrived for it. */
const DEFAULT_PANEL_STATE: PreviewPanelState = {
  loadState: 'idle',
  blockedHosts: [],
  dropped: 0,
  failures: [],
  truncated: false,
  stillFrame: null,
  backdrop: null
}

/**
 * Preview store state, selectors, and actions.
 *
 * Selectors are getters returning defined fallbacks for unknown panels, so
 * callers never branch on `undefined`. Actions replace the panel's `Map` entry
 * immutably (new `Map` each write) so zustand's shallow equality notifies
 * subscribers.
 */
export interface PreviewStoreState {
  /** Per-panel UI state, keyed by dockview panel id. */
  panels: Map<string, PreviewPanelState>
  /**
   * The panel id of the currently live preview when another `open` is refused
   * with `PREVIEW_VIEW_LIMIT_REACHED`, or `null` when no refusal is pending.
   * Drives the refused panel's "Close the other preview" affordance (NEW-9).
   */
  holderPanelId: string | null

  // --- Selectors ---
  /**
   * @param panelId - Panel to read.
   * @returns The panel's state, or `undefined` if none has been recorded.
   */
  getPanel: (panelId: string) => PreviewPanelState | undefined
  /**
   * @param panelId - Panel to read.
   * @returns The panel's load state, or `'idle'` when unknown.
   */
  getLoadState: (panelId: string) => PreviewLoadState
  /**
   * @param panelId - Panel to read.
   * @returns The panel's failure entries, or `[]` when unknown.
   */
  getFailures: (panelId: string) => PreviewFailure[]
  /**
   * @param panelId - Panel to read.
   * @returns The failure badge count for this panel (0 when unknown).
   */
  getFailureCount: (panelId: string) => number
  /**
   * @param panelId - Panel to read.
   * @returns The panel's still frame, or `null` when none/unknown.
   */
  getStillFrame: (panelId: string) => PreviewStillFrame | null

  // --- Actions ---
  /**
   * Sets the load state (and optional dropped count) for a panel.
   * @param panelId - Panel to update.
   * @param loadState - New load state.
   * @param dropped - Optional new dropped-candidate count; preserved if omitted.
   */
  setLoadState: (panelId: string, loadState: PreviewLoadState, dropped?: number) => void
  /**
   * Replaces a panel's failure list with the latest coalesced report.
   *
   * Semantics are REPLACE, not append: the main-side `PreviewFailureLog` is the
   * ring-buffer of record and sends the whole current list on each coalesced
   * `failuresChanged` (§1.3), so the store mirrors that authoritative snapshot.
   *
   * @param panelId - Panel to update.
   * @param failures - The current failure entries for the panel.
   * @param truncated - Whether the ring buffer overflowed. Defaults to `false`.
   */
  pushFailures: (panelId: string, failures: PreviewFailure[], truncated?: boolean) => void
  /**
   * Clears a panel's failure list and truncation flag.
   * @param panelId - Panel to update.
   */
  clearFailures: (panelId: string) => void
  /**
   * Sets the still frame for a panel (shown while the live view is hidden).
   * @param panelId - Panel to update.
   * @param frame - The captured, downscaled still frame.
   */
  setStillFrame: (panelId: string, frame: PreviewStillFrame) => void
  /** Record the colour main is painting behind the page (`#RRGGBB`). */
  setBackdrop: (panelId: string, color: string) => void
  /**
   * Record (or update) a remote host this panel was refused.
   *
   * Idempotent per host: a repeat sighting merges its kinds rather than
   * appending a second row, so a stylesheet firing twenty violations for one
   * font host produces one entry.
   */
  recordBlockedHost: (panelId: string, entry: PreviewBlockedHost) => void
  /**
   * Clears a panel's still frame so it falls back to the placeholder colour.
   * @param panelId - Panel to update.
   */
  clearStillFrame: (panelId: string) => void
  /**
   * Records the live preview's panel id for a limit-reached refusal.
   * @param holderPanelId - Panel id of the already-open preview.
   */
  setHolder: (holderPanelId: string) => void
  /** Clears the limit-reached holder once the refusal is resolved. */
  clearHolder: () => void
  /**
   * Removes all recorded state for a panel (on panel close).
   * @param panelId - Panel to forget.
   */
  removePanel: (panelId: string) => void
  /** Resets the entire store; intended for tests and hard teardown. */
  reset: () => void
}

/**
 * Immutably updates one panel entry, seeding from {@link DEFAULT_PANEL_STATE}
 * when the panel is not yet present.
 *
 * @param panels - The current panels map.
 * @param panelId - Panel to update.
 * @param patch - Partial state to merge onto the panel's entry.
 * @returns A new `Map` with the panel entry updated.
 */
function withPanel(
  panels: Map<string, PreviewPanelState>,
  panelId: string,
  patch: Partial<PreviewPanelState>
): Map<string, PreviewPanelState> {
  const next = new Map(panels)
  const current = next.get(panelId) ?? DEFAULT_PANEL_STATE
  next.set(panelId, { ...current, ...patch })
  return next
}

export const usePreviewStore = create<PreviewStoreState>((set, get) => ({
  panels: new Map(),
  holderPanelId: null,

  // --- Selectors ---
  getPanel: (panelId) => get().panels.get(panelId),
  getLoadState: (panelId) => get().panels.get(panelId)?.loadState ?? 'idle',
  getFailures: (panelId) => get().panels.get(panelId)?.failures ?? [],
  getFailureCount: (panelId) => get().panels.get(panelId)?.failures.length ?? 0,
  getStillFrame: (panelId) => get().panels.get(panelId)?.stillFrame ?? null,

  // --- Actions ---
  setLoadState: (panelId, loadState, dropped) =>
    set((state) => ({
      panels: withPanel(state.panels, panelId, {
        loadState,
        ...(dropped !== undefined ? { dropped } : {})
      })
    })),

  pushFailures: (panelId, failures, truncated = false) =>
    set((state) => ({
      panels: withPanel(state.panels, panelId, { failures, truncated })
    })),

  clearFailures: (panelId) =>
    set((state) => ({
      panels: withPanel(state.panels, panelId, { failures: [], truncated: false })
    })),

  setBackdrop: (panelId, color) =>
    set((state) => ({
      panels: withPanel(state.panels, panelId, { backdrop: color })
    })),
  recordBlockedHost: (panelId, entry) =>
    set((state) => {
      const current = state.panels.get(panelId)?.blockedHosts ?? []
      const existing = current.find((row) => row.host === entry.host)
      if (existing !== undefined) {
        const merged = [...new Set([...existing.kinds, ...entry.kinds])]
        if (merged.length === existing.kinds.length) {
          // Nothing new: return the SAME state object so subscribers do not
          // re-render on every repeat violation from a chatty page.
          return state
        }
        return {
          panels: withPanel(state.panels, panelId, {
            blockedHosts: current.map((row) =>
              row.host === entry.host ? { ...row, kinds: merged } : row
            )
          })
        }
      }
      return {
        panels: withPanel(state.panels, panelId, { blockedHosts: [...current, entry] })
      }
    }),

  setStillFrame: (panelId, frame) =>
    set((state) => ({
      panels: withPanel(state.panels, panelId, { stillFrame: frame })
    })),

  clearStillFrame: (panelId) =>
    set((state) => ({
      panels: withPanel(state.panels, panelId, { stillFrame: null })
    })),

  setHolder: (holderPanelId) => set({ holderPanelId }),

  clearHolder: () => set({ holderPanelId: null }),

  removePanel: (panelId) =>
    set((state) => {
      if (!state.panels.has(panelId)) return state
      const next = new Map(state.panels)
      next.delete(panelId)
      return { panels: next }
    }),

  reset: () => set({ panels: new Map(), holderPanelId: null })
}))
