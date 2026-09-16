// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * previewHostFocus tests (issue #124, QG-11a H1).
 *
 * The way back out of a previewed page: a forwarded key whose renderer action
 * moves focus into Erfana's chrome first hands native focus to the host
 * window's own contents, then reaches the renderer. Every other key leaves
 * focus in the page, and a window or contents that is gone is skipped without
 * losing the key.
 */
import { describe, expect, it, vi } from 'vitest'

import { PREVIEW_FORWARDED_SHORTCUTS } from './previewInputForward'
import {
  PREVIEW_HOST_FOCUS_KEYS,
  focusHostContents,
  forwardWithHostFocus,
  movesFocusToHost,
  type PreviewHostFocusWindow
} from './previewHostFocus'

vi.mock('../LoggingService', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

function makeWindow(options: { windowGone?: boolean; contentsGone?: boolean } = {}) {
  const focus = vi.fn<() => void>()
  const window: PreviewHostFocusWindow = {
    isDestroyed: () => options.windowGone === true,
    webContents: { focus, isDestroyed: () => options.contentsGone === true }
  }
  return { window, focus }
}

describe('PREVIEW_HOST_FOCUS_KEYS', () => {
  it('names only keys main actually forwards', () => {
    const forwarded = PREVIEW_FORWARDED_SHORTCUTS.map((s) => s.key as string)
    expect(Object.isFrozen(PREVIEW_HOST_FOCUS_KEYS)).toBe(true)
    for (const key of PREVIEW_HOST_FOCUS_KEYS) {
      expect(forwarded).toContain(key)
    }
  })

  it('moves focus for Escape, Find and Close, and for nothing else', () => {
    expect(movesFocusToHost('Escape')).toBe(true)
    expect(movesFocusToHost('f')).toBe(true)
    expect(movesFocusToHost('w')).toBe(true)
    for (const key of ['s', 'back', 'forward', 'escape', 'F', 'Enter', '']) {
      expect(movesFocusToHost(key)).toBe(false)
    }
  })
})

describe('forwardWithHostFocus', () => {
  it('focuses the host contents BEFORE the forwarded Escape is emitted', () => {
    const { window, focus } = makeWindow()
    const forward = vi.fn<(key: string) => void>()

    forwardWithHostFocus(window, 'Escape', forward)

    expect(focus).toHaveBeenCalledTimes(1)
    expect(forward).toHaveBeenCalledWith('Escape')
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(forward.mock.invocationCallOrder[0])
  })

  it.each(['s', 'back', 'forward'])('leaves focus in the page for %s', (key) => {
    const { window, focus } = makeWindow()
    const forward = vi.fn<(key: string) => void>()

    forwardWithHostFocus(window, key, forward)

    expect(focus).not.toHaveBeenCalled()
    expect(forward).toHaveBeenCalledWith(key)
  })

  it('still forwards the key when the host window is gone', () => {
    const { window, focus } = makeWindow({ windowGone: true })
    const forward = vi.fn<(key: string) => void>()

    expect(() => forwardWithHostFocus(window, 'Escape', forward)).not.toThrow()
    expect(focus).not.toHaveBeenCalled()
    expect(forward).toHaveBeenCalledWith('Escape')
  })

  it('still forwards the key when focus throws', () => {
    const { window, focus } = makeWindow()
    focus.mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })
    const forward = vi.fn<(key: string) => void>()

    expect(() => forwardWithHostFocus(window, 'f', forward)).not.toThrow()
    expect(forward).toHaveBeenCalledWith('f')
  })
})

describe('focusHostContents', () => {
  it('focuses a live host contents', () => {
    const { window, focus } = makeWindow()
    expect(focusHostContents(window)).toBe(true)
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('skips a destroyed host contents', () => {
    const { window, focus } = makeWindow({ contentsGone: true })
    expect(focusHostContents(window)).toBe(false)
    expect(focus).not.toHaveBeenCalled()
  })

  it('skips a contents that cannot focus', () => {
    const window: PreviewHostFocusWindow = { isDestroyed: () => false, webContents: {} }
    expect(focusHostContents(window)).toBe(false)
  })
})
