// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git conflict-marker detection (docs/designs/comments/html-preview-comments.md §3
 * "Conflict markers outside any block", decision 32, U-070–U-076).
 *
 * Two different questions, two different strictnesses:
 *
 * - **Is the file conflicted?** Only a COMPLETE hunk counts – `<<<<<<<`, then
 *   optionally `|||||||` (diff3), then `=======`, then `>>>>>>>`, each at the
 *   start of a line and in that order. A lone `=======` line is common (ASCII
 *   art in a `<pre>`, a Markdown-style rule) and must not lock the file.
 * - **Is this comment block damaged?** Any line inside the block that begins
 *   with one of the four markers, after leading whitespace. Erfana's own
 *   writes escape such lines in user text (format.ts), so a marker inside a
 *   block always means a merge went through it.
 *
 * Every scan is a single linear pass over the lines; no regex runs over the
 * whole file.
 */

/** Seven-character marker runs git writes (default `conflict-marker-size`). */
const MARKER_LENGTH = 7

/** A complete conflict hunk: from the start of its `<<<<<<<` line to the end of its `>>>>>>>` line. */
export interface ConflictHunk {
  readonly start: number
  readonly end: number
}

type MarkerKind = 'ours' | 'base' | 'theirs-start' | 'theirs-end'

const MARKER_CHARS: ReadonlyMap<string, MarkerKind> = new Map([
  ['<', 'ours'],
  ['|', 'base'],
  ['=', 'theirs-start'],
  ['>', 'theirs-end']
])

/**
 * The marker a line starts with, or `null`. A marker is exactly seven equal
 * marker characters, then the end of the line or a space/tab (git writes a
 * label after `<<<<<<<`, `|||||||` and `>>>>>>>`, nothing after `=======`).
 */
export function markerAtLineStart(line: string): MarkerKind | null {
  const kind = MARKER_CHARS.get(line[0])
  if (!kind) return null
  for (let i = 1; i < MARKER_LENGTH; i += 1) if (line[i] !== line[0]) return null
  const after = line[MARKER_LENGTH]
  if (after === undefined) return kind
  if (kind === 'theirs-start') return null
  return after === ' ' || after === '\t' ? kind : null
}

/**
 * True when a line inside a comment block, after its leading whitespace,
 * begins with a marker run of seven `<`, `|`, `=` or `>` (any suffix).
 */
export function lineHasMarkerPrefix(line: string): boolean {
  const trimmed = line.trimStart()
  const ch = trimmed[0]
  if (!MARKER_CHARS.has(ch)) return false
  for (let i = 1; i < MARKER_LENGTH; i += 1) if (trimmed[i] !== ch) return false
  return true
}

/** Call `onLine(line, start, end)` for every line; `end` excludes the line break. */
export function forEachLine(
  text: string,
  onLine: (line: string, start: number, end: number) => void
): void {
  let start = 0
  for (let i = 0; i <= text.length; i += 1) {
    const ch = text[i]
    if (i < text.length && ch !== '\n' && ch !== '\r') continue
    onLine(text.slice(start, i), start, i)
    if (ch === '\r' && text[i + 1] === '\n') i += 1
    start = i + 1
  }
}

/**
 * Every complete conflict hunk in `text`, in order. A new `<<<<<<<` while a
 * hunk is open restarts the hunk from there; markers out of order are ignored.
 */
export function findConflictHunks(text: string): ConflictHunk[] {
  const hunks: ConflictHunk[] = []
  // Fast path: no hunk can exist without its opening run anywhere in the text.
  if (!text.includes('<'.repeat(MARKER_LENGTH))) return hunks
  let openedAt = -1
  let phase: 'idle' | 'ours' | 'theirs' = 'idle'
  forEachLine(text, (line, start, end) => {
    const kind = markerAtLineStart(line)
    if (kind === 'ours') {
      openedAt = start
      phase = 'ours'
    } else if (kind === 'theirs-start' && phase === 'ours') {
      phase = 'theirs'
    } else if (kind === 'theirs-end' && phase === 'theirs') {
      hunks.push({ start: openedAt, end })
      phase = 'idle'
    }
  })
  return hunks
}

/** True when `text` holds at least one complete conflict hunk. */
export function hasConflictHunk(text: string): boolean {
  return findConflictHunks(text).length > 0
}
