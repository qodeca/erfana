// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pointer and keyboard picking for the renderer's comment overlay host (spec
 * 024 024-NFR-006, 024-AC-029; comments-v2 C-08; differences table D-31;
 * menu matrix § 4).
 *
 * - **The mode shortcut** (Ctrl+Alt+M / Cmd+Option+M, `shared/commentModeKey`)
 *   is a `window` listener, so it is gated by the active panel – dockview
 *   keeps every tab mounted (src/renderer/CLAUDE.md).
 * - **The scroller is a tab stop** (C-08.1) while the host is live; the
 *   attribute is the scroller's, never the exported content's.
 * - **In comment mode** the pointer outlines the target under it and a
 *   click picks it (`overlayCore/gesture`: a drag of 4 px or more, or a
 *   selection, selects words instead – 024-FR-004); the click never reaches
 *   a link. The picker keys move real focus between
 *   targets: the picked one takes `tabindex="-1"` and the Focus card's ring
 *   (C-08.3). It keeps the attribute while it is the pick – so the menu and
 *   the window hand focus back to it on close – and loses it when another
 *   target is picked or the mode ends.
 * - **The menu** opens on a right-click on a target or a selection, or from
 *   Shift+F10 / the Menu key: at the picked target (in comment mode), at the
 *   selection's last line (outside it, C-08.5), else at the first target in
 *   view. The host decides what a selection makes of it (`hostMenu.ts`).
 * - **Spoken steps** (C-10): every keyboard pick says the target as the host
 *   names it ("Paragraph, line 42: “We ship…”. 2 comments."); the first three
 *   after the mode turns on add the keys, the keyboard entry says it in one
 *   sentence with "Comment mode on.", and Tab at either end says so.
 * - **A click on commented words** (C-17) – a plain click, no drag, not on a
 *   link – opens that thread, in and outside comment mode.
 *
 * @module components/Comments/overlay/useHostPointerKeys
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { classifyGesture, type GesturePoint } from '../../../../../shared/comments/overlayCore/gesture'
import { commentModeKeyFromDomEvent, matchCommentModeKey } from '../../../../../shared/commentModeKey'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { isMacOS } from '../../../utils/platform'
import { MARKDOWN_COPY, MD_SPOKEN_COPY } from '../commentCopyWords'
import { clearPickTabIndex, setPickTabIndex } from './commentContentAttrs'
import { firstTargetInView, movePicker, pickerStepOf } from './pickerKeys'
import type { PreviewCommentAdapter } from './previewAdapter'

/** Where a keyboard-opened menu sits: the target's top-left plus this (menu matrix § 4). */
const MENU_KEY_OFFSET_PX = 4

/** Options for {@link useHostPointerKeys}. */
export interface HostPointerKeysOptions {
  readonly live: boolean
  readonly mode: boolean
  readonly activePanel: boolean
  readonly adapter: PreviewCommentAdapter
  readonly scroller: HTMLElement | null
  /** The scroller's accessible name (C-08.1). */
  readonly scrollerLabel: string
  /** A menu or a window is open: the mode shortcut waits. */
  readonly windowOpen: boolean
  readonly onToggleMode: (byKeyboard: boolean) => void
  readonly onExit: () => void
  /** A target was picked: by a click, or by Enter (`byKey`). */
  readonly onPick: (target: HTMLElement, byKey: boolean) => void
  /** What a keyboard pick says about `target` (C-10). */
  readonly speak: (target: HTMLElement) => string
  /** The thread whose marked words are at a viewport point, or `null` (C-17). */
  readonly markAt: (x: number, y: number) => string | null
  /** Open one thread from its marked words; `at` is the target the click was in. */
  readonly onOpenMark: (threadKey: string, at: HTMLElement | null) => void
  /** Open the menu; `target` is the one under the pointer – the host prefers a selection's. */
  readonly onMenu: (target: HTMLElement | null, at: { x: number; y: number }) => void
  /** The selection's last line box, or `null` when nothing is selected (keyboard-opened menu, C-08.5). */
  readonly selectionRect: () => DOMRect | null
  readonly onSay: (text: string) => void
  readonly onScroll: () => void
}

