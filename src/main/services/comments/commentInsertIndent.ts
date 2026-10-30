// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Main's own check of the blanks around a new block (security review L-4).
 *
 * `isSafeInsert` (`commentWriteCore.ts`) proves the insert is ONE comment
 * with blanks around it, but takes any run of blanks: a worker that answered
 * wrong could indent a block by a megabyte of spaces, or turn a Markdown
 * paragraph into an indented code block. So `CommentWriter.attempt` also
 * checks the blanks against the bytes MAIN read, around the splice point:
 *
 * - **A leading indent** (the `line-start` shape, Markdown) only at a line
 *   start, and either exactly the blanks that start that line (a block before
 *   a quote, a later block of a list item), or spaces no wider than the
 *   line's list-marker content column – list item n ≥ 2 writes at item
 *   n − 1's content column on item n's own marker line. Never longer.
 * - **An own-lines tail** (HTML `before-target`): its blanks are exactly the
 *   blanks between the line's start and the splice point – the target's own
 *   indent, given back to it.
 *
 * Blanks are ASCII, so the read bytes are scanned as bytes; a UTF-8 BOM at the
 * file's start counts as part of the line start.
 */
import { LINE_START_INDENT, OWN_LINES_TAIL, type ByteSplice } from './commentWriteCore'

const LF = 0x0a
const CR = 0x0d
/** The bytes of a line read for its leading blanks and list marker: more than any marker's column. */
const LINE_HEAD_BYTES = 256
/** A list item's marker and the spaces after it (CommonMark: 1–4; more is code, whose column is one past the marker). */
const LIST_MARKER = /^[ \t]*(?:[-+*]|\d{1,9}[.)]) {1,4}(?=\S)/
const BOM = [0xef, 0xbb, 0xbf]

/** The offset the line holding `at` starts at in `read` (after a leading BOM). */
function lineStartOf(read: Uint8Array, at: number): number {
  let start = at
  while (start > 0 && read[start - 1] !== LF && read[start - 1] !== CR) start -= 1
  return start === 0 && BOM.every((byte, i) => read[i] === byte) ? Math.min(BOM.length, at) : start
}

/** `read[from, to)` as Latin-1: blanks and markers are ASCII, anything else only has to differ from them. */
function latin1(read: Uint8Array, from: number, to: number): string {
  return Buffer.from(read.buffer, read.byteOffset + from, Math.max(0, to - from)).toString('latin1')
}

/** The first bytes of the line that starts at `at`, up to its line break. */
function lineHead(read: Uint8Array, at: number): string {
  const head = latin1(read, at, Math.min(read.length, at + LINE_HEAD_BYTES))
  return head.split(/[\r\n]/, 1)[0]
}

/** Whether a line-start indent fits the line it is written on (module comment). */
function leadFits(lead: string, line: string): boolean {
  const blanks = /^[ \t]*/.exec(line)![0]
  if (lead === blanks) return true
  const marker = LIST_MARKER.exec(line)
  return marker !== null && /^ +$/.test(lead) && lead.length <= marker[0].length
}

/**
 * Whether the blanks of `splice.insert` fit the bytes main read (module comment).
 *
 * @param read - The file's bytes as main read them.
 * @param splice - The worker's answer, already within `read` and safe (`isSpliceWithin`, `isSafeInsert`).
 * @returns `false` when an indent or a tail is not the one the read bytes call for.
 */
export function insertBlanksFit(read: Uint8Array, splice: ByteSplice): boolean {
  if (splice.insert.length === 0) return true
  const text = Buffer.from(splice.insert.buffer, splice.insert.byteOffset, splice.insert.length).toString('utf8')
  const lead = LINE_START_INDENT.exec(text)?.[0] ?? ''
  const tailMatch = OWN_LINES_TAIL.exec(text)
  const tail = tailMatch === null ? undefined : tailMatch[0].replace(/^(?:\r\n|\r|\n)/, '')
  const lineStart = lineStartOf(read, splice.byteStart)
  const before = latin1(read, lineStart, splice.byteStart)
  if (lead !== '') {
    // The line-start shape: at a line start, followed by its line break and nothing more.
    return before === '' && (tail === undefined || tail === '') && leadFits(lead, lineHead(read, splice.byteStart))
  }
  if (tail === undefined || tail === '') return true
  return tail === before
}
