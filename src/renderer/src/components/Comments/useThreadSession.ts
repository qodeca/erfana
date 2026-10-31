// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – what a thread window remembers while it is open (comments-v2
 * C-13, C-14; spec 024 state table W-03, W-04, W-05, W-11).
 *
 * - **Stepping** (C-13): the threads shown can move on from the ones the
 *   window opened with – ‹ ›, Alt+F9, "Resolve and next".
 * - **Updated from the file** (W-03): a shown thread's bytes changed and not
 *   by a write from this window – the strip says so, and the messages that
 *   were there when it opened are remembered, so a "New since you opened"
 *   divider can sit above the new ones. A thread resolved elsewhere folds by
 *   itself.
 * - **Removed while open** (W-04): the threads it showed are gone from a
 *   newer list, and not by a delete from this window – it keeps the last
 *   thread it showed, read-only, instead of closing silently. A delete made
 *   here still closes it, as before.
 * - **All done** (W-11): the stepper was offered, and now no open comment is
 *   left in the file.
 *
 * Tracked with the "state from the previous render" pattern – compared and
 * set during render, guarded by the list's identity – so no ref is read in
 * render and no effect sets state.
 *
 * @module components/Comments/useThreadSession
 */
import { useCallback, useState } from 'react'
import type { CommentSaveRequest } from '../../../../shared/ipc/preview-comment-schema'
import type { CommentListState } from '../../stores/usePreviewCommentStore'
import type { DrawerFilter } from './commentRows'
import { allResolved, stepPosition, type StepPosition } from './commentWindowStates'
import type { CommentWindowRequest } from './commentWindowTypes'
import { selectThreads, type ThreadsSelection } from './ThreadsView'

/** The keys a thread window shows. */
interface ShownKeys {
  readonly threadKeys: readonly string[]
  readonly blockKeys: readonly string[]
}

/** What the session carries from one render to the next. */
interface Track {
  readonly list: CommentListState | null
  /** The shown keys, as one string: a request's arrays are new on every render. */
  readonly keys: string
  readonly snapshot: ThreadsSelection | null
  readonly baseline: ReadonlyMap<string, string>
  readonly seen: ReadonlyMap<string, ReadonlySet<string>>
  /** Threads this window wrote to and whose new bytes it has not seen yet. */
  readonly own: ReadonlySet<string>
  /** Threads this window deleted. */
  readonly deleted: ReadonlySet<string>
  readonly updated: boolean
  readonly everStepper: boolean
}

const EMPTY_TRACK: Track = {
  list: null,
  keys: '',
  snapshot: null,
  baseline: new Map(),
  seen: new Map(),
  own: new Set(),
  deleted: new Set(),
  updated: false,
  everStepper: false
}

/** What the window reads from the session. */
export interface ThreadSession {
  /** The selection to show: the list's now, or – removed while open – the last one shown. */
  readonly selection: ThreadsSelection | null
  /** The file is listed but holds none of the keys, in a list that predates the window: read again. */
  readonly waiting: boolean
  /** Gone before it was ever shown, or deleted from here: the window closes (M2). */
  readonly gone: boolean
  /** W-04: removed outside Erfana while shown. */
  readonly removed: boolean
  /** W-03: a shown thread changed in the file, not by this window. */
  readonly updated: boolean
  /** Message ids each shown thread had when it was first shown (W-03 divider). */
  readonly seen: ReadonlyMap<string, ReadonlySet<string>>
  /** The stepper, when there is another open comment to go to (C-13). */
  readonly step: StepPosition | null
  /** W-11: the stepper was offered and every comment in the file is resolved now. */
  readonly allDone: boolean
  /** The window moved on from the threads it opened with: the pin's draft no longer applies. */
  readonly stepped: boolean
  readonly goTo: (threadKey: string) => void
  /** A write from this window is about to be sent. */
  readonly noteWrite: (save: CommentSaveRequest) => void
  /** That write did not land: its thread may change again only from outside. */
  readonly noteRefused: (save: CommentSaveRequest) => void
}

const isEmpty = (selection: ThreadsSelection | null): boolean =>
  selection === null || selection.threads.length + selection.damaged.length + selection.newer.length === 0