/** What the host draws from pointer and keys. */
export interface HostPointerKeys {
  /** The target to outline: the picked one, else the one under the pointer. */
  readonly outlined: HTMLElement | null
  /**
   * Pick and focus the first target in view (comment mode turned on from the
   * keyboard); `lead` says "Comment mode on." with it, in one sentence (C-10).
   */
  readonly focusFirst: (lead?: boolean) => void
}

/** Keyboard steps after the mode turns on that add the keys to what they say (C-10 "the first three steps"). */
const HINTED_STEPS = 3

/** Whether the document holds a non-empty selection. */
function hasSelection(): boolean {
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== ''
}

/**
 * Pointer and keys for one live host.
 *
 * @param options - {@link HostPointerKeysOptions}
 * @returns {@link HostPointerKeys}
 */
export function useHostPointerKeys(options: HostPointerKeysOptions): HostPointerKeys {
  const { live, mode, activePanel, adapter, scroller, scrollerLabel, windowOpen } = options
  const [hover, setHover] = useState<HTMLElement | null>(null)
  const [picked, setPicked] = useState<HTMLElement | null>(null)
  const latest = useLatestRef(options)
  const pickedRef = useLatestRef(picked)

  // The target this hook gave `tabindex="-1"`: one at a time, removed when the pick moves or the mode ends.
  const marked = useRef<HTMLElement | null>(null)
  const unmark = useCallback(() => {
    if (marked.current !== null) clearPickTabIndex(marked.current)
    marked.current = null
  }, [])

  // Keyboard steps since the mode turned on: the first ones add the keys (C-10).
  const steps = useRef(0)

  /** Give `target` real focus and the ring (C-08.3), and say it (C-10). */
  const focusTarget = useCallback(
    (target: HTMLElement, lead = false) => {
      if (marked.current !== target) {
        unmark()
        // Marked, so exports and copies strip it (024-FR-024, `commentContentAttrs.ts`).
        if (setPickTabIndex(target)) marked.current = target
      }
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'nearest' })
      setPicked(target)
      const spoken = latest.current.speak(target)
      const hint = steps.current < HINTED_STEPS ? MD_SPOKEN_COPY.hint : ''
      steps.current += 1
      latest.current.onSay(lead ? MD_SPOKEN_COPY.modeOnAt(spoken) + hint : spoken + hint)
    },
    [latest, unmark]
  )

  // Leaving the mode or the view (or unmounting) takes the attribute off the content again.
  useEffect(() => {
    steps.current = 0
    if (mode && live) return unmark
    unmark()
    return undefined
  }, [mode, live, unmark])

  // C-08.2: the block holding the selection's anchor, else the first block in view.
  const focusFirst = useCallback(
    (lead = false) => {
      const anchor = hasSelection() ? (window.getSelection()?.anchorNode ?? null) : null
      const held = anchor !== null && latest.current.scroller?.contains(anchor) ? adapter.targetAt(anchor) : null
      const first =
        held !== null && adapter.canComment(held).ok
          ? held
          : firstTargetInView(adapter, latest.current.scroller?.getBoundingClientRect() ?? null)
      if (first !== null) focusTarget(first, lead)
    },
    [adapter, focusTarget, latest]
  )

  // Leaving the mode or the view drops the outline and the pick.
  const [shownMode, setShownMode] = useState(mode && live)
  if (shownMode !== (mode && live)) {
    setShownMode(mode && live)
    setHover(null)
    setPicked(null)
  }

  // ---- the mode shortcut: the active panel's only ----
  useEffect(() => {
    if (!live || !activePanel || windowOpen) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (!matchCommentModeKey(commentModeKeyFromDomEvent(event), isMacOS())) return
      event.preventDefault()
      latest.current.onToggleMode(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live, activePanel, windowOpen, latest])

  // ---- the scroller: a tab stop with a name (C-08.1) ----
  useEffect(() => {
    if (!live || scroller === null) return undefined
    const hadTabIndex = scroller.getAttribute('tabindex')
    scroller.setAttribute('tabindex', '0')
    scroller.setAttribute('aria-label', scrollerLabel)
    return () => {
      if (hadTabIndex === null) scroller.removeAttribute('tabindex')
      else scroller.setAttribute('tabindex', hadTabIndex)
      scroller.removeAttribute('aria-label')
    }
  }, [live, scroller, scrollerLabel])

  // ---- pointer, keys and scroll on the scroller ----
  const down = useRef<GesturePoint | null>(null)
  useEffect(() => {
    if (!live || scroller === null) return undefined
    const targetOf = (event: Event): HTMLElement | null => latest.current.adapter.targetAt(event.target as Node | null)
    const onScroll = (): void => latest.current.onScroll()
    const onMove = (event: MouseEvent): void => {
      if (latest.current.mode) setHover(targetOf(event))
    }
    const onLeave = (): void => setHover(null)
    const onDown = (event: MouseEvent): void => {
      down.current = event.button === 0 ? { x: event.clientX, y: event.clientY } : null
    }
    const onClick = (event: MouseEvent): void => {
      if (event.button !== 0) return
      const start = down.current ?? { x: event.clientX, y: event.clientY }
      const gesture = classifyGesture({ down: start, up: { x: event.clientX, y: event.clientY }, selectionCollapsed: !hasSelection() })
      const on = latest.current.mode
      // C-17: a plain click on commented words opens that thread – outside the mode only off a link.
      const onLink = event.target instanceof Element && event.target.closest('a') !== null
      const mark = gesture === 'pick' && (on || !onLink) ? latest.current.markAt(event.clientX, event.clientY) : null
      if (!on) {
        if (mark !== null) latest.current.onOpenMark(mark, targetOf(event))
        return
      }
      // In comment mode a click is a pick, never a link (the preview's own handlers do not run).
      event.preventDefault()
      event.stopPropagation()
      const target = targetOf(event)
      if (mark !== null) latest.current.onOpenMark(mark, target)
      else if (gesture === 'pick' && target !== null) latest.current.onPick(target, false)
    }
    const onContextMenu = (event: MouseEvent): void => {
      const target = targetOf(event)
      if (target === null && !hasSelection()) return
      event.preventDefault()
      event.stopPropagation()
      latest.current.onMenu(target, { x: event.clientX, y: event.clientY })
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const step = pickerStepOf(event)
      if (step === null) return
      const { mode: on, adapter: current } = latest.current
      if (!on) {
        if (step !== 'menu') return
        const words = hasSelection() ? latest.current.selectionRect() : null
        if (words !== null) {
          event.preventDefault()
          latest.current.onMenu(null, { x: words.left + MENU_KEY_OFFSET_PX, y: words.bottom })
          return
        }
        const first = firstTargetInView(current, scroller.getBoundingClientRect())
        if (first === null) return
        event.preventDefault()
        const box = first.getBoundingClientRect()
        latest.current.onMenu(first, { x: box.left + MENU_KEY_OFFSET_PX, y: box.top + MENU_KEY_OFFSET_PX })
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const at = pickedRef.current
      if (step === 'exit') latest.current.onExit()
      else if (step === 'open') {
        if (at !== null) latest.current.onPick(at, true)
      } else if (step === 'menu') {
        if (at === null) return
        const box = at.getBoundingClientRect()
        latest.current.onMenu(at, { x: box.left + MENU_KEY_OFFSET_PX, y: box.top + MENU_KEY_OFFSET_PX })
      } else {
        const move = movePicker(current, at, step, () => firstTargetInView(current, scroller.getBoundingClientRect()))
        if ('target' in move) focusTarget(move.target)
        else if (move.end === 'top') latest.current.onSay(MARKDOWN_COPY.pickerTop)
        else if (move.end === 'no-child') latest.current.onSay(MARKDOWN_COPY.pickerNoChild)
        else if (at !== null) latest.current.onSay(step === 'next' ? MD_SPOKEN_COPY.last : MD_SPOKEN_COPY.first)
      }
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('mousemove', onMove)
    scroller.addEventListener('mouseleave', onLeave)
    scroller.addEventListener('mousedown', onDown, true)
    scroller.addEventListener('click', onClick, true)
    scroller.addEventListener('contextmenu', onContextMenu, true)
    scroller.addEventListener('keydown', onKeyDown)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('mousemove', onMove)
      scroller.removeEventListener('mouseleave', onLeave)
      scroller.removeEventListener('mousedown', onDown, true)
      scroller.removeEventListener('click', onClick, true)
      scroller.removeEventListener('contextmenu', onContextMenu, true)
      scroller.removeEventListener('keydown', onKeyDown)
    }
  }, [live, scroller, latest, pickedRef, focusTarget])

  const outlined = picked !== null && picked.isConnected ? picked : hover
  return { outlined, focusFirst }
}
