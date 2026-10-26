// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:commentList` – every comment of the page on screen and of its
 * same-project frames, read from disk (docs/designs/html-preview-comments.md
 * §7.7, §8, §10.4, §10.6, decision 15; tests M-014, M-053).
 *
 * Every file is re-read on every list; loading never writes. Main reads the
 * bytes; the parse and the summary run in the comment parse worker as the
 * `list` job (`commentListCore.ts`, §19 R3-12), whose document cache spares
 * an unchanged file a second parse. Files are read one after the other, so a
 * list holds one file's bytes at a time, and at most
 * {@link COMMENT_LIST_MAX_FILES} are listed – the cut is made before any file
 * is read.
 *
 * Each file, thread and damaged or newer block is named by a main-minted key
 * bound to the window, panel and view session (`commentKeyStore.ts`); the
 * renderer sends those keys back with an operation, never a path or an
 * offset. Text and emails go to Erfana's own window here – and never to the
 * page (§4.1 B5).
 */
import { CommentFileViewSchema, type CommentFileView } from '../../../../shared/ipc/preview-comment-schema'
import { stablePathDigest } from '../../../../shared/stablePathDigest'
import { logger } from '../../LoggingService'
import { loadCommentBytes } from './commentFileAccess'
import type { CommentFileJobRunner } from './commentFileJobs'
import type { CommentBinding, CommentKeyStore } from './commentKeyStore'
import type { ListSummary } from './commentListCore'
import type { CommentRefusal } from './commentRefusals'
import type { FrameFile } from './frameFileMap'

/** Files one list reads at most: the page and every frame of two pages' worth (`MAX_FRAMES_PER_PAGE` is 50). */
export const COMMENT_LIST_MAX_FILES = 64

/** One file to list: the page's, or a frame's. */
export interface ListedFile {
  readonly file: FrameFile
  readonly frame: boolean
}

/** What a list is built from. */
export interface ListInput {
  readonly binding: CommentBinding
  readonly keys: Pick<CommentKeyStore<unknown>, 'keyFor'>
  readonly realRoot: string
  readonly files: readonly ListedFile[]
  /** Whether a thread's element is not rendered right now ("Not visible now"). */
  readonly notVisible: (realPath: string, threadId: string) => boolean
  /** Where the parse runs: the comment parse worker in the app. */
  readonly jobs: CommentFileJobRunner
  readonly platform?: NodeJS.Platform
}

type ReadOnlyView = NonNullable<CommentFileView['readOnlyReason']>

/** Refusals that still list the file, read-only, with a reason the drawer names. */
const LISTED_REFUSALS: Partial<Readonly<Record<CommentRefusal, ReadOnlyView>>> = {
  link: 'link',
  missing: 'missing',
  encoding: 'encoding',
  'too-large': 'too-large'
}

function baseOf(input: ListInput, { file, frame }: ListedFile) {
  return {
    fileKey: input.keys.keyFor(input.binding, { kind: 'file', realPath: file.realPath }),
    displayPath: file.displayPath,
    filePath: file.projectPath,
    frame
  }
}

/** One file's view, with each thread's id in order – its "not visible now" flag is set last. */
interface ListedView {
  readonly view: CommentFileView
  readonly realPath: string
  readonly threadIds: readonly string[]
}

/** The worker's summary with main's keys and paths; every "not visible now" flag still `false`. */
function fileView(input: ListInput, listed: ListedFile, summary: ListSummary): CommentFileView {
  const { realPath } = listed.file
  const blockKey = (rawHash: string, start: number): string =>
    input.keys.keyFor(input.binding, { kind: 'block', realPath, rawHash, start })
  return {
    ...baseOf(input, listed),
    writable: summary.writable,
    ...(summary.readOnlyReason === undefined ? {} : { readOnlyReason: summary.readOnlyReason }),
    threads: summary.threads.map(({ threadId, ...thread }) => ({
      ...thread,
      threadKey: input.keys.keyFor(input.binding, { kind: 'thread', realPath, threadId }),
      notVisible: false
    })),
    damaged: summary.damaged.map(({ start, ...block }) => ({ ...block, blockKey: blockKey(block.rawHash, start) })),
    newer: summary.newer.map(({ start, rawHash, ...block }) => ({ ...block, blockKey: blockKey(rawHash, start) }))
  }
}

/** A file listed with no comments, read-only for `reason`, or `undefined` when it is not listed. */
function refusedView(input: ListInput, listed: ListedFile, refusal: CommentRefusal): CommentFileView | undefined {
  const reason = LISTED_REFUSALS[refusal]
  if (reason === undefined) return undefined
  return { ...baseOf(input, listed), writable: false, readOnlyReason: reason, threads: [], damaged: [], newer: [] }
}

/** One file's view, or `undefined` when it is not listed (a path comments never touch). */
async function viewOf(input: ListInput, listed: ListedFile): Promise<ListedView | undefined> {
  const { realPath } = listed.file
  const loaded = await loadCommentBytes({ realRoot: input.realRoot, filePath: realPath }, { platform: input.platform })
  if (!loaded.ok) {
    const refused = refusedView(input, listed, loaded.reason)
    return refused === undefined ? undefined : { view: refused, realPath, threadIds: [] }
  }
  const listedFile = await input.jobs.runJob(loaded.bytes, { kind: 'list' })
  if (listedFile.kind === 'failed') {
    logger.warn('Preview comments: a file could not be parsed for the comment list', {
      failure: listedFile.failure,
      file: stablePathDigest(realPath)
    })
    return undefined
  }
  const view = listedFile.ok ? fileView(input, listed, listedFile.summary) : refusedView(input, listed, listedFile.refusal)
  // Composed here, so a miss is a bug: the file drops out of the list rather than the whole list failing.
  if (view !== undefined && !CommentFileViewSchema.safeParse(view).success) {
    logger.warn('Preview comments: a file was left out of the comment list', { file: stablePathDigest(realPath) })
    return undefined
  }
  if (view === undefined) return undefined
  const threadIds = listedFile.ok ? listedFile.summary.threads.map(thread => thread.threadId) : []
  return { view, realPath, threadIds }
}

/**
 * Each thread's "not visible now" flag, read once, after the last file: the
 * renderer takes the newer of this answer and main's anchor-status events, so
 * the flags must be no older than the answer itself (a flag read before a
 * later file's await could be overtaken by an event the renderer then sees
 * first – E-005).
 */
function withNotVisible(input: ListInput, { view, realPath, threadIds }: ListedView): CommentFileView {
  return { ...view, threads: view.threads.map((thread, i) => ({ ...thread, notVisible: input.notVisible(realPath, threadIds[i]) })) }
}

/**
 * Every listed file's comments, in the order given, at most
 * {@link COMMENT_LIST_MAX_FILES} of them. Never throws for one file's failure.
 */
export async function buildCommentList(input: ListInput): Promise<CommentFileView[]> {
  if (input.files.length > COMMENT_LIST_MAX_FILES) {
    logger.warn('Preview comments: the comment list was cut short', { files: input.files.length, listed: COMMENT_LIST_MAX_FILES })
  }
  const views: ListedView[] = []
  // One after the other: one file's bytes in flight at a time, and the worker's queue left to page loads.
  for (const listed of input.files.slice(0, COMMENT_LIST_MAX_FILES)) {
    const view = await viewOf(input, listed).catch(() => {
      logger.warn('Preview comments: a file could not be listed', { file: stablePathDigest(listed.file.realPath) })
      return undefined
    })
    if (view !== undefined) views.push(view)
  }
  return views.map(view => withNotVisible(input, view))
}
