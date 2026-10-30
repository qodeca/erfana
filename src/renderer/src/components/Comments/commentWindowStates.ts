// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – which state a thread in the comment window is in, and where the
 * stepper goes (spec 024 state table § 1 S-01 – S-06 and § 4 precedence;
 * comments-v2 C-05, C-06, C-13, R-06, R-21). Pure: no React, no bridge.
 *
 * One state per thread, the first that applies: Resolved > Not found >
 * Words changed > Changed > Not visible now > Open. Damaged and newer-format
 * blocks are not threads: the window shows them on their own.
 *
 * The stepper walks the threads of the file in file order within the
 * drawer's current filter – Open by default and while the drawer is shut,
 * Resolved when the drawer shows resolved ones; Can't edit holds no thread,
 * so there is nothing to step to – wrapping round, and skips the threads the
 * window already shows.
 *
 * @module components/Comments/commentWindowStates
 */
import type { CommentFileView, CommentThreadView } from '../../../../shared/ipc/comment-common-schema'
import type { DrawerFilter } from './commentRows'

/** A thread's state in the window (state table § 1). */
export type ThreadState = 'open' | 'not-visible' | 'changed' | 'words' | 'not-found' | 'resolved'

/**
 * The one state of a thread (state table § 4).
 *
 * @param thread - The listed thread.
 * @param notVisible - Thread keys main reported as not rendered right now.
 * @returns Its state.
 */
export function threadStateOf(thread: CommentThreadView, notVisible: ReadonlySet<string> = new Set()): ThreadState {
  if (thread.status === 'resolved') return 'resolved'
  if (!thread.attached) return 'not-found'
  if (thread.change?.state === 'words') return 'words'
  if (thread.change?.state === 'changed') return 'changed'
  if (thread.notVisible || notVisible.has(thread.threadKey)) return 'not-visible'
  return 'open'
}

/**
 * Resolve is the main button – primary and focused when the window opens –
 * in the states that usually mean the work was done (C-05, C-06: S-03 – S-05).
 */
export function resolveLeads(state: ThreadState): boolean {
  return state === 'not-found' || state === 'words' || state === 'changed'
}

/** Where the stepper stands. */
export interface StepPosition {
  /** 1-based place of the shown thread among the filter's threads; 0 when the shown thread is not in it. */
  readonly at: number
  readonly of: number
  /** The filter's thread before and after the shown ones, wrapping; `null` when there is none to go to. */
  readonly previous: string | null
  readonly next: string | null
}

/** Whether a thread is in a drawer filter's list (commentRows: threads are Open or Resolved; Can't edit holds blocks). */
export function inDrawerFilter(thread: CommentThreadView, filter: DrawerFilter): boolean {
  if (filter === 'cantEdit') return false
  return filter === 'resolved' ? thread.status === 'resolved' : thread.status === 'open'
}

/**
 * The stepper over a file's threads in the drawer's current filter (C-13).
 *
 * @param file - The listed file.
 * @param shown - The thread keys the window shows now, in file order.
 * @param filter - The drawer's filter; Open while the drawer is shut.
 * @returns The position, or `null` when the window shows no thread of the file.
 */
export function stepPosition(file: CommentFileView, shown: readonly string[], filter: DrawerFilter = 'open'): StepPosition | null {
  const order = file.threads.map(thread => thread.threadKey)
  const showing = new Set(shown)
  const first = order.findIndex(key => showing.has(key))
  if (first < 0) return null
  const open = file.threads.filter(thread => inDrawerFilter(thread, filter)).map(thread => thread.threadKey)
  const others = open.filter(key => !showing.has(key))
  const placeOf = (key: string): number => order.indexOf(key)
  const after = others.find(key => placeOf(key) > first) ?? others[0] ?? null
  const before = [...others].reverse().find(key => placeOf(key) < first) ?? others[others.length - 1] ?? null
  const current = open.indexOf(order[first])
  return { at: current + 1, of: open.length, previous: before, next: after }
}

/**
 * `file` as it is once `resolved` is resolved – what "Resolve and next"
 * counts its step from (C-13), before the re-list brings the new file view.
 *
 * @param file - The listed file, still showing the thread open.
 * @param resolved - The thread just resolved; none: `file` as it is.
 * @returns The file with that thread's status resolved.
 */
export function withResolved(file: CommentFileView, resolved: string | undefined): CommentFileView {
  if (resolved === undefined) return file
  return { ...file, threads: file.threads.map(thread => (thread.threadKey === resolved ? { ...thread, status: 'resolved' as const } : thread)) }
}

/** True when a file has no open thread left (W-11 "All open comments are resolved"). */
export function allResolved(file: CommentFileView): boolean {
  return file.threads.every(thread => thread.status !== 'open')
}
