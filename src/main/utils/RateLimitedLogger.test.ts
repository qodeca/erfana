// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../services/LoggingService', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { logger } from '../services/LoggingService'
import { RateLimitedLogger } from './RateLimitedLogger'

// lastLogTime initializes to 0, so first emission requires performance.now() >= intervalMs.
// We start the clock at a high baseline so the first log always passes the interval check.
const CLOCK_START = 100_000

describe('RateLimitedLogger', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>
  let clock: number

  beforeEach(() => {
    vi.clearAllMocks()
    clock = CLOCK_START
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    nowSpy.mockRestore()
  })

  it('emits immediately on first call', () => {
    const rl = new RateLimitedLogger('test', 10000)

    rl.log('warn', 'first message', { key: 'value' })

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith('first message', { key: 'value', suppressedCount: 0 })
  })

  it('suppresses subsequent calls within intervalMs', () => {
    const rl = new RateLimitedLogger('test', 10000)

    rl.log('warn', 'msg') // emits (t=100000)
    clock += 100
    rl.log('warn', 'msg') // suppressed
    clock += 100
    rl.log('warn', 'msg') // suppressed
    clock += 100
    rl.log('warn', 'msg') // suppressed
    clock += 100
    rl.log('warn', 'msg') // suppressed

    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('reports accumulated suppressedCount on next allowed emission', () => {
    const rl = new RateLimitedLogger('test', 100)

    // First call emits
    rl.log('warn', 'msg', { key: 'val' })

    // Three suppressed calls within interval
    clock += 10
    rl.log('warn', 'msg', { key: 'val' })
    clock += 10
    rl.log('warn', 'msg', { key: 'val' })
    clock += 10
    rl.log('warn', 'msg', { key: 'val' })

    // Advance past interval; next call should emit with suppressedCount: 3
    clock += 101
    rl.log('warn', 'msg', { key: 'val' })

    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenLastCalledWith('msg', { key: 'val', suppressedCount: 3 })
  })

  it('resets suppressedCount to 0 after emission', () => {
    const rl = new RateLimitedLogger('test', 100)

    rl.log('warn', 'msg')           // emits (suppressedCount sent: 0)
    clock += 10
    rl.log('warn', 'msg')           // suppressed
    clock += 101
    rl.log('warn', 'msg')           // emits with suppressedCount: 1
    clock += 101
    rl.log('warn', 'msg')           // emits with suppressedCount: 0

    expect(logger.warn).toHaveBeenCalledTimes(3)
    expect(logger.warn).toHaveBeenLastCalledWith('msg', { suppressedCount: 0 })
  })

  it('reset() allows immediate re-emission', () => {
    const rl = new RateLimitedLogger('test', 10000)

    rl.log('warn', 'msg')     // emits (call #1)
    clock += 100
    rl.log('warn', 'msg')     // suppressed

    rl.reset()

    clock += 1
    rl.log('warn', 'msg')     // emits after reset (call #2)

    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  it('reset() zeroes suppressedCount', () => {
    const rl = new RateLimitedLogger('test', 10000)

    rl.log('warn', 'msg')     // emits
    clock += 10
    rl.log('warn', 'msg')     // suppressed (suppressedCount = 1)
    clock += 10
    rl.log('warn', 'msg')     // suppressed (suppressedCount = 2)

    rl.reset()

    clock += 1
    rl.log('warn', 'msg')

    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenLastCalledWith('msg', { suppressedCount: 0 })
  })

  it('routes error level through logger.error with undefined error arg', () => {
    const rl = new RateLimitedLogger('test', 10000)

    rl.log('error', 'error msg', { key: 'val' })

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('error msg', undefined, {
      key: 'val',
      suppressedCount: 0
    })
  })

  it.each([
    ['info' as const],
    ['debug' as const],
    ['warn' as const]
  ])('routes %s level through logger[level] with two args', (level) => {
    const rl = new RateLimitedLogger('test', 10000)

    rl.log(level, 'the message', { extra: 1 })

    expect(logger[level]).toHaveBeenCalledTimes(1)
    expect(logger[level]).toHaveBeenCalledWith('the message', { extra: 1, suppressedCount: 0 })
  })
})
