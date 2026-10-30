// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment parse worker's entry, and its composition root for file kinds
 * (docs/designs/comments/html-preview-comments.md §19 R3-12; spec 024
 * architecture note 001 § 8 C22, C24).
 *
 * Built as its own main-process bundle (`comment-parse.worker`,
 * electron.vite.config.ts) and started by `CommentParseWorkerAdapter.ts`. The
 * shared runner (`comments/commentParseWorker.ts`) knows no file kind; this
 * file is the one place that names them, registering each kind's job table
 * under the kind's id. To add a kind, register its table in
 * {@link commentWorkerJobs} beside HTML's – the runner, the protocol and the
 * client need no change.
 *
 * It starts listening only when its `workerData` names its role, so the module
 * can be imported anywhere – a test runner's own worker thread included –
 * without answering messages that are not addressed to it.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { htmlKind } from '../../../shared/comments/htmlKind'
import { CommentJobRegistry } from '../comments/commentFileJobs'
import { isCommentParseWorker, startCommentParseWorker, type CommentParsePort } from '../comments/commentParseWorker'
import { htmlCommentJobTable } from '../preview/comments/htmlCommentJobs'

/** Every file kind's jobs, frozen. */
export function commentWorkerJobs(): CommentJobRegistry {
  const jobs = new CommentJobRegistry()
  jobs.register(htmlKind.id, htmlCommentJobTable)
  // A new kind registers its table here, e.g. `jobs.register(markdownKind.id, markdownCommentJobTable)`.
  jobs.freeze()
  return jobs
}

if (isCommentParseWorker(workerData, parentPort)) {
  startCommentParseWorker(parentPort as unknown as CommentParsePort, commentWorkerJobs())
}
