// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Per-tab UI state for HTML preview tabs (issue #124, part 3 §3.3–§3.4).
 *
 * WHAT IS NOT HERE: which page the tab shows. That is `params.filePath` on the
 * dockview panel, the one value the title, the tooltip, the close label, the
 * "which tab shows this file" lookup and crash recovery all read (RS3). A second
 * copy here would be a source that a crash remount forgets, or that a move
 * updates in one place and not the other.
 *
 * What IS here is UI state only:
 * - `linkMode` – whether a plain link opens a new tab or replaces this page.
 *   Only the renderer knows it: main never needs it (a plain link comes back as
 *   `by-mode`, and `commit` re-checks eligibility whatever the mode, RA7). Memory
 *   only – after a restart every tab is in new-tab mode.
 * - main's Back and Forward state, as the last `preview:pageChanged` carried it.
 * - the move in flight's announcement and the last committed move, written by
 *   the move coordinator (`previewTabMove.ts`, part 3 §3.6, §3.8) and read by
 *   the panel's polite region and its failed banner.
 *
 * LIFETIME. An entry is created when the panel mounts ({@link PreviewTabStoreState.seed})
 * or by the first history report, and removed ONLY when dockview removes the
 * panel (`onDidRemovePanel`, wired in `EditorAreaSplitPanel`) – never on
 * unmount. The error boundary remounts a crashed panel; forgetting the mode
 * there would quietly switch a same-tab tab back to new-tab.
 *
 * Keyed by panel id, which never changes for a tab. Selectors return the
 * stored entry; fall back to {@link NO_PREVIEW_TAB} OUTSIDE the selector, so
 * `useSyncExternalStore` never sees a fresh object and loops:
 *
 * ```ts
 * const tab = usePreviewTabStore((s) => s.tabs.get(panelId)) ?? NO_PREVIEW_TAB
 * ```
 *
 * @module usePreviewTabStore
 * @see docs/design/design-issue-124-part3.md §3.3, §3.4
 */
import { create } from 'zustand'

import type {
  PreviewHistoryState,
  PreviewPageTarget
} from '../../../shared/ipc/preview-types'

/**
 * What a plain link (no `target`) does in this tab: `new-tab` opens it in
 * another tab, `same-tab` replaces this tab's page. `_self`, `_blank`,
 * Cmd/Ctrl-click and middle-click keep their own rules whatever the mode.
 */
export type PreviewLinkMode = 'new-tab' | 'same-tab'

/** Who started a move: Erfana's own controls, or a link inside the page. */
export type PreviewMoveOrigin = 'chrome' | 'page'

/** What a move did: open a page, or step the tab's history. */
export type PreviewMoveAction = 'open' | 'back' | 'forward'

/**
 * What to say once a move lands (part 3 §3.8). Written by the coordinator just
 * before the commit and cleared, without a word, when the commit is refused.
 * The panel speaks it only on a `pageChanged` for this tab whose page and
 * anchor equal {@link PreviewMoveAnnouncement.target} and whose `failed` is
 * false, then clears it.
 */
export interface PreviewMoveAnnouncement {
  /**
   * `chrome` – the Back button or a key with focus in the toolbar: "Showing
   * pricing.html." `page` – a link or a key inside the page, whose own title
   * announcement covers the change: nothing, unless tabs closed.
   */
  readonly origin: PreviewMoveOrigin
  /** Other tabs the move closes: "Closed the other tab…" / "Closed 2 other tabs…". */
  readonly closedCount: number
  /** The page main checked; only a `pageChanged` naming it speaks this text. */
  readonly target: PreviewPageTarget
  /**
   * The move put focus on the tab's Back button (the prompt was answered), so
   * the text waits one animation frame after that focus change (part 3 §3.8).
   */
  readonly focusMoved: boolean
}

/**
 * The last move main accepted for this tab (part 3 §3.8). The failed banner
 * reads it: when it caused the failure, the banner names `to` ("pricing.html
 * could not be shown…") and offers to go back to `from`.
 */
