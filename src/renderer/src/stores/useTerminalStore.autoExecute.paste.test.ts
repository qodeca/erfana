// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTerminalStore } from './useTerminalStore'
import {
  ENTER_MIN_QUIET_MS,
  ENTER_NO_OUTPUT_DELAY_MS,
  ENTER_POLL_MS
} from './terminalInputSettle'
import type { ITerminalOperations } from '../interfaces/ITerminalOperations'

/**
 * sendToTerminal with autoExecute against the terminals #449 was about: a long
 * paste the program takes ~1 KiB at a time (Windows ConPTY), a plain shell, a
 * terminal that goes away while Enter is waiting, and two sends at once.
 *
 * Split from useTerminalStore.autoExecute.test.ts, which is near its size
 * limit; same store-with-mocked-write setup.
 */

const mockWrite = vi.fn()
const mockTerminalOps: ITerminalOperations = { write: mockWrite }
const useTerminalStore = createTerminalStore(mockTerminalOps)

/** Every write as `[terminalId, data]`, in order. */
function writes(): Array<[string, string]> {
  return mockWrite.mock.calls.map(([id, data]) => [String(id), String(data)])
}

function enterCount(terminalId = 'term1'): number {
  return writes().filter(([id, data]) => id === terminalId && data === '\r').length
}

