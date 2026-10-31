// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown file kind's comment jobs – its table in the comment parse
 * worker (spec 024 architecture note 001 § 5, § 8 C19, C22; 024-NFR-008).
 *
 * Two jobs, each on bytes main read, both in the worker – the parse, the
 * placement, the render check and the verifying re-parse never run on the
 * main thread:
 * - `list` – the shared list on a Markdown parse, through the kind's slice of
 *   the document cache (`kindCommentJobs.ts`);
 * - `write` – the shared write (`commentWriteCore.ts`) with the Markdown
 *   kind. A Markdown `write` may carry `breaks`, the user's "preserve line
 *   breaks" setting, which the render check renders with; absent, off.
 *
 * No `instrument`, `draft` or `pin`: those read served HTML pages. A file
 * past the Markdown limits is `too-large` before any parse
 * (`markdownLimits.ts`).
 */
import { markdownKind, markdownKindWith } from '../../../../shared/markdownComments/markdownKind'
import type { RandomBytes } from '../../../../shared/comments/format'
import type { KindDocument } from '../../../../shared/comments/fileKind'
import { createInProcessCommentJobs, type CommentFileJobRunner, type CommentJobTable } from '../commentFileJobs'
import type { ListJob } from '../commentListCore'
import { createKindCommentJobTable } from '../kindCommentJobs'
import type { WriteJob } from '../commentWriteCore'

/** A write to a Markdown file, rendered with the user's line-break setting. */
export interface MarkdownWriteJob extends WriteJob {
  /** "Preserve line breaks" (`remark-breaks`), as the preview renders the file; absent: off. */
  readonly breaks?: boolean
}

/** The Markdown jobs. */
export type MarkdownCommentJob = ListJob | MarkdownWriteJob

const SHARED = createKindCommentJobTable(markdownKind)
/** The kinds by line-break setting: built once, never per job. */
const BY_BREAKS = { off: markdownKind, on: markdownKindWith({ breaks: true }) }
const WRITE_ON = createKindCommentJobTable(BY_BREAKS.on).write

/** The Markdown kind's jobs, by name. */
export const markdownCommentJobTable: CommentJobTable<MarkdownCommentJob, KindDocument> = {
  list: SHARED.list,
  write: {
    run: (bytes, job, env) => (job.breaks === true ? WRITE_ON : SHARED.write).run(bytes, job, env),
    // Both write tables come from `createKindCommentJobTable`, so they transfer alike.
    transferables: SHARED.write.transferables
  }
}

/**
 * The Markdown jobs on the calling thread – for the suites, which have no
 * worker bundle. Never for production: the parse would block the main thread.
 */
export function createInProcessMarkdownJobs(options: { readonly random?: RandomBytes } = {}): CommentFileJobRunner<MarkdownCommentJob> {
  return createInProcessCommentJobs<MarkdownCommentJob, KindDocument>(markdownKind.id, markdownCommentJobTable, options)
}
