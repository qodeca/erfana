// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "Show in preview" in a renderer-hosted preview (plan step 10; I-6, K-22,
 * P-F07): one step for a drawer row, a row's Open and a step key – open the
 * folded part, scroll, flash (`revealThread`, `overlayCore/reveal`). The flash
 * is static, as the HTML overlay's, so reduced motion needs nothing. A target
 * that still cannot be seen gets the drawer's visible note, never only a spoken
 * sentence.
 *
 * @module components/Comments/overlay/useHostReveal
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import { REVEAL_FLASH_MS } from '../../../../../shared/comments/overlayCore/reveal'
import { revealThread } from './hostDrawer'
import type { PreviewCommentAdapter } from './previewAdapter'

/** What {@link useHostReveal} gives the host. */
export interface HostReveal {
  /** The target wearing the flash now. */
  readonly flash: HTMLElement | null
  /** The drawer's note: the last "Show in preview" could not show its target. */
  readonly note: string | null
  /** A row's "Show in preview": a target that cannot show gets the note, and `say`. */
  readonly showRow: (threadKey: string | undefined) => void
  /** A window or a step opened on this thread: the same step, and the window itself says when it is hidden. */
  readonly showThread: (threadKey: string) => void
  /** A step inside the open window reached this thread: the same, and the window's target follows it. */
  readonly stepTo: (window: unknown, threadKey: string) => void
  /** The thread a step moved `window` to, or `null`. */
  readonly steppedIn: (window: unknown) => string | null
  /** A new comment's window opened on `target`: what {@link pickedFor} answers. */
  readonly openedOn: (draftToken: string, target: HTMLElement) => void
  /** The target the new comment with this draft opened on, or `null`. */
  readonly pickedFor: (draftToken: string) => HTMLElement | null
}

/**
 * @param adapter - The preview's adapter.
 * @param placements - Where main placed the listed threads.
 * @param say - Says a sentence aloud.
 * @returns {@link HostReveal}
 */
export function useHostReveal(adapter: PreviewCommentAdapter, placements: readonly ThreadPlacement[], say: (text: string) => void): HostReveal {
  // An object, so a second reveal of one target starts its time again.
  const [flash, setFlash] = useState<{ readonly element: HTMLElement } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [stepped, setStepped] = useState<{ readonly window: unknown; readonly threadKey: string } | null>(null)
  const [picked, setPicked] = useState<{ readonly draftToken: string; readonly target: HTMLElement } | null>(null)
  useEffect(() => {
    if (flash === null) return undefined
    const timer = setTimeout(() => setFlash(null), REVEAL_FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])
  const latest = useRef({ adapter, placements })
  useEffect(() => {
    latest.current = { adapter, placements }
  }, [adapter, placements])

  const show = useCallback((threadKey: string | undefined): HTMLElement | null => {
    const target = revealThread(threadKey, latest.current.placements, latest.current.adapter)
    setFlash(target === null ? null : { element: target })
    return target
  }, [])
  const showRow = useCallback(
    (threadKey: string | undefined) => {
      const text = show(threadKey) === null ? latest.current.adapter.words.notOnScreen : null
      setNote(text)
      if (text !== null) say(text)
    },
    [show, say]
  )
  const showThread = useCallback(
    (threadKey: string) => {
      setNote(null)
      show(threadKey)
    },
    [show]
  )
  const stepTo = useCallback(
    (window: unknown, threadKey: string) => {
      setStepped({ window, threadKey })
      showThread(threadKey)
    },
    [showThread]
  )
  const steppedIn = (window: unknown): string | null => (stepped !== null && stepped.window === window ? stepped.threadKey : null)
  const openedOn = useCallback((draftToken: string, target: HTMLElement) => setPicked({ draftToken, target }), [])
  const pickedFor = (draftToken: string): HTMLElement | null => (picked?.draftToken === draftToken ? picked.target : null)
  return { flash: flash?.element ?? null, note, showRow, showThread, stepTo, steppedIn, openedOn, pickedFor }
}