describe('useTerminalStore.sendToTerminal autoExecute – paste delivery (#449)', () => {
  beforeEach(() => {
    useTerminalStore.setState({ activeTerminalId: null, activityById: new Map(), userInputById: new Map() })
    useTerminalStore.getState().clearActivity('term1')
    useTerminalStore.getState().clearActivity('term2')
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockWrite.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('a paste larger than 10 KB taken ~1 KiB per read', () => {
    const CHUNK = 1024
    // 180 lines of ~62 characters: about 11 KB once wrapped
    const longPrompt = Array.from(
      { length: 180 },
      (_, i) => `Line ${String(i + 1).padStart(3, '0')} of a long selection sent to the agent as one prompt.`
    ).join('\n')

    it('sends exactly one Enter, only after the last 1 KiB piece has been echoed and gone quiet', async () => {
      useTerminalStore.setState({ activeTerminalId: 'term1' })
      const pasteLength = `\x1b[200~${longPrompt.replace(/\n/g, '\r')}\x1b[201~`.length
      expect(pasteLength).toBeGreaterThan(10_000)
      const pieces = Math.ceil(pasteLength / CHUNK)

      const promise = useTerminalStore.getState().sendToTerminal(longPrompt, true)

      // The program redraws as it takes each piece, 90 ms apart – slower than
      // the old fixed 200 ms Enter for the whole paste
      for (let i = 1; i <= pieces; i++) {
        await vi.advanceTimersByTimeAsync(90)
        useTerminalStore.getState().noteOutput('term1')
        expect(enterCount(), `Enter sent while piece ${i} of ${pieces} was still being taken`).toBe(0)
      }

      // Quiet for ENTER_MIN_QUIET_MS (the pauses were shorter), then within one poll
      await vi.advanceTimersByTimeAsync(ENTER_MIN_QUIET_MS - 1)
      expect(enterCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(ENTER_POLL_MS)
      expect(enterCount()).toBe(1)

      await expect(promise).resolves.toBe(true)
      // The paste is one whole write and Enter is the only other one
      expect(writes()).toHaveLength(2)
      expect(writes()[0][1]).toHaveLength(pasteLength)
      expect(writes()[0][1].endsWith('\x1b[201~')).toBe(true)
      expect(writes()[1]).toEqual(['term1', '\r'])
    })

    it('waits out a stall in the middle of the paste (2 × the stall) before Enter', async () => {
      // A loaded host: pieces every 80 ms, but one 350 ms stall halfway. The
      // stall is shorter than ENTER_MIN_QUIET_MS, so it does not end the wait
      // by itself; it then sets the quiet time after the last piece to 700 ms.
      useTerminalStore.setState({ activeTerminalId: 'term1' })
      const promise = useTerminalStore.getState().sendToTerminal(longPrompt, true)
      const gaps = [80, 80, 80, 80, 80, 350, 80, 80, 80, 80, 80]
      for (const gap of gaps) {
        await vi.advanceTimersByTimeAsync(gap)
        useTerminalStore.getState().noteOutput('term1')
        expect(enterCount()).toBe(0)
      }

      // ENTER_MIN_QUIET_MS of quiet is not enough after the stall: 2 x 350 ms is
      await vi.advanceTimersByTimeAsync(2 * 350 - ENTER_POLL_MS)
      expect(enterCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(2 * ENTER_POLL_MS)
      expect(enterCount()).toBe(1)
      await expect(promise).resolves.toBe(true)
    })
  })

  describe('a plain shell without bracketed paste', () => {
    it('sends a single-line command as-is, then exactly one Enter after the echo settles', async () => {
      useTerminalStore.setState({ activeTerminalId: 'term1' })

      const promise = useTerminalStore.getState().sendToTerminal('ls -la', true)
      // The shell echoes the typed characters in two bursts
      for (const gap of [10, 10]) {
        await vi.advanceTimersByTimeAsync(gap)
        useTerminalStore.getState().noteOutput('term1')
      }
      await vi.advanceTimersByTimeAsync(ENTER_MIN_QUIET_MS + ENTER_POLL_MS)

      await expect(promise).resolves.toBe(true)
      // No paste markers a plain shell would print as junk, and no extra carriage return
      expect(writes()).toEqual([
        ['term1', 'ls -la'],
        ['term1', '\r']
      ])
    })

    it('still sends exactly one Enter when the shell prints nothing back', async () => {
      useTerminalStore.setState({ activeTerminalId: 'term1' })

      const promise = useTerminalStore.getState().sendToTerminal('ls -la', true)
      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)

      await expect(promise).resolves.toBe(true)
      expect(enterCount()).toBe(1)
      // Nothing more is written later
      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)
      expect(writes()).toHaveLength(2)
    })
  })

  describe('the terminal closes while Enter is waiting', () => {
    it('returns false and sends no Enter to the terminal that replaced it', async () => {
      useTerminalStore.setState({ activeTerminalId: 'term1' })
      // Main answers "no such terminal" for writes to the one that exited
      mockWrite.mockImplementation(async (id: string) =>
        id === 'term1' && mockWrite.mock.calls.length > 1
          ? { success: false, error: 'Terminal not found' }
          : { success: true }
      )

      const promise = useTerminalStore.getState().sendToTerminal('Line 1\nLine 2', true)
      await vi.advanceTimersByTimeAsync(20)
      useTerminalStore.getState().noteOutput('term1')

      // The agent exits mid-wait; the panel starts a new shell
      await vi.advanceTimersByTimeAsync(100)
      useTerminalStore.getState().clearActivity('term1')
      useTerminalStore.setState({ activeTerminalId: 'term2' })
      useTerminalStore.getState().noteOutput('term2')

      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)
      await expect(promise).resolves.toBe(false)

      // The new terminal got nothing from this send, and the old one took no Enter
      expect(writes().filter(([id]) => id === 'term2')).toEqual([])
      expect(mockWrite).toHaveBeenCalledTimes(2)
      await expect(mockWrite.mock.results[1].value).resolves.toMatchObject({ success: false })
    })
  })

  describe('two sends at once', () => {
    // Sends to one terminal are queued (useTerminalStore sendQueueById): without
    // the queue the writes were [paste 1, paste 2, Enter, Enter].
    it('never lets the second paste land between the first paste and its Enter', async () => {
      // A second prompt command fired while the first one's Enter is waiting.
      // If its paste reaches the prompt box first, the first Enter submits
      // both prompts as one, and the second Enter submits an empty prompt.
      useTerminalStore.setState({ activeTerminalId: 'term1' })

      const first = useTerminalStore.getState().sendToTerminal('Explain\nthis', true)
      await vi.advanceTimersByTimeAsync(50)
      const second = useTerminalStore.getState().sendToTerminal('Ask\nthat', true)

      await vi.advanceTimersByTimeAsync(2 * ENTER_NO_OUTPUT_DELAY_MS)
      await expect(Promise.all([first, second])).resolves.toEqual([true, true])

      expect(writes().map(([, data]) => data)).toEqual([
        '\x1b[200~Explain\rthis\x1b[201~',
        '\r',
        '\x1b[200~Ask\rthat\x1b[201~',
        '\r'
      ])
    })
  })
})
