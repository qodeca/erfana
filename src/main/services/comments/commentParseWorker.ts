// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The persistent comment parse worker's shared runner
 * (docs/designs/comments/html-preview-comments.md §19 R3-12; spec 024
 * architecture note 001 § 8 C22; pattern `src/main/services/workers/git-status.worker.ts`).
 *
 * The worker runs the parse of every commented file off the main thread: a
 * 4 MB page costs about 380 ms of parsing and a dense 25 MB page about 5 s,
 * which on the main thread would freeze every window (spike S9, §19 Rev 4).
 *
 * The runner knows no file kind. A request names a file kind id and a job;
 * the runner looks the job up in the {@link CommentJobLookup} the entry built
 * – every kind's table, registered at the composition root
 * (`src/main/services/workers/comment-parse.worker.ts`, the
 * `comment-parse.worker` bundle of electron.vite.config.ts, started by
 * `CommentParseWorkerAdapter.ts`) – and runs it with that kind's slice of one
 * document cache for the worker's life (`commentJobDocs.ts`). A request for a
 * kind or a job no table names is not a request: it is ignored.
 *
 * Requests are handled one at a time, in order. Before any work the worker
 * tells main the SHA-256 of the request's bytes (`begin`): when a file kills
 * it (out of memory, or main's time limit), main knows which content did and
 * sends that hash back with every later request, and the worker answers
 * `poisoned` for it without parsing it again (security review S-M). A throw
 * answers `error` with no text (nothing from the file reaches a log). The
 * buffers a handler names are transferred, not copied, and every reply hands
 * the request's own bytes back as `raw` – main may have lent them rather than
 * copied them (`CommentParseWorkerAdapter.ts`, §19 Rev 4).
 */
import type { CommentJobLookup } from './commentFileJobs'
import { CommentDocCache, sha256HexOf } from './commentJobDocs'
import {
  COMMENT_PARSE_WORKER_ROLE,
  requestHandlerOf,
  type CommentParseBegin,
  type CommentParseReply,
  type CommentParseRequest
} from './commentParseProtocol'

/** The slice of a `MessagePort` the runner uses. */
export interface CommentParsePort {
  on(event: 'message', listener: (message: unknown) => void): unknown
  postMessage(message: CommentParseReply | CommentParseBegin, transfer?: ArrayBuffer[]): void
}

/** What a worker answers with: every kind's jobs, and the one document cache they share. */
export interface CommentParseWorkerContext {
  readonly jobs: CommentJobLookup
  readonly cache: CommentDocCache
}

/**
 * A view's buffer when it can move without a copy: when the view owns all of
 * it. A view into a larger buffer (a pooled `Buffer`, say) is copied instead –
 * moving it would take the rest of that buffer with it. Every reply moves the
 * request's bytes back this way (main lends a whole buffer or sends its own
 * copy), and a handler may name its answer's buffers the same way.
 */
export function rawTransferablesOf(raw: Uint8Array): ArrayBuffer[] {
  return raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength ? [raw.buffer as ArrayBuffer] : []
}

/**
 * Answer one request on `port`; anything that is not a request for a job
 * `context.jobs` knows is ignored. Never throws.
 */
export function answerParseRequest(port: CommentParsePort, message: unknown, context: CommentParseWorkerContext): void {
  const handler = requestHandlerOf(message, context.jobs)
  if (handler === undefined) return
  const request = message as CommentParseRequest
  const raw = request.bytes
  // Which content this is, before any work: if the work below kills this worker, main stops sending it.
  const hash = sha256HexOf(raw)
  port.postMessage({ type: 'begin', id: request.id, hash })
  if (request.poisoned?.includes(hash) === true) {
    port.postMessage({ type: 'poisoned', id: request.id, raw }, rawTransferablesOf(raw))
    return
  }
  let reply: [CommentParseReply, ArrayBuffer[]]
  try {
    const result = handler.run(raw, request.job, { cache: context.cache.forKind(request.fileKind) })
    const moved = [...(handler.transferables?.(result) ?? []), ...rawTransferablesOf(raw)]
    reply = [{ type: 'job', id: request.id, result, raw }, moved]
  } catch {
    port.postMessage({ type: 'error', id: request.id, raw }, rawTransferablesOf(raw))
    return
  }
  port.postMessage(...reply)
}

/** Start answering requests on `port` with `jobs`, and a document cache for the worker's life. */
export function startCommentParseWorker(port: CommentParsePort, jobs: CommentJobLookup): void {
  const context: CommentParseWorkerContext = { jobs, cache: new CommentDocCache() }
  port.on('message', message => answerParseRequest(port, message, context))
}

/** True when this thread was started as the comment parse worker. */
export function isCommentParseWorker(data: unknown, port: unknown): boolean {
  const role = (data as { role?: unknown } | null | undefined)?.role
  return port !== null && port !== undefined && role === COMMENT_PARSE_WORKER_ROLE
}
