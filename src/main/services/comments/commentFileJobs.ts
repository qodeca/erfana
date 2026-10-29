// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment file jobs: every parse a pick, a pin, a list or a write needs, run
 * on bytes main read (docs/designs/comments/html-preview-comments.md §19 R3-12).
 *
 * Four jobs: `draft` (a pick), `pin` (a pin click: its blocks and its draft
 * from one parse), `list` and `write`. Main reads and confines the file; the
 * parse of it – about 380 ms at 4 MB
 * and 5 s at 25 MB on the slowest box measured (spike S9, §19 Rev 4) – and
 * everything worked out from the parse run in the comment parse worker,
 * beside the instrumentation of served pages. Main's share of a job is the
 * message – the bytes are lent, not copied, from 64 KB up – and the
 * structured answer.
 *
 * Pure: the dispatcher below runs in the worker (`commentParseWorker.ts`) and
 * in {@link createInProcessCommentFileJobs}, the runner the suites use. A job
 * and its answer are plain data – no class instances, no functions – because
 * they cross a thread; the in-process runner clones both with
 * `structuredClone`, so a suite catches anything that would not.
 */
import type { RandomBytes } from '../../../shared/htmlComments'
import { CommentDocCache, documentOf } from './commentJobDocs'
import { runDraftJob, runPinJob, type DraftJob, type DraftJobResult, type PinJob, type PinJobResult } from '../preview/comments/commentDraftCore'
import { runListJob, type ListJob, type ListJobResult } from './commentListCore'
import { runWriteJob, type WriteJob, type WriteJobResult } from './commentWriteCore'

/** Every job kind. */
export type CommentFileJob = DraftJob | PinJob | ListJob | WriteJob

/** Every job answer; `kind` names the job it answers. */
export type CommentFileJobResult = DraftJobResult | PinJobResult | ListJobResult | WriteJobResult

/** The answer to a job of `J`'s kind. */
export type JobResultOf<J extends CommentFileJob> = Extract<CommentFileJobResult, { readonly kind: J['kind'] }>

/**
 * Why a job produced no answer – the parse worker client's failures
 * (`CommentParseWorkerAdapter.ts`); `poisoned`: these bytes stopped a worker
 * before, so they are not parsed again (S-M).
 */
export type CommentJobFailure = 'busy' | 'timeout' | 'crashed' | 'error' | 'unavailable' | 'poisoned'

/**
 * A job's answer, or why there is none. `raw` is the job's bytes handed back
 * when the runner LENT them to its worker rather than copying them
 * (`CommentParseWorkerAdapter.ts`): the caller's own view is empty then.
 */
export type CommentJobOutcome<J extends CommentFileJob> = (
  | JobResultOf<J>
  | { readonly kind: 'failed'; readonly failure: CommentJobFailure }
) & { readonly raw?: Uint8Array }

/**
 * Runs comment file jobs. Never rejects: every failure is a `failed` outcome.
 * The bytes may be lent: a caller that still needs them after the call reads
 * the outcome's `raw` when it has one, and its own view otherwise.
 */
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
    case 'pin':
      return runPinJob(documentOf(bytes, env.cache), job)
    case 'list':
      return runListJob(documentOf(bytes, env.cache))
    case 'write':
      return runWriteJob(bytes, job, env)
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
        // The bytes were copied, not lent: there is nothing to hand back.
        return structuredClone(result) as CommentJobOutcome<J>
      } catch {
        return { kind: 'failed', failure: 'error' }
      }
    }
  }
}
