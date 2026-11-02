// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whether "Show in preview" reached its target in the HTML Preview (plan step
 * 10, I-6). The page opens a closed section around the target, and only then
 * reports it visible, so a target's "Hidden on the page" tag at the press says
 * nothing about the result. The answer is read once the page had time to
 * report; a target still hidden gets the drawer's visible note and the
 * sentence aloud, and a target main has no pin for gets them at once.
 *
 * @module HtmlPreviewPanel/comments/useRevealNote
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLatestRef } from '../../../../hooks/useLatestRef'

/**
 * Longest the page's report of a reveal takes: its anchor check waits at most
 * 250 ms (`ANCHOR_CHECK_MIN_MS`, which the renderer cannot import), plus the trip through main.
 */
export const REVEAL_SETTLE_MS = 400

/** What the reader has been told about the last reveal, and how a new one starts. */
export interface RevealNote {
  readonly note: string | null
  /** Watch a reveal of `threadKey`, just sent: its row's hidden tag at the press, and main's answer. */
  readonly watch: (threadKey: string, hidden: boolean, found: Promise<{ readonly ok: boolean }>) => void
}

/**
 * @param notVisible - Thread keys main reported hidden now.
 * @param text - The sentence.
 * @param say - Says it aloud too.
 * @returns {@link RevealNote}
 */
export function useRevealNote(notVisible: readonly string[], text: string, say: (text: string) => void): RevealNote {
  const [note, setNote] = useState<string | null>(null)
  const latest = useLatestRef({ notVisible, text, say })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const watch = useCallback(
    (threadKey: string, hidden: boolean, found: Promise<{ readonly ok: boolean }>) => {
      setNote(null)
      clearTimeout(timer.current)
      const tell = (): void => {
        setNote(latest.current.text)
        latest.current.say(latest.current.text)
      }
      // Reported hidden at the press: the page's next report decides. Hidden only by the last list: nothing will change it.
      const reported = latest.current.notVisible.includes(threadKey)
      if (hidden) {
        timer.current = setTimeout(() => {
          if (!reported || latest.current.notVisible.includes(threadKey)) tell()
        }, REVEAL_SETTLE_MS)
      }
      void found.then(
        answer => {
          if (answer.ok) return
          clearTimeout(timer.current)
          tell()
        },
        () => undefined
      )
    },
    [latest]
  )
  return { note, watch }
}
