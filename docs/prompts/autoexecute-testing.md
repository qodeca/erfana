# AutoExecute Feature - Testing

> Part of the [Prompt Templates](./README.md) documentation. For overview, see [AutoExecute Overview](./autoexecute-overview.md).

## Table of Contents
1. [Test Coverage](#test-coverage)
2. [Mocking Strategy](#mocking-strategy)
3. [Test Results](#test-results)

---

## Test Coverage

### Test File: `useTerminalStore.autoExecute.test.ts`

**15 tests** covering core autoExecute functionality, error handling, bracketed paste and timing. The store is built with `createTerminalStore(mockTerminalOps)`, and the 200ms delay is driven with fake timers.

### Test Categories

#### 1. Basic Functionality (2 tests)
- Sends text, then Enter after 200ms, when `autoExecute=true`
- Does NOT send Enter key when `autoExecute=false`

#### 2. Error Handling (4 tests)
- Returns false if no active terminal
- Returns false if text write fails
- Returns false if Enter write fails
- Handles unexpected errors gracefully (IPC errors)

#### 3. Edge Cases (3 tests)
- Handles long text content correctly (10,000 characters)
- Handles multiple concurrent calls correctly (parallel execution)
- Handles an empty string with `autoExecute`

#### 4. Bracketed Paste (4 tests)
- Wraps multi-line text in bracketed paste mode with `autoExecute`
- Wraps multi-line text in bracketed paste mode without `autoExecute`
- Does NOT wrap single-line text
- Normalizes Windows line endings (`\r\n` becomes one `\r`)

#### 5. Timing (1 test)
- Waits exactly 200ms before sending Enter (nothing at 199ms, Enter at 200ms)

#### 6. Getters (1 test)
- `getActiveTerminalId()` returns correct terminal ID

### Representative Tests

**Send text, then Enter after the delay**
```typescript
it('should send text then Enter with 200ms delay when autoExecute is true', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })

  const promise = useTerminalStore.getState().sendToTerminal('echo hello', true)

  // First write (text) happens immediately
  await vi.advanceTimersByTimeAsync(0)
  expect(mockWrite).toHaveBeenCalledTimes(1)
  expect(mockWrite).toHaveBeenCalledWith('term1', 'echo hello')

  // Second write (Enter) after the delay
  await vi.advanceTimersByTimeAsync(200)
  expect(mockWrite).toHaveBeenCalledTimes(2)
  expect(mockWrite).toHaveBeenLastCalledWith('term1', '\r')

  expect(await promise).toBe(true)
})
```

**Text write fails**
```typescript
it('should return false if text write fails', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })
  mockWrite.mockResolvedValue({ success: false, error: 'Write failed' })

  const result = await useTerminalStore.getState().sendToTerminal('test', true)

  expect(result).toBe(false)
  expect(mockWrite).toHaveBeenCalledTimes(1) // Only text write, no Enter
})
```

**Multi-line text as one bracketed paste**
```typescript
it('should wrap multi-line text in bracketed paste mode without autoExecute', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })

  const result = await useTerminalStore.getState().sendToTerminal('Line 1\nLine 2\nLine 3', false)

  expect(result).toBe(true)
  expect(mockWrite).toHaveBeenCalledTimes(1)
  expect(mockWrite).toHaveBeenCalledWith('term1', '\x1b[200~Line 1\rLine 2\rLine 3\x1b[201~')
})
```

**Exact 200ms timing**
```typescript
it('should wait exactly 200ms before sending Enter', async () => {
  useTerminalStore.setState({ activeTerminalId: 'term1' })

  const promise = useTerminalStore.getState().sendToTerminal('test', true)

  await vi.advanceTimersByTimeAsync(0)
  expect(mockWrite).toHaveBeenCalledTimes(1)

  await vi.advanceTimersByTimeAsync(199)
  expect(mockWrite).toHaveBeenCalledTimes(1)

  await vi.advanceTimersByTimeAsync(1)
  expect(mockWrite).toHaveBeenCalledTimes(2)

  await promise
})
```

The other tests follow the same shape; read `src/renderer/src/stores/useTerminalStore.autoExecute.test.ts` for them.

---

## Mocking Strategy

### Injected terminal operations

The store takes its terminal operations as a constructor argument, so no global `window.api` mock is needed:

```typescript
const mockWrite = vi.fn()

const mockTerminalOps: ITerminalOperations = {
  write: mockWrite
}

const useTerminalStore = createTerminalStore(mockTerminalOps)
```

### Setup

```typescript
beforeEach(() => {
  useTerminalStore.setState({
    activeTerminalId: null,
    activityById: new Map(),
    userInputById: new Map()
  })
  vi.clearAllMocks()
  vi.useFakeTimers() // drives the 200ms delay
  mockWrite.mockResolvedValue({ success: true })
})

afterEach(() => {
  vi.useRealTimers()
})
```

### Simulating Failures

```typescript
// Text write fails
mockWrite.mockResolvedValue({ success: false, error: 'Write failed' })

// First call succeeds, second fails
mockWrite
  .mockResolvedValueOnce({ success: true })
  .mockResolvedValueOnce({ success: false, error: 'Enter failed' })

// Unexpected error
mockWrite.mockRejectedValue(new Error('Unexpected IPC error'))
```

### Tracking Write Order

```typescript
const writeCalls: string[] = []

mockWrite.mockImplementation(async (_id: string, data: string) => {
  writeCalls.push(data)
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

The v0.3.4 coverage snapshot, its missing-branch note and test-performance figures are archived in [AutoExecute v0.3 history](../archive/autoexecute-v0.3-history.md#coverage-results-v034).

---

## See Also

- [AutoExecute Overview](./autoexecute-overview.md) - Feature overview and architecture
- [AutoExecute Technical](./autoexecute-technical.md) - Write pipeline and 200ms delay details
- [AutoExecute Reference](./autoexecute-reference.md) - Error handling and implementation files
- [Testing Strategy](../testing/README.md) - Overall testing approach
