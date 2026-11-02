// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTerminalStore } from './useTerminalStore'
import type { ITerminalOperations } from '../interfaces/ITerminalOperations'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

const mockWrite = vi.fn()
const mockTerminalOps: ITerminalOperations = { write: mockWrite }
const useTerminalStore = createTerminalStore(mockTerminalOps)

/** Run a send to completion through the 200 ms paste-to-Enter wait. */
async function send(terminalId: string, text: string): Promise<boolean> {
  const promise = useTerminalStore.getState().sendToTerminalId(terminalId, text)
  await vi.advanceTimersByTimeAsync(200)
  return promise
}

describe('useTerminalStore.sendToTerminalId', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      activeTerminalId: 'active-term',
      activityById: new Map(),
      userInputById: new Map()
    })
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockWrite.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes to the named terminal, not the active one', async () => {
    expect(await send('target-term', 'hello')).toBe(true)
    expect(mockWrite).toHaveBeenCalledTimes(2)
    for (const [id] of mockWrite.mock.calls) expect(id).toBe('target-term')
  })

  it('025-AC-032 sends a single-line text as one bracketed paste', async () => {
    await send('t1', 'explain this')
    expect(mockWrite).toHaveBeenNthCalledWith(1, 't1', `${PASTE_START}explain this${PASTE_END}`)
  })

  it('025-AC-032 sends a multi-line text as one bracketed paste and submits it once', async () => {
    await send('t1', 'line one\nline two')
    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(mockWrite).toHaveBeenNthCalledWith(1, 't1', `${PASTE_START}line one\rline two${PASTE_END}`)
    expect(mockWrite).toHaveBeenNthCalledWith(2, 't1', '\r')
  })

  it('025-AC-032 removes control characters before typing, including an injected paste end marker', async () => {
    await send('t1', `a\x1b[31mb\x07c\x9bd${PASTE_END}e`)
    expect(mockWrite).toHaveBeenNthCalledWith(1, 't1', `${PASTE_START}a[31mbcd[201~e${PASTE_END}`)
  })

  it('sends Enter only after the 200 ms wait', async () => {
    const promise = useTerminalStore.getState().sendToTerminalId('t1', 'hello')
    await vi.advanceTimersByTimeAsync(0)
    expect(mockWrite).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(199)
    expect(mockWrite).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(await promise).toBe(true)
    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(mockWrite).toHaveBeenLastCalledWith('t1', '\r')
  })

  it('marks user input and activity on the named terminal', async () => {
    await send('t1', 'hello')
    expect(useTerminalStore.getState().userInputById.has('t1')).toBe(true)
    expect(useTerminalStore.getState().activityById.has('t1')).toBe(true)
    expect(useTerminalStore.getState().userInputById.has('active-term')).toBe(false)
  })

  it('returns false and writes nothing for an empty terminal id', async () => {
    expect(await send('', 'hello')).toBe(false)
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('returns false and writes nothing when only control characters and spaces are left', async () => {
    expect(await send('t1', '\x1b\x07 \n\t')).toBe(false)
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('returns false without sending Enter when the paste write fails', async () => {
    mockWrite.mockResolvedValueOnce({ success: false, error: 'closed' })
    expect(await send('t1', 'hello')).toBe(false)
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(useTerminalStore.getState().userInputById.has('t1')).toBe(false)
  })

  it('returns false when the Enter write fails', async () => {
    mockWrite.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'closed' })
    expect(await send('t1', 'hello')).toBe(false)
    expect(mockWrite).toHaveBeenCalledTimes(2)
  })

  it('returns false when a write throws', async () => {
    mockWrite.mockRejectedValueOnce(new Error('ipc down'))
    expect(await send('t1', 'hello')).toBe(false)
  })

  it('leaves sendToTerminal unchanged: single-line text is still not bracketed', async () => {
    const promise = useTerminalStore.getState().sendToTerminal('echo hi', false)
    await vi.advanceTimersByTimeAsync(0)
    expect(await promise).toBe(true)
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith('active-term', 'echo hi')
  })
})
