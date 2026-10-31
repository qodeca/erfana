// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – screen-reader announcements and inner steps of the comment
 * window, shared by every preview (docs/designs/comments/html-preview-comments.md
 * §10.9; docs/design-system Feedback card, "telling a screen reader"; spec 024
 * architecture note 001 § 8 C22: `commentLive` is split, the HTML picker
 * announcement stays in `HtmlPreviewPanel/comments/commentLive.ts`).
 *
 * - {@link useLiveText}: the text for an ALWAYS-MOUNTED live region. Each
 *   announcement first empties the region, then sets the text a frame later,
 *   so saying the same sentence twice is still a change the browser reports.
 * - {@link CommentStepsContext} / {@link useInnerStep}: an open inner step of
 *   the comment window (an edit, a delete confirmation, the inline identity
 *   editor) registers how to back out of it. Esc or an outside click then
 *   backs out of the newest step instead of closing the window – and backing
 *   out keeps any typed text in the session drafts.
 *
 * @module Comments/commentLive
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLatestRef } from '../../hooks/useLatestRef'
import { COMMENT_MAX_CHARS, counterState, type CounterState } from './commentFormat'
import { WINDOW_COPY } from './commentWindowCopy'

/**
 * Text for an always-mounted live region, set clear-then-text.
 *
 * @returns `[text, say]` – render `text` inside the region; `say(next)` announces.
 *
 * @example
 * ```tsx
 * const [alertText, alert] = useLiveText()
 * <p className="erf-comment-sr" aria-live="assertive">{alertText}</p>
 * alert("Couldn't save: index.html is read-only.")
 * ```
 */
export function useLiveText(): readonly [string, (text: string) => void] {
  const [text, setText] = useState('')
  const frame = useRef<number | null>(null)
  const say = useCallback((next: string) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    setText('')
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      setText(next)
    })
  }, [])
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    []
  )
  return [text, say] as const
}

/** How the comment window's dismiss reaches the open inner steps. */
export interface CommentSteps {
  /** Register a step's back-out; returns the unregister function. */
  readonly register: (cancel: () => void) => () => void
  /** Announce a failure in the window's assertive region. */
  readonly alert: (text: string) => void
}

/** Outside a comment window there are no steps and nothing to announce to. */
export const CommentStepsContext = createContext<CommentSteps>({
  register: () => () => {},
  alert: () => {}
})

/**
 * Register an inner step while `active`, so Esc backs out of it first.
 *
 * @param active - Whether the step is open.
 * @param cancel - Back out of the step (keep typed text).
 */
export function useInnerStep(active: boolean, cancel: () => void): void {
  const { register } = useContext(CommentStepsContext)
  // Read only when Esc arrives – an event, never during render.
  const latest = useLatestRef(cancel)
  useEffect(() => {
    if (!active) return undefined
    return register(() => latest.current())
  }, [active, register, latest])
}

/** The counter's states, lowest first. */
const RANK: Readonly<Record<CounterState, number>> = { ok: 0, near: 1, over: 2 }

/**
 * C-19.5: what the counter's polite region says – once per crossing. Going up
 * into the warning band says how many characters are left ("400 characters
 * left"), going over says by how much ("Over the limit by 3"); a move back down
 * says nothing and empties the region. A field that opens already past a line
 * (a restored draft) has crossed nothing.
 *
 * @param count - Characters in the field (code points).
 * @returns The region's text.
 */
export function useCounterCrossing(count: number): string {
  const state = counterState(count)
  const [last, setLast] = useState<CounterState>(state)
  const [said, setSaid] = useState('')
  // "State from the previous render": compared and set during render, no effect.
  if (state !== last) {
    setLast(state)
    const up = RANK[state] > RANK[last]
    setSaid(!up ? '' : state === 'over' ? WINDOW_COPY.overBy(count - COMMENT_MAX_CHARS) : WINDOW_COPY.charsLeft(COMMENT_MAX_CHARS - count))
  }
  return said
}

/**
 * The window's failure announcer.
 *
 * @returns `alert(text)`.
 */
export function useCommentAlert(): (text: string) => void {
  return useContext(CommentStepsContext).alert
}

/**
 * The session-draft keys for typed text that is not a new comment.
 *
 * @example
 * ```ts
 * commentDrafts.set(replyDraftKey(panelId, fileKey, threadKey), text)
 * ```
 */
export const replyDraftKey = (panelId: string, fileKey: string, threadKey: string): string =>
  ['reply', panelId, fileKey, threadKey].join('|')

/**
 * The draft key of an edit of one message. The thread key is part of it: a
 * hand-edited file may repeat a message id across threads.
 */
export const editDraftKey = (
  panelId: string,
  fileKey: string,
  threadKey: string,
  messageId: string
): string => ['edit', panelId, fileKey, threadKey, messageId].join('|')
