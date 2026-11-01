// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:commentBulk` and `file-comment:bulk` (spec 024 024-FR-028, plan
 * step 13): what both families share of a bulk action – "Resolve all changed
 * comments", "Delete all resolved comments".
 *
 * A request names main-minted keys and the block hash the person reviewed,
 * never a path. One write per file, each through the one `CommentWriter`, one
 * after the other. A file's write is all or nothing, so a partial failure
 * leaves every file either fully done or byte-identical, and a refusal of one
 * file never stops the next: the answer says which is which, and the review
 * can be run again on what is left.
 *
 * A write past the time limit answers `COMMENT_SAVE_PENDING` for its file and
 * goes on under its lock; the file watch shows the result when it lands.
 */
import { ErrorCode } from '../../../shared/errors'
import type { CommentBulkFile, CommentBulkFileResult, CommentBulkRequest, CommentBulkResult } from '../../../shared/ipc/comment-common-schema'
import { logger } from '../LoggingService'
import type { BulkThread } from './commentBulkCore'
import type { CommentBinding, CommentKeyStore } from './commentKeyStore'
import { refusalCode } from './commentRefusals'
import { boundedWrite, SAVE_TIMEOUT_MS, type LandedWrite } from './commentSaveFlow'
import { samePathKey } from './commentUnsavedSources'
import type { CommentWriteResult, CommentWriter } from './CommentWriter'

type Written = Extract<CommentWriteResult, { ok: true }>

/** One file's write of a bulk action, or `threads: null` when a key did not hold. */
export interface BulkFileWork {
  readonly fileKey: string
  readonly threads: readonly BulkThread[] | null
  readonly write: (threads: readonly BulkThread[]) => Promise<CommentWriteResult>
}

const KEY_REFUSED = { code: ErrorCode.COMMENT_KEY_INVALID, reason: 'key-invalid' } as const

/**
 * The file and threads a request names, as this binding's key store knows them.
 *
 * @param keys - The binding's key store.
 * @param binding - The sender's view or panel.
 * @param named - The file part of the request.
 * @param isFile - Whether a key's real path is the file key's (and, in the file family, the panel's).
 * @returns The file's real path and its threads, or `null` when any key is unknown or names another file.
 */
export function resolveBulkFile<D>(
  keys: Pick<CommentKeyStore<D>, 'resolve'>,
  binding: CommentBinding,
  named: CommentBulkFile,
  isFile: (fileRealPath: string, keyRealPath: string) => boolean
): { readonly realPath: string; readonly threads: readonly BulkThread[] } | null {
  const file = keys.resolve(binding, named.fileKey, 'file')
  if (!file.ok) return null
  const threads: BulkThread[] = []
  for (const { threadKey, rawHash } of named.threads) {
    const thread = keys.resolve(binding, threadKey, 'thread')
    if (!thread.ok || !isFile(file.value.realPath, thread.value.realPath)) return null
    threads.push({ threadId: thread.value.threadId, rawHash })
  }
  return isFile(file.value.realPath, file.value.realPath) ? { realPath: file.value.realPath, threads } : null
}

async function runOne(work: BulkFileWork, timeoutMs: number, land: (written: Written) => void): Promise<CommentBulkFileResult> {
  const { fileKey, threads } = work
  if (threads === null) return { fileKey, ok: false, ...KEY_REFUSED }
  const write = work.write(threads)
  const outlasted = (): void => {
    void write.then(
      result => {
        if (result.ok) land(result)
      },
      () => logger.warn('Comments: a bulk write that outlasted its time limit failed')
    )
  }
  const result = await boundedWrite(write, timeoutMs, outlasted)
  if (result === 'pending') return { fileKey, ok: false, code: ErrorCode.COMMENT_SAVE_PENDING }
  if (result === 'failed') return { fileKey, ok: false, code: ErrorCode.COMMENT_WRITE_FAILED }
  if (!result.ok) return { fileKey, ok: false, code: refusalCode(result.reason), reason: result.reason }
  land(result)
  return { fileKey, ok: true, done: threads.length }
}

/**
 * Every file's write, one after the other: a refusal of one does not stop the next.
 *
 * @param files - One entry per file.
 * @param timeoutMs - Longest one write waits before its file answers "still saving".
 * @param land - A write landed, in time or late.
 * @returns Each file's outcome, in request order.
 */
export async function runBulkFiles(files: readonly BulkFileWork[], timeoutMs = SAVE_TIMEOUT_MS, land: (written: Written) => void = () => {}): Promise<CommentBulkResult> {
  const outcomes: CommentBulkFileResult[] = []
  for (const file of files) outcomes.push(await runOne(file, timeoutMs, land))
  return { ok: true, files: outcomes }
}

/** What the HTML family's flow is built from. */
export interface BulkFlowDeps<D, S> {
  readonly binding: CommentBinding
  readonly realRoot: string
  readonly keys: Pick<CommentKeyStore<D>, 'resolve'>
  readonly writer: Partial<Pick<CommentWriter, 'changeThreads'>>
  readonly captureScroll: () => Promise<S | undefined>
  readonly currentPage: () => string
  readonly landed: (write: LandedWrite<S>) => void
  readonly timeoutMs?: number
  readonly platform?: NodeJS.Platform
}

/** One view's bulk path: the reader's place goes back after the writes, as after any save. */
export function createCommentBulkFlow<D, S>(deps: BulkFlowDeps<D, S>): (request: CommentBulkRequest) => Promise<CommentBulkResult> {
  const same = (a: string, b: string): boolean => samePathKey(a, deps.platform) === samePathKey(b, deps.platform)
  return async request => {
    const changeThreads = deps.writer.changeThreads?.bind(deps.writer)
    if (changeThreads === undefined) return { ok: false, code: ErrorCode.COMMENT_KEY_INVALID }
    const scroll = await deps.captureScroll()
    const work = request.files.map((named): BulkFileWork => {
      const found = resolveBulkFile(deps.keys, deps.binding, named, same)
      const file = { realRoot: deps.realRoot, filePath: found?.realPath ?? '' }
      return { fileKey: named.fileKey, threads: found?.threads ?? null, write: threads => changeThreads({ file, threads, change: request.change }) }
    })
    return runBulkFiles(work, deps.timeoutMs, written =>
      deps.landed({ realPath: written.realPath, fileHash: written.fileHash, ...(scroll === undefined ? {} : { scroll, page: deps.currentPage() }) })
    )
  }
}
