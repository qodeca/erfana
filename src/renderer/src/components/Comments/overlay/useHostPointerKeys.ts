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
 *   a link, and the rest of the click family never reaches the preview's
 *   content (`contentGuard.ts`). A pointer pick paints the target picked as
 *   a key does – real focus and the Focus card's ring (D-06) – without
 *   saying it. The picker keys move real focus between
 *   targets: the picked one takes `tabindex="-1"` and the Focus card's ring
 *   (C-08.3). It keeps the attribute while it is the pick – so the menu and
 *   the window hand focus back to it on close – and loses it when another
 *   target is picked or the mode ends. A picker key's release is kept from
 *   the preview with its press (Esc's keyup too, OVL-E-01).
 * - **The menu** opens on a right-click on a target or a selection (in
 *   comment mode on any right-click – off every target its item is disabled
 *   with the reason, `targetlessMenu`), or from
 *   Shift+F10 / the Menu key: at the picked target (in comment mode), at the
 *   selection's last line (outside it, C-08.5), else at the first target in
 *   view. The host decides what a selection makes of it (`hostMenu.ts`).
 * - **Spoken steps** (C-10): every keyboard pick says the target as the host
 *   names it ("Paragraph, line 42: “We ship…”. 2 comments."); the first three
 *   after the mode turns on add the keys, the keyboard entry says it in one
 *   sentence with "Comment mode on.", and a key at a level's end says so.
 * - **The keys** are the overlay core's (`overlayCore/pickerKeys`), one rule
 *   with the HTML page. With nothing outlined, a key starts from the first
 *   target in view (K-10); with no target at all it says so.
 * - **A click on commented words** (C-17) – a plain click, no drag, not on a
 *   link – opens that thread, in and outside comment mode.
 *
 * @module components/Comments/overlay/useHostPointerKeys
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { classifyGesture, type GesturePoint } from '../../../../../shared/comments/overlayCore/gesture'
import { movePicker, pickerStepOf } from '../../../../../shared/comments/overlayCore/pickerKeys'
import { pointerTakesOver } from '../../../../../shared/comments/overlayCore/pointerFollow'
import { commentModeKeyFromDomEvent, matchCommentModeKey } from '../../../../../shared/commentModeKey'
import { useLatestRef } from '../../../hooks/useLatestRef'
import { isMacOS } from '../../../utils/platform'
import { MD_SPOKEN_COPY } from '../commentCopyWords'
import { clearPickTabIndex, setPickTabIndex } from './commentContentAttrs'
import { guardContent } from './contentGuard'
import { firstTargetInView, pickerEndSentence, previewTree } from './pickerKeys'
import { targetNounOf, type PreviewCommentAdapter } from './previewAdapter'

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
  /**
   * Esc on the preview while the non-modal window is open (C-18): the window's dismiss. The Esc order is menu →
   * window → comment mode, and a pointer pick hands focus back to the preview while the window opens.
   */
  readonly onWindowEscape: () => void
  /** A target was picked: by a click, or by Enter (`byKey`). */
  readonly onPick: (target: HTMLElement, byKey: boolean) => void
  /** What a keyboard pick says about `target` (C-10). */
  readonly speak: (target: HTMLElement) => string
  /** The thread whose marked words are at a viewport point, or `null` (C-17). */
  readonly markAt: (x: number, y: number) => string | null
  /** Open one thread from its marked words; `at` is the target the click was in. */
  readonly onOpenMark: (threadKey: string, at: HTMLElement | null) => void
  /**
   * Open the menu; `target` is the one under the pointer or outlined. The host takes a selection's when the
   * pointer is on it (I-22), or on a key (`byKey`), except in comment mode, which acts on what is outlined (K-11).
   */
  readonly onMenu: (target: HTMLElement | null, at: { x: number; y: number }, byKey?: boolean) => void
  /** The selection's last line box, or `null` when nothing is selected (keyboard-opened menu, C-08.5). */
  readonly selectionRect: () => DOMRect | null
  /** The target holding a selection in view, or `null`: the keyboard's mode entry starts there (C-08.2, I-12). */
  readonly selectionTarget: () => HTMLElement | null
  /** Whether a viewport point is on the selection: only there is a right-click about the words (I-22). */
  readonly onSelectionAt: (x: number, y: number) => boolean
  readonly onSay: (text: string) => void
  /** A key moved the pick: the Comment button's words are behind it. */
  readonly onKeyMove: () => void
  readonly onScroll: () => void
}

