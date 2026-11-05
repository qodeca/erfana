// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTerminalStore } from './useTerminalStore'
import {
  ENTER_MAX_DELAY_MS,
  ENTER_MIN_DELAY_MS,
  ENTER_MIN_QUIET_MS,
  ENTER_NO_OUTPUT_DELAY_MS,
  ENTER_POLL_MS
} from './terminalInputSettle'
import type { ITerminalOperations } from '../interfaces/ITerminalOperations'

/**
 * Comprehensive test suite for sendToTerminal autoExecute functionality
 *
 * Tests the complete flow from context menu → sendToTerminal → terminal write
 * Covers error handling and 200ms delay pattern
 *
 * v0.3.4 - Simplified fire-and-forget approach (no initialization polling)
 * v0.3.6 - Updated to use dependency injection for ISP compliance
 * v0.5.3 - 200ms delay pattern: text written, then 200ms wait, then Enter
 *          This is REQUIRED - atomic writes don't work reliably with PTY
 * #449   - Enter waits until the terminal's output has gone quiet after the
 *          paste (terminalInputSettle.ts). With no output at all, as in most
 *          tests here, it goes ENTER_NO_OUTPUT_DELAY_MS after the text.
 */

// Mock terminal operations
const mockWrite = vi.fn()

const mockTerminalOps: ITerminalOperations = {
  write: mockWrite
}

// Create store instance with mocked dependencies
const useTerminalStore = createTerminalStore(mockTerminalOps)

