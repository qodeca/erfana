// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTerminalStore } from './useTerminalStore'
import {
  ENTER_MIN_DELAY_MS,
  ENTER_MIN_QUIET_MS,
  ENTER_NO_OUTPUT_DELAY_MS,
  ENTER_POLL_MS
} from './terminalInputSettle'
import type { ITerminalOperations } from '../interfaces/ITerminalOperations'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

const mockWrite = vi.fn()
const mockTerminalOps: ITerminalOperations = { write: mockWrite }
const useTerminalStore = createTerminalStore(mockTerminalOps)

/** Every write as `[terminalId, data]`, in order. */
function writes(): Array<[string, string]> {
  return mockWrite.mock.calls.map(([id, data]) => [String(id), String(data)])
}

/** Run a send to completion; with no output from the terminal, Enter waits ENTER_NO_OUTPUT_DELAY_MS. */
async function send(terminalId: string, text: string): Promise<boolean> {
  const promise = useTerminalStore.getState().sendToTerminalId(terminalId, text)
  await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)
  return promise
}

describe('useTerminalStore.sendToTerminalId', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      activeTerminalId: 'active-term',
      activityById: new Map(),
      userInputById: new Map()
    })
    // Output times live outside store state and would leak between tests
    for (const id of ['t1', 't2', 'target-term', 'active-term']) useTerminalStore.getState().clearActivity(id)
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

  describe('Enter waits until the paste has settled (#449)', () => {
    it('sends Enter once the echo has been quiet for ENTER_MIN_QUIET_MS, not on a fixed timer', async () => {
      const promise = useTerminalStore.getState().sendToTerminalId('t1', 'hello')
      await vi.advanceTimersByTimeAsync(0)
      expect(mockWrite).toHaveBeenCalledTimes(1)

      // The program is still taking the paste well past the old fixed 200 ms
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(90)
        useTerminalStore.getState().noteOutput('t1')
      }
      expect(mockWrite).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(ENTER_MIN_QUIET_MS - 1)
      expect(mockWrite).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(ENTER_POLL_MS)
      expect(await promise).toBe(true)
      expect(mockWrite).toHaveBeenCalledTimes(2)
      expect(mockWrite).toHaveBeenLastCalledWith('t1', '\r')
    })

    it('never sends Enter sooner than ENTER_MIN_DELAY_MS, even after a quick echo', async () => {
      const promise = useTerminalStore.getState().sendToTerminalId('t1', 'hello')
      await vi.advanceTimersByTimeAsync(1)
      useTerminalStore.getState().noteOutput('t1')

      await vi.advanceTimersByTimeAsync(ENTER_MIN_DELAY_MS - 2)
      expect(mockWrite).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(ENTER_MIN_QUIET_MS + ENTER_POLL_MS)
      expect(await promise).toBe(true)
      expect(mockWrite).toHaveBeenCalledTimes(2)
    })

    it('sends Enter after ENTER_NO_OUTPUT_DELAY_MS when the terminal prints nothing', async () => {
      const promise = useTerminalStore.getState().sendToTerminalId('t1', 'hello')
      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS - 1)
      expect(mockWrite).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(ENTER_POLL_MS)
      expect(await promise).toBe(true)
      expect(mockWrite).toHaveBeenLastCalledWith('t1', '\r')
    })

    it('waits on the output of the named terminal, not the active one', async () => {
      const promise = useTerminalStore.getState().sendToTerminalId('t1', 'hello')
      await vi.advanceTimersByTimeAsync(10)
      useTerminalStore.getState().noteOutput('active-term')

      await vi.advanceTimersByTimeAsync(ENTER_MIN_QUIET_MS + ENTER_POLL_MS)
      expect(mockWrite).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)
      expect(await promise).toBe(true)
    })
  })

  describe('sends to one terminal run one after another', () => {
    it('never lets the second paste land between the first paste and its Enter', async () => {
      const first = useTerminalStore.getState().sendToTerminalId('t1', 'Explain\nthis')
      await vi.advanceTimersByTimeAsync(50)
      const second = useTerminalStore.getState().sendToTerminalId('t1', 'Ask\nthat')

      // The second paste waits for the first Enter
      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS - 100)
      expect(writes()).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(2 * ENTER_NO_OUTPUT_DELAY_MS)
      await expect(Promise.all([first, second])).resolves.toEqual([true, true])
      expect(writes()).toEqual([
        ['t1', `${PASTE_START}Explain\rthis${PASTE_END}`],
        ['t1', '\r'],
        ['t1', `${PASTE_START}Ask\rthat${PASTE_END}`],
        ['t1', '\r']
      ])
    })

    it('shares the queue with sendToTerminal for the same terminal', async () => {
      useTerminalStore.setState({ activeTerminalId: 't1' })
      const first = useTerminalStore.getState().sendToTerminal('Explain\nthis', true)
      await vi.advanceTimersByTimeAsync(50)
      const second = useTerminalStore.getState().sendToTerminalId('t1', 'Ask that')

      await vi.advanceTimersByTimeAsync(2 * ENTER_NO_OUTPUT_DELAY_MS + ENTER_POLL_MS)
      await expect(Promise.all([first, second])).resolves.toEqual([true, true])
      expect(writes().map(([, data]) => data)).toEqual([
        `${PASTE_START}Explain\rthis${PASTE_END}`,
        '\r',
        `${PASTE_START}Ask that${PASTE_END}`,
        '\r'
      ])
    })

    it('runs the next send after one that failed', async () => {
      mockWrite.mockResolvedValueOnce({ success: false, error: 'closed' })
      const first = useTerminalStore.getState().sendToTerminalId('t1', 'one')
      const second = useTerminalStore.getState().sendToTerminalId('t1', 'two')

      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS + ENTER_POLL_MS)
      await expect(Promise.all([first, second])).resolves.toEqual([false, true])
      expect(writes().map(([, data]) => data)).toEqual([
        `${PASTE_START}one${PASTE_END}`,
        `${PASTE_START}two${PASTE_END}`,
        '\r'
      ])
    })

    it('does not hold a send to another terminal behind one still waiting', async () => {
      const first = useTerminalStore.getState().sendToTerminalId('t1', 'one')
      const second = useTerminalStore.getState().sendToTerminalId('t2', 'two')
      await vi.advanceTimersByTimeAsync(0)
      expect(writes()).toEqual([
        ['t1', `${PASTE_START}one${PASTE_END}`],
        ['t2', `${PASTE_START}two${PASTE_END}`]
      ])

      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS + ENTER_POLL_MS)
      await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    })
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
