// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Selection comments in a renderer-hosted preview (spec 024 024-FR-004;
 * comments-v2 C-16; menu matrix M-12, M-14, M-16, M-19, M-21).
 *
 * - **Reading the selection** ({@link readSelection}): the target is the
 *   smallest one holding the whole selection – a list for two of its items, a
 *   table for two of its rows (I-16, D-17). When no target holds it all, the
 *   selection is cut to the target it starts in (Markdown: "cut to the block
 *   where it started", with a notice in the window). A selection that starts
 *   in a target that cannot take a comment (the frontmatter) carries that
 *   reason. Only spaces are no selection.
 * - **The Comment button** follows the overlay core's one rule
 *   (`overlayCore/selectionRules`): about 150 ms after a pointer-up that
 *   leaves words selected in a target that can take a comment, above the end
 *   of the selection's last line in view (below it near the top). It takes no
 *   focus and leaves the selection alone. It follows a scroll, leaves while
 *   the selection is out of view and comes back with it; Esc or a collapsed
 *   selection end it. Shown inside and outside comment mode (C-16).
 *
 * @module components/Comments/overlay/useSelectionComments
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import { SELECTION_BUTTON_DELAY_MS, buttonGoesBelow, lastLineInView } from '../../../../../shared/comments/overlayCore/selectionRules'
import { useLatestRef } from '../../../hooks/useLatestRef'
import type { NewCommentWords, NounSource } from '../commentWindowTypes'
import { wordsInTarget } from './domWords'
import type { PreviewCommentAdapter } from './previewAdapter'

export { SELECTION_BUTTON_DELAY_MS }

/** The selection, as a comment would be about it. */
export interface SelectionPick {
  /** The smallest target holding the whole selection, else the one it starts in. */
  readonly target: HTMLElement
  /** Why that target cannot take a comment (the frontmatter), or `null`. */
  readonly refused: string | null
  readonly words: NewCommentWords
  /** The selected text as the page has it (the prompt items read it). */
  readonly text: string
  /** The selection's last line box, for a keyboard-opened menu. */
  readonly rect: DOMRect | null
  /** Every line box: the button sits on the last in view, and a right-click counts only on one of them. */
  readonly lines: readonly DOMRect[]
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
  const started = adapter.targetAt(range.startContainer)
  const holder = adapter.targetAt(range.commonAncestorContainer)
  const target = holder !== null && adapter.canComment(holder).ok ? holder : started
  if (target === null) return null
  const can = adapter.canComment(target)
  const lines = typeof range.getClientRects === 'function' ? [...range.getClientRects()] : []
  return { target, refused: can.ok ? null : can.reason, words: wordsInTarget(target, range), text, rect: lines.at(-1) ?? null, lines }
}

/** The selection, when it shows in `area`: words out of view are ignored (C-16, I-12). */
function inView(pick: SelectionPick | null, area: HTMLElement | null): SelectionPick | null {
  return pick !== null && lastLineOf(pick, area) !== null ? pick : null
}

/** The last line of `pick` that shows in `area`, the line the button sits on. */
function lastLineOf(pick: SelectionPick, area: HTMLElement | null): DOMRect | null {
  return area === null ? null : lastLineInView(pick.lines, area.getBoundingClientRect())
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
  /** The current selection (menu, button click). */
  readonly read: () => SelectionPick | null
  /** The current selection, when it shows: what a key may act on (C-16, I-12). */
  readonly readInView: () => SelectionPick | null
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

  // The button is up, or out of view and coming back with its selection: a scroll moves it.
  const armed = useRef(false)

  const read = useCallback(() => readSelection(latest.current.adapter, latest.current.scroller), [latest])
  const readInView = useCallback(() => inView(read(), latest.current.area), [read, latest])
  const hideButton = useCallback(() => {
    armed.current = false
    setButton(null)
  }, [])

  // The button over the selection's last line in view, when the selection can take a comment; `false` when it cannot show now.
  const place = useCallback((): boolean => {
    const pick = read()
    const area = latest.current.area
    if (pick === null || pick.refused !== null || latest.current.blocked !== null || area === null) {
      hideButton()
      return false
    }
    const line = lastLineOf(pick, area)
    if (line === null) {
      setButton(null)
      return false
    }
    const box = area.getBoundingClientRect()
    const top = line.top - box.top
    const below = buttonGoesBelow(line.top, box.top)
    armed.current = true
    setButton({ x: Math.max(0, line.right - box.left), y: below ? line.bottom - box.top : top, below })
    return true
  }, [latest, read, hideButton])

  useEffect(() => {
    if (!live || scroller === null) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const onUp = (event: MouseEvent): void => {
      if (event.button !== 0) return
      clearTimeout(timer)
      timer = setTimeout(place, SELECTION_BUTTON_DELAY_MS)
    }
    const onScroll = (): void => {
      if (armed.current) place()
    }
    const onSelectionChange = (): void => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed) hideButton()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hideButton()
    }
    // Capture: in comment mode the content guard keeps a release from the preview's content (`contentGuard.ts`).
    scroller.addEventListener('mouseup', onUp, true)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('keydown', onKey)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      clearTimeout(timer)
      scroller.removeEventListener('mouseup', onUp, true)
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('keydown', onKey)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [live, scroller, place, hideButton])

  return { button: live ? button : null, read, readInView, hideButton, showButton: place }
}

/**
 * A comment saved with words is checked once the list shows its thread:
 * main keeps `sel` only where its own parse of the file finds the words
 * once (024-FR-004), and when it did not, `onDropped` says so.
 *
 * @returns Call with the saved thread's key and its target's tag. `onDropped` gets the thread's
 *   placement – its tag and place (C-03) – when it is on that tag, else the tag.
 */
export function useWordsCheck(
  placements: readonly ThreadPlacement[],
  onDropped: (target: NounSource) => void
): (threadKey: string, tag: string) => void {
  const pending = useRef<{ threadKey: string; tag: string } | null>(null)
  const dropped = useLatestRef(onDropped)
  useEffect(() => {
    const check = pending.current
    const placement = check === null ? undefined : placements.find(p => p.threadKey === check.threadKey)
    if (check === null || placement === undefined) return
    pending.current = null
    if (placement.sel === undefined) dropped.current(placement.tag === check.tag ? placement : check.tag)
  }, [placements, dropped])
  return useCallback((threadKey: string, tag: string) => {
    pending.current = { threadKey, tag }
  }, [])
}
