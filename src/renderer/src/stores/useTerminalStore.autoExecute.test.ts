// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTerminalStore } from './useTerminalStore'
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

  it('should send text then Enter with 200ms delay when autoExecute is true', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    // Execute
    const promise = useTerminalStore.getState().sendToTerminal('echo hello', true)

    // First write (text) happens immediately
    await vi.advanceTimersByTimeAsync(0)
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith('term1', 'echo hello')

    // Wait 200ms for Enter
    await vi.advanceTimersByTimeAsync(200)

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

    // Advance past the 200ms delay
    await vi.advanceTimersByTimeAsync(200)

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
    await vi.advanceTimersByTimeAsync(200)

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

    // Advance timers for all delays
    await vi.advanceTimersByTimeAsync(200)

    await Promise.all(promises)

    // Verify - 6 writes total (3 text + 3 Enter)
    expect(writeCalls.length).toBe(6)
    expect(writeCalls).toContain('first')
    expect(writeCalls).toContain('second')
    expect(writeCalls).toContain('third')
    expect(writeCalls.filter(c => c === '\r').length).toBe(3)
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
    await vi.advanceTimersByTimeAsync(200)

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
    await vi.advanceTimersByTimeAsync(200)

    const result = await promise

    // Verify - empty text, then Enter
    expect(result).toBe(true)
    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(mockWrite).toHaveBeenNthCalledWith(1, 'term1', '')
    expect(mockWrite).toHaveBeenNthCalledWith(2, 'term1', '\r')
  })

  it('should wait exactly 200ms before sending Enter', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    // Execute
    const promise = useTerminalStore.getState().sendToTerminal('test', true)

    // First write happens immediately
    await vi.advanceTimersByTimeAsync(0)
    expect(mockWrite).toHaveBeenCalledTimes(1)

    // At 199ms, Enter should NOT have been sent yet
    await vi.advanceTimersByTimeAsync(199)
    expect(mockWrite).toHaveBeenCalledTimes(1)

    // At 200ms, Enter should be sent
    await vi.advanceTimersByTimeAsync(1)
    expect(mockWrite).toHaveBeenCalledTimes(2)

    await promise
  })
})
