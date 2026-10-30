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
 *   n − 1's content column on item n's own marker line – or, on a line with
 *   no marker, spaces no wider than the column the line's own blanks reach
 *   (tabs to the next multiple of 4): CommonMark lets an item's later block
 *   sit further in than the item's content column, where the block is
 *   written ("1. a\n\n    para", content column 3). Never longer; the line's
 *   own bytes are never changed.
 * - **An own-lines tail** (HTML `before-target`): its blanks are exactly the
 *   blanks between the line's start and the splice point – the target's own
 *   indent, given back to it.
 * - **A delete** (an empty insert, review L-2): the bytes removed are one
 *   `erfana:comment` block and its own blanks and line break, nothing else.
 *
 * Blanks are ASCII, so the read bytes are scanned as bytes; a UTF-8 BOM at the
 * file's start counts as part of the line start.
 */
import { BLOCK_HEADER } from '../../../shared/comments/blocks'
import { LINE_START_INDENT, OWN_LINES_TAIL, type ByteSplice } from './commentWriteCore'

const LF = 0x0a
const CR = 0x0d
/** The bytes of a line read for its leading blanks and list marker: more than any marker's column. */
const LINE_HEAD_BYTES = 256
/** A list item's marker and the spaces after it (CommonMark: 1–4; more is code, whose column is one past the marker). */
const LIST_MARKER = /^[ \t]*(?:[-+*]|\d{1,9}[.)]) {1,4}(?=\S)/
const BOM = [0xef, 0xbb, 0xbf]
/** CommonMark's tab stop: a tab in a line's indent reaches the next multiple of 4. */
const TAB_STOP = 4

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

/** The column `blanks` reach, a tab advancing to the next multiple of {@link TAB_STOP} (CommonMark). */
function columnsOf(blanks: string): number {
  let column = 0
  for (const char of blanks) column = char === '\t' ? column + TAB_STOP - (column % TAB_STOP) : column + 1
  return column
}

/** Whether a line-start indent fits the line it is written on (module comment). */
function leadFits(lead: string, line: string): boolean {
  const blanks = /^[ \t]*/.exec(line)![0]
  if (lead === blanks) return true
  if (!/^ +$/.test(lead)) return false
  const marker = LIST_MARKER.exec(line)
  if (marker !== null) return lead.length <= marker[0].length
  // A continuation block may sit further in than its item's content column ("1. a\n\n    para"):
  // the block goes at that column, never past the column the line itself reaches.
  return lead.length <= columnsOf(blanks)
}

/**
 * Whether the blanks of `splice.insert` fit the bytes main read (module comment).
 *
 * @param read - The file's bytes as main read them.
 * @param splice - The worker's answer, already within `read` and safe (`isSpliceWithin`, `isSafeInsert`).
 * @returns `false` when an indent or a tail is not the one the read bytes call for, or a delete
 *   removes more (or other) than one comment block.
 */
export function insertBlanksFit(read: Uint8Array, splice: ByteSplice): boolean {
  if (splice.insert.length === 0) return removesOneBlock(read, splice)
  return insertFits(read, splice)
}

/** Blanks before a removed block: its line-start indent (spaces, or a hand-written tab). */
const REMOVED_LEAD = /^[ \t]+/
/** After it: its line break, then – HTML's own-lines shape – the target's indent given back. */
const REMOVED_TAIL = /(?:\r\n|\r|\n)[ \t]*$/

/**
 * A delete (an empty insert): main does not take the worker's byte range on
 * trust (review L-2). The bytes removed, less the blanks before the block and
 * the line break (and indent) after it, are exactly one HTML comment node
 * whose text starts with the `erfana:comment` header – so a wrong answer can
 * never cut a byte of the file's own content. "One node" means nothing but its
 * final `-->` (or `--!>`) closes it; a damaged block may hold other `--`, and
 * deleting it ("Delete damaged comment", S-07/S-08) must still work.
 */
function isOneCommentNode(block: string): boolean {
  const close = block.endsWith('--!>') ? 4 : block.endsWith('-->') ? 3 : 0
  if (close === 0 || !block.startsWith('<!--') || block.length < 4 + close) return false
  const inner = block.slice(4, -close)
  return !inner.includes('-->') && !inner.includes('--!>') && !inner.startsWith('>') && !inner.startsWith('->')
}

function removesOneBlock(read: Uint8Array, splice: ByteSplice): boolean {
  if (splice.byteEnd <= splice.byteStart) return false
  let removed: string
  try {
    removed = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(read.subarray(splice.byteStart, splice.byteEnd))
  } catch {
    return false
  }
  const block = removed.replace(REMOVED_LEAD, '').replace(REMOVED_TAIL, '')
  return isOneCommentNode(block) && BLOCK_HEADER.test(block.slice(4))
}

/** The blanks of a non-empty insert (module comment). */
function insertFits(read: Uint8Array, splice: ByteSplice): boolean {
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
