// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { isBenignShutdownTimerError } from './isBenignShutdownTimerError'

describe('isBenignShutdownTimerError', () => {
  it('matches the chokidar awaitWriteFinish timer race during shutdown', () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'expiry')")
    err.stack = [
      "TypeError: Cannot read properties of undefined (reading 'expiry')",
      '    at compareTimersLists (node:internal/timers:419:35)',
      '    at PriorityQueue.percolateUp (node:internal/priority_queue:81:11)',
      '    at PriorityQueue.insert (node:internal/priority_queue:27:10)',
      '    at insert (node:internal/timers:378:20)',
      '    at setTimeout (node:internal/timers:136:3)',
      '    at FSWatcher._throttle (/app/node_modules/chokidar/index.js:683:19)'
    ].join('\n')
    expect(isBenignShutdownTimerError(err)).toBe(true)
  })

  it('matches when only the internal/timers frame is present', () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'expiry')")
    err.stack = "TypeError: ...\n    at insert (node:internal/timers:378:20)"
    expect(isBenignShutdownTimerError(err)).toBe(true)
  })

  it('does not match a different undefined-property read', () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'foo')")
    err.stack = '    at compareTimersLists (node:internal/timers:419:35)'
    expect(isBenignShutdownTimerError(err)).toBe(false)
  })

  it('does not match the expiry message without a timer-internal frame', () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'expiry')")
    err.stack = '    at someAppCode (/app/src/main/foo.ts:10:5)'
    expect(isBenignShutdownTimerError(err)).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isBenignShutdownTimerError(undefined)).toBe(false)
    expect(isBenignShutdownTimerError(null)).toBe(false)
    expect(isBenignShutdownTimerError("reading 'expiry'")).toBe(false)
    expect(isBenignShutdownTimerError({ message: "reading 'expiry'" })).toBe(false)
  })

  it('tolerates an Error with no stack', () => {
    const err = new Error("Cannot read properties of undefined (reading 'expiry')")
    err.stack = undefined
    expect(isBenignShutdownTimerError(err)).toBe(false)
  })
})
