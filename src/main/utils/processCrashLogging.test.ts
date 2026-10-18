// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockLogger = vi.hoisted(() => ({ error: vi.fn() }))
const mockFallback = vi.hoisted(() => vi.fn())

vi.mock('../services/LoggingService', () => ({ logger: mockLogger }))
vi.mock('./crashFallbackLog', () => ({ writeCrashFallbackLine: mockFallback }))

type Listener = (...args: unknown[]) => void

describe('registerProcessCrashLogging', () => {
  let rejectionListener: Listener
  let monitorListener: Listener
  const baselineRejection = process.listeners('unhandledRejection')
  const baselineMonitor = process.listeners('uncaughtExceptionMonitor')
  const baselineUncaught = process.listeners('uncaughtException')

  beforeEach(async () => {
    vi.clearAllMocks()
    // fresh module state each time: the registration flag is module-level
    vi.resetModules()
    const { registerProcessCrashLogging } = await import('./processCrashLogging')
    registerProcessCrashLogging()
    registerProcessCrashLogging() // idempotent
    rejectionListener = process
      .listeners('unhandledRejection')
      .find((l) => !baselineRejection.includes(l)) as Listener
    monitorListener = process
      .listeners('uncaughtExceptionMonitor')
      .find((l) => !baselineMonitor.includes(l)) as Listener
  })

  afterEach(() => {
    process.removeListener('unhandledRejection', rejectionListener)
    process.removeListener('uncaughtExceptionMonitor', monitorListener)
  })

  it('registers one listener of each kind and leaves uncaughtException alone', () => {
    expect(process.listeners('unhandledRejection')).toHaveLength(baselineRejection.length + 1)
    expect(process.listeners('uncaughtExceptionMonitor')).toHaveLength(baselineMonitor.length + 1)
    // The monitor observes only: the default uncaught-exception behaviour is unchanged
    expect(process.listeners('uncaughtException')).toEqual(baselineUncaught)
  })

  it('logs an unhandled rejection with the greppable tag and a fallback line', () => {
    const reason = new Error('rejected')
    rejectionListener(reason)

    expect(mockLogger.error).toHaveBeenCalledWith('[crash] unhandled-rejection', reason)
    expect(mockFallback).toHaveBeenCalledWith('[crash] unhandled-rejection', reason)
  })

  it('logs a non-Error rejection reason as text', () => {
    rejectionListener('just a string')
    expect(mockLogger.error).toHaveBeenCalledWith('[crash] unhandled-rejection', undefined, {
      reason: 'just a string'
    })
  })

  it('records an uncaught exception through the monitor', () => {
    const err = new Error('kaboom')
    monitorListener(err, 'uncaughtException')
    expect(mockLogger.error).toHaveBeenCalledWith('[crash] uncaught-exception', err)
    expect(mockFallback).toHaveBeenCalled()
  })

  it('ignores the benign shutdown timer race that the before-quit guard swallows', () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'expiry')")
    err.stack = `${err.message}\n    at compareTimersLists (node:internal/timers:1:1)`
    monitorListener(err, 'uncaughtException')
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockFallback).not.toHaveBeenCalled()
  })
})
