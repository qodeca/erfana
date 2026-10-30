// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML file kind's comment jobs – its table in the comment parse worker
 * (docs/designs/comments/html-preview-comments.md §19 R3-12; spec 024
 * architecture note 001 § 8 C22).
 *
 * Five jobs, each on bytes main read:
 * - `instrument` – a served page's element tokens (`commentParseCore.ts`);
 * - `draft` and `pin` – a pick, and a pin click's blocks and draft from one
 *   parse (`commentDraftCore.ts`);
 * - `list` and `write` – the shared list and write (`commentListCore.ts`,
 *   `commentWriteCore.ts`) on an HTML parse.
 *
 * The worker's entry registers {@link htmlCommentJobTable} under the HTML
 * kind's id (`src/main/services/workers/comment-parse.worker.ts`); main asks
 * for them through `htmlCommentParseClient.ts`, and the suites through
 * {@link createInProcessCommentFileJobs}. The read-only jobs take the parsed
 * document from the HTML slice of the worker's cache; the write parses afresh
 * and leaves its verified result there (`commentJobDocs.ts`).
 */
import { htmlKind } from '../../../../shared/comments/htmlKind'
import type { CommentDocument, RandomBytes } from '../../../../shared/htmlComments'
import { createInProcessCommentJobs, type CommentFileJobRunner, type CommentJobTable } from '../../comments/commentFileJobs'
import { documentOf } from '../../comments/commentJobDocs'
import { runListJob, type ListJob } from '../../comments/commentListCore'
import { rawTransferablesOf } from '../../comments/commentParseWorker'
import { runWriteJob, type WriteJob } from '../../comments/commentWriteCore'
import { runDraftJob, runPinJob, type DraftJob, type DraftJobResult, type PinJob, type PinJobResult } from './commentDraftCore'
import { instrumentDocument, type InstrumentOutcome } from './commentParseCore'

/** Instrument a served page. */
export interface InstrumentJob {
  readonly kind: 'instrument'
}

/** A served page's instrumentation, or why there is none. */
export interface InstrumentJobResult {
  readonly kind: 'instrument'
  readonly outcome: InstrumentOutcome
}

/** The HTML jobs on a commented file. */
export type HtmlFileJob = DraftJob | PinJob | ListJob | WriteJob

/** Every HTML job. */
export type HtmlCommentJob = InstrumentJob | HtmlFileJob

/** Runs the HTML file jobs. */
export type HtmlFileJobRunner = CommentFileJobRunner<HtmlFileJob>

declare module '../../comments/commentFileJobs' {
  /** The HTML kind's own jobs' answers; `list` and `write` are the shared ones. */
  interface CommentJobResults {
    instrument: InstrumentJobResult
    draft: DraftJobResult
    pin: PinJobResult
  }
}

/** The buffers of an outcome that can move to main without a copy. */
function outcomeTransferables(outcome: InstrumentOutcome): ArrayBuffer[] {
  if (outcome.kind !== 'ok') return []
  return [outcome.html.buffer, outcome.offsets.buffer, outcome.lines.buffer, outcome.tagCodes.buffer] as ArrayBuffer[]
}

/** The HTML kind's jobs, by name. */
export const htmlCommentJobTable: CommentJobTable<HtmlCommentJob, CommentDocument> = {
  instrument: {
    run: bytes => ({ kind: 'instrument', outcome: instrumentDocument(bytes) }),
    transferables: result => outcomeTransferables(result.outcome)
  },
  draft: { run: (bytes, job, env) => runDraftJob(documentOf(bytes, env.cache), job) },
  pin: { run: (bytes, job, env) => runPinJob(documentOf(bytes, env.cache), job) },
  list: { run: (bytes, _job, env) => runListJob(documentOf(bytes, env.cache)) },
  write: {
    run: (bytes, job, env) => runWriteJob(bytes, job, env),
    // The block bytes, when they own their buffer; a view into a larger one is copied.
    transferables: result => (result.ok ? rawTransferablesOf(result.insert) : [])
  }
}

/**
 * The HTML file jobs on the calling thread – for the suites, which have no
 * worker bundle. Never for production: the parse would block the main thread.
 */
export function createInProcessCommentFileJobs(options: { readonly random?: RandomBytes } = {}): HtmlFileJobRunner {
  return createInProcessCommentJobs<HtmlFileJob, CommentDocument>(htmlKind.id, htmlCommentJobTable, options)
}