export interface PreviewLastMove {
  /** `back` means the return is a Forward ("Return to …"); otherwise a Back. */
  readonly action: PreviewMoveAction
  /** The page the tab showed before the move; `null` when it was not known. */
  readonly from: PreviewPageTarget | null
  /** The page main accepted. */
  readonly to: PreviewPageTarget
}

/** The UI state one preview tab keeps. Everything but the page it shows. */
export interface PreviewTabState {
  /** What a plain link does in this tab. */
  readonly linkMode: PreviewLinkMode
  /** Main's history has an earlier page for this tab. */
  readonly canGoBack: boolean
  /** Main's history has a later page for this tab (after a Back). */
  readonly canGoForward: boolean
  /** The page Back would show; its file name goes into the Back tooltip. */
  readonly backTarget: PreviewPageTarget | null
  /** The page Forward would show. */
  readonly forwardTarget: PreviewPageTarget | null
  /**
   * Main's history generation from its last report; a Back or Forward request
   * must carry it. `0` before the first report – main answers a stale one with
   * `PREVIEW_NAV_SKIPPED`, and Back is disabled until a report says otherwise.
   */
  readonly generation: number
  /** The move in flight's announcement, or `null` (see {@link PreviewMoveAnnouncement}). */
  readonly announcement: PreviewMoveAnnouncement | null
  /** The last move main accepted, or `null` (see {@link PreviewLastMove}). */
  readonly lastMove: PreviewLastMove | null
}

/** The link mode every tab starts in (answer 2: new tabs, as before #124). */
export const DEFAULT_PREVIEW_LINK_MODE: PreviewLinkMode = 'new-tab'

/** A tab with no entry: new-tab mode, nowhere to go back or forward to. */
export const NO_PREVIEW_TAB: PreviewTabState = Object.freeze({
  linkMode: DEFAULT_PREVIEW_LINK_MODE,
  canGoBack: false,
  canGoForward: false,
  backTarget: null,
  forwardTarget: null,
  generation: 0,
  announcement: null,
  lastMove: null
})

/**
 * Narrows an untyped value – a dockview param, for one – to a link mode.
 *
 * @param value - Anything
 * @returns `true` for `'new-tab'` and `'same-tab'` only
 */
export function isPreviewLinkMode(value: unknown): value is PreviewLinkMode {
  return value === 'new-tab' || value === 'same-tab'
}

/** Preview tab store state and actions. */
export interface PreviewTabStoreState {
  /** Per-tab UI state, keyed by dockview panel id. */
  tabs: ReadonlyMap<string, PreviewTabState>

  /**
   * The tab's state, or {@link NO_PREVIEW_TAB} when it has none. For reads
   * outside React (the link router); components select `tabs` directly.
   *
   * @param panelId - Tab to read
   * @returns The stored entry, or the shared default
   */
  getTab: (panelId: string) => PreviewTabState
  /**
   * Create the tab's entry on mount, in the mode it was opened with.
   *
   * A no-op when the entry exists: a panel remounted by its error boundary
   * keeps the mode the user chose, and a reused tab keeps its own. An invalid
   * `linkMode` falls back to {@link DEFAULT_PREVIEW_LINK_MODE}.
   *
   * @param panelId - Tab to create
   * @param linkMode - `params.linkMode` as the panel received it (untrusted shape)
   */
  seed: (panelId: string, linkMode?: unknown) => void
  /**
   * Set what a plain link does in this tab; the toggle's only write.
   *
   * @param panelId - Tab to update
   * @param linkMode - The new mode
   */
  setLinkMode: (panelId: string, linkMode: PreviewLinkMode) => void
  /**
   * Replace the tab's Back and Forward state with main's latest report.
   *
   * No "newer generation wins" check on purpose: a view closed by a crash, or
   * reopened after a close, starts a fresh history in main, so a lower
   * generation can be the current one. Reports arrive in order on one channel.
   *
   * @param panelId - Tab to update; created in the default mode if absent
   * @param history - Main's Back and Forward state for the tab
   */
  setHistory: (panelId: string, history: PreviewHistoryState) => void
  /**
   * Set or clear the tab's pending move announcement.
   *
   * @param panelId - Tab to update; clearing a tab with no entry is a no-op
   * @param announcement - What to say when the move lands, or `null`
   */
  setAnnouncement: (panelId: string, announcement: PreviewMoveAnnouncement | null) => void
  /**
   * Record, or forget, the last move main accepted for the tab.
   *
   * @param panelId - Tab to update; clearing a tab with no entry is a no-op
   * @param lastMove - The accepted move, or `null`
   */
  setLastMove: (panelId: string, lastMove: PreviewLastMove | null) => void
  /**
   * Forget a tab. Called when dockview removes the panel – not on unmount.
   *
   * @param panelId - Tab to forget
   */
  removePanel: (panelId: string) => void
  /** Forget every tab. For tests and hard teardown. */
  reset: () => void
}

