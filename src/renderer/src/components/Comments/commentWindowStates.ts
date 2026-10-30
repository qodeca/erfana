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
 * The stepper walks the open threads of the file in file order (the drawer's
 * default filter, Open), wrapping round, and skips the threads the window
 * already shows.
 *
 * @module components/Comments/commentWindowStates
 */
import type { CommentFileView, CommentThreadView } from '../../../../shared/ipc/comment-common-schema'

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
  /** 1-based place of the shown thread among the open ones; 0 when the shown thread is not open. */
  readonly at: number
  readonly of: number
  /** The open thread before and after the shown ones, wrapping; `null` when there is none to go to. */
  readonly previous: string | null
  readonly next: string | null
}

/**
 * The stepper over a file's open threads (C-13).
 *
 * @param file - The listed file.
 * @param shown - The thread keys the window shows now, in file order.
 * @returns The position, or `null` when the window shows no thread of the file.
 */
export function stepPosition(file: CommentFileView, shown: readonly string[]): StepPosition | null {
  const order = file.threads.map(thread => thread.threadKey)
  const showing = new Set(shown)
  const first = order.findIndex(key => showing.has(key))
  if (first < 0) return null
  const open = file.threads.filter(thread => thread.status === 'open').map(thread => thread.threadKey)
  const others = open.filter(key => !showing.has(key))
  const placeOf = (key: string): number => order.indexOf(key)
  const after = others.find(key => placeOf(key) > first) ?? others[0] ?? null
  const before = [...others].reverse().find(key => placeOf(key) < first) ?? others[others.length - 1] ?? null
  const current = open.indexOf(order[first])
  return { at: current + 1, of: open.length, previous: before, next: after }
}

/** True when a file has no open thread left (W-11 "All open comments are resolved"). */
export function allResolved(file: CommentFileView): boolean {
  return file.threads.every(thread => thread.status !== 'open')
}
