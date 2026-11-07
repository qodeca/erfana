// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({ targetStatus: vi.fn() }))
const logger = vi.hoisted(() => ({ warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../utils/logger', () => ({ logger }))

import { useTerminalStore } from '../../../stores/useTerminalStore'
import { TARGET_REASK_LIMIT, TARGET_REASK_MS, useBrowserTarget } from './useBrowserTarget'

const flush = async (): Promise<void> => {
  await act(async () => undefined)
}

describe('useBrowserTarget (025-FR-061)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    gateway.targetStatus.mockReset()
    logger.warn.mockReset()
    useTerminalStore.getState().setActiveTerminalId(null)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads no terminal without asking main', () => {
    const { result } = renderHook(() => useBrowserTarget())
    expect(result.current).toMatchObject({ terminalId: null, terminalName: null, status: null })
    expect(result.current.view.text).toBe('No terminal open')
    expect(gateway.targetStatus).not.toHaveBeenCalled()
  })

  it('shows the agent main names for the active terminal', async () => {
    gateway.targetStatus.mockResolvedValue({ kind: 'agent', process: 'claude', fresh: true })
    act(() => useTerminalStore.getState().setActiveTerminalId('terminal-1'))
    const { result } = renderHook(() => useBrowserTarget())
    expect(result.current.view.text).toBe('→ Terminal · …')
    await flush()
    expect(gateway.targetStatus).toHaveBeenCalledWith('terminal-1')
    expect(result.current.status).toEqual({ kind: 'agent', process: 'claude' })
    expect(result.current.view.text).toBe('→ Terminal · claude')
  })

  it('asks again while the answer is not fresh, up to the limit', async () => {
    gateway.targetStatus.mockResolvedValue({ kind: 'unknown', process: null, fresh: false })
    act(() => useTerminalStore.getState().setActiveTerminalId('terminal-1'))
    renderHook(() => useBrowserTarget())
    await flush()
    for (let i = 0; i < TARGET_REASK_LIMIT + 2; i++) {
      await act(async () => vi.advanceTimersByTime(TARGET_REASK_MS))
    }
    expect(gateway.targetStatus).toHaveBeenCalledTimes(TARGET_REASK_LIMIT + 1)
  })

  it('stops asking once fresh, and refresh asks again now', async () => {
    gateway.targetStatus
      .mockResolvedValueOnce({ kind: 'unknown', process: null, fresh: false })
      .mockResolvedValue({ kind: 'shell', process: 'zsh', fresh: true })
    act(() => useTerminalStore.getState().setActiveTerminalId('terminal-1'))
    const { result } = renderHook(() => useBrowserTarget())
    await flush()
    await act(async () => vi.advanceTimersByTime(TARGET_REASK_MS))
    await act(async () => vi.advanceTimersByTime(TARGET_REASK_MS * 3))
    expect(gateway.targetStatus).toHaveBeenCalledTimes(2)
    expect(result.current.view.warn).toBe(true)
    act(() => result.current.refresh())
    await flush()
    expect(gateway.targetStatus).toHaveBeenCalledTimes(3)
  })

  it('logs a failed read and keeps the status unknown', async () => {
    gateway.targetStatus.mockRejectedValue(new Error('gone'))
    act(() => useTerminalStore.getState().setActiveTerminalId('terminal-1'))
    const { result } = renderHook(() => useBrowserTarget())
    await flush()
    expect(logger.warn).toHaveBeenCalledWith('Browser target status failed', { error: 'gone' })
    expect(result.current.status).toBeNull()
  })

  it('ignores an answer that arrives after unmount', async () => {
    let answer: (value: unknown) => void = () => undefined
    gateway.targetStatus.mockReturnValue(new Promise(resolve => (answer = resolve)))
    act(() => useTerminalStore.getState().setActiveTerminalId('terminal-1'))
    const { result, unmount } = renderHook(() => useBrowserTarget())
    unmount()
    await act(async () => answer({ kind: 'agent', process: 'claude', fresh: false }))
    await act(async () => vi.advanceTimersByTime(TARGET_REASK_MS * 2))
    expect(gateway.targetStatus).toHaveBeenCalledOnce()
    expect(result.current.status).toBeNull()
  })
})