/**
 * Immutably writes one tab entry.
 *
 * @param tabs - The current map
 * @param panelId - Tab to write
 * @param entry - Its new state
 * @returns A new map, so zustand notifies subscribers
 */
function withTab(
  tabs: ReadonlyMap<string, PreviewTabState>,
  panelId: string,
  entry: PreviewTabState
): Map<string, PreviewTabState> {
  const next = new Map(tabs)
  next.set(panelId, entry)
  return next
}

/**
 * Writes one nullable field of a tab entry, skipping writes that change
 * nothing – a `null` onto a `null`, or any `null` for a tab with no entry, so
 * a late clear after the tab closed cannot bring a removed entry back.
 *
 * @param tabs - The current map
 * @param panelId - Tab to write
 * @param field - `announcement` or `lastMove`
 * @param value - Its new value
 * @returns The state patch, or `{}` when nothing changes
 */
function writeField<K extends 'announcement' | 'lastMove'>(
  tabs: ReadonlyMap<string, PreviewTabState>,
  panelId: string,
  field: K,
  value: PreviewTabState[K]
): Partial<PreviewTabStoreState> {
  const current = tabs.get(panelId)
  if (value === null && (current === undefined || current[field] === null)) return {}
  return { tabs: withTab(tabs, panelId, { ...(current ?? NO_PREVIEW_TAB), [field]: value }) }
}

export const usePreviewTabStore = create<PreviewTabStoreState>((set, get) => ({
  tabs: new Map(),

  getTab: (panelId) => get().tabs.get(panelId) ?? NO_PREVIEW_TAB,

  seed: (panelId, linkMode) =>
    set((state) => {
      if (state.tabs.has(panelId)) return state
      return {
        tabs: withTab(state.tabs, panelId, {
          ...NO_PREVIEW_TAB,
          linkMode: isPreviewLinkMode(linkMode) ? linkMode : DEFAULT_PREVIEW_LINK_MODE
        })
      }
    }),

  setLinkMode: (panelId, linkMode) =>
    set((state) => {
      const current = state.tabs.get(panelId) ?? NO_PREVIEW_TAB
      // Same-value writes must not notify: the toolbar re-renders on every write.
      if (state.tabs.has(panelId) && current.linkMode === linkMode) return state
      return { tabs: withTab(state.tabs, panelId, { ...current, linkMode }) }
    }),

  setHistory: (panelId, history) =>
    set((state) => {
      const current = state.tabs.get(panelId) ?? NO_PREVIEW_TAB
      // Copy the five fields by name: a `pageChanged` payload carries more
      // (panel id, page, flags), and none of that is UI state for this store.
      return {
        tabs: withTab(state.tabs, panelId, {
          ...current,
          canGoBack: history.canGoBack,
          canGoForward: history.canGoForward,
          backTarget: history.backTarget,
          forwardTarget: history.forwardTarget,
          generation: history.generation
        })
      }
    }),

  setAnnouncement: (panelId, announcement) =>
    set((state) => writeField(state.tabs, panelId, 'announcement', announcement)),

  setLastMove: (panelId, lastMove) =>
    set((state) => writeField(state.tabs, panelId, 'lastMove', lastMove)),

  removePanel: (panelId) =>
    set((state) => {
      if (!state.tabs.has(panelId)) return state
      const next = new Map(state.tabs)
      next.delete(panelId)
      return { tabs: next }
    }),

  reset: () => set({ tabs: new Map() })
}))