/** The track after a new list (or new keys): baseline, seen messages and the updated flag. */
function observe(track: Track, list: CommentListState, keys: string, live: ThreadsSelection | null): Track {
  const baseline = new Map(track.baseline)
  const seen = new Map(track.seen)
  const own = new Set(track.own)
  let updated = track.updated
  for (const thread of live?.threads ?? []) {
    const ids = new Set(thread.messages.map(message => message.id))
    const before = baseline.get(thread.threadKey)
    baseline.set(thread.threadKey, thread.rawHash)
    if (before === undefined || own.delete(thread.threadKey)) seen.set(thread.threadKey, ids)
    else if (before !== thread.rawHash) updated = true
  }
  return { ...track, list, keys, baseline, seen, own, updated, snapshot: isEmpty(live) ? track.snapshot : live }
}

/**
 * The open window's thread session.
 *
 * @param request - The window's request.
 * @param list - The tab's list.
 * @param filter - The drawer's current filter: the stepper steps within it (C-13); Open while the drawer is shut.
 * @returns {@link ThreadSession}
 */
export function useThreadSession(request: CommentWindowRequest, list: CommentListState, filter: DrawerFilter = 'open'): ThreadSession {
  const opened: ShownKeys | null =
    request.kind === 'threads' ? { threadKeys: request.threadKeys, blockKeys: request.blockKeys } : null
  const [moved, setMoved] = useState<ShownKeys | null>(null)
  const keys = moved ?? opened
  const fileKey = request.kind === 'threads' ? request.fileKey : ''
  const live = keys === null ? null : selectThreads(list.files, fileKey, keys.threadKeys, keys.blockKeys)
  const [track, setTrack] = useState<Track>(EMPTY_TRACK)
  const signature = keys === null ? '' : `${keys.threadKeys.join(',')}|${keys.blockKeys.join(',')}`
  let current = track
  if (keys !== null && (track.list !== list || track.keys !== signature)) {
    current = observe(track, list, signature, live)
    setTrack(current)
  }
  const fresh = request.kind === 'threads' && list.status === 'ready' && (list.generation ?? 0) > request.listAfter
  const empty = isEmpty(live)
  // A thread or a damaged block this window deleted itself is gone, never "removed outside Erfana".
  const ownDelete = keys !== null && [...keys.threadKeys, ...keys.blockKeys].some(key => current.deleted.has(key))
  const removed = fresh && empty && current.snapshot !== null && !ownDelete
  const gone = fresh && empty && !removed
  const selection = removed ? current.snapshot : live
  const step = live !== null && !empty && !removed && live.damaged.length + live.newer.length === 0
    ? stepPosition(live.file, live.threads.map(thread => thread.threadKey), filter)
    : null
  const offered = step !== null && step.next !== null
  if (offered && !current.everStepper) {
    current = { ...current, everStepper: true }
    setTrack(current)
  }
  const allDone = current.everStepper && live !== null && fresh && allResolved(live.file)

  const goTo = useCallback((threadKey: string) => setMoved({ threadKeys: [threadKey], blockKeys: [] }), [])
  const noteWrite = useCallback((save: CommentSaveRequest) => {
    if (save.op === 'deleteBlock') {
      setTrack(t => ({ ...t, deleted: new Set([...t.deleted, save.blockKey]) }))
      return
    }
    if (save.op === 'add' || save.op === 'rebuildBlock') return
    const key = save.threadKey
    setTrack(t => ({
      ...t,
      own: new Set([...t.own, key]),
      deleted: save.op === 'deleteThread' || save.op === 'deleteMessage' ? new Set([...t.deleted, key]) : t.deleted
    }))
  }, [])
  const noteRefused = useCallback((save: CommentSaveRequest) => {
    if (save.op === 'deleteBlock') {
      setTrack(t => ({ ...t, deleted: new Set([...t.deleted].filter(k => k !== save.blockKey)) }))
      return
    }
    if (save.op === 'add' || save.op === 'rebuildBlock') return
    const key = save.threadKey
    setTrack(t => ({ ...t, own: new Set([...t.own].filter(k => k !== key)), deleted: new Set([...t.deleted].filter(k => k !== key)) }))
  }, [])

  return {
    selection,
    waiting: selection === null || (isEmpty(selection) && !fresh),
    gone,
    removed,
    updated: current.updated && !removed,
    seen: current.seen,
    step: offered && !allDone ? step : null,
    allDone,
    stepped: moved !== null,
    goTo,
    noteWrite,
    noteRefused
  }
}
