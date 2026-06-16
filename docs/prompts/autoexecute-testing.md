# AutoExecute Feature - Testing

> Part of the [Prompt Templates](./README.md) documentation. For overview, see [AutoExecute Overview](./autoexecute-overview.md).

## Table of Contents
1. [Test Coverage](#test-coverage)
2. [Mocking Strategy](#mocking-strategy)
3. [Test Results](#test-results)

---

## Test Coverage

### Test File: `useTerminalStore.autoExecute.test.ts`

**10 focused tests** covering core autoExecute functionality, error handling, and timing (v0.3.4 simplified).

### Test Categories

#### 1. Basic Functionality (2 tests)
- ✅ Sends Enter key after text when `autoExecute=true`
- ✅ Does NOT send Enter key when `autoExecute=false`

#### 2. Error Handling (4 tests)
- ✅ Returns false if no active terminal
- ✅ Returns false if text write fails
- ✅ Returns false if Enter write fails
- ✅ Handles unexpected errors gracefully (IPC errors)

#### 3. Edge Cases (3 tests)
- ✅ Handles long text content correctly (10,000 characters)
- ✅ Handles multiple concurrent calls correctly (parallel execution)
- ✅ Waits 200ms between text write and Enter key (timing validation)

#### 4. Getters (1 test)
- ✅ getActiveTerminalId() returns correct terminal ID

### Detailed Test Descriptions

**Test 1: Send Enter key with autoExecute**
```typescript
it('should send Enter key after text when autoExecute is true', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })

  const result = await useTerminalStore.getState().sendToTerminal('echo hello', true)

  expect(result).toBe(true)
  expect(mockTerminalApi.write).toHaveBeenCalledTimes(2)
  expect(mockTerminalApi.write).toHaveBeenNthCalledWith(1, 'term1', 'echo hello')
  expect(mockTerminalApi.write).toHaveBeenNthCalledWith(2, 'term1', '\r')
})
```

**Test 2: No Enter key without autoExecute**
```typescript
it('should NOT send Enter key when autoExecute is false', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })

  const result = await useTerminalStore.getState().sendToTerminal('echo hello', false)

  expect(result).toBe(true)
  expect(mockTerminalApi.write).toHaveBeenCalledTimes(1)
  expect(mockTerminalApi.write).toHaveBeenCalledWith('term1', 'echo hello')
})
```

**Test 3: No active terminal**
```typescript
it('should return false if no active terminal', async () => {
  useTerminalStore.setState({ activeTerminalId: null })

  const result = await useTerminalStore.getState().sendToTerminal('test', true)

  expect(result).toBe(false)
  expect(mockTerminalApi.write).not.toHaveBeenCalled()
})
```

**Test 4: Text write fails**
```typescript
it('should return false if text write fails', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })
  mockTerminalApi.write.mockResolvedValue({ success: false, error: 'Write failed' })

  const result = await useTerminalStore.getState().sendToTerminal('test', true)

  expect(result).toBe(false)
  expect(mockTerminalApi.write).toHaveBeenCalledTimes(1) // Only text write, no Enter
})
```

**Test 5: Enter write fails**
```typescript
it('should return false if Enter write fails', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })
  mockTerminalApi.write
    .mockResolvedValueOnce({ success: true }) // Text write succeeds
    .mockResolvedValueOnce({ success: false, error: 'Enter failed' }) // Enter fails

  const result = await useTerminalStore.getState().sendToTerminal('test', true)

  expect(result).toBe(false)
  expect(mockTerminalApi.write).toHaveBeenCalledTimes(2)
})
```

**Test 6: Long text content**
```typescript
it('should handle long text content correctly', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })
  const longText = 'x'.repeat(10000)

  const result = await useTerminalStore.getState().sendToTerminal(longText, true)

  expect(result).toBe(true)
  expect(mockTerminalApi.write).toHaveBeenCalledTimes(2)
  expect(mockTerminalApi.write).toHaveBeenNthCalledWith(1, 'term1', longText)
  expect(mockTerminalApi.write).toHaveBeenNthCalledWith(2, 'term1', '\r')
})
```

**Test 7: Concurrent calls**
```typescript
it('should handle multiple concurrent calls correctly', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })
  const writeOrder: string[] = []

  mockTerminalApi.write.mockImplementation(async (_id: string, data: string) => {
    writeOrder.push(data)
    return { success: true }
  })

  const promises = [
    useTerminalStore.getState().sendToTerminal('first', true),
    useTerminalStore.getState().sendToTerminal('second', true),
    useTerminalStore.getState().sendToTerminal('third', true)
  ]

  await Promise.all(promises)

  expect(writeOrder.length).toBe(6) // 3 texts + 3 enters
})
```

**Test 8: 200ms timing validation**
```typescript
it('should wait 200ms between text write and Enter key', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })
  const timestamps: number[] = []

  mockTerminalApi.write.mockImplementation(async () => {
    timestamps.push(Date.now())
    return { success: true }
  })

  await useTerminalStore.getState().sendToTerminal('test', true)

  const timeDiff = timestamps[1] - timestamps[0]
  expect(timeDiff).toBeGreaterThanOrEqual(195) // 5ms tolerance
  expect(timeDiff).toBeLessThan(300)
})
```

**Test 9: Unexpected errors**
```typescript
it('should handle unexpected errors gracefully', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })
  mockTerminalApi.write.mockRejectedValue(new Error('Unexpected IPC error'))

  const result = await useTerminalStore.getState().sendToTerminal('test', true)

  expect(result).toBe(false)
  expect(mockTerminalApi.write).toHaveBeenCalledTimes(1)
})
```

**Test 10: getActiveTerminalId getter**
```typescript
it('should use getActiveTerminalId getter', () => {
  useTerminalStore.setState({ activeTerminalId: 'term123' })

  const id = useTerminalStore.getState().getActiveTerminalId()

  expect(id).toBe('term123')
})
```

---

## Mocking Strategy

### Mock PTY API

**Setup** (`useTerminalStore.autoExecute.test.ts:14-33`)

```typescript
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
```

### Realistic Implementations

**Default Success Behavior**:
```typescript
beforeEach(() => {
  // Reset all mocks
  vi.clearAllMocks()

  // Default mock implementation - write succeeds
  mockTerminalApi.write.mockResolvedValue({ success: true })
})
```

**Simulating Failures**:
```typescript
// Text write fails
mockTerminalApi.write.mockResolvedValue({
  success: false,
  error: 'Write failed'
})

// First call succeeds, second fails
mockTerminalApi.write
  .mockResolvedValueOnce({ success: true })
  .mockResolvedValueOnce({ success: false, error: 'Enter failed' })

// Unexpected error
mockTerminalApi.write.mockRejectedValue(new Error('IPC error'))
```

**Tracking Write Order**:
```typescript
const writeOrder: string[] = []

mockTerminalApi.write.mockImplementation(async (_id: string, data: string) => {
  writeOrder.push(data)
  return { success: true }
})
```

**Timing Validation**:
```typescript
const timestamps: number[] = []

mockTerminalApi.write.mockImplementation(async () => {
  timestamps.push(Date.now())
  return { success: true }
})
```

---

## Test Results

### Running Tests

```bash
# Run all tests
npm run test

# Run specific test file
npm run test:renderer -- useTerminalStore.autoExecute

# Run with coverage
npm run test:cov
```

### Coverage Results (v0.3.4)

```
File: useTerminalStore.ts
-------------------------
Statements:   100% (39/39)
Branches:     91.66% (11/12)
Functions:    100% (12/12)
Lines:        100% (39/39)

Test Results:
-------------
Test Files:  1 passed (1)
Tests:       10 passed (10)
Duration:    ~1 second
```

### Coverage Metrics

- **Statement Coverage**: 100% - All code paths executed
- **Branch Coverage**: 91.66% - Missing 1 edge case (minor)
- **Function Coverage**: 100% - All functions tested
- **Line Coverage**: 100% - All lines executed

### Missing Branch

The single uncovered branch (lines 57, 69 in useTerminalStore.ts) are defensive checks that are difficult to trigger in tests but provide safety in production:
- Line 57: `isRecentlyActive` edge case when timestamp is exactly at boundary
- Line 69: `hasUserInteracted` edge case check

These are considered acceptable uncovered branches as they are defensive programming practices.

### Test Performance

- **Fast execution**: ~1 second for all 10 tests
- **No flakiness**: 5ms timing tolerance prevents race conditions
- **Deterministic**: All tests pass consistently
- **Parallel-safe**: Tests can run in parallel without interference

---

## See Also

- [AutoExecute Overview](./autoexecute-overview.md) - Feature overview and architecture
- [AutoExecute Technical](./autoexecute-technical.md) - Write pipeline and 200ms delay details
- [AutoExecute Reference](./autoexecute-reference.md) - Error handling and implementation files
- [Testing Strategy](../testing/README.md) - Overall testing approach
