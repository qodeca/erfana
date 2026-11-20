// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The main side's window-focus check (#478 plan S17, decision 37): one
 * `browser-window-focus` listener for every main tracker, added with the first
 * and removed with the last; a tracker that throws does not stop the others.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: undefined }))
vi.mock('../LoggingService', () => ({ logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { logger } from '../LoggingService'
import { mainTrackerCount, registerMainTracker, setFocusSourceForTests, type FocusSource } from './mainFreshnessRegistry'

function fakeFocus(): FocusSource & { fire(): void; readonly listeners: number } {
  const listeners = new Set<() => void>()
  return {
    on: (_event, listener) => listeners.add(listener),
    removeListener: (_event, listener) => listeners.delete(listener),
    fire: () => {
      for (const listener of [...listeners]) listener()
    },
    get listeners() {
      return listeners.size
    }
  }
}

let focus: ReturnType<typeof fakeFocus>
let restore: () => void
const removals: Array<() => void> = []

beforeEach(() => {
  focus = fakeFocus()
  restore = setFocusSourceForTests(focus)
})

afterEach(() => {
  for (const remove of removals.splice(0)) remove()
  restore()
})

describe('mainFreshnessRegistry (#478 S17)', () => {
  it('listens with the first tracker, checks every tracker on focus, and stops with the last', () => {
    const a = { check: vi.fn() }
    const b = { check: vi.fn() }
    expect(focus.listeners).toBe(0)
    const removeA = registerMainTracker(a)
    const removeB = registerMainTracker(b)
    expect(focus.listeners).toBe(1)

    focus.fire()
    expect(a.check).toHaveBeenCalledWith('focus')
    expect(b.check).toHaveBeenCalledWith('focus')

    removeA()
    removeB()
    expect(mainTrackerCount()).toBe(0)
    expect(focus.listeners).toBe(0)
  })

  it('keeps checking the rest when one tracker throws, and logs it', () => {
    const failing = {
      check: () => {
        throw new Error('boom')
      }
    }
    const healthy = { check: vi.fn() }
    removals.push(registerMainTracker(failing), registerMainTracker(healthy))
    focus.fire()
    expect(healthy.check).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalled()
  })
})
