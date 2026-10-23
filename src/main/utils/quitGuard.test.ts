// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { createQuitGuard } from './quitGuard'

const fakeEvent = (): { preventDefault: ReturnType<typeof vi.fn> } => ({ preventDefault: vi.fn() })

describe('quitGuard', () => {
  it('prevents the first before-quit and asks the caller to start the shutdown', () => {
    const guard = createQuitGuard()
    const event = fakeEvent()
    expect(guard.handleBeforeQuit(event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(guard.isShuttingDown()).toBe(true)
  })

  it('prevents the second before-quit too, without starting another shutdown', () => {
    const guard = createQuitGuard()
    guard.handleBeforeQuit(fakeEvent())
    const second = fakeEvent()
    expect(guard.handleBeforeQuit(second)).toBe(false)
    expect(second.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('window-all-closed asks to quit before the shutdown, and does nothing during it', () => {
    const guard = createQuitGuard()
    const quit = vi.fn()
    guard.handleWindowAllClosed(quit)
    expect(quit).toHaveBeenCalledTimes(1)

    guard.handleBeforeQuit(fakeEvent())
    guard.handleWindowAllClosed(quit)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('the quit-confirm sequence ends with app.exit called exactly once', () => {
    // before-quit (app.quit) -> window destroyed -> window-all-closed -> 2nd before-quit
    const guard = createQuitGuard()
    const exit = vi.fn()
    const quit = vi.fn()
    const shutdown = (): void => exit(0)
    const events = [fakeEvent(), fakeEvent()]

    if (guard.handleBeforeQuit(events[0])) shutdown()
    guard.handleWindowAllClosed(quit)
    if (guard.handleBeforeQuit(events[1])) shutdown()

    expect(events.every((e) => e.preventDefault.mock.calls.length === 1)).toBe(true)
    expect(quit).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
