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
import type { CommentFileJob, CommentFileJobResult } from './commentFileJobs'
import { TOKEN_CHARS, type InstrumentOutcome } from './commentParseCore'

/** The `workerData.role` the adapter starts the worker with; the worker answers only then. */
export const COMMENT_PARSE_WORKER_ROLE = 'erfana-comment-parse'

/** Every job kind, checked complete against the job union; types only cross from the job module. */
const JOB_KINDS = { draft: true, 'pin-blocks': true, list: true, write: true } satisfies Record<CommentFileJob['kind'], true>
const COMMENT_FILE_JOB_KINDS: ReadonlySet<string> = new Set(Object.keys(JOB_KINDS))

/** Main → worker: instrument a served document, or run a comment file job (`commentFileJobs.ts`). */
export type CommentParseRequest =
  | {
      readonly type: 'instrument'
      readonly id: number
      /** The served document's bytes (transferred). */
      readonly bytes: Uint8Array
    }
  | {
      readonly type: 'job'
      readonly id: number
      /** The file's bytes as main read them (transferred). */
      readonly bytes: Uint8Array
      readonly job: CommentFileJob
    }

/** Worker → main. */
export type CommentParseReply =
  | { readonly type: 'result'; readonly id: number; readonly outcome: InstrumentOutcome }
  | { readonly type: 'job'; readonly id: number; readonly result: CommentFileJobResult }
  | { readonly type: 'error'; readonly id: number }

/** True when `job` names a known job kind; its fields are the job module's to read. */
function isJob(job: unknown): job is CommentFileJob {
  return typeof job === 'object' && job !== null && COMMENT_FILE_JOB_KINDS.has((job as { kind?: unknown }).kind as string)
}

/** True when `message` is a well-formed {@link CommentParseRequest}. */
export function isParseRequest(message: unknown): message is CommentParseRequest {
  if (typeof message !== 'object' || message === null) return false
  const { type, id, bytes } = message as { type?: unknown; id?: unknown; bytes?: unknown }
  if (!Number.isSafeInteger(id) || !(bytes instanceof Uint8Array)) return false
  return type === 'instrument' || (type === 'job' && isJob((message as { job?: unknown }).job))
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

/** True when `result` names a known job kind; the client checks it is the kind it asked for. */
function isJobResult(result: unknown): result is CommentFileJobResult {
  return typeof result === 'object' && result !== null && COMMENT_FILE_JOB_KINDS.has((result as { kind?: unknown }).kind as string)
}

/** True when `message` is a well-formed {@link CommentParseReply}. */
export function isParseReply(message: unknown): message is CommentParseReply {
  if (typeof message !== 'object' || message === null) return false
  const { type, id } = message as { type?: unknown; id?: unknown }
  if (!Number.isSafeInteger(id)) return false
  if (type === 'error') return true
  if (type === 'job') return isJobResult((message as { result?: unknown }).result)
  if (type !== 'result') return false
  const outcome = (message as { outcome?: InstrumentOutcome }).outcome
  if (typeof outcome !== 'object' || outcome === null) return false
  if (outcome.kind === 'unavailable') return typeof outcome.reason === 'string'
  return outcome.kind === 'ok' && isConsistentTable(outcome)
}
