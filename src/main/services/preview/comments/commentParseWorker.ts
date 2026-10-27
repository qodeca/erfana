// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The persistent comment parse worker (docs/designs/html-preview-comments.md
 * §19 R3-12; pattern `src/main/services/workers/git-status.worker.ts`).
 *
 * Built as its own main-process bundle entry (`comment-parse.worker`,
 * electron.vite.config.ts) and started by `CommentParseWorkerAdapter.ts`. It
 * runs the parse5 pass of every instrumented document off the main thread: a
 * 4 MB page costs about 380 ms of parsing and a dense 25 MB page about 5 s,
 * which on the main thread would freeze every window (spike S9, §19 Rev 4).
 *
 * The shell only moves messages; the work is `instrumentDocument`
 * (`commentParseCore.ts`) for a served page, and `runCommentFileJob`
 * (`commentFileJobs.ts`) for the parse a pick, a pin, a list or a write needs
 * – with one document cache for the worker's life (`commentJobDocs.ts`).
 * Requests are handled one at a time, in order. Before any work the worker
 * tells main the SHA-256 of the request's bytes (`begin`): when a page kills
 * it (out of memory, or main's time limit), main knows which content did and
 * sends that hash back with every later request, and the worker answers
 * `poisoned` for it without parsing it again (security review S-M). A throw
 * answers `error` with no text (nothing from the page reaches a log). The
 * result's large buffers
 * are transferred, not copied, and every reply hands the request's own bytes
 * back as `raw` – main may have lent them rather than copied them
 * (`CommentParseWorkerAdapter.ts`, §19 Rev 4).
 *
 * It starts listening only when its `workerData` names its role, so the module
 * can be imported anywhere – a test runner's own worker thread included –
 * without answering messages that are not addressed to it.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { runCommentFileJob, type CommentFileJobResult } from './commentFileJobs'
import { CommentDocCache, sha256HexOf } from './commentJobDocs'
import { instrumentDocument, type InstrumentOutcome } from './commentParseCore'
import {
  COMMENT_PARSE_WORKER_ROLE,
  isParseRequest,
  type CommentParseBegin,
  type CommentParseReply,
  type CommentParseRequest
} from './commentParseProtocol'

/** The slice of a `MessagePort` the shell uses. */
export interface CommentParsePort {
  on(event: 'message', listener: (message: unknown) => void): unknown
  postMessage(message: CommentParseReply | CommentParseBegin, transfer?: ArrayBuffer[]): void
}

/** The buffers of an outcome that can move to main without a copy. */
function transferablesOf(outcome: InstrumentOutcome): ArrayBuffer[] {
  if (outcome.kind !== 'ok') return []
  return [outcome.html.buffer, outcome.offsets.buffer, outcome.lines.buffer, outcome.tagCodes.buffer] as ArrayBuffer[]
}

/**
 * A job answer's buffer that can move without a copy: the write's block bytes,
 * when they own theirs. A view into a larger buffer (a pooled `Buffer`, say)
 * is copied instead – moving it would take the rest of that buffer with it.
 */
export function jobTransferablesOf(result: CommentFileJobResult): ArrayBuffer[] {
  if (result.kind !== 'write' || !result.ok) return []
  const { insert } = result
  return insert.byteOffset === 0 && insert.byteLength === insert.buffer.byteLength ? [insert.buffer as ArrayBuffer] : []
}

/**
 * The request's bytes as they go back: moved when they own their buffer
 * (they always do – main lends a whole buffer or sends its own copy), else
 * copied here, off the main thread.
 */
export function rawTransferablesOf(raw: Uint8Array): ArrayBuffer[] {
  return raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength ? [raw.buffer as ArrayBuffer] : []
}

/** The documents this worker parsed for jobs, by content hash. */
const jobDocuments = new CommentDocCache()

/** The reply to one request, with what it transfers. Throws when the work does. */
function replyTo(request: CommentParseRequest, cache: CommentDocCache): [CommentParseReply, ArrayBuffer[]] {
  const raw = request.bytes
  if (request.type === 'job') {
    const result = runCommentFileJob(raw, request.job, { cache })
    return [{ type: 'job', id: request.id, result, raw }, [...jobTransferablesOf(result), ...rawTransferablesOf(raw)]]
  }
  const outcome = instrumentDocument(raw)
  return [{ type: 'result', id: request.id, outcome, raw }, [...transferablesOf(outcome), ...rawTransferablesOf(raw)]]
}

/**
 * Answer one request on `port`; anything that is not a request is ignored.
 * Never throws. `cache` is the worker's document cache; a suite passes its own.
 */
export function answerParseRequest(port: CommentParsePort, message: unknown, cache: CommentDocCache = jobDocuments): void {
  if (!isParseRequest(message)) return
  // Which content this is, before any work: if the work below kills this worker, main stops sending it.
  const hash = sha256HexOf(message.bytes)
  port.postMessage({ type: 'begin', id: message.id, hash })
  if (message.poisoned?.includes(hash) === true) {
    port.postMessage({ type: 'poisoned', id: message.id, raw: message.bytes }, rawTransferablesOf(message.bytes))
    return
  }
  let reply: [CommentParseReply, ArrayBuffer[]]
  try {
    reply = replyTo(message, cache)
  } catch {
    port.postMessage({ type: 'error', id: message.id, raw: message.bytes }, rawTransferablesOf(message.bytes))
    return
  }
  port.postMessage(...reply)
}

/** Start answering requests on `port`. */
export function startCommentParseWorker(port: CommentParsePort): void {
  port.on('message', message => answerParseRequest(port, message))
}

/** True when this thread was started as the comment parse worker. */
export function isCommentParseWorker(data: unknown, port: unknown): boolean {
  const role = (data as { role?: unknown } | null | undefined)?.role
  return port !== null && port !== undefined && role === COMMENT_PARSE_WORKER_ROLE
}

if (isCommentParseWorker(workerData, parentPort)) {
  startCommentParseWorker(parentPort as unknown as CommentParsePort)
}
