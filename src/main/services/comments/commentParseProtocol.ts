// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The message contract between main and the comment parse worker
 * (docs/designs/comments/html-preview-comments.md §19 R3-12; spec 024
 * architecture note 001 § 8 C22).
 *
 * It knows no file kind: a request names a file kind id and a job – its
 * `kind` and its payload – and an answer is that job's result, whose `kind`
 * names the job it answers. What a job's result must hold is the file kind's
 * own business: main checks it where it asked (`CommentParseClient.run`).
 *
 * Its own module so the main bundle imports the contract without importing
 * the worker entry, which would make the main bundle load the worker's chunk
 * at start-up.
 */
import type { CommentFileKindId } from '../../../shared/comments/fileKind'
import type { AnyCommentJobHandler, CommentJob, CommentJobLookup, CommentJobResult } from './commentFileJobs'

/** The `workerData.role` the adapter starts the worker with; the worker answers only then. */
export const COMMENT_PARSE_WORKER_ROLE = 'erfana-comment-parse'

/** Content hashes main sends with a request, at most (`CommentParseWorkerAdapter.ts` keeps as many). */
export const MAX_POISONED_HASHES = 64
const CONTENT_HASH = /^[0-9a-f]{64}$/

/** Main → worker: run one job of one file kind's table on bytes main read. */
export interface CommentParseRequest {
  readonly type: 'job'
  readonly id: number
  /**
   * The SHA-256 of each content that stopped a worker before (security review
   * S-M). The worker answers `poisoned` for those instead of parsing them again.
   */
  readonly poisoned?: readonly string[]
  /** The file kind whose table runs the job: an id, never a path (`commentJobDocs.ts`). */
  readonly fileKind: CommentFileKindId
  /** The file's bytes as main read them (transferred). */
  readonly bytes: Uint8Array
  readonly job: CommentJob
}

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
  | { readonly type: 'job'; readonly id: number; readonly result: CommentJobResult; readonly raw?: Uint8Array }
  | { readonly type: 'error'; readonly id: number; readonly raw?: Uint8Array }
  /** The content stopped a worker before: not parsed again (S-M). */
  | { readonly type: 'poisoned'; readonly id: number; readonly raw?: Uint8Array }

/** True when `value` is an object whose `kind` is a string: a job, or a job's answer. */
function isKinded(value: unknown): value is { readonly kind: string } {
  return typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string'
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

/**
 * The handler of a well-formed {@link CommentParseRequest} for a job `jobs`
 * knows; `undefined` for anything else, which the worker ignores.
 */
export function requestHandlerOf(message: unknown, jobs: CommentJobLookup): AnyCommentJobHandler | undefined {
  if (typeof message !== 'object' || message === null) return undefined
  const { type, id, bytes, poisoned, fileKind, job } = message as {
    type?: unknown
    id?: unknown
    bytes?: unknown
    poisoned?: unknown
    fileKind?: unknown
    job?: unknown
  }
  if (type !== 'job' || !Number.isSafeInteger(id) || !(bytes instanceof Uint8Array) || !isPoisonList(poisoned)) return undefined
  if (typeof fileKind !== 'string' || !isKinded(job)) return undefined
  return jobs.handlerOf(fileKind, job.kind)
}

/** True when `message` is a well-formed {@link CommentParseRequest} for a job `jobs` knows. */
export function isParseRequest(message: unknown, jobs: CommentJobLookup): message is CommentParseRequest {
  return requestHandlerOf(message, jobs) !== undefined
}

/** True when `message` is a well-formed {@link CommentParseBegin}. */
export function isParseBegin(message: unknown): message is CommentParseBegin {
  if (typeof message !== 'object' || message === null) return false
  const { type, id, hash } = message as { type?: unknown; id?: unknown; hash?: unknown }
  return type === 'begin' && Number.isSafeInteger(id) && typeof hash === 'string' && CONTENT_HASH.test(hash)
}

/**
 * True when `message` is a well-formed {@link CommentParseReply}. A job
 * answer needs only a `kind`: whether it answers the job asked, and holds
 * what that job promises, the client checks against its request.
 */
export function isParseReply(message: unknown): message is CommentParseReply {
  if (typeof message !== 'object' || message === null) return false
  const { type, id, raw } = message as { type?: unknown; id?: unknown; raw?: unknown }
  if (!Number.isSafeInteger(id)) return false
  if (raw !== undefined && !(raw instanceof Uint8Array)) return false
  if (type === 'error' || type === 'poisoned') return true
  return type === 'job' && isKinded((message as { result?: unknown }).result)
}
