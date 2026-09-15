// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview UI store (Issue #74, work item 68).
 *
 * Holds the renderer-side UI state for HTML preview panels: per-panel load
 * state, failure list + badge count, and the current still frame, plus the
 * single global `holderPanelId` that drives the "a preview is already open"
 * refusal message (design §1.4 X20/NEW-9, §1.8). Issue #124 adds the drag
 * freeze's two per-panel flags: the window-edge resize hold and the latch that
 * keeps a drag's still picture or backdrop until the page is back.
 *
 * State is keyed by `panelId` in a `Map` (mirroring `useSearchStore`'s
 * `providerStates` convention) so multiple refused/closing panels stay isolated;
 * SEVERAL previews can be live at once (sd-074b D5) — an earlier version of
 * this comment said only one ever was, which is the assumption the overlay
 * guard was rewritten to remove. A refused panel also renders its own
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
 * The load states a preview panel can be in.
 *
 * Derived from the `preview:loadStateChanged` payload (item 41) so the union
 * never drifts from the IPC contract. FIVE of them, not four: `suspended` was
 * added when eviction landed, and a reader trusting the old count writes the
 * single-live-preview assumption back in.
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
   * `applyApprovedHosts`, which reloads the page through `startPageLoad` and so
   * starts a fresh failure log (issue #124) — a list built on the failure log
   * would empty the moment the reader approves anything, exactly
   * when they are mid-way through a cascade and about to approve the next one.
   * This slice is fed by `hostBlocked` events and is never cleared by
   * `clearFailures`.
   *
   * It survives the page reload that follows an approval, because the React
   * panel does not unmount when the previewed page reloads. It dies with the
   * panel, which is right: a fresh panel re-discovers on load. It is also
   * emptied when the tab moves to another page ({@link PreviewStoreState.resetPage}):
   * those hosts belonged to the page that asked for them.
   */
  blockedHosts: PreviewBlockedHost[]
  /**
   * Main stopped listing new hosts for this view because it hit its per-view cap.
   *
   * The band says so rather than presenting a truncated list as complete: a
   * permission surface that quietly omits a host is worse than one that admits
   * it cannot show them all.
   */
  blockedHostsTruncated: boolean
  /**
   * Hosts approved for this panel's PROJECT, mirrored from main.
   *
   * Per panel although the fact is per project: this store has no notion of a
   * project, and `PreviewViewService.applyApprovedHosts` already fans an approval
   * out to every live view of the project, so two panels in one project are kept
   * in step by main rather than by a shared slice here.
   *
   * REPLACE semantics — the on-disk allowlist is the record, so an event carries
   * the whole set rather than a delta.
   */
  allowedHosts: readonly string[]
  /**
   * Main is holding this panel's view hidden for a window-edge resize (issue
   * #124, part 1 §1.5) – the one hide the overlay guard does not know about, so
   * the panel reads this to treat the view as hidden.
   *
   * Set on `resizeHold {held: true}`. Cleared by the `visibilityApplied` main's
   * release emits, `true` or `false`, and when the view is suspended; the entry
   * itself goes on close. NEVER on `held: false`: the view stays hidden until
   * main's release.
   */
  resizeHeld: boolean
  /**
   * A splitter or window-edge drag hid the page (answer 6). While set, the
   * fallback shows the still picture only when it is fresh, and the backdrop
   * for a stale one – whether or not anything else still calls the view hidden.
   *
   * Set when the splitter's `drag` occluder registers or `resizeHold {held:
   * true}` arrives. Cleared ONLY by `visibilityApplied(true)` (RU3-2). The
   * occluder and `resizeHeld` both clear BEFORE the page is back on screen, so
   * keying on either would flash the old picture or blink the backdrop; and a
   * `visibilityApplied(false)` – the drag's own hide confirmation, or a release
   * that stays hidden under a dialog – is not the page returning.
   */
  dragHideLatched: boolean
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
  blockedHostsTruncated: false,
  allowedHosts: [],
  dropped: 0,
  failures: [],
  truncated: false,
  stillFrame: null,
  backdrop: null,
  resizeHeld: false,
  dragHideLatched: false
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
  /** Main hit its per-view cap; the list this panel shows is incomplete. */
  markBlockedHostsTruncated: (panelId: string) => void
  /**
   * Mirror the project's approved-host set. Replaces, never merges.
   * @param panelId - Panel to update.
   * @param hosts - The whole allowlist as main knows it.
   */
  setAllowedHosts: (panelId: string, hosts: readonly string[]) => void
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
   * A splitter drag is hiding this panel's page: latch its still picture or
   * backdrop until the page is back ({@link PreviewPanelState.dragHideLatched}).
   * A no-op for a panel with no state.
   * @param panelId - The panel whose page the drag hides.
   */
  latchDragHide: (panelId: string) => void
  /**
   * `preview:resizeHold` with `held: true`: main hid the view for a window-edge
   * resize. Sets `resizeHeld` and the drag latch. A no-op for a panel with no
   * state.
   * @param panelId - The held panel.
   */
  beginResizeHold: (panelId: string) => void
  /**
   * Main applied a visibility (`preview:visibilityApplied`). Either value ends
   * a resize hold; only `true` ends the drag latch. Same-value writes do not
   * notify, and a panel with no state is left alone.
   * @param panelId - The panel main reported on.
   * @param visible - What main applied.
   */
  applyVisibility: (panelId: string, visible: boolean) => void
  /**
   * Drops `resizeHeld`: the panel's event feed unmounted, so no release will
   * reach it.
   * @param panelId - The panel.
   */
  clearResizeHeld: (panelId: string) => void
  /**
   * Drops what belonged to the page a tab showed before it moved to another
   * document (issue #124, part 3 §3.4): blocked hosts and their truncation
   * flag, the still frame and the dropped-candidate count.
   *
   * Keeps the load state, the backdrop and the allowed hosts – those describe
   * the view or the project, not the page.
   *
   * Failures and `truncated` are deliberately NOT reset. The badge mirrors
   * main's failure snapshot, and main sends the new page's snapshot when the
   * page commits – which can arrive BEFORE `pageChanged`. Clearing here would
   * wipe the new page's entries, not the old one's (RS2-3).
   *
   * A no-op for a panel with no state.
   *
   * @param panelId - Panel whose page changed.
   */
  resetPage: (panelId: string) => void
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

/** The two drag-freeze flags; see {@link PreviewPanelState}. */
type DragFreezeFlags = Pick<PreviewPanelState, 'resizeHeld' | 'dragHideLatched'>

/**
 * Patches the drag-freeze flags of an EXISTING panel entry, and only when a
 * value changes.
 *
 * Existing only: these follow events for live panels, and seeding an entry
 * here would resurrect a panel just removed on close. Changed only: main sends
 * `visibilityApplied` on every show and hide, and a same-value write would
 * re-render the panel each time.
 *
 * @param state - The current store state.
 * @param panelId - Panel to update.
 * @param patch - The flags to write.
 * @returns The same state when nothing changes, else the new panels map.
 */
function patchDragFlags(
  state: PreviewStoreState,
  panelId: string,
  patch: Partial<DragFreezeFlags>
): Partial<PreviewStoreState> {
  const current = state.panels.get(panelId)
  if (current === undefined) return state
  const keys = Object.keys(patch) as Array<keyof DragFreezeFlags>
  if (keys.every((key) => current[key] === patch[key])) return state
  return { panels: withPanel(state.panels, panelId, patch) }
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
        ...(dropped !== undefined ? { dropped } : {}),
        // A suspended view is gone: no release will ever reach its hold.
        ...(loadState === 'suspended' ? { resizeHeld: false } : {})
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
  markBlockedHostsTruncated: (panelId) =>
    set((state) => {
      if (state.panels.get(panelId)?.blockedHostsTruncated === true) return state
      return { panels: withPanel(state.panels, panelId, { blockedHostsTruncated: true }) }
    }),
  setAllowedHosts: (panelId, hosts) =>
    set((state) => {
      const current = state.panels.get(panelId)?.allowedHosts ?? []
      // Dedupe before comparing. `selectBandRows` maps these straight to rows
      // keyed by host, so a duplicate that survived main's canonicaliser would
      // render as two identical "Allowed" rows AND a duplicate React key — in
      // the one list whose whole job is to be believable.
      const next = [...new Set(hosts)]
      // Same-value writes must not notify: the band re-renders on every store
      // write, and main re-seeds this on every open.
      if (current.length === next.length && current.every((h, i) => h === next[i])) {
        return state
      }
      return { panels: withPanel(state.panels, panelId, { allowedHosts: next }) }
    }),
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

  resetPage: (panelId) =>
    set((state) => {
      if (!state.panels.has(panelId)) return state
      return {
        panels: withPanel(state.panels, panelId, {
          blockedHosts: DEFAULT_PANEL_STATE.blockedHosts,
          blockedHostsTruncated: false,
          stillFrame: null,
          dropped: 0
        })
      }
    }),

  clearHolder: () => set({ holderPanelId: null }),

  latchDragHide: (panelId) => set((state) => patchDragFlags(state, panelId, { dragHideLatched: true })),
  beginResizeHold: (panelId) =>
    set((state) => patchDragFlags(state, panelId, { resizeHeld: true, dragHideLatched: true })),
  applyVisibility: (panelId, visible) =>
    set((state) =>
      patchDragFlags(state, panelId, visible ? { resizeHeld: false, dragHideLatched: false } : { resizeHeld: false })
    ),
  clearResizeHeld: (panelId) => set((state) => patchDragFlags(state, panelId, { resizeHeld: false })),

  removePanel: (panelId) =>
    set((state) => {
      if (!state.panels.has(panelId)) return state
      const next = new Map(state.panels)
      next.delete(panelId)
      return { panels: next }
    }),

  reset: () => set({ panels: new Map(), holderPanelId: null })
}))
