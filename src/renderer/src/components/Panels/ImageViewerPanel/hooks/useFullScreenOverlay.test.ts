// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link useFullScreenOverlay}.
 *
 * @module useFullScreenOverlay.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useFullScreenOverlay } from './useFullScreenOverlay'

/** Mounts a `#portal-root` the overlay can target. */
function addPortalRoot(): HTMLElement {
  const root = document.createElement('div')
  root.id = 'portal-root'
  document.body.appendChild(root)
  return root
}

/** Builds an overlay element with `count` focusable buttons. */
function makeOverlay(count: number): HTMLDivElement {
  const overlay = document.createElement('div')
  for (let i = 0; i < count; i += 1) {
    const button = document.createElement('button')
    button.textContent = `btn-${i}`
    overlay.appendChild(button)
  }
  document.body.appendChild(overlay)
  return overlay
}

beforeEach(() => {
  addPortalRoot()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useFullScreenOverlay', () => {
  it('starts closed and exposes the portal root', () => {
    const { result } = renderHook(() => useFullScreenOverlay())

    expect(result.current.isFullScreen).toBe(false)
    expect(result.current.portalRoot).toBe(document.getElementById('portal-root'))
  })

  it('opens when a portal root exists', () => {
    const { result } = renderHook(() => useFullScreenOverlay())

    act(() => result.current.open())

    expect(result.current.isFullScreen).toBe(true)
  })

  it('refuses to open without a portal root', () => {
    document.getElementById('portal-root')?.remove()
    const { result } = renderHook(() => useFullScreenOverlay())

    act(() => result.current.open())

    // Half-opening would trap focus in a detached tree.
    expect(result.current.isFullScreen).toBe(false)
  })

  it('restores focus to the opener on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { result } = renderHook(() => useFullScreenOverlay())
    act(() => result.current.open())
    act(() => result.current.close())

    expect(result.current.isFullScreen).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('does not move focus when closing an overlay that was never open', () => {
    const other = document.createElement('button')
    document.body.appendChild(other)
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { result } = renderHook(() => useFullScreenOverlay())
    other.focus()
    act(() => result.current.close())

    // An Escape press outside full screen must not steal focus.
    expect(document.activeElement).toBe(other)
  })

  describe('Focus trap', () => {
    it('focuses the first focusable element when it opens', () => {
      const overlay = makeOverlay(3)
      const { result } = renderHook(() => useFullScreenOverlay())
      ;(result.current.overlayRef as { current: HTMLDivElement | null }).current = overlay

      act(() => result.current.open())

      expect(document.activeElement).toBe(overlay.querySelectorAll('button')[0])
    })

    it('wraps Tab from the last element back to the first', () => {
      const overlay = makeOverlay(3)
      const buttons = Array.from(overlay.querySelectorAll('button'))
      const { result } = renderHook(() => useFullScreenOverlay())
      ;(result.current.overlayRef as { current: HTMLDivElement | null }).current = overlay
      act(() => result.current.open())

      buttons[2].focus()
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      })

      expect(document.activeElement).toBe(buttons[0])
    })

    it('wraps Shift+Tab from the first element to the last', () => {
      const overlay = makeOverlay(3)
      const buttons = Array.from(overlay.querySelectorAll('button'))
      const { result } = renderHook(() => useFullScreenOverlay())
      ;(result.current.overlayRef as { current: HTMLDivElement | null }).current = overlay
      act(() => result.current.open())

      buttons[0].focus()
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
        )
      })

      expect(document.activeElement).toBe(buttons[2])
    })

    it('stops trapping once the overlay closes', () => {
      const overlay = makeOverlay(3)
      const buttons = Array.from(overlay.querySelectorAll('button'))
      const outside = document.createElement('button')
      document.body.appendChild(outside)

      const { result } = renderHook(() => useFullScreenOverlay())
      ;(result.current.overlayRef as { current: HTMLDivElement | null }).current = overlay
      act(() => result.current.open())
      act(() => result.current.close())

      outside.focus()
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      })

      expect(document.activeElement).toBe(outside)
      expect(document.activeElement).not.toBe(buttons[0])
    })
  })
})
