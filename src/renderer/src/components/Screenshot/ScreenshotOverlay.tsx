// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Screenshot Area-Select Overlay
 *
 * Renders inside the borderless transparent BrowserWindow spawned by
 * `AreaSelectOverlay.selectArea()` (main). Two interaction modes coexist:
 *
 * 1. **Pointer drag** (default): the user drags a rectangle with the mouse
 *    or touch input; releasing posts the selection back to main.
 * 2. **Keyboard region picker** (#164 finding [4]): pressing Tab initialises
 *    a 240×160 rectangle centred in the viewport with focus on a
 *    `role="application"` wrapper; arrow keys translate the rectangle
 *    (Alt+Arrows = 50px steps), Shift+Arrows resize from the bottom-right
 *    corner, Space/Enter submits. This is the keyboard-only equivalent
 *    required by WCAG 2.2 SC 2.1.1 (Keyboard) + SC 2.5.7 (Dragging
 *    Movements).
 *
 * A throttled `role="status" aria-live="polite"` region announces the live
 * rectangle dimensions to screen readers during both modes (#164 F[19]).
 *
 * The component reads `displayId` from the URL hash so the main-process
 * capturer knows which display to crop from. The hash format is
 * `#overlay/screenshot?displayId=<id>` and is populated by main when loading
 * the overlay URL.
 *
 * @see Issue #164 - Windows Phase 3 screenshot parity
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import './ScreenshotOverlay.css'

type Rect = { x: number; y: number; width: number; height: number }
type Mode = 'idle' | 'pointer-drag' | 'keyboard'

const MIN_SELECTION_PX = 4
const KEYBOARD_INIT_WIDTH = 240
const KEYBOARD_INIT_HEIGHT = 160
const KEYBOARD_STEP_PX = 10
const KEYBOARD_FAST_STEP_PX = 50
const SR_ANNOUNCEMENT_THROTTLE_MS = 250

function parseDisplayIdFromHash(hash: string): number | null {
  const queryStart = hash.indexOf('?')
  if (queryStart === -1) return null
  const params = new URLSearchParams(hash.slice(queryStart + 1))
  const raw = params.get('displayId')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function normaliseRect(start: { x: number; y: number }, end: { x: number; y: number }): Rect {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  return { x, y, width, height }
}

function clampRect(rect: Rect, viewportWidth: number, viewportHeight: number): Rect {
  const width = Math.min(rect.width, viewportWidth)
  const height = Math.min(rect.height, viewportHeight)
  const x = Math.max(0, Math.min(rect.x, viewportWidth - width))
  const y = Math.max(0, Math.min(rect.y, viewportHeight - height))
  return { x, y, width, height }
}

export function ScreenshotOverlay(): JSX.Element {
  const displayId = useMemo(() => parseDisplayIdFromHash(window.location.hash), [])
  const keyboardHelpId = useId()
  const [mode, setMode] = useState<Mode>('idle')
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null)
  const [keyboardRect, setKeyboardRect] = useState<Rect | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const submittedRef = useRef(false)
  const keyboardRectRef = useRef<HTMLDivElement | null>(null)
  const lastAnnouncementAtRef = useRef(0)

  const pointerRect = start && current ? normaliseRect(start, current) : null
  const displayRect = mode === 'keyboard' && keyboardRect ? keyboardRect : pointerRect

  // Throttled live-region update — every motion event would spam screen
  // readers; ~4 updates per second is enough to follow size changes (#164 F[19]).
  useEffect(() => {
    if (!displayRect) return
    const now = performance.now()
    if (now - lastAnnouncementAtRef.current < SR_ANNOUNCEMENT_THROTTLE_MS) return
    lastAnnouncementAtRef.current = now
    setAnnouncement(`Selected area, ${displayRect.width} by ${displayRect.height} pixels`)
  }, [displayRect])

  const submit = (rect: Rect): void => {
    if (
      rect.width < MIN_SELECTION_PX ||
      rect.height < MIN_SELECTION_PX ||
      displayId === null ||
      submittedRef.current
    ) {
      // #164 round-2 F#16: don't set a "Selection cancelled" announcement in
      // the overlay — the overlay window tears down immediately after this
      // call and the announcement races destruction. The main renderer's
      // persistent live region (TerminalPanel) speaks the cancel/success.
      submittedRef.current = true
      window.overlayApi?.areaCancelled()
      return
    }
    submittedRef.current = true
    window.overlayApi?.areaSelected({
      displayId,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    })
  }

  const cancel = (): void => {
    if (submittedRef.current) return
    submittedRef.current = true
    window.overlayApi?.areaCancelled()
  }

  // Global Escape + blur cancel + Tab → enter keyboard mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        cancel()
        return
      }
      // #164 round-2 F#18: Tab only enters keyboard mode from idle. Once the
      // keyboard rectangle exists, Tab inside it should be absorbed rather
      // than re-initialise — the rect handler stops propagation, so a stray
      // bubbled Tab in another container would otherwise reset the user's
      // selection.
      if (e.key === 'Tab' && mode === 'idle') {
        e.preventDefault()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const initial: Rect = {
          x: Math.round((viewportWidth - KEYBOARD_INIT_WIDTH) / 2),
          y: Math.round((viewportHeight - KEYBOARD_INIT_HEIGHT) / 2),
          width: KEYBOARD_INIT_WIDTH,
          height: KEYBOARD_INIT_HEIGHT
        }
        setKeyboardRect(initial)
        setMode('keyboard')
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', cancel)
    }
  }, [mode])

  // Focus the keyboard rectangle so arrow keys land on its handler.
  useEffect(() => {
    if (mode === 'keyboard' && keyboardRectRef.current) {
      keyboardRectRef.current.focus()
    }
  }, [mode])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    setMode('pointer-drag')
    setKeyboardRect(null)
    e.currentTarget.setPointerCapture(e.pointerId)
    const point = { x: Math.round(e.clientX), y: Math.round(e.clientY) }
    setStart(point)
    setCurrent(point)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!start) return
    setCurrent({ x: Math.round(e.clientX), y: Math.round(e.clientY) })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!start || !current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const finalRect = normaliseRect(start, current)
    setStart(null)
    setCurrent(null)
    setMode('idle')
    submit(finalRect)
  }

  const handleKeyboardRectKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!keyboardRect) return

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      submit(keyboardRect)
      return
    }

    const step = e.altKey ? KEYBOARD_FAST_STEP_PX : KEYBOARD_STEP_PX
    const isResize = e.shiftKey
    let next = keyboardRect

    switch (e.key) {
      case 'ArrowLeft':
        next = isResize
          ? { ...keyboardRect, width: keyboardRect.width - step }
          : { ...keyboardRect, x: keyboardRect.x - step }
        break
      case 'ArrowRight':
        next = isResize
          ? { ...keyboardRect, width: keyboardRect.width + step }
          : { ...keyboardRect, x: keyboardRect.x + step }
        break
      case 'ArrowUp':
        next = isResize
          ? { ...keyboardRect, height: keyboardRect.height - step }
          : { ...keyboardRect, y: keyboardRect.y - step }
        break
      case 'ArrowDown':
        next = isResize
          ? { ...keyboardRect, height: keyboardRect.height + step }
          : { ...keyboardRect, y: keyboardRect.y + step }
        break
      default:
        return
    }
    e.preventDefault()
    next = clampRect(
      { ...next, width: Math.max(MIN_SELECTION_PX, next.width), height: Math.max(MIN_SELECTION_PX, next.height) },
      window.innerWidth,
      window.innerHeight
    )
    setKeyboardRect(next)
  }

  return (
    <div
      className={`screenshot-overlay screenshot-overlay--${mode}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* SR-only live region. `aria-atomic` ensures the full message is read
        * each time, not just diffs. Throttled by the useEffect above. */}
      <div
        className="screenshot-overlay-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>

      <div className="screenshot-overlay-hint">
        Drag to select an area · Tab for keyboard · Esc to cancel
      </div>

      {/* SR-discoverable keyboard help (#164 round-2 F#18). Rendered BEFORE
        * the user presses Tab so screen-reader browse mode can find the
        * shortcut list without having to enter the rectangle first. */}
      <div id={keyboardHelpId} className="screenshot-overlay-sr-only">
        Press Tab to enter keyboard selection mode. Arrow keys move; Shift+arrows resize;
        Alt+arrows for 50-pixel steps; Space or Enter captures; Escape cancels.
      </div>

      {displayRect && (
        <div
          className={`screenshot-overlay-selection${mode === 'keyboard' ? ' screenshot-overlay-selection--keyboard' : ''}`}
          style={{
            left: `${displayRect.x}px`,
            top: `${displayRect.y}px`,
            width: `${displayRect.width}px`,
            height: `${displayRect.height}px`
          }}
        >
          <span className="screenshot-overlay-size">
            {displayRect.width} × {displayRect.height}
          </span>
        </div>
      )}

      {mode === 'keyboard' && keyboardRect && (
        <div
          ref={keyboardRectRef}
          role="group"
          aria-label={`Selection ${keyboardRect.width} by ${keyboardRect.height} pixels at ${keyboardRect.x},${keyboardRect.y}`}
          aria-describedby={keyboardHelpId}
          tabIndex={0}
          className="screenshot-overlay-keyboard-handle"
          style={{
            left: `${keyboardRect.x}px`,
            top: `${keyboardRect.y}px`,
            width: `${keyboardRect.width}px`,
            height: `${keyboardRect.height}px`
          }}
          onKeyDown={handleKeyboardRectKeyDown}
        />
      )}
    </div>
  )
}
