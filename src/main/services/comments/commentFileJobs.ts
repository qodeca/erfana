// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment jobs: every parse a served page, a pick, a pin, a list or a write
 * needs, run on bytes main read (docs/designs/comments/html-preview-comments.md
 * §19 R3-12; spec 024 architecture note 001 § 8 C22).
 *
 * Main reads and confines the file; the parse of it – about 380 ms at 4 MB
 * and 5 s at 25 MB on the slowest box measured (spike S9, §19 Rev 4) – and
 * everything worked out from the parse run in the comment parse worker. Main's
 * share of a job is the message – the bytes are lent, not copied, from 64 KB
 * up – and the structured answer.
 *
 * This module is the shared half and knows no file kind. A job is plain data
 * whose `kind` names it; each file kind brings a {@link CommentJobTable} – its
 * jobs by name – and the worker's entry registers every kind's table in a
 * {@link CommentJobRegistry} (the composition root,
 * `src/main/services/workers/comment-parse.worker.ts`). A request names a file
 * kind id and a job; the worker runs that kind's handler and never learns a
 * path. {@link CommentFileJob} lists the jobs shared code asks of every kind –
 * the list and the write.
 *
 * Pure: a handler runs in the worker and in {@link createInProcessCommentJobs},
 * the runner the suites use. A job and its answer are plain data – no class
 * instances, no functions – because they cross a thread; the in-process runner
 * clones both with `structuredClone`, so a suite catches anything that would
 * not.
 */
import type { RandomBytes } from '../../../shared/htmlComments'
import type { CommentFileKindId } from '../../../shared/comments/fileKind'
import { CommentDocCache, type KindDocCache } from './commentJobDocs'
import type { ListJob, ListJobResult } from './commentListCore'
import type { WriteJob, WriteJobResult } from './commentWriteCore'

/** A job for the worker: `kind` names it in its file kind's table; its other fields are its payload. */
export interface CommentJob {
  readonly kind: string
}

/** A job's answer: `kind` names the job it answers. */
export interface CommentJobResult {
  readonly kind: string
}

/**
 * Every job's answer, by job name. The shared jobs are listed here; a file
 * kind adds its own jobs' answers by augmenting this interface from its job
 * table's module (`declare module`), so a job name means one answer type
 * whichever kind runs it – a kind that runs a shared job answers as it does.
 */
export interface CommentJobResults {
  list: ListJobResult
  write: WriteJobResult
}

/** The jobs shared code asks of every file kind. */
export type CommentFileJob = ListJob | WriteJob

/** Their answers. */
export type CommentFileJobResult = JobResultOf<CommentFileJob>

/** The answer to a job of `J`'s kind; `never` for a job no kind has declared. */
export type JobResultOf<J extends CommentJob> = J['kind'] extends keyof CommentJobResults ? CommentJobResults[J['kind']] : never

/**
 * Why a job produced no answer – the parse worker client's failures
 * (`CommentParseWorkerAdapter.ts`); `poisoned`: these bytes stopped a worker
 * before, so they are not parsed again (S-M).
 */
export type CommentJobFailure = 'busy' | 'timeout' | 'crashed' | 'error' | 'unavailable' | 'poisoned'

/** No answer, and why. */
export interface CommentJobFailed {
  readonly kind: 'failed'
  readonly failure: CommentJobFailure
}

/**
 * A job's answer, or why there is none. `raw` is the job's bytes handed back
 * when the runner LENT them to its worker rather than copying them
 * (`CommentParseWorkerAdapter.ts`): the caller's own view is empty then.
 */
export type CommentJobOutcome<J extends CommentJob> = (JobResultOf<J> | CommentJobFailed) & { readonly raw?: Uint8Array }

/**
 * Runs the jobs `J` (by default the shared ones). Never rejects: every
 * failure is a `failed` outcome. The bytes may be lent: a caller that still
 * needs them after the call reads the outcome's `raw` when it has one, and
 * its own view otherwise.
 */
export interface CommentFileJobRunner<J extends CommentJob = CommentFileJob> {
  runJob<T extends J>(bytes: Uint8Array, job: T): Promise<CommentJobOutcome<T>>
}

/** What a job may use besides its bytes. */
export interface CommentJobEnv<D = unknown> {
  /** The job's file kind's slice of the worker's document cache (C19). */
  readonly cache: KindDocCache<D>
  /** Random source for new thread and message ids; `crypto.getRandomValues` when absent. */
  readonly random?: RandomBytes
}

