// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The message contract between main and the comment parse worker
 * (docs/designs/html-preview-comments.md §19 R3-12).
 *
 * Its own module so the main bundle imports the contract without importing
 * the worker entry (`commentParseWorker.ts`), which would make the main
 * bundle load the worker's chunk at start-up.
 */
import { TOKEN_CHARS, type InstrumentOutcome } from './commentParseCore'

/** The `workerData.role` the adapter starts the worker with; the worker answers only then. */
export const COMMENT_PARSE_WORKER_ROLE = 'erfana-comment-parse'

/** Main → worker. */
export interface CommentParseRequest {
  readonly type: 'instrument'
  readonly id: number
  /** The served document's bytes (transferred). */
  readonly bytes: Uint8Array
}

/** Worker → main. */
export type CommentParseReply =
  | { readonly type: 'result'; readonly id: number; readonly outcome: InstrumentOutcome }
  | { readonly type: 'error'; readonly id: number }

/** True when `message` is a well-formed {@link CommentParseRequest}. */
export function isParseRequest(message: unknown): message is CommentParseRequest {
  if (typeof message !== 'object' || message === null) return false
  const { type, id, bytes } = message as Partial<CommentParseRequest>
  return type === 'instrument' && Number.isSafeInteger(id) && bytes instanceof Uint8Array
}

/**
 * True when an `ok` outcome's table is internally consistent: one token of
 * {@link TOKEN_CHARS} characters, one offset and one tag code per element.
 * The token table's aligned lookup relies on it, so main checks it at the
 * boundary instead of trusting the other thread.
 */
function isConsistentTable(outcome: InstrumentOutcome & { kind: 'ok' }): boolean {
  const { html, tokens, offsets, tagCodes, tagNames, blocks, fileHash } = outcome
  return (
    html instanceof Uint8Array &&
    offsets instanceof Int32Array &&
    tagCodes instanceof Uint32Array &&
    typeof tokens === 'string' &&
    typeof fileHash === 'string' &&
    tokens.length === offsets.length * TOKEN_CHARS &&
    tagCodes.length === offsets.length &&
    Array.isArray(tagNames) &&
    Array.isArray(blocks)
  )
}

/** True when `message` is a well-formed {@link CommentParseReply}. */
export function isParseReply(message: unknown): message is CommentParseReply {
  if (typeof message !== 'object' || message === null) return false
  const { type, id } = message as { type?: unknown; id?: unknown }
  if (!Number.isSafeInteger(id)) return false
  if (type === 'error') return true
  if (type !== 'result') return false
  const outcome = (message as { outcome?: InstrumentOutcome }).outcome
  if (typeof outcome !== 'object' || outcome === null) return false
  if (outcome.kind === 'unavailable') return typeof outcome.reason === 'string'
  return outcome.kind === 'ok' && isConsistentTable(outcome)
}
