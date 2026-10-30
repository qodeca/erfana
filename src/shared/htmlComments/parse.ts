// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Reading comment blocks from an HTML file
 * (docs/designs/comments/html-preview-comments.md §5.5, §5.7, decision 12).
 *
 * Blocks are found by walking parse5's COMMENT NODES – never by a regex over
 * the file – so block-shaped text inside `<script>`, `<style>`, `<textarea>`,
 * attribute values, CDATA or another comment is never mistaken for a block
 * (U-032). What each node is – `ok`, `newer` or `damaged`, and why – is
 * decided by the kind-agnostic classifier in `../comments/blocks.ts`, with
 * the shipped `before-target` removable range and the shared re-attach rules
 * (`../comments/reattach.ts`). The classifier's names are re-exported here,
 * so this module stays the HTML entry for reading blocks.
 */
import { PREVIEW_LIMITS } from '../preview-limits'
import { classifyIndexedBlocks, type FileCommentState } from '../comments/blocks'
import { decodeLossless, utf8Length, type DecodeFailure } from '../comments/encoding'
import { resolveBlockTarget } from '../comments/reattach'
import { hasMoreStartTagsThan, indexHtml, type HtmlIndex } from './htmlIndex'
import { HtmlParseLimitError, hasAttributeFlood } from './parseBounds'

export {
  hashText,
  parseDataJson,
  scanJson,
  type DamageReason,
  type FileCommentState,
  type ParsedBlock,
  type ReadOnlyReason
} from '../comments/blocks'

/** A decoded file with its shared parse and its comment state – the input of every splice. */
export interface CommentDocument {
  readonly text: string
  readonly index: HtmlIndex
  readonly state: FileCommentState
}

/** Find and classify every comment block of an already indexed file. */
export function parseIndexedBlocks(index: HtmlIndex): FileCommentState {
  return classifyIndexedBlocks(index, 'before-target', (node, data, blockEnds) =>
    resolveBlockTarget(index, { after: node.end, anchor: data.anchor, blockEnds })
  )
}

/** True when the decoded file is over the comment size limit (served raw, read-only). */
function isTooLarge(text: string): boolean {
  return utf8Length(text) > PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES
}

const TOO_LARGE: FileCommentState = { blocks: [], writable: false, readOnlyReason: 'too-large' }

/**
 * Every comment block of a decoded HTML file and the file's comment state.
 * A file over `COMMENT_FILE_MAX_BYTES` is not parsed: it is read-only with
 * the reason `too-large` and lists no blocks.
 */
export function parseCommentBlocks(text: string): FileCommentState {
  return analyzeCommentDocument(text).state
}

/** The index of `text`, or `undefined` when the parse went past its bounds (`parseBounds.ts`, S-M). */
function boundedIndex(text: string): HtmlIndex | undefined {
  try {
    return indexHtml(text)
  } catch (error) {
    if (error instanceof HtmlParseLimitError) return undefined
    throw error
  }
}

/**
 * Parse once and keep the parse: the input of `planInsert` / `planReplace` /
 * `planDelete`. A page past the parse bounds is `too-large`, like one past the
 * size limit: read-only, no blocks.
 */
export function analyzeCommentDocument(text: string): CommentDocument {
  const index = isTooLarge(text) ? undefined : boundedIndex(text)
  if (index === undefined) return { text, index: indexHtml(''), state: TOO_LARGE }
  return { text, index, state: parseIndexedBlocks(index) }
}

/** Result of {@link parseCommentFile}. */
export type CommentFileResult =
  | { readonly ok: true; readonly doc: CommentDocument }
  | {
      readonly ok: false
      readonly reason: DecodeFailure | 'too-large'
      readonly state: FileCommentState
    }

/**
 * Decode a file's bytes losslessly and analyse it. Anything but UTF-8 is
 * read-only with the reason `encoding` (§3); the bytes are never touched.
 * A file over `COMMENT_FILE_MAX_BYTES`, with more start tags than
 * `COMMENT_MAX_TOKENS_PER_DOCUMENT`, or with an attribute flood
 * (`hasAttributeFlood`) is `too-large` and never parsed: either would build a
 * tree past what the parse worker's heap is sized for, or take it minutes
 * (§19 Rev 4, S-M). One that goes past the parse's own bounds while parsing
 * is `too-large` too.
 */
export function parseCommentFile(bytes: Uint8Array): CommentFileResult {
  if (
    bytes.length > PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES ||
    hasMoreStartTagsThan(bytes, PREVIEW_LIMITS.COMMENT_MAX_TOKENS_PER_DOCUMENT) ||
    hasAttributeFlood(bytes)
  ) {
    return { ok: false, reason: 'too-large', state: TOO_LARGE }
  }
  const decoded = decodeLossless(bytes)
  if (!decoded.ok) {
    return {
      ok: false,
      reason: decoded.reason,
      state: { blocks: [], writable: false, readOnlyReason: 'encoding' }
    }
  }
  const doc = analyzeCommentDocument(decoded.text)
  return doc.state === TOO_LARGE ? { ok: false, reason: 'too-large', state: TOO_LARGE } : { ok: true, doc }
}