describe('useTerminalStore.sendToTerminal with autoExecute', () => {
  beforeEach(() => {
    // Reset store state
    useTerminalStore.setState({
      activeTerminalId: null,
      activityById: new Map(),
      userInputById: new Map()
    })
    // The output times live outside store state; clearActivity drops them
    useTerminalStore.getState().clearActivity('term1')
    useTerminalStore.getState().clearActivity('term2')

    // Reset all mocks
    vi.clearAllMocks()

    // Use fake timers for 200ms delay testing
    vi.useFakeTimers()

    // Default mock implementation - write succeeds
    mockWrite.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should send text then Enter when autoExecute is true', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    // Execute
    const promise = useTerminalStore.getState().sendToTerminal('echo hello', true)

    // First write (text) happens immediately
    await vi.advanceTimersByTimeAsync(0)
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith('term1', 'echo hello')

    // No output from the terminal: Enter after the no-output delay
    await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)

    // Second write (Enter) after delay
    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(mockWrite).toHaveBeenLastCalledWith('term1', '\r')

    const result = await promise
    expect(result).toBe(true)
  })

  it('should NOT send Enter key when autoExecute is false', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('echo hello', false)

    // Verify - only text, no Enter
    expect(result).toBe(true)
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith('term1', 'echo hello')
  })

  it('should return false if no active terminal', async () => {
    // Setup - no active terminal
    useTerminalStore.setState({ activeTerminalId: null })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify
    expect(result).toBe(false)
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('should return false if text write fails', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    mockWrite.mockResolvedValue({ success: false, error: 'Write failed' })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify - fails on first write, doesn't attempt Enter
    expect(result).toBe(false)
    expect(mockWrite).toHaveBeenCalledTimes(1)
  })

  it('should return false if Enter write fails', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    // First write succeeds, second (Enter) fails
    mockWrite
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'Enter failed' })

    // Execute
    const promise = useTerminalStore.getState().sendToTerminal('test', true)

    // Advance past the Enter delay
    await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)

    const result = await promise

    // Verify - both writes attempted, but returns false due to Enter failure
    expect(result).toBe(false)
    expect(mockWrite).toHaveBeenCalledTimes(2)
  })

  it('should handle long text content correctly', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    const longText = 'x'.repeat(10000)

    // Execute
    const promise = useTerminalStore.getState().sendToTerminal(longText, true)

    // Advance timers
    await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)

    const result = await promise

    // Verify - two separate writes
    expect(result).toBe(true)
    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(mockWrite).toHaveBeenNthCalledWith(1, 'term1', longText)
    expect(mockWrite).toHaveBeenNthCalledWith(2, 'term1', '\r')
  })

  it('should handle multiple concurrent calls correctly', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    const writeCalls: string[] = []

    mockWrite.mockImplementation(async (_id: string, data: string) => {
      writeCalls.push(data)
      return { success: true }
    })

    // Execute - rapid consecutive calls
    const promises = [
      useTerminalStore.getState().sendToTerminal('first', true),
      useTerminalStore.getState().sendToTerminal('second', true),
      useTerminalStore.getState().sendToTerminal('third', true)
    ]

    // Sends to one terminal run one after another, each waiting for its own Enter
    await vi.advanceTimersByTimeAsync(3 * ENTER_NO_OUTPUT_DELAY_MS)

    await expect(Promise.all(promises)).resolves.toEqual([true, true, true])

    // Verify - each Enter right after its own text, in call order
    expect(writeCalls).toEqual(['first', '\r', 'second', '\r', 'third', '\r'])
  })

  it('should handle unexpected errors gracefully', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    mockWrite.mockRejectedValue(new Error('Unexpected IPC error'))

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify - should return false and log error
    expect(result).toBe(false)
    expect(mockWrite).toHaveBeenCalledTimes(1)
  })

  it('should use getActiveTerminalId getter', () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term123' })

    // Execute
    const id = useTerminalStore.getState().getActiveTerminalId()

    // Verify
    expect(id).toBe('term123')
  })

  it('should wrap multi-line text in bracketed paste mode with autoExecute', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    const multiLineText = 'Line 1\nLine 2\nLine 3'

    // Execute
    const promise = useTerminalStore.getState().sendToTerminal(multiLineText, true)

    // Advance timers
    await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)

    const result = await promise

    // Verify - multi-line text wrapped in bracketed paste with \n→\r, then Enter
    expect(result).toBe(true)
    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(mockWrite).toHaveBeenNthCalledWith(
      1, 'term1', '\x1b[200~Line 1\rLine 2\rLine 3\x1b[201~'
    )
    expect(mockWrite).toHaveBeenNthCalledWith(2, 'term1', '\r')
  })

  it('should wrap multi-line text in bracketed paste mode without autoExecute', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    const multiLineText = 'Line 1\nLine 2\nLine 3'

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal(multiLineText, false)

    // Verify - wrapped in bracketed paste with \n→\r, no Enter
    expect(result).toBe(true)
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(
      'term1', '\x1b[200~Line 1\rLine 2\rLine 3\x1b[201~'
    )
  })

  it('should NOT wrap single-line text in bracketed paste mode', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('single line', false)

    // Verify - single-line text sent as-is, no bracketed paste wrapping
    expect(result).toBe(true)
    expect(mockWrite).toHaveBeenCalledWith('term1', 'single line')
  })

  it('should normalize Windows line endings (\\r\\n) in bracketed paste', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    const windowsText = 'Line 1\r\nLine 2\r\nLine 3'

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal(windowsText, false)

    // Verify - \r\n converted to single \r (not double \r\r)
    expect(result).toBe(true)
    expect(mockWrite).toHaveBeenCalledWith(
      'term1', '\x1b[200~Line 1\rLine 2\rLine 3\x1b[201~'
    )
  })

  it('should handle empty string with autoExecute', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    // Execute
    const promise = useTerminalStore.getState().sendToTerminal('', true)

    // Advance timers
    await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)

    const result = await promise

    // Verify - empty text, then Enter
    expect(result).toBe(true)
    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(mockWrite).toHaveBeenNthCalledWith(1, 'term1', '')
    expect(mockWrite).toHaveBeenNthCalledWith(2, 'term1', '\r')
  })

  it('waits ENTER_NO_OUTPUT_DELAY_MS before Enter when the terminal prints nothing', async () => {
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    const promise = useTerminalStore.getState().sendToTerminal('test', true)

    await vi.advanceTimersByTimeAsync(0)
    expect(mockWrite).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS - 1)
    expect(mockWrite).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(mockWrite).toHaveBeenCalledTimes(2)

    await promise
  })

  describe('Enter waits until the paste has been taken (#449)', () => {
    /** Advance fake time to `at` ms after the send started, then note terminal output. */
    async function outputAt(at: number, elapsed: { ms: number }): Promise<void> {
      await vi.advanceTimersByTimeAsync(at - elapsed.ms)
      elapsed.ms = at
      useTerminalStore.getState().noteOutput('term1')
    }

    function enterSent(): boolean {
      return mockWrite.mock.calls.some(([, data]) => data === '\r')
    }

    it('sends Enter once the echo of a short paste has been quiet for ENTER_MIN_QUIET_MS', async () => {
      useTerminalStore.setState({ activeTerminalId: 'term1' })
      const elapsed = { ms: 0 }

      const promise = useTerminalStore.getState().sendToTerminal('Line 1\nLine 2', true)
      await outputAt(20, elapsed)

      // Quiet for less than the minimum: not yet
      await vi.advanceTimersByTimeAsync(ENTER_MIN_QUIET_MS - 1)
      expect(enterSent()).toBe(false)

      // Within one poll after the quiet time
      await vi.advanceTimersByTimeAsync(60)
      expect(enterSent()).toBe(true)
      await expect(promise).resolves.toBe(true)
    })

    it('never sends Enter sooner than ENTER_MIN_DELAY_MS, even after a quick echo', async () => {
      useTerminalStore.setState({ activeTerminalId: 'term1' })
      const elapsed = { ms: 0 }

      const promise = useTerminalStore.getState().sendToTerminal('Line 1\nLine 2', true)
      await outputAt(1, elapsed)
      await vi.advanceTimersByTimeAsync(ENTER_MIN_DELAY_MS - 2)
      expect(enterSent()).toBe(false)

      // …and once the echo is quiet it does go, within one poll of the quiet
      // time – not at a cap. (ENTER_MIN_QUIET_MS > ENTER_MIN_DELAY_MS, so the
      // quiet time, not the 200 ms floor, is what sets the moment here.)
      await vi.advanceTimersByTimeAsync(1 + ENTER_MIN_QUIET_MS - ENTER_MIN_DELAY_MS)
      expect(enterSent()).toBe(false)
      await vi.advanceTimersByTimeAsync(ENTER_POLL_MS)
      expect(enterSent()).toBe(true)
      expect(mockWrite).toHaveBeenCalledTimes(2)
      await expect(promise).resolves.toBe(true)
    })

    it('does not send Enter while a long paste is still arriving in pieces', async () => {
      // A long prompt on a busy Windows machine: ConPTY hands it over a piece
      // at a time, 600 ms apart. The old fixed 200 ms Enter landed before the
      // first piece and reached the agent together with the paste's last one.
      useTerminalStore.setState({ activeTerminalId: 'term1' })
      const elapsed = { ms: 0 }
      const longPrompt = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`).join('\n')

      const promise = useTerminalStore.getState().sendToTerminal(longPrompt, true)
      for (const at of [600, 1200, 1800, 2400]) {
        await outputAt(at, elapsed)
        expect(enterSent()).toBe(false)
      }

      // After the last piece: quiet for twice the longest pause (2 x 600 ms) first
      await vi.advanceTimersByTimeAsync(1200 - 1)
      expect(enterSent()).toBe(false)
      await vi.advanceTimersByTimeAsync(60)
      expect(enterSent()).toBe(true)

      // The paste is one write and Enter is its own write, after it
      expect(mockWrite).toHaveBeenCalledTimes(2)
      const pasteWrite = String(mockWrite.mock.calls[0][1])
      expect(pasteWrite.startsWith('\x1b[200~Line 1\r')).toBe(true)
      expect(pasteWrite.endsWith('Line 300\x1b[201~')).toBe(true)
      await expect(promise).resolves.toBe(true)
    })

    it('keeps waiting past ENTER_MAX_DELAY_MS while a very slow paste is still arriving', async () => {
      // A heavily loaded machine: one piece every 2.5 s. An 8 s cap would cut
      // in before the last piece; long pauses mean a paste, so it is waited out.
      useTerminalStore.setState({ activeTerminalId: 'term1' })
      const elapsed = { ms: 0 }

      const promise = useTerminalStore.getState().sendToTerminal('Line 1\nLine 2', true)
      for (const at of [2500, 5000, 7500, 10000]) {
        await outputAt(at, elapsed)
        expect(enterSent()).toBe(false)
      }
      // Quiet for twice the 2.5 s pause after the last piece
      await vi.advanceTimersByTimeAsync(5000 - 1)
      expect(enterSent()).toBe(false)
      await vi.advanceTimersByTimeAsync(60)
      expect(enterSent()).toBe(true)
      await expect(promise).resolves.toBe(true)
    })

    it('ignores output printed before the paste was written', async () => {
      useTerminalStore.setState({ activeTerminalId: 'term1' })
      useTerminalStore.getState().noteOutput('term1')
      await vi.advanceTimersByTimeAsync(1)

      const promise = useTerminalStore.getState().sendToTerminal('Line 1\nLine 2', true)
      // Earlier output is not the paste's echo: the no-output rule applies
      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS - 1)
      expect(enterSent()).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(enterSent()).toBe(true)
      await expect(promise).resolves.toBe(true)
    })

    it('sends Enter after ENTER_MAX_DELAY_MS when the output never goes quiet', async () => {
      // A spinner redrawing every 80 ms while the agent works
      useTerminalStore.setState({ activeTerminalId: 'term1' })
      const elapsed = { ms: 0 }

      const promise = useTerminalStore.getState().sendToTerminal('next task', true)
      while (elapsed.ms < ENTER_MAX_DELAY_MS - 80) {
        await outputAt(elapsed.ms + 80, elapsed)
        expect(enterSent()).toBe(false)
      }
      await vi.advanceTimersByTimeAsync(ENTER_MAX_DELAY_MS - elapsed.ms + 60)
      expect(enterSent()).toBe(true)
      await expect(promise).resolves.toBe(true)
    })

    it('waits on the output of the terminal it wrote to, not another one', async () => {
      useTerminalStore.setState({ activeTerminalId: 'term1' })

      const promise = useTerminalStore.getState().sendToTerminal('Line 1\nLine 2', true)
      await vi.advanceTimersByTimeAsync(20)
      useTerminalStore.getState().noteOutput('term2')

      await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS - 21)
      expect(enterSent()).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(enterSent()).toBe(true)
      await expect(promise).resolves.toBe(true)
    })
  })

  it('counts a programmatic send as recent user input for the restart and quit guards', async () => {
    // A prompt the app sends on the user's behalf starts agent work exactly as
    // typing does; the restart guard must ask before killing it.
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    const promise = useTerminalStore.getState().sendToTerminal('explain this', true)
    await vi.advanceTimersByTimeAsync(ENTER_NO_OUTPUT_DELAY_MS)
    await promise

    const state = useTerminalStore.getState()
    expect(state.userInputById.has('term1')).toBe(true)
    expect(state.isRecentlyActiveId('term1', 20_000)).toBe(true)
  })

  it('does not mark input when the write fails', async () => {
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    mockWrite.mockResolvedValue({ success: false, error: 'closed' })

    await useTerminalStore.getState().sendToTerminal('explain this', false)

    expect(useTerminalStore.getState().userInputById.has('term1')).toBe(false)
  })
})
