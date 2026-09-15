// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One preview tab's own Back and Forward list (issue #124, part 3 §3.5).
 *
 * Erfana keeps this list instead of reading Chromium's: Chromium's session
 * history also records navigations inside frames (a link in a frame would
 * light up Back), and it dies with the view when the view sleeps (spike S6).
 * Main holds one list per panel, beside the zoom level, so it survives a
 * suspend.
 *
 * Pure and immutable: every function returns a new frozen history and never
 * touches the one it was given. A call that changes nothing returns its input
 * as it is, so `next === previous` tells the caller nothing happened.
 *
 * - An entry is a project file and where in it: `{ filePath, anchor }`.
 * - At most `PREVIEW_LIMITS.MAX_HISTORY_ENTRIES` entries; a push past that
 *   drops the oldest.
 * - `generation` grows by one on every change, so a Back or Forward the
 *   renderer asked for against an older list can be recognised and refused.
 * - The entry the tab already shows is never recorded twice in a row.
 *
 * @see docs/design/design-issue-124-part3.md §3.5
 */
import type { PreviewHistoryState, PreviewPageTarget } from '../../../shared/ipc/preview-types'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'

/** A step through the list. */
export type HistoryDirection = 'back' | 'forward'

/** A tab's history. Frozen; change it only through the functions below. */
export interface PreviewTabHistory {
  /** Oldest first. Never empty. */
  readonly entries: readonly PreviewPageTarget[]
  /** The entry the tab shows. */
  readonly index: number
  /** Grows by one on every change. */
  readonly generation: number
}

/**
 * A one-entry history: the page a tab first opens on.
 *
 * @param generation - Where the count starts. A caller that replaces an
 *   earlier list for the same panel passes that list's generation plus one, so
 *   a request made against the old list cannot match the new one.
 * @throws RangeError when `generation` is not a non-negative safe integer.
 */
export function createTabHistory(first: PreviewPageTarget, generation = 0): PreviewTabHistory {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new RangeError(`History generation must be a non-negative integer, got ${generation}`)
  }
  return freezeHistory([first], 0, generation)
}

/** The entry the tab shows. */
export function currentEntry(history: PreviewTabHistory): PreviewPageTarget {
  return history.entries[history.index]
}

/** Whether there is an entry one step away in `direction`. */
export function canStep(history: PreviewTabHistory, direction: HistoryDirection): boolean {
  return direction === 'back'
    ? history.index > 0
    : history.index < history.entries.length - 1
}

/** The entry one step away in `direction`, or `null` at that end of the list. */
export function neighbourEntry(
  history: PreviewTabHistory,
  direction: HistoryDirection
): PreviewPageTarget | null {
  return canStep(history, direction) ? history.entries[neighbourIndex(history, direction)] : null
}

/**
 * Record a new page after the current one – a move main started, or an
 * in-page `#section` jump. Entries ahead of the current one are dropped, as in
 * a browser; past the cap the oldest goes.
 *
 * Pushing the entry the tab already shows changes nothing: Chromium treats a
 * navigation to the URL on screen as a replacement, so a second identical
 * entry would make one Back press appear to do nothing.
 */
export function pushEntry(history: PreviewTabHistory, entry: PreviewPageTarget): PreviewTabHistory {
  if (sameEntry(currentEntry(history), entry)) return history
  const kept = [...history.entries.slice(0, history.index + 1), entry]
  const overflow = Math.max(0, kept.length - PREVIEW_LIMITS.MAX_HISTORY_ENTRIES)
  const entries = kept.slice(overflow)
  return freezeHistory(entries, entries.length - 1, history.generation + 1)
}

/** Put `entry` in place of the current one. The entry already there changes nothing. */
export function replaceCurrent(
  history: PreviewTabHistory,
  entry: PreviewPageTarget
): PreviewTabHistory {
  if (sameEntry(currentEntry(history), entry)) return history
  const entries = [...history.entries]
  entries[history.index] = entry
  return freezeHistory(entries, history.index, history.generation + 1)
}

/**
 * Move to the entry one step away – what a committed Back or Forward does.
 * With no entry there, nothing changes.
 */
export function stepHistory(
  history: PreviewTabHistory,
  direction: HistoryDirection
): PreviewTabHistory {
  if (!canStep(history, direction)) return history
  return freezeHistory(history.entries, neighbourIndex(history, direction), history.generation + 1)
}

/**
 * Remove the entry one step away: a Back or Forward reached a page that is
 * gone (RU2-3). The tab keeps showing its entry, and the next step in that
 * direction goes one entry further – in `[X, B, A]` on A, dropping Back's `B`
 * leaves `[X, A]` with X behind. With no entry there, nothing changes.
 */
export function dropNeighbour(
  history: PreviewTabHistory,
  direction: HistoryDirection
): PreviewTabHistory {
  if (!canStep(history, direction)) return history
  const dropped = neighbourIndex(history, direction)
  const entries = history.entries.filter((_, at) => at !== dropped)
  const index = direction === 'back' ? history.index - 1 : history.index
  return freezeHistory(entries, index, history.generation + 1)
}

/** The Back and Forward state `pageChanged` and a refused step carry; targets are copies. */
export function historyState(history: PreviewTabHistory): PreviewHistoryState {
  const back = neighbourEntry(history, 'back')
  const forward = neighbourEntry(history, 'forward')
  return {
    canGoBack: back !== null,
    canGoForward: forward !== null,
    backTarget: back === null ? null : { ...back },
    forwardTarget: forward === null ? null : { ...forward },
    generation: history.generation
  }
}

/** The index one step away; may be outside the list – check {@link canStep} first. */
function neighbourIndex(history: PreviewTabHistory, direction: HistoryDirection): number {
  return direction === 'back' ? history.index - 1 : history.index + 1
}

/** Same file and same place in it. */
function sameEntry(a: PreviewPageTarget, b: PreviewPageTarget): boolean {
  return a.filePath === b.filePath && a.anchor === b.anchor
}

/** A frozen history over frozen copies of `entries`, so no caller's object is kept. */
function freezeHistory(
  entries: readonly PreviewPageTarget[],
  index: number,
  generation: number
): PreviewTabHistory {
  return Object.freeze({
    entries: Object.freeze(
      entries.map((entry) => Object.freeze({ filePath: entry.filePath, anchor: entry.anchor }))
    ),
    index,
    generation
  })
}
