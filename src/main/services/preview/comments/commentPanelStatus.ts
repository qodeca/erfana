// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What one view tells the renderer about its comments, read from the frame
 * registry (docs/designs/comments/html-preview-comments.md §8, §10.4, §10.10).
 *
 * - The files the drawer lists: the page's, then each same-project frame's,
 *   each once.
 * - The threads whose element is not rendered right now ("Not visible now"),
 *   as main-minted keys.
 * - The tab's counts, added over the files on screen, and why comments are
 *   unavailable for it – the feature flag, the page's overlay going, or
 *   instrumentation's reason, named as the renderer names it.
 *
 * Reads only; every value is main-composed and checked by the event schema
 * before it leaves (`commentEmit.ts`).
 */
import type { CommentUnavailableReason, CommentsChanged } from '../../../../shared/ipc/preview-comment-schema'
import type { PreviewCommentServing } from './commentInstrumentation'
import type { CommentFrameLike, CommentFrames, FrameRecord } from './commentFrames'
import type { CommentBinding, CommentKeyStore } from './commentKeyStore'
import type { ListedFile } from './commentListBuilder'
import { addCounts, countsOf, type CommentCounts } from './commentPins'
import { samePathKey } from './commentUnsavedSources'

/** Instrumentation's reasons as the renderer names them (§10.10 "Unavailable"). */
const UNAVAILABLE: Readonly<Record<string, CommentUnavailableReason>> = {
  'too-large': 'too-large',
  encoding: 'encoding',
  'too-many-elements': 'page-too-large',
  collision: 'prepare-failed',
  'request-unknown': 'prepare-failed',
  'parse-failed': 'prepare-failed'
}

/** What the status is read from. */
export interface CommentPanelStatusDeps {
  readonly panelId: string
  readonly frames: CommentFrames
  readonly keys: Pick<CommentKeyStore<unknown>, 'keyFor'>
  readonly binding: CommentBinding
  readonly serving: Pick<PreviewCommentServing, 'unavailableReason'>
  readonly mainFrame: () => CommentFrameLike | undefined
  /** `htmlPreview.comments.enabled` now. */
  readonly enabled: () => boolean
  readonly platform?: NodeJS.Platform
}

/** One view's status reads. */
export interface CommentPanelStatus {
  /** Every thread key whose pin's element is not rendered now. */
  notVisibleThreadKeys(): string[]
  /** Whether the thread `threadId` of `realPath` is not rendered now. */
  isNotVisible(realPath: string, threadId: string): boolean
  /** The files the drawer lists, the page's first – a frame mid-reload by the file its commit named. */
  listedFiles(): Promise<ListedFile[]>
  /** Why comments are unavailable for the tab, if they are. */
  unavailable(): CommentUnavailableReason | undefined
  /** The tab's counts and availability, as `preview:commentsChanged` carries them. */
  changed(): CommentsChanged
  /** Instrumentation's reason for `realPath`, as the renderer names it. */
  reasonFor(realPath: string): CommentUnavailableReason | undefined
}

/** Build the status reads for one view. */
export function createCommentPanelStatus(deps: CommentPanelStatusDeps): CommentPanelStatus {
  const key = (path: string): string => samePathKey(path, deps.platform)
  const threadsOf = (record: FrameRecord, pin: string): readonly string[] => record.pins.get(pin)?.threadIds ?? []

  const reasonFor = (realPath: string): CommentUnavailableReason | undefined => {
    const reason = deps.serving.unavailableReason(realPath)
    return reason === undefined ? undefined : UNAVAILABLE[reason]
  }

  const unavailable = (): CommentUnavailableReason | undefined => {
    if (!deps.enabled()) return 'disabled'
    const main = deps.mainFrame()
    const top = main === undefined ? undefined : deps.frames.get(main.frameTreeNodeId)
    if (top?.loss !== undefined) return top.loss
    const file = top?.file
    return file === undefined || !file.commentable ? undefined : reasonFor(file.realPath)
  }

  return {
    notVisibleThreadKeys() {
      const out: string[] = []
      for (const record of deps.frames.all()) {
        const realPath = record.file?.realPath
        if (realPath === undefined) continue
        for (const pin of record.hidden) {
          for (const threadId of threadsOf(record, pin)) {
            out.push(deps.keys.keyFor(deps.binding, { kind: 'thread', realPath, threadId }))
          }
        }
      }
      return out
    },

    isNotVisible(realPath, threadId) {
      const wanted = key(realPath)
      return deps.frames
        .all()
        .some(
          record =>
            record.file !== undefined &&
            key(record.file.realPath) === wanted &&
            [...record.hidden].some(pin => threadsOf(record, pin).includes(threadId))
        )
    },

    async listedFiles() {
      const seen = new Set<string>()
      const out: ListedFile[] = []
      const frames = deps.frames.liveFrames()
      // A reload clears a frame's file at the commit and sets it again at the
      // new document's hello; a list read in between still lists the file (SEC-20).
      const files = await Promise.all(frames.map(frame => deps.frames.fileOf(frame.frameTreeNodeId)))
      frames.forEach((frame, i) => {
        const file = files[i]
        if (file === undefined || !file.commentable || seen.has(key(file.realPath))) return
        seen.add(key(file.realPath))
        out.push({ file, frame: frame.parent !== null })
      })
      return out
    },

    unavailable,

    changed() {
      const seen = new Set<string>()
      const counts: CommentCounts[] = []
      for (const record of deps.frames.all()) {
        const view = deps.frames.viewOf(record)
        if (view === undefined || seen.has(key(view.realPath))) continue
        seen.add(key(view.realPath))
        counts.push(countsOf(view))
      }
      const reason = unavailable()
      return { panelId: deps.panelId, counts: addCounts(counts), ...(reason === undefined ? {} : { unavailable: reason }) }
    },

    reasonFor
  }
}
