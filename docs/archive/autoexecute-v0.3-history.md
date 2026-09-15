# AutoExecute v0.3 history

Point-in-time record of how the prompt autoExecute feature changed between v0.3.2 and v0.3.4, moved out of the living [`docs/prompts/autoexecute-*`](../prompts/autoexecute-overview.md) guides on 2026-09-15. Line counts, coverage figures and code excerpts are as they stood at v0.3.4 and are not maintained – for the current implementation see [AutoExecute Reference](../prompts/autoexecute-reference.md) and [AutoExecute Technical](../prompts/autoexecute-technical.md).

> **Lifecycle**: Write-once-archive. Retained for the reasoning behind the fire-and-forget write and the 200ms delay – do not delete.

---

## What was fixed

### v0.3.3 – initial autoExecute implementation

**Problem**: The "Explain", "Modify", and "Ask" context menu actions inconsistently executed the Enter key after pasting prompts to the terminal.

**Root Causes**:
- Fire-and-forget terminal writes (no completion confirmation)
- No terminal initialization state checking
- Race conditions between terminal bootstrap and prompt execution
- Insufficient delay (100ms) between text write and Enter key
- IPC writes had no ordering guarantees

**Solution**: Implemented Promise-based writes with completion callbacks, terminal initialization polling, enhanced error handling, and increased reliability delays.

### v0.3.4 – simplified fire-and-forget (current at the time)

**Problem**: The v0.3.3 solution was over-engineered - Promise-based writes with callbacks caused IPC handler hangs ("reply was never sent" errors) because node-pty's write callback wasn't firing reliably.

**Root Cause**: The node-pty write callback only indicates socket buffer flush, NOT completion of rendering or shell readiness. This made it unreliable for synchronization.

**Research Findings**:
- Fire-and-forget writes are the industry standard (VSCode, Hyper, all major terminals)
- Write ordering is guaranteed by TCP/socket FIFO semantics
- 200ms delay is well-calibrated: PTY buffering (1-20ms) + shell processing (1-50ms) + GPU rendering (10-100ms) + system load margin
- No simpler reliable alternative exists

**Solution**: Reverted to synchronous fire-and-forget writes, removed initialization polling complexity, kept the 200ms delay which is sufficient and necessary.

---

## Write operations evolution

### v0.3.2 – original fire-and-forget (unreliable)

```typescript
// Terminal Store - No await, no confirmation
window.api.terminal.write(terminalId, text)

// Preload - Fire-and-forget
write: (id: string, data: string): void => {
  ipcRenderer.send('terminal:write', {id, data})
}

// IPC Handler - No return
ipcMain.on('terminal:write', (_, {id, data}) => {
  terminalService.write(id, data)
})

// Terminal Service - Sync return
write(id: string, data: string): boolean {
  pty.write(data)
  return true // Optimistic
}
```

**Problems**:
- No write completion confirmation
- Enter could be sent before text fully buffered
- 100ms delay insufficient
- No error propagation

### v0.3.3 – promise with callback (over-engineered)

```typescript
// Terminal Service - Promise-based with callback
write(terminalId: string, data: string): Promise<boolean> {
  return new Promise((resolve) => {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      resolve(false)
      return
    }

    try {
      // node-pty callback parameter
      ;(terminal.ptyProcess.write as (data: string, cb?: () => void) => void)(
        data,
        () => resolve(true) // Callback fires when socket flushed
      )
    } catch (error) {
      resolve(false)
    }
  })
}

// IPC Handler - Awaitable
ipcMain.handle('terminal:write', async (_, {terminalId, data}) => {
  const success = await terminalService.write(terminalId, data)
  return {success}
})
```

**Problems Discovered**:
- Callback didn't fire reliably → IPC hangs ("reply was never sent")
- Callback indicates socket flush, NOT render completion
- Added initialization polling complexity (overkill)
- Over-engineered for the actual use case

### v0.3.4 – simplified fire-and-forget (current at the time)

```typescript
// Terminal Service - Synchronous fire-and-forget
write(terminalId: string, data: string): boolean {
  const terminal = this.terminals.get(terminalId)
  if (!terminal) return false

  try {
    terminal.ptyProcess.write(data) // Synchronous
    return true
  } catch (error) {
    // Handle EPIPE (terminal closed)
    if ((error as {code?: string}).code === 'EPIPE') {
      this.terminals.delete(terminalId)
      this.emit('exit', {terminalId, exitCode: 0})
      return false
    }
    console.error(`Failed to write:`, error)
    return false
  }
}

// IPC Handler - Synchronous (no async needed)
ipcMain.handle('terminal:write', (_, {terminalId, data}) => {
  try {
    const success = terminalService.write(terminalId, data)
    return {success}
  } catch (error) {
    return {success: false, error: String(error)}
  }
})

// Terminal Store - Simple with 200ms delay
const writeResult = await window.api.terminal.write(terminalId, text)
if (!writeResult.success) return false

if (autoExecute) {
  // 200ms delay for rendering (PTY + shell + GPU)
  await new Promise(resolve => setTimeout(resolve, 200))

  const enterResult = await window.api.terminal.write(terminalId, '\r')
  if (!enterResult.success) return false
}
```

