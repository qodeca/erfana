// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Selection comments in a renderer-hosted preview (spec 024 024-FR-004;
 * comments-v2 C-16; menu matrix M-12, M-14, M-16, M-19, M-21).
 *
 * - **Reading the selection** ({@link readSelection}): the target is the one
 *   the selection starts in, and a selection that runs past it is cut to it
 *   (Markdown: "cut to the block where it started", with a notice in the
 *   window). A selection that starts in a target that cannot take a comment
 *   (the frontmatter) carries that reason. Only spaces are no selection.
 * - **The Comment button** appears about 150 ms after a pointer-up that
 *   leaves words selected in a target that can take a comment, above the
 *   end of the selection's last line (below it near the top). It takes no
 *   focus and leaves the selection alone; Esc, a scroll or a collapsed
 *   selection hide it. Shown inside and outside comment mode (C-16).
 *
 * @module components/Comments/overlay/useSelectionComments
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import { useLatestRef } from '../../../hooks/useLatestRef'
import type { NewCommentWords } from '../commentWindowTypes'
import { wordsInTarget } from './domWords'
import type { PreviewCommentAdapter } from './previewAdapter'

/** The wait after the pointer-up before the Comment button shows (C-16 "about 150 ms"). */
export const SELECTION_BUTTON_DELAY_MS = 150
/** Below this distance from the area's top, the button goes under the selection (C-16 "flipped below"). */
const FLIP_BELOW_PX = 48

/** The selection, as a comment would be about it. */
export interface SelectionPick {
  /** The target the selection starts in. */
  readonly target: HTMLElement
  /** Why that target cannot take a comment (the frontmatter), or `null`. */
  readonly refused: string | null
  readonly words: NewCommentWords
  /** The selected text as the page has it (the prompt items read it). */
  readonly text: string
  /** The selection's last line box, for the button and a keyboard-opened menu. */
  readonly rect: DOMRect | null
}

/** Where the Comment button sits, relative to the overlay's area. */
export interface SelectionButton {
  readonly x: number
  readonly y: number
  readonly below: boolean
}

/**
 * The preview's current selection as a {@link SelectionPick}, or `null`
 * when nothing (or only spaces) is selected inside `scroller`'s targets.
 */
export function readSelection(adapter: PreviewCommentAdapter, scroller: HTMLElement | null): SelectionPick | null {
  const selection = window.getSelection()
  if (scroller === null || selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  const text = selection.toString()
  if (text.trim() === '') return null
  const range = selection.getRangeAt(0)
  if (!scroller.contains(range.startContainer)) return null
  const target = adapter.targetAt(range.startContainer)
  if (target === null) return null
  const can = adapter.canComment(target)
  const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null
  const rect = rects !== null && rects.length > 0 ? rects[rects.length - 1] : null
  return { target, refused: can.ok ? null : can.reason, words: wordsInTarget(target, range), text, rect }
}

/** Options for {@link useSelectionComments}. */
export interface SelectionCommentsOptions {
  readonly live: boolean
  /** Why no new comment can be written now, or `null`: no button then. */
  readonly blocked: string | null
  readonly adapter: PreviewCommentAdapter
  readonly scroller: HTMLElement | null
  readonly area: HTMLElement | null
}

/** What the host draws and asks. */
export interface SelectionComments {
  /** The Comment button, while it shows. */
  readonly button: SelectionButton | null
  /** The current selection (menu, keyboard, button click). */
  readonly read: () => SelectionPick | null
  readonly hideButton: () => void
  /**
   * Draw the Comment button over the current selection now (C-16: turning
   * comment mode on with words selected shows it); `false` when no selection
   * in a commentable target is in view, so it is ignored.
   */
  readonly showButton: () => boolean
}

/**
 * The selection reader and the Comment button of one live host.
 *
 * @param options - {@link SelectionCommentsOptions}
 * @returns {@link SelectionComments}
 */
export function useSelectionComments(options: SelectionCommentsOptions): SelectionComments {
  const { live, scroller } = options
  const latest = useLatestRef(options)
  const [button, setButton] = useState<SelectionButton | null>(null)

  const read = useCallback(() => readSelection(latest.current.adapter, latest.current.scroller), [latest])
  const hideButton = useCallback(() => setButton(null), [])

  // The button over the selection's last line, when the selection can take a comment (and, asked for, is in view).
  const place = useCallback((inViewOnly = false): boolean => {
    const pick = readSelection(latest.current.adapter, latest.current.scroller)
    const area = latest.current.area?.getBoundingClientRect()
    const outOfView =
      inViewOnly && pick?.rect != null && area !== undefined && (pick.rect.bottom <= area.top || pick.rect.top >= area.bottom)
    if (pick === null || pick.refused !== null || latest.current.blocked !== null || pick.rect === null || area === undefined || outOfView) {
      setButton(null)
      return false
    }
    const top = pick.rect.top - area.top
    const below = top < FLIP_BELOW_PX
    setButton({ x: Math.max(0, pick.rect.right - area.left), y: below ? pick.rect.bottom - area.top : top, below })
    return true
  }, [latest])

  useEffect(() => {
    if (!live || scroller === null) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const onUp = (event: MouseEvent): void => {
      if (event.button !== 0) return
      clearTimeout(timer)
      timer = setTimeout(place, SELECTION_BUTTON_DELAY_MS)
    }
    const hide = (): void => setButton(null)
    const onSelectionChange = (): void => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed) hide()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }
    scroller.addEventListener('mouseup', onUp)
    scroller.addEventListener('scroll', hide, { passive: true })
    scroller.addEventListener('keydown', onKey)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      clearTimeout(timer)
      scroller.removeEventListener('mouseup', onUp)
      scroller.removeEventListener('scroll', hide)
      scroller.removeEventListener('keydown', onKey)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [live, scroller, place])

  const showButton = useCallback(() => place(true), [place])
  return { button: live ? button : null, read, hideButton, showButton }
}

/**
 * A comment saved with words is checked once the list shows its thread:
 * main keeps `sel` only where its own parse of the file finds the words
 * once (024-FR-004), and when it did not, `onDropped` says so.
 *
 * @returns Call with the saved thread's key and its target's tag.
 */
export function useWordsCheck(
  placements: readonly ThreadPlacement[],
  onDropped: (tag: string) => void
): (threadKey: string, tag: string) => void {
  const pending = useRef<{ threadKey: string; tag: string } | null>(null)
  const dropped = useLatestRef(onDropped)
  useEffect(() => {
    const check = pending.current
    const placement = check === null ? undefined : placements.find(p => p.threadKey === check.threadKey)
    if (check === null || placement === undefined) return
    pending.current = null
    if (placement.sel === undefined) dropped.current(check.tag)
  }, [placements, dropped])
  return useCallback((threadKey: string, tag: string) => {
    pending.current = { threadKey, tag }
  }, [])
}
