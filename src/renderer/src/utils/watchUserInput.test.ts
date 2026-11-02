// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchUserInput } from './watchUserInput'

describe('watchUserInput', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('R-003 says nothing happened until a pointer or key press', () => {
    const watch = watchUserInput()
    expect(watch.acted()).toBe(false)
    document.body.focus()
    expect(watch.acted()).toBe(false)
    watch.stop()
  })

  it.each(['pointerdown', 'mousedown', 'keydown'])('R-003 a %s anywhere in the document counts', type => {
    const watch = watchUserInput()
    const target = document.createElement('button')
    document.body.appendChild(target)
    // Stopped in the bubble phase: the watch listens in the capture phase, so it still sees it.
    target.addEventListener(type, event => event.stopPropagation())
    target.dispatchEvent(new Event(type, { bubbles: true }))
    expect(watch.acted()).toBe(true)
    watch.stop()
    target.remove()
  })

  it('R-003 a press after stop() is not counted, and stop() twice removes the listeners once', () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const watch = watchUserInput()
    watch.stop()
    watch.stop()
    document.dispatchEvent(new Event('keydown'))
    expect(watch.acted()).toBe(false)
    expect(remove).toHaveBeenCalledTimes(3)
  })
})
