// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments removed outside Erfana (comments-v2 OD-06, § 4.2; spec 024 state
 * table § 2 "Drawer note – removed outside").
 *
 * A session-only memory of the open threads each list showed. When a later
 * list of the same file no longer holds an open thread – and Erfana did not
 * delete it itself – the thread was removed outside Erfana (an agent, an
 * editor, a git checkout), and the drawer says so above the list. Nothing is
 * written to the file; the note goes on Dismiss, on another file, or with
 * the session (a restart).
 *
 * A thread that was resolved, or is still listed as not found, was not
 * removed. Keys are stable for one view session (`commentKeyStore.ts`), so
 * the same thread keeps its key from list to list.
 *
 * @module components/Comments/commentRemovedOutside
 */
import { useCallback, useState } from 'react'
import type { CommentFileView } from '../../../../shared/ipc/comment-common-schema'
import type { CommentListState } from '../../stores/usePreviewCommentStore'
import type { CommentWords } from './commentCopyWords'

/** One comment that was removed outside Erfana, as the note lists it. */
export interface RemovedComment {
  readonly threadKey: string
  /** The first message's text. */
  readonly text: string
  readonly author: string
  /** The target as the drawer labels it. */
  readonly label: string
}

/** The open threads of one list, by key. */
export type OpenThreads = ReadonlyMap<string, RemovedComment>

/**
 * The open threads of `files`, as {@link RemovedComment}s by key.
 *
 * @param files - Main's list.
 * @param words - The preview's words, for the target label.
 * @returns Open threads by thread key.
 */
export function openThreadsOf(files: readonly CommentFileView[], words: CommentWords): OpenThreads {
  const open = new Map<string, RemovedComment>()
  for (const file of files) {
    for (const thread of file.threads) {
      if (thread.status !== 'open') continue
      const [first] = thread.messages
      open.set(thread.threadKey, {
        threadKey: thread.threadKey,
        text: first?.text ?? '',
        author: first?.by.name ?? '',
        label: thread.runtime ? thread.runtime.tag : words.label(thread)
      })
    }
  }
  return open
}

/**
 * The open threads of `before` that `after` no longer lists at all, leaving
 * out the ones Erfana deleted itself.
 *
 * @param before - The previous list's open threads.
 * @param after - Every thread key the new list holds, open or resolved.
 * @param own - Thread keys Erfana deleted in this session.
 * @returns The removed threads, in the order the previous list had them.
 */
export function removedOutside(
  before: OpenThreads,
  after: ReadonlySet<string>,
  own: ReadonlySet<string>
): RemovedComment[] {
  return [...before.values()].filter(thread => !after.has(thread.threadKey) && !own.has(thread.threadKey))
}

/** What {@link useRemovedOutside} tracks between lists. */
interface Tracked {
  readonly generation: number | undefined
  readonly fileKey: string | undefined
  readonly open: OpenThreads
  readonly removed: readonly RemovedComment[]
  readonly own: ReadonlySet<string>
}

const EMPTY: Tracked = { generation: undefined, fileKey: undefined, open: new Map(), removed: [], own: new Set() }

/** What the host hands the drawer. */
export interface RemovedOutside {
  /** Removed since the note was last dismissed; empty when there is no note. */
  readonly removed: readonly RemovedComment[]
  readonly dismiss: () => void
  /** Erfana is deleting this thread itself: its absence is not "removed outside". */
  readonly ownDelete: (threadKey: string) => void
}

/**
 * Tracks one panel's open threads across its lists (OD-06).
 *
 * @param list - The panel's list state.
 * @param words - The preview's words, for the target label.
 * @returns {@link RemovedOutside}
 */
export function useRemovedOutside(list: CommentListState, words: CommentWords): RemovedOutside {
  const [tracked, setTracked] = useState<Tracked>(EMPTY)
  // Each ready list is compared once, during render: the note is history the
  // lists make, not a mirror of one of them.
  if (list.status === 'ready' && list.generation !== tracked.generation) {
    const fileKey = list.files[0]?.fileKey
    const open = openThreadsOf(list.files, words)
    const sameFile = fileKey !== undefined && fileKey === tracked.fileKey
    const listed = new Set(list.files.flatMap(file => file.threads.map(thread => thread.threadKey)))
    const gone = sameFile ? removedOutside(tracked.open, listed, tracked.own) : []
    setTracked({
      generation: list.generation,
      fileKey,
      open,
      removed: sameFile ? [...tracked.removed, ...gone] : [],
      own: sameFile ? tracked.own : new Set()
    })
  }
  const dismiss = useCallback(() => setTracked(current => ({ ...current, removed: [] })), [])
  const ownDelete = useCallback(
    (threadKey: string) => setTracked(current => ({ ...current, own: new Set([...current.own, threadKey]) })),
    []
  )
  return { removed: tracked.removed, dismiss, ownDelete }
}