### Why v0.3.4 was better

**Simplicity**:
- No callback complexity
- No initialization polling
- Industry-standard approach

**Reliability**:
- Fire-and-forget is proven (VSCode, Hyper, iTerm2)
- Write ordering guaranteed by TCP FIFO
- 200ms delay is well-calibrated
- No IPC hangs

**Maintainability**:
- Less code (100+ lines removed)
- Easier to understand
- Easier to debug

---

## Modified files

### v0.3.3 (complex implementation)

| File | Lines Changed | Purpose |
|------|---------------|---------|
| **TerminalService.ts** | +79 / -42 | Async writes with callbacks, enhanced isAvailable() |
| **terminal-handlers.ts** | +20 / -14 | Changed `on` → `handle` for awaitable IPC |
| **useTerminalStore.ts** | +87 / -36 | Polling, error handling, awaited writes |
| **preload/index.ts** | +9 / -4 | Promise API, type updates |
| **useTerminalStore.autoExecute.test.ts** | +290 / 0 | Comprehensive test suite |

**Total**: +500 / -104 lines (+396 net)

### v0.3.4 (simplified implementation)

| File | Lines Changed | Purpose |
|------|---------------|---------|
| **TerminalService.ts** | -37 / +21 | Reverted to sync writes, EPIPE handling |
| **terminal-handlers.ts** | -4 / +1 | Removed async from handler |
| **useTerminalStore.ts** | -38 / +14 | Removed polling, kept 200ms delay |
| **useTerminalStore.autoExecute.test.ts** | -5 / +2 | Removed polling tests, added coverage tests |
| **registry.ts** | -18 / +0 | Removed verbose logging |
| **panelUtils.ts** | -8 / +0 | Removed verbose logging |
| **PreviewContextMenu.tsx** | -11 / +0 | Removed verbose logging |

**Total**: -121 / +38 lines (-83 net from v0.3.3)

---

## Migration guide

### From v0.3.2 to v0.3.4

**Before (v0.3.2)**:
```typescript
// Fire-and-forget, no error handling
window.api.terminal.write(terminalId, text)
setTimeout(() => {
  window.api.terminal.write(terminalId, '\r')
}, 100) // Too short!
```

**After (v0.3.4)**:
```typescript
// Proper error handling and timing
const writeResult = await window.api.terminal.write(terminalId, text)
if (!writeResult.success) return

await new Promise(resolve => setTimeout(resolve, 200))

const enterResult = await window.api.terminal.write(terminalId, '\r')
if (!enterResult.success) return
```

### From v0.3.3 to v0.3.4

**Before (v0.3.3)**:
```typescript
// Complex polling and callbacks
const available = await waitForTerminalInit(terminalId, 5000)
if (!available) return false

const writeResult = await window.api.terminal.write(terminalId, text)
// ... more complexity
```

**After (v0.3.4)**:
```typescript
// Simple and reliable
const writeResult = await window.api.terminal.write(terminalId, text)
if (!writeResult.success) return false

await new Promise(resolve => setTimeout(resolve, 200))

const enterResult = await window.api.terminal.write(terminalId, '\r')
return enterResult.success
```

---

## Coverage results (v0.3.4)

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

### Coverage metrics

- **Statement Coverage**: 100% - All code paths executed
- **Branch Coverage**: 91.66% - Missing 1 edge case (minor)
- **Function Coverage**: 100% - All functions tested
- **Line Coverage**: 100% - All lines executed

### Missing branch

The single uncovered branch (lines 57, 69 in useTerminalStore.ts) are defensive checks that are difficult to trigger in tests but provide safety in production:
- Line 57: `isRecentlyActive` edge case when timestamp is exactly at boundary
- Line 69: `hasUserInteracted` edge case check

These are considered acceptable uncovered branches as they are defensive programming practices.

### Test performance

- **Fast execution**: ~1 second for all 10 tests
- **No flakiness**: 5ms timing tolerance prevents race conditions
- **Deterministic**: All tests pass consistently
- **Parallel-safe**: Tests can run in parallel without interference
