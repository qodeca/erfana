// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `performance.mark` points of the large-file timing (spec 024
 * 024-NFR-001, 024-AC-024), for the Markdown Preview's renderer-hosted
 * comments. `e2e/markdown-comments.timing.e2e.ts` reads them:
 *
 * - **preview-rendered** – the preview's body committed a new version of the
 *   document (`utils/previewRenderTiming.ts`, from `MarkdownPreview`);
 * - **pins-visible** – the overlay drew the icons of a list it had not drawn
 *   before (`CommentOverlayLayer`);
 * - **save-start** – Save was pressed on a new comment: its write goes to
 *   main (`useMarkdownComments`' comment source);
 * - **saved-visible** – the icon of that new thread is drawn.
 *
 * Each point keeps only its latest mark: the previous entry of the same name
 * is cleared first, so a long session never grows the timeline – one entry
 * per name at most, and nothing else runs unless the test reads them.
 *
 * @module components/Comments/overlay/commentTiming
 */

/** The mark names; the prefix keeps them apart from any other mark in the window. */
export const COMMENT_TIMING_MARKS = {
  previewRendered: 'erfana:comments:preview-rendered',
  pinsVisible: 'erfana:comments:pins-visible',
  saveStart: 'erfana:comments:save-start',
  savedVisible: 'erfana:comments:saved-visible'
} as const

export type CommentTimingMark = (typeof COMMENT_TIMING_MARKS)[keyof typeof COMMENT_TIMING_MARKS]

/** Lists whose icons were drawn once already: a redraw (scroll, resize) is not "pins visible" again. */
let drawnLists = new WeakSet<object>()
/** At most this many saved threads wait for their icon. */
const MAX_AWAITED_THREADS = 16
/** New threads saved here whose icon has not been drawn yet. */
const awaitedThreads = new Set<string>()

/**
 * Put `name` on the performance timeline, replacing its previous mark.
 *
 * @param name - One of {@link COMMENT_TIMING_MARKS}
 */
export function markCommentTiming(name: CommentTimingMark): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  performance.clearMarks(name)
  performance.mark(name)
}

/**
 * Save was pressed on a new comment: the start of "saved comment visible".
 */
export function noteCommentSaveStart(): void {
  markCommentTiming(COMMENT_TIMING_MARKS.saveStart)
}

/**
 * Main wrote the new thread `threadKey`: its first drawn icon ends the save's timing.
 *
 * @param threadKey - The new thread's key from the save answer
 */
export function awaitSavedPin(threadKey: string): void {
  // A thread whose icon is never drawn (hidden, not attached) must not pile up: the oldest goes.
  if (awaitedThreads.size >= MAX_AWAITED_THREADS) {
    const oldest = awaitedThreads.values().next().value
    if (oldest !== undefined) awaitedThreads.delete(oldest)
  }
  awaitedThreads.add(threadKey)
}

/**
 * The overlay drew icons for `list`'s threads `drawnKeys` (called after the
 * DOM holds them). Marks pins-visible the first time a list's icons are drawn,
 * and saved-visible when an awaited new thread is among them.
 *
 * @param list - The placements array the icons were drawn from (identity marks a new list)
 * @param drawnKeys - The thread keys of every drawn icon
 */
export function noteCommentPinsDrawn(list: object, drawnKeys: readonly string[]): void {
  if (drawnKeys.length === 0) return
  if (!drawnLists.has(list)) {
    drawnLists.add(list)
    markCommentTiming(COMMENT_TIMING_MARKS.pinsVisible)
  }
  if (awaitedThreads.size === 0) return
  let saved = false
  for (const key of drawnKeys) saved = awaitedThreads.delete(key) || saved
  if (saved) markCommentTiming(COMMENT_TIMING_MARKS.savedVisible)
}

/** Test helper: forget what was drawn and awaited. */
export function resetCommentTiming(): void {
  drawnLists = new WeakSet<object>()
  awaitedThreads.clear()
}
