// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the name step before a thread write (024-FR-022; R-019).
 *
 * Someone who received a reviewed file may start with Reply, Resolve, Re-open
 * or Mark resolved, never with a new comment. Those writes put a name in the
 * file, so they stop at the identity step too – also when the name is already
 * in Settings and only the privacy notice is unseen – and go on by themselves
 * once it is answered. Cancel or Esc goes back to the thread: nothing is
 * written, the typed text stays.
 *
 * The write that asked simply waits on {@link IdentityGate.ready}, so its
 * caller keeps its own busy state and its own clean-up.
 *
 * @module components/Comments/useIdentityGate
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommentIdentitySettings } from '../../../../shared/ipc/global-settings-schema'
import type { CommentSaveRequest } from '../../../../shared/ipc/preview-comment-schema'
import { useLatestRef } from '../../hooks/useLatestRef'

/** The name is unset, or the one-time privacy notice is unseen. */
export function identityMissing(identity: CommentIdentitySettings | null): boolean {
  return identity === null || !identity.identityNoticeSeen || !identity.authorName
}

/** Whether main writes an author for this request (`CommentWriter`: `needsAuthor`). */
export function writeNeedsAuthor(save: CommentSaveRequest): boolean {
  if (save.op === 'rebuildBlock') return save.status === 'resolved'
  return save.op === 'add' || save.op === 'reply' || save.op === 'setStatus'
}

/** What the window reads from the gate. */
export interface IdentityGate {
  /** A thread write is waiting on the identity step. */
  readonly open: boolean
  /** Resolves `true` when `save` may go, after the step if it needs one. */
  readonly ready: (save: CommentSaveRequest) => Promise<boolean>
  /** Show the step; `true` once it is answered, `false` when it is cancelled. */
  readonly ask: () => Promise<boolean>
  /** The step is answered: the waiting write goes on. */
  readonly answered: () => void
  /** The step is cancelled: the waiting write is dropped. */
  readonly cancel: () => void
  /** Focus goes back where the write was asked for, or to `fallback` when that is gone. */
  readonly restoreFocus: (fallback: HTMLElement | null) => void
}

/**
 * The gate of one comment window.
 *
 * @param identity - The identity in Settings.
 * @param registerStep - Registers the step so Esc backs out of it first.
 * @returns {@link IdentityGate}
 */
export function useIdentityGate(identity: CommentIdentitySettings | null, registerStep: (cancel: () => void) => () => void): IdentityGate {
  const [open, setOpen] = useState(false)
  const waiting = useRef<((go: boolean) => void) | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const identityRef = useLatestRef(identity)

  const settle = useCallback((go: boolean) => {
    const answer = waiting.current
    waiting.current = null
    setOpen(false)
    answer?.(go)
  }, [])
  const ask = useCallback(
    () =>
      new Promise<boolean>(resolve => {
        waiting.current?.(false)
        waiting.current = resolve
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setOpen(true)
      }),
    []
  )
  const ready = useCallback(
    async (save: CommentSaveRequest) => !writeNeedsAuthor(save) || !identityMissing(identityRef.current) || ask(),
    [ask, identityRef]
  )
  const answered = useCallback(() => settle(true), [settle])
  const cancel = useCallback(() => settle(false), [settle])
  const restoreFocus = useCallback((fallback: HTMLElement | null) => {
    const back = opener.current
    opener.current = null
    ;(back?.isConnected === true ? back : fallback)?.focus()
  }, [])

  useEffect(() => (open ? registerStep(cancel) : undefined), [open, registerStep, cancel])
  // A window closed at the step: the write that waited is dropped, the text stays in the drafts.
  useEffect(() => () => waiting.current?.(false), [])

  return { open, ready, ask, answered, cancel, restoreFocus }
}
