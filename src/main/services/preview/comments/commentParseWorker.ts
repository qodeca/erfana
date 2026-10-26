// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The persistent comment parse worker (docs/designs/html-preview-comments.md
 * §19 R3-12; pattern `src/main/services/workers/git-status.worker.ts`).
 *
 * Built as its own main-process bundle entry (`comment-parse.worker`,
 * electron.vite.config.ts) and started by `CommentParseWorkerAdapter.ts`. It
 * runs the parse5 pass of every instrumented document off the main thread: a
 * 4 MB page costs about 380 ms of parsing, which on the main thread would
 * freeze every window (spike S9).
 *
 * The shell only moves messages; the work is `instrumentDocument`
 * (`commentParseCore.ts`). Requests are handled one at a time, in order. A
 * throw answers `error` with no text (nothing from the page reaches a log).
 * The result's large buffers are transferred, not copied.
 *
 * It starts listening only when its `workerData` names its role, so the module
 * can be imported anywhere – a test runner's own worker thread included –
 * without answering messages that are not addressed to it.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { instrumentDocument, type InstrumentOutcome } from './commentParseCore'
import {
  COMMENT_PARSE_WORKER_ROLE,
  isParseRequest,
  type CommentParseReply
} from './commentParseProtocol'

/** The slice of a `MessagePort` the shell uses. */
export interface CommentParsePort {
  on(event: 'message', listener: (message: unknown) => void): unknown
  postMessage(message: CommentParseReply, transfer?: ArrayBuffer[]): void
}

/** The buffers of an outcome that can move to main without a copy. */
function transferablesOf(outcome: InstrumentOutcome): ArrayBuffer[] {
  if (outcome.kind !== 'ok') return []
  return [outcome.html.buffer, outcome.offsets.buffer, outcome.tagCodes.buffer] as ArrayBuffer[]
}

/** Answer one request on `port`; anything that is not a request is ignored. Never throws. */
export function answerParseRequest(port: CommentParsePort, message: unknown): void {
  if (!isParseRequest(message)) return
  let outcome: InstrumentOutcome
  try {
    outcome = instrumentDocument(message.bytes)
  } catch {
    port.postMessage({ type: 'error', id: message.id })
    return
  }
  port.postMessage({ type: 'result', id: message.id, outcome }, transferablesOf(outcome))
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
