// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment file jobs: every parse a pick, a pin, a list or a write needs, run
 * on bytes main read (docs/designs/html-preview-comments.md §19 R3-12).
 *
 * Main reads and confines the file; the parse of it – about 380 ms at 4 MB
 * (spike S9) – and everything worked out from the parse run in the comment
 * parse worker, beside the instrumentation of served pages. Main's share of
 * a job is one copy of the bytes into the message and the structured answer.
 *
 * Pure: the dispatcher below runs in the worker (`commentParseWorker.ts`) and
 * in {@link createInProcessCommentFileJobs}, the runner the suites use. A job
 * and its answer are plain data – no class instances, no functions – because
 * they cross a thread; the in-process runner clones both with
 * `structuredClone`, so a suite catches anything that would not.
 */
import type { RandomBytes } from '../../../../shared/htmlComments'
import { CommentDocCache, documentOf, freshDocumentOf } from './commentJobDocs'
import { runDraftJob, runPinBlocksJob, type DraftJob, type DraftJobResult, type PinBlocksJob, type PinBlocksJobResult } from './commentDraftCore'
import { runListJob, type ListJob, type ListJobResult } from './commentListCore'
import { runWriteJob, type WriteJob, type WriteJobResult } from './commentWriteCore'

/** Every job kind. */
export type CommentFileJob = DraftJob | PinBlocksJob | ListJob | WriteJob

/** Every job answer; `kind` names the job it answers. */
export type CommentFileJobResult = DraftJobResult | PinBlocksJobResult | ListJobResult | WriteJobResult

/** The answer to a job of `J`'s kind. */
export type JobResultOf<J extends CommentFileJob> = Extract<CommentFileJobResult, { readonly kind: J['kind'] }>

/** Why a job produced no answer – the parse worker client's failures (`CommentParseWorkerAdapter.ts`). */
export type CommentJobFailure = 'busy' | 'timeout' | 'crashed' | 'error' | 'unavailable'

/** A job's answer, or why there is none. */
export type CommentJobOutcome<J extends CommentFileJob> =
  | JobResultOf<J>
  | { readonly kind: 'failed'; readonly failure: CommentJobFailure }

/** Runs comment file jobs. Never rejects: every failure is a `failed` outcome. */
export interface CommentFileJobRunner {
  runJob<J extends CommentFileJob>(bytes: Uint8Array, job: J): Promise<CommentJobOutcome<J>>
}

/** What a job may use besides its bytes. */
export interface CommentJobEnv {
  readonly cache: CommentDocCache
  /** Random source for new thread and message ids; `crypto.getRandomValues` when absent. */
  readonly random?: RandomBytes
}

/** Run one job on `bytes`. Throws only on a bug; the callers turn a throw into an `error`. */
export function runCommentFileJob(bytes: Uint8Array, job: CommentFileJob, env: CommentJobEnv): CommentFileJobResult {
  switch (job.kind) {
    case 'draft':
      return runDraftJob(documentOf(bytes, env.cache), job)
    case 'pin-blocks':
      return runPinBlocksJob(documentOf(bytes, env.cache), job)
    case 'list':
      return runListJob(documentOf(bytes, env.cache))
    case 'write':
      return runWriteJob(freshDocumentOf(bytes), bytes, job, env)
  }
}

/**
 * Jobs on the calling thread – for the suites, which have no worker bundle.
 * Never for production: the parse would block the main thread.
 */
export function createInProcessCommentFileJobs(options: { readonly random?: RandomBytes } = {}): CommentFileJobRunner {
  const env: CommentJobEnv = { cache: new CommentDocCache(), random: options.random }
  return {
    async runJob<J extends CommentFileJob>(bytes: Uint8Array, job: J): Promise<CommentJobOutcome<J>> {
      try {
        const result = runCommentFileJob(new Uint8Array(bytes), structuredClone(job), env)
        return structuredClone(result) as JobResultOf<J>
      } catch {
        return { kind: 'failed', failure: 'error' }
      }
    }
  }
}
