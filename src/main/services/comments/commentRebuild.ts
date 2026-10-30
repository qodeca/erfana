// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "Rebuild from data…" for a hand-damaged comment (comments-v2 OD-05, § 4.1;
 * spec 024 024-FR-014, state table S-07).
 *
 * Offered only for a block the parse read as `readable-mismatch` or
 * `id-mismatch` whose `@data` is valid: its data is the truth, and only the
 * readable lines (or the header's id) were edited by hand. Never automatic –
 * the list says it can be done ({@link rebuildViewOf}); the write job does it
 * when the reader asks ({@link rebuildDataOf}).
 *
 * The block's text is read the way `blocks.ts` classifies it: the `@data`
 * line and the JSON after it, scanned and parsed with the same guards and
 * checked with `CommentDataSchema`; the readable lines compared trimmed, with
 * the agent note skipped. Pure: no Electron, no file system.
 */
import { parseDataJson, scanJson, type DamageReason } from '../../../shared/comments/blocks'
import {
  AGENT_NOTE_PREFIX,
  BLOCK_MARKER,
  CommentDataSchema,
  FORMAT_VERSION,
  LINE_BREAK,
  renderReadableLines,
  type CommentData
} from '../../../shared/comments/format'
import { REBUILD_LINE_MAX_CHARS, REBUILD_LINES_MAX, type CommentFileView } from '../../../shared/ipc/comment-common-schema'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'

/** The wire form of a rebuild offer. */
export type RebuildView = NonNullable<CommentFileView['damaged'][number]['rebuild']>

/** The damage reasons a rebuild may repair. */
const REBUILDABLE: ReadonlySet<DamageReason> = new Set<DamageReason>(['readable-mismatch', 'id-mismatch'])
const DATA_LINE = /^\s*@data(?:\s|$)/
const STATUS_PREFIX = 'status: '

/** What a damaged block's text holds, when its data is valid. */
interface Readable {
  readonly data: CommentData
  /** Header then readable lines, trimmed, without the agent note – as the file has them. */
  readonly fileLines: readonly string[]
  /** The same, as the data renders them. */
  readonly dataLines: readonly string[]
}

/** The comment's body: the text between `<!--` and its closing `-->` / `--!>`. */
function bodyOf(raw: string): string | undefined {
  if (!raw.startsWith('<!--')) return undefined
  const close = raw.endsWith('--!>') ? 4 : raw.endsWith('-->') ? 3 : 0
  return close === 0 ? undefined : raw.slice(4, raw.length - close)
}

/** Readable lines without the agent note: from the `status:` line on, when the note opens them. */
function withoutNote(lines: readonly string[]): readonly string[] {
  if (!lines[0]?.startsWith(AGENT_NOTE_PREFIX)) return lines
  const status = lines.findIndex(line => line.startsWith(STATUS_PREFIX))
  return status < 0 ? lines.slice(1) : lines.slice(status)
}

/** A damaged block's valid data and its lines, or `undefined` when its data is not valid. */
function readableOf(raw: string): Readable | undefined {
  const body = bodyOf(raw)
  if (body === undefined) return undefined
  const lines = body.split(LINE_BREAK)
  const dataAt = lines.findIndex((line, i) => i > 0 && DATA_LINE.test(line))
  if (dataAt < 0) return undefined
  const json = [lines[dataAt].trimStart().slice('@data'.length), ...lines.slice(dataAt + 1)].join('\n').trim()
  if (scanJson(json, PREVIEW_LIMITS.COMMENT_JSON_MAX_DEPTH) !== 'ok') return undefined
  let parsed: unknown
  try {
    parsed = parseDataJson(json)
  } catch {
    return undefined
  }
  if (!CommentDataSchema.safeParse(parsed).success) return undefined
  // The parsed value, not the schema's output: fields a later version added are kept, as `blocks.ts` keeps them.
  const data = parsed as CommentData
  const readable = withoutNote(lines.slice(1, dataAt).map(line => line.trim()).filter(Boolean))
  const header = `${BLOCK_MARKER} v${FORMAT_VERSION} id=${data.id}`
  return {
    data,
    fileLines: [lines[0].trim(), ...readable],
    dataLines: [header, ...renderReadableLines(data).map(line => line.trim()).filter(Boolean)]
  }
}

const cut = (line: string): string => (line.length > REBUILD_LINE_MAX_CHARS ? line.slice(0, REBUILD_LINE_MAX_CHARS) : line)

/**
 * What the window shows for a damaged block it may offer to rebuild: each
 * differing line as the file and as the data has it, and – when only the
 * `status:` line differs and the file says resolved – that claim.
 *
 * @param raw - The block's text as the file has it.
 * @param reason - Why the parse read it as damaged.
 * @returns The offer, or `undefined` when a rebuild is not offered.
 */
export function rebuildViewOf(raw: string, reason: DamageReason): RebuildView | undefined {
  if (!REBUILDABLE.has(reason)) return undefined
  const readable = readableOf(raw)
  if (readable === undefined) return undefined
  const { fileLines, dataLines } = readable
  const lines: Array<{ file: string; data: string }> = []
  for (let i = 0; i < Math.max(fileLines.length, dataLines.length) && lines.length < REBUILD_LINES_MAX; i += 1) {
    const file = fileLines[i] ?? ''
    const data = dataLines[i] ?? ''
    if (file !== data) lines.push({ file: cut(file), data: cut(data) })
  }
  if (lines.length === 0) return undefined
  const only = lines.length === 1 ? lines[0] : undefined
  const claimsResolved =
    only !== undefined &&
    only.file.startsWith(`${STATUS_PREFIX}resolved`) &&
    only.data.startsWith(`${STATUS_PREFIX}open`) &&
    readable.data.status === 'open'
  return claimsResolved ? { lines, claims: 'resolved' } : { lines }
}

/**
 * The data a rebuild writes, when the block may be rebuilt.
 *
 * @param raw - The block's text as the file has it now.
 * @param reason - Why the parse read it as damaged.
 * @returns The block's own `@data`, or `undefined`.
 */
export function rebuildDataOf(raw: string, reason: DamageReason): CommentData | undefined {
  return REBUILDABLE.has(reason) ? readableOf(raw)?.data : undefined
}
