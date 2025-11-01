import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTerminalStore } from './useTerminalStore'
import type { ITerminalOperations } from '../interfaces/ITerminalOperations'

/**
 * Comprehensive test suite for sendToTerminal autoExecute functionality
 *
 * Tests the complete flow from context menu → sendToTerminal → terminal write
 * Covers error handling, write ordering, and 200ms delay for rendering
 *
 * v0.3.4 - Simplified fire-and-forget approach (no initialization polling)
 * v0.3.6 - Updated to use dependency injection for ISP compliance
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

    // Default mock implementation - write succeeds
    mockWrite.mockResolvedValue({ success: true })
  })

  it('should send Enter key after text when autoExecute is true', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('echo hello', true)

    // Verify
    expect(result).toBe(true)
    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(mockWrite).toHaveBeenNthCalledWith(1, 'term1', 'echo hello')
    expect(mockWrite).toHaveBeenNthCalledWith(2, 'term1', '\r')
  })

  it('should NOT send Enter key when autoExecute is false', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('echo hello', false)

    // Verify
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

    // Verify
    expect(result).toBe(false)
    expect(mockWrite).toHaveBeenCalledTimes(1) // Only text write, no Enter
  })

  it('should return false if Enter write fails', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    mockWrite
      .mockResolvedValueOnce({ success: true }) // Text write succeeds
      .mockResolvedValueOnce({ success: false, error: 'Enter failed' }) // Enter fails

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify
    expect(result).toBe(false)
    expect(mockWrite).toHaveBeenCalledTimes(2)
  })

  it('should handle long text content correctly', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    const longText = 'x'.repeat(10000)

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal(longText, true)

    // Verify
    expect(result).toBe(true)
    expect(mockWrite).toHaveBeenCalledTimes(2)
    expect(mockWrite).toHaveBeenNthCalledWith(1, 'term1', longText)
    expect(mockWrite).toHaveBeenNthCalledWith(2, 'term1', '\r')
  })

  it('should handle multiple concurrent calls correctly', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    const writeOrder: string[] = []

    mockWrite.mockImplementation(async (_id: string, data: string) => {
      writeOrder.push(data)
      return { success: true }
    })

    // Execute - rapid consecutive calls (will run in parallel)
    const promises = [
      useTerminalStore.getState().sendToTerminal('first', true),
      useTerminalStore.getState().sendToTerminal('second', true),
      useTerminalStore.getState().sendToTerminal('third', true)
    ]

    await Promise.all(promises)

    // Verify - all writes completed (parallel calls will interleave)
    expect(writeOrder.length).toBe(6) // 3 texts + 3 enters
    expect(writeOrder.filter(w => w === 'first').length).toBe(1)
    expect(writeOrder.filter(w => w === 'second').length).toBe(1)
    expect(writeOrder.filter(w => w === 'third').length).toBe(1)
    expect(writeOrder.filter(w => w === '\r').length).toBe(3)
  })

  it('should wait 200ms between text write and Enter key', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    const timestamps: number[] = []

    mockWrite.mockImplementation(async () => {
      timestamps.push(Date.now())
      return { success: true }
    })

    // Execute
    await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify - approximately 200ms between writes (allow 5ms tolerance for timing variations)
    expect(timestamps.length).toBe(2)
    const timeDiff = timestamps[1] - timestamps[0]
    expect(timeDiff).toBeGreaterThanOrEqual(195) // 5ms tolerance for setTimeout precision
    expect(timeDiff).toBeLessThan(300) // Reasonable upper bound
  })

  it('should handle unexpected errors gracefully', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    mockWrite.mockRejectedValue(new Error('Unexpected IPC error'))

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify - should return false and log error
    expect(result).toBe(false)
    expect(mockWrite).toHaveBeenCalledTimes(1) // Only attempted text write
  })

  it('should use getActiveTerminalId getter', () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term123' })

    // Execute
    const id = useTerminalStore.getState().getActiveTerminalId()

    // Verify
    expect(id).toBe('term123')
  })
})
