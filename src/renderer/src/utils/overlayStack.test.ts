// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared open-overlay stack (#229): Escape reaches only the topmost overlay.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger } from './logger'
import {
  getTopmostOverlay,
  isTopmostOverlay,
  readZIndexToken,
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

    it('ranks a z-index token by the value it holds on :root', () => {
      document.documentElement.style.setProperty('--z-context-menu', '100000')
      const menu = mountedRef()
      const dialog = mountedRef()
      registerOverlay({ ref: menu, zIndex: '--z-context-menu', getEscapeHandler: () => null })
      registerOverlay({ ref: dialog, zIndex: 10001, getEscapeHandler: () => null })

      expect(isTopmostOverlay(menu)).toBe(true)
      document.documentElement.style.removeProperty('--z-context-menu')
    })

    it('reads an undefined token as 0', () => {
      expect(readZIndexToken('--z-not-a-token')).toBe(0)
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

    it('ignores an auto-repeated Escape so a held key cannot walk down the stack', () => {
      const bottom = vi.fn()
      const top = vi.fn()
      registerOverlay({ ref: mountedRef(), zIndex: 10000, getEscapeHandler: () => bottom })
      registerOverlay({ ref: mountedRef(), zIndex: 10001, getEscapeHandler: () => top })

      pressEscape({ repeat: true })

      expect(top).not.toHaveBeenCalled()
      expect(bottom).not.toHaveBeenCalled()
    })
  })

  describe('non-modal entries', () => {
    it('take Escape first when topmost', () => {
      const dialog = vi.fn()
      const menu = vi.fn()
      registerOverlay({ ref: mountedRef(), zIndex: 10001, getEscapeHandler: () => dialog })
      registerOverlay({
        ref: mountedRef(),
        zIndex: 100000,
        modal: false,
        getEscapeHandler: () => menu
      })

      pressEscape()

      expect(menu).toHaveBeenCalledOnce()
      expect(dialog).not.toHaveBeenCalled()
    })

    it('do not take the topmost-modal slot from the dialog beneath', () => {
      const dialog = mountedRef()
      const menu = mountedRef()
      registerOverlay({ ref: dialog, zIndex: 10001, getEscapeHandler: () => null })
      registerOverlay({ ref: menu, zIndex: 100000, modal: false, getEscapeHandler: () => null })

      expect(isTopmostOverlay(dialog)).toBe(true)
      expect(getTopmostOverlay()?.ref).toBe(menu)
    })
  })

  describe('token parsing', () => {
    afterEach(() => {
      document.documentElement.style.removeProperty('--z-test-bad')
      vi.restoreAllMocks()
    })

    it('ranks a defined but non-integer token at 0 and warns once in dev', () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
      document.documentElement.style.setProperty('--z-test-bad', 'calc(1000 + 1)')

      expect(readZIndexToken('--z-test-bad')).toBe(0)
      expect(readZIndexToken('--z-test-bad')).toBe(0)

      expect(warn).toHaveBeenCalledOnce()
    })
  })
})

describe('stack tokens in design-tokens.css', () => {
  // Every `zIndex: '--z-…'` an overlay passes to the stack must be a plain
  // integer in the stylesheet, or readZIndexToken ranks that overlay at 0 –
  // below every dialog – and Escape goes to the wrong surface.
  const rendererSrc = resolve(__dirname, '..')
  const tokensCss = readFileSync(resolve(rendererSrc, 'styles/design-tokens.css'), 'utf8')

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(full)
      return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : []
    })
  }

  const usedTokens = new Set(
    sourceFiles(rendererSrc).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/zIndex:\s*'(--z-[\w-]+)'/g)].map((m) => m[1])
    )
  )

  it('finds the tokens the overlays use', () => {
    expect([...usedTokens]).toEqual(expect.arrayContaining(['--z-modal', '--z-context-menu']))
  })

  it.each([...usedTokens])('%s is declared as a plain integer', (token) => {
    const declaration = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(tokensCss)
    expect(declaration, `${token} is not declared`).not.toBeNull()
    expect(declaration![1].trim()).toMatch(/^-?\d+$/)
  })
})
