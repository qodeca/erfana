import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTerminalStore } from './useTerminalStore'

/**
 * Comprehensive test suite for sendToTerminal autoExecute functionality
 *
 * Tests the complete flow from context menu → sendToTerminal → terminal write
 * Covers initialization race conditions, error handling, and write ordering
 */

// Mock the window.api.terminal interface
const mockTerminalApi = {
  isAvailable: vi.fn(),
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

    // Default mock implementations
    mockTerminalApi.isAvailable.mockResolvedValue({
      success: true,
      available: true,
      initialized: true
    })
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

  it('should wait for terminal initialization before writing', async () => {
    // Setup - terminal not initialized initially
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    let callCount = 0
    mockTerminalApi.isAvailable.mockImplementation(async () => {
      callCount++
      // First 3 calls: not initialized, 4th call: initialized
      return {
        success: true,
        available: true,
        initialized: callCount >= 4
      }
    })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify
    expect(result).toBe(true)
    expect(mockTerminalApi.isAvailable).toHaveBeenCalledWith('term1')
    expect(callCount).toBeGreaterThanOrEqual(4)
    expect(mockTerminalApi.write).toHaveBeenCalledTimes(2)
  })

  it('should return false if terminal is not available', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    mockTerminalApi.isAvailable.mockResolvedValue({
      success: true,
      available: false
    })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify
    expect(result).toBe(false)
    expect(mockTerminalApi.write).not.toHaveBeenCalled()
  })

  it('should return false if no active terminal', async () => {
    // Setup - no active terminal
    useTerminalStore.setState({ activeTerminalId: null })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify
    expect(result).toBe(false)
    expect(mockTerminalApi.isAvailable).not.toHaveBeenCalled()
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

  it('should timeout and fail for autoExecute if terminal never initializes', async () => {
    // Setup - terminal never becomes initialized
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    mockTerminalApi.isAvailable.mockResolvedValue({
      success: true,
      available: true,
      initialized: false // Always false
    })

    // Execute - should timeout after 5 seconds and abort for autoExecute
    const startTime = Date.now()
    const result = await useTerminalStore.getState().sendToTerminal('test', true)
    const elapsed = Date.now() - startTime

    // Verify - should timeout around 5000ms and NOT attempt to write (abort for autoExecute)
    expect(elapsed).toBeGreaterThanOrEqual(5000)
    expect(elapsed).toBeLessThan(6000) // Some margin for processing
    expect(result).toBe(false) // Fails for autoExecute to prevent command corruption
    expect(mockTerminalApi.write).not.toHaveBeenCalled() // No writes attempted
  }, 10000) // Increase test timeout to 10 seconds

  it('should timeout but proceed for manual write if terminal never initializes', async () => {
    // Setup - terminal never becomes initialized
    useTerminalStore.setState({ activeTerminalId: 'term1' })
    mockTerminalApi.isAvailable.mockResolvedValue({
      success: true,
      available: true,
      initialized: false // Always false
    })

    // Execute - should timeout after 5 seconds but proceed for manual write
    const startTime = Date.now()
    const result = await useTerminalStore.getState().sendToTerminal('test', false)
    const elapsed = Date.now() - startTime

    // Verify - should timeout around 5000ms and still attempt to write (manual write allowed)
    expect(elapsed).toBeGreaterThanOrEqual(5000)
    expect(elapsed).toBeLessThan(6000) // Some margin for processing
    expect(result).toBe(true) // Proceeds anyway for manual writes
    expect(mockTerminalApi.write).toHaveBeenCalledTimes(1) // Only text, no Enter
  }, 10000) // Increase test timeout to 10 seconds

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

  it('should handle terminal becoming unavailable mid-operation', async () => {
    // Setup
    useTerminalStore.setState({ activeTerminalId: 'term1' })

    let isAvailableCallCount = 0
    mockTerminalApi.isAvailable.mockImplementation(async () => {
      isAvailableCallCount++
      // Becomes unavailable after first check
      return {
        success: true,
        available: isAvailableCallCount === 1,
        initialized: true
      }
    })

    // Execute
    const result = await useTerminalStore.getState().sendToTerminal('test', true)

    // Verify
    expect(result).toBe(false)
    expect(mockTerminalApi.write).not.toHaveBeenCalled()
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

    // Verify - at least 200ms between writes
    expect(timestamps.length).toBe(2)
    const timeDiff = timestamps[1] - timestamps[0]
    expect(timeDiff).toBeGreaterThanOrEqual(200)
    expect(timeDiff).toBeLessThan(300) // Reasonable upper bound
  })
})
