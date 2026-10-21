// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared open-overlay stack (#229): Escape reaches only the topmost overlay.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getTopmostOverlay,
  isTopmostOverlay,
  registerOverlay,
  resetOverlayStackForTests,
  unregisterOverlay
} from './overlayStack'

/** A connected element wrapped in a ref, as a mounted overlay would hold it. */
function mountedRef(): { current: HTMLElement } {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return { current: element }
}

function pressEscape(init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    ...init
  })
  document.dispatchEvent(event)
  return event
}

afterEach(() => {
  resetOverlayStackForTests()
  document.body.innerHTML = ''
})

describe('overlayStack', () => {
  describe('ordering', () => {
    it('treats the highest zIndex as topmost regardless of registration order', () => {
      const high = mountedRef()
      const low = mountedRef()
      registerOverlay({ ref: high, zIndex: 10001, getEscapeHandler: () => null })
      registerOverlay({ ref: low, zIndex: 10000, getEscapeHandler: () => null })

      expect(isTopmostOverlay(high)).toBe(true)
      expect(isTopmostOverlay(low)).toBe(false)
    })

    it('breaks a zIndex tie by the latest registration', () => {
      const first = mountedRef()
      const second = mountedRef()
      registerOverlay({ ref: first, zIndex: 10000, getEscapeHandler: () => null })
      registerOverlay({ ref: second, zIndex: 10000, getEscapeHandler: () => null })

      expect(getTopmostOverlay()?.ref).toBe(second)
    })

    it('moves a re-registered ref instead of duplicating it', () => {
      const a = mountedRef()
      const b = mountedRef()
      registerOverlay({ ref: a, zIndex: 10000, getEscapeHandler: () => null })
      registerOverlay({ ref: b, zIndex: 10000, getEscapeHandler: () => null })
      registerOverlay({ ref: a, zIndex: 10000, getEscapeHandler: () => null })

      expect(getTopmostOverlay()?.ref).toBe(a)
      unregisterOverlay(a)
      // Had `a` been duplicated, a stale copy would still claim the top.
      expect(getTopmostOverlay()?.ref).toBe(b)
    })

    it('skips an entry whose element is detached', () => {
      const live = mountedRef()
      const dead = mountedRef()
      registerOverlay({ ref: live, zIndex: 10000, getEscapeHandler: () => null })
      registerOverlay({ ref: dead, zIndex: 10001, getEscapeHandler: () => null })
      dead.current.remove()

      expect(isTopmostOverlay(live)).toBe(true)
    })

    it('reports any ref as topmost when nothing connected is registered', () => {
      expect(isTopmostOverlay({ current: null })).toBe(true)
      expect(getTopmostOverlay()).toBeNull()
    })
  })

  describe('Escape', () => {
    it('runs only the topmost handler when two overlays are stacked', () => {
      const bottom = vi.fn()
      const top = vi.fn()
      registerOverlay({ ref: mountedRef(), zIndex: 10000, getEscapeHandler: () => bottom })
      registerOverlay({ ref: mountedRef(), zIndex: 10001, getEscapeHandler: () => top })

      const event = pressEscape()

      expect(top).toHaveBeenCalledOnce()
      expect(bottom).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(true)
    })

    it('hands the next Escape to the overlay beneath once the top one is gone', () => {
      const bottom = vi.fn()
      const top = vi.fn()
      const topRef = mountedRef()
      registerOverlay({ ref: mountedRef(), zIndex: 10000, getEscapeHandler: () => bottom })
      registerOverlay({ ref: topRef, zIndex: 10001, getEscapeHandler: () => top })

      pressEscape()
      unregisterOverlay(topRef)
      pressEscape()

      expect(top).toHaveBeenCalledOnce()
      expect(bottom).toHaveBeenCalledOnce()
    })

    it('does not fall through when the topmost overlay opts out of Escape', () => {
      const bottom = vi.fn()
      registerOverlay({ ref: mountedRef(), zIndex: 10000, getEscapeHandler: () => bottom })
      registerOverlay({ ref: mountedRef(), zIndex: 10001, getEscapeHandler: () => null })

      const event = pressEscape()

      expect(bottom).not.toHaveBeenCalled()
      // Left alone so the focused control can still use the key.
      expect(event.defaultPrevented).toBe(false)
    })

    it('reads the handler at keystroke time', () => {
      const before = vi.fn()
      const after = vi.fn()
      let current = before
      registerOverlay({ ref: mountedRef(), zIndex: 10000, getEscapeHandler: () => current })

      current = after
      pressEscape()

      expect(before).not.toHaveBeenCalled()
      expect(after).toHaveBeenCalledOnce()
    })

    it('ignores Escape during an IME composition', () => {
      const handler = vi.fn()
      registerOverlay({ ref: mountedRef(), zIndex: 10000, getEscapeHandler: () => handler })

      pressEscape({ isComposing: true })

      expect(handler).not.toHaveBeenCalled()
    })

    it('ignores other keys', () => {
      const handler = vi.fn()
      registerOverlay({ ref: mountedRef(), zIndex: 10000, getEscapeHandler: () => handler })

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

      expect(handler).not.toHaveBeenCalled()
    })

    it('stops listening once the last overlay unregisters', () => {
      const handler = vi.fn()
      const ref = mountedRef()
      registerOverlay({ ref, zIndex: 10000, getEscapeHandler: () => handler })
      unregisterOverlay(ref)

      const event = pressEscape()

      expect(handler).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })
  })
})
