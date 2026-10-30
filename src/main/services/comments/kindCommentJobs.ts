// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared jobs – `list` and `write` – for any file kind that needs nothing
 * more (spec 024 architecture note 001 § 3, § 8 C19, C22, C24).
 *
 * A renderer-hosted preview's kind (Markdown, the `.txt` conformance kind)
 * asks the parse worker for the list and the write only: no page tokens, no
 * served-page instrumentation. {@link createKindCommentJobTable} builds that
 * table from the kind alone, so the worker's composition root
 * (`src/main/services/workers/comment-parse.worker.ts`) registers a kind with
 * one line – `jobs.register(kind.id, createKindCommentJobTable(kind))` – and
 * the suites run the same table in process ({@link createInProcessKindJobs}).
 *
 * Both jobs read the file through the kind's slice of the document cache,
 * and the write leaves its verified result there (`commentJobDocs.ts`). The
 * write may plan on a cached document because a kind served by this table
 * plans only on what its parse decided: the budgeted backup-tier lookups
 * that make the HTML writer parse afresh (`planAdd`'s re-location of a page
 * draft) run only for HTML documents, which have their own table. So a save
 * right after the list – the usual order – parses the file once, for the
 * verify, not twice (spec 024 024-NFR-001).
 */
import type { CommentFileKind, KindDocument } from '../../../shared/comments/fileKind'
import type { RandomBytes } from '../../../shared/comments/format'
import {
  createInProcessCommentJobs,
  type CommentFileJob,
  type CommentFileJobRunner,
  type CommentJobTable
} from './commentFileJobs'
import { kindDocumentOf } from './commentJobDocs'
import { runListJob } from './commentListCore'
import { rawTransferablesOf } from './commentParseWorker'
import { runWriteJob } from './commentWriteCore'

/** `kind`'s `list` and `write` jobs, by name. */
export function createKindCommentJobTable(kind: CommentFileKind): CommentJobTable<CommentFileJob, KindDocument> {
  return {
    list: { run: (bytes, job, env) => runListJob(kindDocumentOf(bytes, kind, env.cache), job) },
    write: {
      run: (bytes, job, env) => runWriteJob(bytes, job, { ...env, kind, read: read => kindDocumentOf(read, kind, env.cache) }),
      // The block bytes, when they own their buffer; a view into a larger one is copied.
      transferables: result => (result.ok ? rawTransferablesOf(result.insert) : [])
    }
  }
}

/**
 * `kind`'s shared jobs on the calling thread – for the suites, which have no
 * worker bundle. Never for production: the parse would block the main thread.
 */
export function createInProcessKindJobs(
  kind: CommentFileKind,
  options: { readonly random?: RandomBytes } = {}
): CommentFileJobRunner {
  return createInProcessCommentJobs<CommentFileJob, KindDocument>(kind.id, createKindCommentJobTable(kind), options)
}
