// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – per-tab renderer state
 * (docs/designs/html-preview-comments.md §4.2, §10.1, §10.6; R-015, R-023).
 *
 * One entry per preview panel id. What it holds, and who is the record:
 *
 * - `mode`, `showIcons` – the tab's comment mode and its "show comment icons"
 *   toggle. Per tab, never persisted (§3 "Pins toggle scope"). Main is the
 *   record for `mode` (Esc in the page and the shortcut change it there and
 *   say so with `commentModeChanged`); this mirrors it so the toolbar can draw.
 *   The entry outlives a page change and a reload of the same tab, which is
 *   what keeps the mode on across the save reload and a same-tab navigation
 *   (R-023).
 * - `counts`, `unavailable`, `notVisible` – main's latest events.
 * - `drawerOpen` – the comments drawer.
 * - `list` – the last `preview:commentList` answer, with a GENERATION. Each
 *   request takes a new generation and only the answer to the newest one is
 *   stored, so a slow answer that lands after a newer one (a save, then the
 *   watcher's change event) can never put old threads back (R-015).
 *
 * The typed draft of each element lives in a module-level map, not in the
 * store: it is session memory that nothing renders from ("Draft restored",
 * §10.4), and keeping it out of the store keeps keystrokes from re-rendering
 * every subscriber.
 *
 * @module stores/usePreviewCommentStore
 */
import { create } from 'zustand'
import type {
  CommentFileView,
  CommentListResult,
  CommentUnavailableReason,
  CommentsChanged
} from '../../../shared/ipc/preview-comment-schema'

/** Counts for the toolbar badge. */
export interface CommentCounts {
  readonly open: number
  readonly resolved: number
  readonly attention: number
}

/** The drawer's read of the page's comments. */
export interface CommentListState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly files: readonly CommentFileView[]
  /** Main's error code when `status` is `'error'`. */
  readonly code?: string
}

/** One tab's comment state. */
export interface PanelCommentState {
  readonly mode: boolean
  readonly showIcons: boolean
  readonly counts: CommentCounts | null
  readonly unavailable: CommentUnavailableReason | null
  /** Thread keys whose element is not rendered right now. */
  readonly notVisible: readonly string[]
  readonly drawerOpen: boolean
  readonly list: CommentListState
  /** The generation of the newest list request. */
  readonly listGeneration: number
}

/** A fresh tab: mode off, icons on (designer call: pins pressed by default). */
export const INITIAL_PANEL_COMMENT_STATE: PanelCommentState = Object.freeze({
  mode: false,
  showIcons: true,
  counts: null,
  unavailable: null,
  notVisible: Object.freeze([]) as readonly string[],
  drawerOpen: false,
  list: Object.freeze({
    status: 'idle',
    files: Object.freeze([]) as readonly CommentFileView[]
  }) as CommentListState,
  listGeneration: 0
})

interface PreviewCommentStore {
  readonly panels: ReadonlyMap<string, PanelCommentState>
  /** Patch one tab's entry (created on first use). */
  patch: (panelId: string, patch: Partial<PanelCommentState>) => void
  /** Main's `commentsChanged`. */
  applyChanged: (payload: CommentsChanged) => void
  /** Start a list request; returns its generation. */
  beginList: (panelId: string) => number
  /**
   * Store a list answer – only when `generation` is still the newest.
   *
   * @returns Whether the answer was stored.
   */
  finishList: (panelId: string, generation: number, result: CommentListResult) => boolean
  /** Forget a tab (its panel unmounted). */
  drop: (panelId: string) => void
  /** Test helper: forget everything. */
  reset: () => void
}

/** The entry for `panelId`, or the initial state. */
function entryOf(
  panels: ReadonlyMap<string, PanelCommentState>,
  panelId: string
): PanelCommentState {
  return panels.get(panelId) ?? INITIAL_PANEL_COMMENT_STATE
}

/** `panels` with `panelId` replaced by `next`. */
function withEntry(
  panels: ReadonlyMap<string, PanelCommentState>,
  panelId: string,
  next: PanelCommentState
): ReadonlyMap<string, PanelCommentState> {
  const copy = new Map(panels)
  copy.set(panelId, next)
  return copy
}

export const usePreviewCommentStore = create<PreviewCommentStore>((set, get) => ({
  panels: new Map(),

  patch: (panelId, patch) => {
    set(s => ({
      panels: withEntry(s.panels, panelId, { ...entryOf(s.panels, panelId), ...patch })
    }))
  },

  applyChanged: ({ panelId, counts, unavailable }) => {
    set(s => ({
      panels: withEntry(s.panels, panelId, {
        ...entryOf(s.panels, panelId),
        counts,
        unavailable: unavailable ?? null
      })
    }))
  },

  beginList: panelId => {
    const current = entryOf(get().panels, panelId)
    const generation = current.listGeneration + 1
    // Keep the threads on screen while the new read is in flight: a refresh
    // after a save must not flash the drawer to "Reading comments…".
    const list: CommentListState =
      current.list.status === 'ready'
        ? current.list
        : { status: 'loading', files: current.list.files }
    set(s => ({
      panels: withEntry(s.panels, panelId, {
        ...entryOf(s.panels, panelId),
        list,
        listGeneration: generation
      })
    }))
    return generation
  },

  finishList: (panelId, generation, result) => {
    const current = entryOf(get().panels, panelId)
    if (generation !== current.listGeneration) return false
    const list: CommentListState = result.ok
      ? { status: 'ready', files: result.files }
      : { status: 'error', files: current.list.files, code: result.code }
    const unavailable = result.ok
      ? (result.unavailable ?? current.unavailable)
      : current.unavailable
    set(s => ({
      panels: withEntry(s.panels, panelId, { ...entryOf(s.panels, panelId), list, unavailable })
    }))
    return true
  },

  drop: panelId => {
    if (!get().panels.has(panelId)) return
    set(s => {
      const copy = new Map(s.panels)
      copy.delete(panelId)
      return { panels: copy }
    })
  },

  reset: () => set({ panels: new Map() })
}))

/**
 * One tab's comment state, with the initial state as a STABLE fallback
 * (a fresh object inside a selector would loop `useSyncExternalStore`).
 *
 * @param panelId - The preview panel id.
 * @returns The tab's state.
 */
export function usePanelCommentState(panelId: string): PanelCommentState {
  return usePreviewCommentStore(s => s.panels.get(panelId)) ?? INITIAL_PANEL_COMMENT_STATE
}

/** Typed drafts per element for this session (§10.4 "Draft restored"). */
const drafts = new Map<string, string>()

/**
 * The comment drafts kept in memory for the session.
 *
 * @example
 * ```ts
 * commentDrafts.set(key, 'Make the button bigger')
 * commentDrafts.get(key) // 'Make the button bigger' – shown with "Draft restored"
 * ```
 */
export const commentDrafts = {
  get: (key: string): string => drafts.get(key) ?? '',
  set: (key: string, text: string): void => {
    if (text === '') drafts.delete(key)
    else drafts.set(key, text)
  },
  clear: (key: string): void => {
    drafts.delete(key)
  },
  /** Test helper. */
  reset: (): void => drafts.clear()
}