/** What the host draws from pointer and keys. */
export interface HostPointerKeys {
  /** The target to outline: the pick, until the pointer moves off it with no menu or window open; else the one under the pointer. */
  readonly outlined: HTMLElement | null
  /**
   * Pick and focus the first target in view (comment mode turned on from the
   * keyboard); `lead` says "Comment mode on." with it, in one sentence (C-10).
   */
  readonly focusFirst: (lead?: boolean) => void
}

/** Keyboard steps after the mode turns on that add the keys to what they say (C-10 "the first three steps"). */
const HINTED_STEPS = 3

/** One key across its press and release (the physical key; `key` where the engine gives no `code`). */
const keyOf = (event: KeyboardEvent): string => (event.code === '' ? event.key : event.code)

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
  const hoverRef = useLatestRef(hover)
  // The keys put the pick where it is: a level they chose holds under the pointer (`overlayCore/pointerFollow`).
  const keyHeld = useRef(false)
  // The way back down: what Alt+Up left, for Alt+Down (`overlayCore/pickerKeys`).
  const path = useRef<readonly HTMLElement[]>([])

  // The target this hook gave `tabindex="-1"`: one at a time, removed when the pick moves or the mode ends.
  const marked = useRef<HTMLElement | null>(null)
  const unmark = useCallback(() => {
    if (marked.current !== null) clearPickTabIndex(marked.current)
    marked.current = null
  }, [])
  /** The pick ends. A focused target stops being focusable, which would drop focus to `<body>`: the scroller takes it first. */
  const releasePick = useCallback(() => {
    if (marked.current?.contains(document.activeElement) === true) latest.current.scroller?.focus({ preventScroll: true })
    unmark()
  }, [latest, unmark])

  // Keyboard steps since the mode turned on: the first ones add the keys (C-10).
  const steps = useRef(0)

  /** Make `target` the pick: real focus and the ring (C-08.3, D-06). */
  const paintPicked = useCallback(
    (target: HTMLElement) => {
      if (marked.current !== target) {
        unmark()
        // Marked, so exports and copies strip it (024-FR-024, `commentContentAttrs.ts`).
        if (setPickTabIndex(target)) marked.current = target
      }
      // `focusVisible`: a pick by pointer wears the ring too – after a click the browser would not draw it (D-06).
      target.focus({ preventScroll: true, focusVisible: true })
      setPicked(target)
    },
    [unmark]
  )

  /** Give `target` real focus and the ring (C-08.3), bring it into view, and say it (C-10). */
  const focusTarget = useCallback(
    (target: HTMLElement, lead = false) => {
      keyHeld.current = true
      paintPicked(target)
      target.scrollIntoView({ block: 'nearest' })
      const spoken = latest.current.speak(target)
      const hint = steps.current < HINTED_STEPS ? MD_SPOKEN_COPY.hint : ''
      steps.current += 1
      latest.current.onSay(lead ? MD_SPOKEN_COPY.modeOnAt(spoken) + hint : spoken + hint)
    },
    [latest, paintPicked]
  )

  // Leaving the mode or the view (or unmounting) takes the attribute off the content again.
  useEffect(() => {
    steps.current = 0
    path.current = []
    if (mode && live) return releasePick
    releasePick()
    return undefined
  }, [mode, live, releasePick])

  // C-08.2: the block holding a selection in view, else the first block in view.
  const focusFirst = useCallback(
    (lead = false) => {
      // Asked a frame after the mode turned on: a pick, a menu or a window that came first keeps the focus.
      if (pickedRef.current?.isConnected === true || latest.current.windowOpen) return
      const held = latest.current.selectionTarget()
      const first =
        held !== null && adapter.canComment(held).ok
          ? held
          : firstTargetInView(adapter, latest.current.scroller?.getBoundingClientRect() ?? null)
      if (first !== null) focusTarget(first, lead)
    },
    [adapter, focusTarget, latest, pickedRef]
  )

  // Leaving the mode or the view drops the outline and the pick.
  const [shownMode, setShownMode] = useState(mode && live)
  if (shownMode !== (mode && live)) {
    setShownMode(mode && live)
    setHover(null)
    // Only on the way out: the first pick can land before the render that turns the mode on.
    if (!(mode && live)) setPicked(null)
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
  // Keys whose press the picker took: their release is taken too (OVL-E-01).
  const swallowedRef = useRef(new Set<string>())
  useEffect(() => {
    if (!live || scroller === null) return undefined
    const swallowedKeys = swallowedRef.current
    const targetOf = (event: Event): HTMLElement | null => latest.current.adapter.targetAt(event.target as Node | null)
    const onScroll = (): void => latest.current.onScroll()
    const onMove = (event: MouseEvent): void => {
      if (!latest.current.mode) return
      const under = targetOf(event)
      setHover(under)
      // I-3: the outline shows what a click would hit. An open menu or window keeps its target outlined.
      const pick = marked.current ?? pickedRef.current
      if (pick === null || latest.current.windowOpen || !pointerTakesOver(pick, under, keyHeld.current)) return
      path.current = []
      releasePick()
      setPicked(null)
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
      else if (gesture === 'pick' && target !== null) {
        // OVL-G-01 / D-06: a pointer pick is painted as the pick before the window opens (and hands focus back to it).
        keyHeld.current = false
        path.current = []
        paintPicked(target)
        latest.current.onPick(target, false)
      }
    }
    const onContextMenu = (event: MouseEvent): void => {
      const target = targetOf(event)
      // In comment mode every right-click is the menu's, as in the HTML Preview – off every target, too (M-08).
      if (target === null && !latest.current.onSelectionAt(event.clientX, event.clientY) && !latest.current.mode) return
      event.preventDefault()
      event.stopPropagation()
      latest.current.onMenu(target, { x: event.clientX, y: event.clientY })
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const step = pickerStepOf(event)
      // A press the preview keeps: a release left over from a swallowed one (focus moved before it came) is its own now.
      if (step === null || !latest.current.mode) swallowedKeys.delete(keyOf(event))
      if (step === null) return
      // The Esc order is menu → window → comment mode. An open menu took Esc already (the overlay stack, capture
      // phase); an open window is closed here, wherever focus is.
      if (step === 'exit' && latest.current.windowOpen) {
        event.preventDefault()
        event.stopPropagation()
        latest.current.onWindowEscape()
        return
      }
      const { mode: on, adapter: current } = latest.current
      if (!on) {
        if (step !== 'menu') return
        const words = hasSelection() ? latest.current.selectionRect() : null
        if (words !== null) {
          event.preventDefault()
          latest.current.onMenu(null, { x: words.left + MENU_KEY_OFFSET_PX, y: words.bottom }, true)
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
      swallowedKeys.add(keyOf(event))
      // `marked` first: it is set with the focus, and the pick's state lands a render later. With no pick, the outline is the hover's.
      const held = marked.current?.isConnected === true ? marked.current : (pickedRef.current ?? hoverRef.current)
      const at = held?.isConnected === true ? held : null
      if (step === 'exit') {
        latest.current.onExit()
        return
      }
      // K-10: nothing outlined yet – the key starts from the first target in view, as every picker key does.
      const start = at ?? firstTargetInView(current, scroller.getBoundingClientRect())
      if (start === null) latest.current.onSay(MD_SPOKEN_COPY.noTargets)
      else if (step === 'open' || step === 'menu') {
        if (at === null) paintPicked(start)
        if (step === 'open') latest.current.onPick(start, true)
        else {
          const box = start.getBoundingClientRect()
          latest.current.onMenu(start, { x: box.left + MENU_KEY_OFFSET_PX, y: box.top + MENU_KEY_OFFSET_PX }, true)
        }
      } else if (at === null) focusTarget(start)
      else {
        const move = movePicker(previewTree(current), at, path.current, step)
        if ('target' in move) {
          path.current = move.path
          focusTarget(move.target)
          latest.current.onKeyMove()
        } else latest.current.onSay(pickerEndSentence(move.end, targetNounOf(current, at)))
      }
    }
    // OVL-E-01: the release of a key whose press was the picker's never reaches the preview either.
    const onKeyUp = (event: KeyboardEvent): void => {
      if (swallowedKeys.delete(keyOf(event))) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const content = adapter.root?.() ?? null
    const unguard = guardContent(content !== null && scroller.contains(content) ? content : scroller, () => latest.current.mode)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('mousemove', onMove)
    scroller.addEventListener('mouseleave', onLeave)
    scroller.addEventListener('mousedown', onDown, true)
    scroller.addEventListener('click', onClick, true)
    scroller.addEventListener('contextmenu', onContextMenu, true)
    scroller.addEventListener('keydown', onKeyDown)
    scroller.addEventListener('keyup', onKeyUp)
    return () => {
      unguard()
      swallowedKeys.clear()
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('mousemove', onMove)
      scroller.removeEventListener('mouseleave', onLeave)
      scroller.removeEventListener('mousedown', onDown, true)
      scroller.removeEventListener('click', onClick, true)
      scroller.removeEventListener('contextmenu', onContextMenu, true)
      scroller.removeEventListener('keydown', onKeyDown)
      scroller.removeEventListener('keyup', onKeyUp)
    }
  }, [live, scroller, adapter, latest, pickedRef, hoverRef, focusTarget, paintPicked, releasePick])

  const outlined = picked !== null && picked.isConnected ? picked : hover
  return { outlined, focusFirst }
}
