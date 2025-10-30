import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTerminalStore } from './useTerminalStore'

/**
 * Comprehensive test suite for sendToTerminal autoExecute functionality
 *
 * Tests the complete flow from context menu → sendToTerminal → terminal write
 * Covers error handling, write ordering, and 200ms delay for rendering
 *
 * v0.3.4 - Simplified fire-and-forget approach (no initialization polling)
 */

// Mock the window.api.terminal interface
const mockTerminalApi = {
  write: vi.fn(),
  create: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  getInfo: vi.fn(),
  list: vi.fn(),
  onData: vi.fn(),
  onExit: vi.fn(),
  onError: vi.fn(),
  onClear: vi.fn(),
  markClearComplete: vi.fn()
}

// Setup global window.api mock
;(global as unknown as { window: { api: { terminal: typeof mockTerminalApi } } }).window = {
  api: {
    terminal: mockTerminalApi
  }
}

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
    mockTerminalApi.write.mockResolvedValue({ success: true })
  })

  it('should send Enter key after text when autoExecute is true', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('echo hello', true)

    // Verify
    expect(result).toBe(true)
    expect(mockTerminalApi.write).toHaveBeenCalledTimes(2)
    expect(mockTerminalApi.write).toHaveBeenNthCalledWith(1, 'term1', 'echo hello')
    expect(mockTerminalApi.write).toHaveBeenNthCalledWith(2, 'term1', '\r')
  })

  it('should NOT send Enter key when autoExecute is false', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('echo hello', false)

    // Verify
    expect(result).toBe(true)
    expect(mockTerminalApi.write).toHaveBeenCalledTimes(1)
    expect(mockTerminalApi.write).toHaveBeenCalledWith('term1', 'echo hello')
  })

  it('should return false if no active terminal', async () => {
    // Setup - no active terminal
    useTerminalStore.setState({ activeTerminalId: null })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify
    expect(result).toBe(false)
    expect(mockTerminalApi.write).not.toHaveBeenCalled()
  })

  it('should return false if text write fails', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    mockTerminalApi.write.mockResolvedValue({ success: false, error: 'Write failed' })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify
    expect(result).toBe(false)
    expect(mockTerminalApi.write).toHaveBeenCalledTimes(1) // Only text write, no Enter
  })

  it('should return false if Enter write fails', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    mockTerminalApi.write
      .mockResolvedValueOnce({ success: true }) // Text write succeeds
      .mockResolvedValueOnce({ success: false, error: 'Enter failed' }) // Enter fails

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify
    expect(result).toBe(false)
    expect(mockTerminalApi.write).toHaveBeenCalledTimes(2)
  })

  it('should handle long text content correctly', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    const longText = 'x'.repeat(10000)

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal(longText, true)

    // Verify
    expect(result).toBe(true)
    expect(mockTerminalApi.write).toHaveBeenCalledTimes(2)
    expect(mockTerminalApi.write).toHaveBeenNthCalledWith(1, 'term1', longText)
    expect(mockTerminalApi.write).toHaveBeenNthCalledWith(2, 'term1', '\r')
  })

  it('should handle multiple concurrent calls correctly', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    const writeOrder: string[] = []

    mockTerminalApi.write.mockImplementation(async (_id: string, data: string) => {
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

    mockTerminalApi.write.mockImplementation(async () => {
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
    mockTerminalApi.write.mockRejectedValue(new Error('Unexpected IPC error'))

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify - should return false and log error
    expect(result).toBe(false)
    expect(mockTerminalApi.write).toHaveBeenCalledTimes(1) // Only attempted text write
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
