// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The message contract between main and the comment parse worker
 * (docs/designs/comments/html-preview-comments.md §19 R3-12).
 *
 * Its own module so the main bundle imports the contract without importing
 * the worker entry (`commentParseWorker.ts`), which would make the main
 * bundle load the worker's chunk at start-up.
 */
import type { CommentFileJob, CommentFileJobResult } from './commentFileJobs'
import { TOKEN_CHARS, type InstrumentOutcome } from '../preview/comments/commentParseCore'

/** The `workerData.role` the adapter starts the worker with; the worker answers only then. */
export const COMMENT_PARSE_WORKER_ROLE = 'erfana-comment-parse'

/** Every job kind, checked complete against the job union; types only cross from the job module. */
const JOB_KINDS = { draft: true, pin: true, list: true, write: true } satisfies Record<CommentFileJob['kind'], true>
const COMMENT_FILE_JOB_KINDS: ReadonlySet<string> = new Set(Object.keys(JOB_KINDS))

/** Content hashes main sends with a request, at most (`CommentParseWorkerAdapter.ts` keeps as many). */
export const MAX_POISONED_HASHES = 64
const CONTENT_HASH = /^[0-9a-f]{64}$/

/**
 * What every request carries besides its work: the SHA-256 of each content
 * that stopped a worker before (security review S-M). The worker answers
 * `poisoned` for those instead of parsing them again.
 */
interface RequestCommon {
  readonly id: number
  readonly poisoned?: readonly string[]
}

/** Main → worker: instrument a served document, or run a comment file job (`commentFileJobs.ts`). */
export type CommentParseRequest =
  | (RequestCommon & {
      readonly type: 'instrument'
      /** The served document's bytes (transferred). */
      readonly bytes: Uint8Array
    })
  | (RequestCommon & {
      readonly type: 'job'
      /** The file's bytes as main read them (transferred). */
      readonly bytes: Uint8Array
      readonly job: CommentFileJob
    })

/**
 * Worker → main, before any work on a request: the SHA-256 of its bytes. Not
 * a reply – the request still waits for one – but if the worker dies on it,
 * main knows which content to stop sending (S-M).
 */
export interface CommentParseBegin {
  readonly type: 'begin'
  readonly id: number
  readonly hash: string
}

/**
 * Worker → main. Every reply hands the request's bytes back as `raw`
 * (transferred), so main can use bytes it lent rather than copied
 * (`CommentParseWorkerAdapter.ts`).
 */
export type CommentParseReply =
  | { readonly type: 'result'; readonly id: number; readonly outcome: InstrumentOutcome; readonly raw?: Uint8Array }
  | { readonly type: 'job'; readonly id: number; readonly result: CommentFileJobResult; readonly raw?: Uint8Array }
  | { readonly type: 'error'; readonly id: number; readonly raw?: Uint8Array }
  /** The content stopped a worker before: not parsed again (S-M). */
  | { readonly type: 'poisoned'; readonly id: number; readonly raw?: Uint8Array }

/** True when `job` names a known job kind; its fields are the job module's to read. */
function isJob(job: unknown): job is CommentFileJob {
  return typeof job === 'object' && job !== null && COMMENT_FILE_JOB_KINDS.has((job as { kind?: unknown }).kind as string)
}

/** True when `poisoned` is absent, or a short list of content hashes. */
function isPoisonList(poisoned: unknown): boolean {
  return (
    poisoned === undefined ||
    (Array.isArray(poisoned) &&
      poisoned.length <= MAX_POISONED_HASHES &&
      poisoned.every(hash => typeof hash === 'string' && CONTENT_HASH.test(hash)))
  )
}

/** True when `message` is a well-formed {@link CommentParseRequest}. */
export function isParseRequest(message: unknown): message is CommentParseRequest {
  if (typeof message !== 'object' || message === null) return false
  const { type, id, bytes, poisoned } = message as { type?: unknown; id?: unknown; bytes?: unknown; poisoned?: unknown }
  if (!Number.isSafeInteger(id) || !(bytes instanceof Uint8Array) || !isPoisonList(poisoned)) return false
  return type === 'instrument' || (type === 'job' && isJob((message as { job?: unknown }).job))
}

/** True when `message` is a well-formed {@link CommentParseBegin}. */
export function isParseBegin(message: unknown): message is CommentParseBegin {
  if (typeof message !== 'object' || message === null) return false
  const { type, id, hash } = message as { type?: unknown; id?: unknown; hash?: unknown }
  return type === 'begin' && Number.isSafeInteger(id) && typeof hash === 'string' && CONTENT_HASH.test(hash)
}

/**
 * True when an `ok` outcome's table is internally consistent: one token of
 * {@link TOKEN_CHARS} characters, one offset, one line and one tag code per
 * element.
 * The token table's aligned lookup relies on it, so main checks it at the
 * boundary instead of trusting the other thread.
 */
function isConsistentTable(outcome: InstrumentOutcome & { kind: 'ok' }): boolean {
  const { html, tokens, offsets, lines, tagCodes, tagNames, blocks, fileHash } = outcome
  return (
    html instanceof Uint8Array &&
    offsets instanceof Int32Array &&
    lines instanceof Uint32Array &&
    tagCodes instanceof Uint32Array &&
    typeof tokens === 'string' &&
    typeof fileHash === 'string' &&
    tokens.length === offsets.length * TOKEN_CHARS &&
    tagCodes.length === offsets.length &&
    lines.length === offsets.length &&
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
  const { type, id, raw } = message as { type?: unknown; id?: unknown; raw?: unknown }
  if (!Number.isSafeInteger(id)) return false
  if (raw !== undefined && !(raw instanceof Uint8Array)) return false
  if (type === 'error' || type === 'poisoned') return true
  if (type === 'job') return isJobResult((message as { result?: unknown }).result)
  if (type !== 'result') return false
  const outcome = (message as { outcome?: InstrumentOutcome }).outcome
  if (typeof outcome !== 'object' || outcome === null) return false
  if (outcome.kind === 'unavailable') return typeof outcome.reason === 'string'
  return outcome.kind === 'ok' && isConsistentTable(outcome)
}