/** One job of a file kind's table, as the worker runs it. `D` is the kind's cached document. */
export interface CommentJobHandler<J extends CommentJob, R extends CommentJobResult = JobResultOf<J>, D = unknown> {
  /** The answer to `job` on `bytes`. Throws only on a bug; the callers turn a throw into an `error`. */
  run(bytes: Uint8Array, job: J, env: CommentJobEnv<D>): R
  /** The answer's buffers that may move to main without a copy; none when absent. */
  transferables?(result: R): ArrayBuffer[]
}

/** A file kind's jobs `J`, by job kind, each answering as {@link CommentJobResults} says. */
export type CommentJobTable<J extends CommentJob, D = unknown> = {
  readonly [K in J['kind']]: CommentJobHandler<Extract<J, { readonly kind: K }>, JobResultOf<Extract<J, { readonly kind: K }>>, D>
}

/** A handler with its types forgotten – what the registry holds. */
export type AnyCommentJobHandler = CommentJobHandler<CommentJob, CommentJobResult>

/** Any file kind's table, its types forgotten. */
export type AnyCommentJobTable = { readonly [jobKind: string]: AnyCommentJobHandler }

/** What the worker asks of its registry: the handler of one job of one file kind. */
export interface CommentJobLookup {
  /** The handler of job `jobKind` in file kind `fileKind`'s table; `undefined` for an unknown kind or job. */
  handlerOf(fileKind: CommentFileKindId, jobKind: string): AnyCommentJobHandler | undefined
}

/** A table as a map: own keys only, so a job named `__proto__` or `toString` finds nothing. */
function tableMap(table: AnyCommentJobTable): ReadonlyMap<string, AnyCommentJobHandler> {
  return new Map(Object.entries(table))
}

/**
 * Every file kind's job table – filled at the worker's composition root,
 * then frozen, so nothing that runs later can add a job.
 */
export class CommentJobRegistry implements CommentJobLookup {
  private readonly tables = new Map<CommentFileKindId, ReadonlyMap<string, AnyCommentJobHandler>>()
  private isFrozen = false

  /** True once {@link CommentJobRegistry.freeze} ran. */
  get frozen(): boolean {
    return this.isFrozen
  }

  /**
   * Add file kind `fileKind`'s jobs.
   *
   * @throws Error when the registry is frozen, the kind already has a table,
   *   or the table names no job.
   */
  register(fileKind: CommentFileKindId, table: AnyCommentJobTable): void {
    if (this.isFrozen) throw new Error(`Comment jobs are frozen; "${fileKind}" came too late`)
    if (this.tables.has(fileKind)) throw new Error(`Comment file kind "${fileKind}" already has jobs`)
    const jobs = tableMap(table)
    if (jobs.size === 0) throw new Error(`Comment file kind "${fileKind}" names no job`)
    this.tables.set(fileKind, jobs)
  }

  /** Take no more tables. */
  freeze(): void {
    this.isFrozen = true
  }

  handlerOf(fileKind: CommentFileKindId, jobKind: string): AnyCommentJobHandler | undefined {
    return this.tables.get(fileKind)?.get(jobKind)
  }
}

/**
 * One file kind's jobs on the calling thread – for the suites, which have no
 * worker bundle. Never for production: the parse would block the main thread.
 */
export function createInProcessCommentJobs<J extends CommentJob, D>(
  fileKind: CommentFileKindId,
  table: CommentJobTable<J, D>,
  options: { readonly random?: RandomBytes } = {}
): CommentFileJobRunner<J> {
  const jobs = tableMap(table as unknown as AnyCommentJobTable)
  const env: CommentJobEnv = { cache: new CommentDocCache().forKind(fileKind), random: options.random }
  return {
    async runJob<T extends J>(bytes: Uint8Array, job: T): Promise<CommentJobOutcome<T>> {
      try {
        const sent = structuredClone(job)
        const handler = jobs.get(sent.kind)
        if (handler === undefined) throw new Error('unknown job')
        const result = handler.run(new Uint8Array(bytes), sent, env)
        // The bytes were copied, not lent: there is nothing to hand back.
        return structuredClone(result) as CommentJobOutcome<T>
      } catch {
        return { kind: 'failed', failure: 'error' }
      }
    }
  }
}
