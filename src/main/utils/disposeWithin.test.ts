// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const warn = vi.fn()
vi.mock('../services/LoggingService', () => ({ logger: { warn: (...a: unknown[]) => warn(...a) } }))

import { disposeWithin } from './disposeWithin'

describe('disposeWithin', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    warn.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('resolves when the disposer settles and logs nothing', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined)
    await disposeWithin('lock', dispose, 1000)
    expect(dispose).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never rejects: a throwing disposer is logged with its label', async () => {
    await expect(disposeWithin('watcher', () => Promise.reject(new Error('boom')), 1000)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('App quit: watcher threw', { error: 'boom' })
  })

  it('logs a non-Error rejection as text', async () => {
    await disposeWithin('pty', () => Promise.reject('gone'), 1000)
    expect(warn).toHaveBeenCalledWith('App quit: pty threw', { error: 'gone' })
  })

  it('returns at the timeout when the disposer never settles', async () => {
    const pending = disposeWithin('share', () => new Promise<void>(() => {}), 1000)
    await vi.advanceTimersByTimeAsync(999)
    expect(warn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('App quit: share timed out', { timeoutMs: 1000 })
  })
})
