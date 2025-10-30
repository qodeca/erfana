# Prompt Templates Implementation Guide

## Table of Contents
1. [Overview & Architecture](#overview--architecture)
2. [AutoExecute Feature](#autoexecute-feature)
3. [Terminal Write Pipeline](#terminal-write-pipeline)
4. [Initialization Polling Pattern](#initialization-polling-pattern)
5. [Promise-Based Write Operations](#promise-based-write-operations)
6. [Error Handling Strategies](#error-handling-strategies)
7. [Race Condition Prevention](#race-condition-prevention)
8. [Test Coverage](#test-coverage)
9. [Implementation Files Reference](#implementation-files-reference)
10. [Related Documentation](#related-documentation)

---

## Overview & Architecture

The prompt template system enables AI-powered text operations through context menu actions. This guide documents the technical implementation of the **autoExecute feature**, which automatically presses Enter after pasting a prompt into the terminal.

### What Was Fixed (v0.3.3)

**Problem**: The "Elaborate", "Modify", and "Ask" context menu actions inconsistently executed the Enter key after pasting prompts to the terminal.

**Root Causes**:
- Fire-and-forget terminal writes (no completion confirmation)
- No terminal initialization state checking
- Race conditions between terminal bootstrap and prompt execution
- Insufficient delay (100ms) between text write and Enter key
- IPC writes had no ordering guarantees

**Solution**: Implemented Promise-based writes with completion callbacks, terminal initialization polling, enhanced error handling, and increased reliability delays.

### Key Architectural Changes

| Layer | Before | After |
|-------|--------|-------|
| **TerminalService** | Sync writes | Async writes with callbacks |
| **IPC Handlers** | `ipcMain.on` (fire-and-forget) | `ipcMain.handle` (awaitable) |
| **Preload Bridge** | Void return | Promise<{success, error}> |
| **Terminal Store** | No state checking, 100ms delay | Polling (5s max), 200ms delay |

---

## AutoExecute Feature

### What It Does

When `autoExecute: true` is set in a prompt template's YAML frontmatter, the system:
1. Pastes the rendered prompt text into the active terminal
2. Waits for write completion
3. Waits 200ms for text rendering
4. Sends Enter key (`\r`) to execute the command

### When to Use

**Use autoExecute for**:
- Trusted, read-only operations (e.g., "Explain this code")
- Safe commands that don't modify files
- Operations where immediate execution is expected

**Don't use autoExecute for**:
- Destructive operations (delete, modify files)
- Commands that require user review before execution
- Multi-step processes requiring user input

### Configuration

In template YAML frontmatter:

```yaml
---
id: elaborate-selection
label: Elaborate
autoExecute: true  # ← Enables automatic Enter key press
---
```

### User Experience

**With autoExecute (true)**:
1. User selects text in preview
2. User right-clicks → "Elaborate"
3. Prompt appears in terminal **and executes immediately**
4. Claude/AI tool processes the request

**Without autoExecute (false)**:
1. User selects text in preview
2. User right-clicks → template action
3. Prompt appears in terminal **but waits**
4. User reviews command
5. User manually presses Enter

---

## Terminal Write Pipeline

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Interaction                              │
│  (Right-click in preview → Select template action)               │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              PreviewContextMenu.tsx                              │
│  - Retrieve template config from PROMPT_REGISTRY                │
│  - Render template with variables (selectedText, filePath, etc.)│
│  - Call executePromptTemplate(config.id, variables)             │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              utils/panelUtils.ts                                 │
│  - openPanelAndSendContent(rendered, autoExecute)               │
│  - Wait 100ms for panel initialization                          │
│  - Call sendToTerminal(content, autoExecute)                    │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│         stores/useTerminalStore.ts                               │
│  - sendToTerminal(text, autoExecute)                            │
│  - Poll terminal initialization (5s max, 50ms intervals)        │
│  - AWAIT window.api.terminal.write(terminalId, text)            │
│  - If autoExecute: wait 200ms                                   │
│  - If autoExecute: AWAIT window.api.terminal.write(id, '\r')    │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  preload/index.ts                                │
│  - window.api.terminal.write(terminalId, data)                  │
│  - ipcRenderer.invoke('terminal:write', {terminalId, data})     │
│  - Returns: Promise<{success: boolean, error?: string}>         │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│            main/ipc/terminal-handlers.ts                         │
│  - ipcMain.handle('terminal:write', async (_, {id, data}) => {  │
│  -   const success = await terminalService.write(id, data)      │
│  -   return {success}                                           │
│  - })                                                           │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│          main/services/TerminalService.ts                        │
│  - write(terminalId, data): Promise<boolean>                    │
│  - ptyProcess.write(data, callback)  ← node-pty API            │
│  - Callback resolves promise when write completes               │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PTY Process                                 │
│  - Data written to pseudo-terminal                              │
│  - Shell receives and displays text                             │
│  - (If autoExecute) Enter key executes command                  │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

**Context Menu** (`PreviewContextMenu.tsx`)
- Triggers template execution
- Passes template config (includes `autoExecute`)

**Panel Utils** (`utils/panelUtils.ts`)
- Ensures terminal panel is visible
- 100ms wait for panel initialization
- Delegates to terminal store

**Terminal Store** (`stores/useTerminalStore.ts`)
- **CRITICAL LAYER**: Handles initialization polling and write coordination
- Polls terminal state before writes
- Awaits both text write and Enter key write
- Implements error handling strategies

**Preload Bridge** (`preload/index.ts`)
- Exposes async API to renderer
- Type-safe IPC invocation

**IPC Handlers** (`main/ipc/terminal-handlers.ts`)
- Converts IPC calls to service calls
- Returns success/error responses

**Terminal Service** (`main/services/TerminalService.ts`)
- Manages PTY instances
- Provides Promise-based write API
- Uses node-pty callback for completion

---

## Initialization Polling Pattern

### Problem Statement

The terminal uses a **three-flag bootstrap pattern** to ensure clean initialization:
1. `hasReceivedMarker` - PTY bootstrap marker detected
2. `initializationComplete` - Renderer confirmed clear complete
3. `isClearing` - Terminal clearing in progress

If a prompt is executed while the terminal is still initializing, writes may be buffered, dropped, or cause race conditions.

### Solution: Polling with Timeout

**Implementation** (`stores/useTerminalStore.ts:84-111`)

```typescript
const maxWait = 5000 // 5 seconds max wait
const pollInterval = 50 // Check every 50ms
const startTime = Date.now()

while (Date.now() - startTime < maxWait) {
  try {
    const availabilityResult = await window.api.terminal.isAvailable(terminalId)

    if (!availabilityResult.available) {
      return false // Terminal not available
    }

    if (availabilityResult.initialized) {
      break // Terminal ready, proceed with write
    }

    // Still initializing, wait a bit more
    await new Promise(resolve => setTimeout(resolve, pollInterval))
  } catch (error) {
    return false // IPC error
  }
}
```

### Why This Works

- **Non-blocking**: Uses async/await with Promise-based delays
- **Fail-fast**: Returns immediately if terminal unavailable
- **Safe timeout**: 5 seconds is generous but not infinite
- **Fine-grained**: 50ms intervals balance responsiveness vs CPU usage
- **Error handling**: Try-catch inside loop prevents IPC errors from causing infinite loops

### Typical Scenarios

| Scenario | Wait Time | Result |
|----------|-----------|--------|
| Terminal already initialized | 0-50ms | Immediate write |
| Terminal initializing | 200-1000ms | Wait then write |
| Terminal never initializes | 5000ms | Timeout, fail |
| Terminal becomes unavailable | 0-50ms | Immediate fail |

---

## Promise-Based Write Operations

### Before (v0.3.2 and earlier)

**Fire-and-Forget Pattern**:
```typescript
// Terminal Store
window.api.terminal.write(terminalId, text) // No await, no confirmation

// Preload
write: (id: string, data: string): void => {
  ipcRenderer.send('terminal:write', {id, data})
}

// IPC Handler
ipcMain.on('terminal:write', (_, {id, data}) => {
  terminalService.write(id, data) // Sync, no return
})

// Terminal Service
write(id: string, data: string): boolean {
  pty.write(data)
  return true // Optimistic
}
```

**Problems**:
- No way to know if write succeeded
- Enter key could be sent before text write completed
- Race conditions under load
- No error propagation

### After (v0.3.3)

**Promise-Based Pattern**:

#### Terminal Service Layer
```typescript
write(terminalId: string, data: string): Promise<boolean> {
  return new Promise((resolve) => {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      resolve(false)
      return
    }

    try {
      // node-pty supports optional callback parameter (undocumented but stable)
      ;(terminal.ptyProcess.write as (data: string, cb?: () => void) => void)(
        data,
        () => resolve(true) // Callback fires when write completes
      )
    } catch (error) {
      resolve(false)
    }
  })
}
```

**Type Assertion Rationale**:
- node-pty's TypeScript types don't include the callback parameter
- Callback API has been stable since node-pty v0.9.0 (5+ years)
- We control node-pty version in package.json (currently 1.0.0)
- Fallback: If callback not supported, it's simply ignored (no error)
- See: https://github.com/microsoft/node-pty/blob/main/src/unixTerminal.ts#L206

#### IPC Handlers Layer
```typescript
ipcMain.handle('terminal:write', async (_, {terminalId, data}) => {
  try {
    const success = await terminalService.write(terminalId, data)
    return {success}
  } catch (error) {
    return {success: false, error: error.message}
  }
})
```

**Changed from**:
- `ipcMain.on` (fire-and-forget, no return value)
- **To**: `ipcMain.handle` (awaitable, returns Promise)

#### Preload Bridge Layer
```typescript
write: (terminalId: string, data: string): Promise<{success: boolean, error?: string}> =>
  ipcRenderer.invoke('terminal:write', {terminalId, data})
```

**Changed from**:
- `ipcRenderer.send` (void return)
- **To**: `ipcRenderer.invoke` (returns Promise)

#### Terminal Store Layer
```typescript
// AWAIT both writes
const writeResult = await window.api.terminal.write(terminalId, text)
if (!writeResult.success) {
  console.error(`Write failed: ${writeResult.error}`)
  return false
}

if (autoExecute) {
  await new Promise(resolve => setTimeout(resolve, 200)) // Delay for rendering

  const enterResult = await window.api.terminal.write(terminalId, '\r')
  if (!enterResult.success) {
    console.error(`Enter failed: ${enterResult.error}`)
    return false
  }
}
```

### Benefits

✅ **Completion Confirmation**: Know when writes finish
✅ **Error Propagation**: Failures surface to caller
✅ **Write Ordering**: Guaranteed sequence (text → delay → Enter)
✅ **Testability**: Async operations are easier to mock and test
✅ **Reliability**: No race conditions between writes

---

## Error Handling Strategies

The implementation uses **different strategies** for autoExecute vs manual writes to balance reliability with user experience.

### AutoExecute Mode (Fail Fast)

**Philosophy**: If something goes wrong, **don't execute the command**. User expects immediate execution; partial execution could be confusing.

**Behavior**:
```typescript
if (autoExecute) {
  // Terminal not initialized after timeout?
  if (!finalCheck.initialized) {
    console.error('Terminal not initialized after 5000ms, aborting autoExecute')
    return false // ← Fail, don't execute
  }

  // Text write failed?
  if (!writeResult.success) {
    console.error('Write failed, aborting autoExecute')
    return false // ← Fail, don't send Enter
  }

  // Enter write failed?
  if (!enterResult.success) {
    console.error('Enter failed')
    return false // ← Report failure
  }
}
```

**User Impact**:
- Sees error notification
- Command is NOT in terminal (or is partial)
- Can manually retry the action
- No accidental partial execution

### Manual Write Mode (Permissive)

**Philosophy**: User is **manually reviewing the command** anyway. Let them decide what to do.

**Behavior**:
```typescript
if (!autoExecute) {
  // Terminal not initialized after timeout?
  if (!finalCheck.initialized) {
    console.warn('Terminal not initialized, proceeding anyway (manual write)')
    // ← Continue, user will see the text whenever terminal is ready
  }

  // Text write failed?
  if (!writeResult.success) {
    console.warn('Write failed (manual write)')
    return false // ← Fail silently, no Enter sent
  }

  // No Enter key in manual mode
}
```

**User Impact**:
- Text appears in terminal when ready
- User must press Enter manually
- User can edit command before executing
- More forgiving of transient errors

### Error Scenarios Table

| Error Condition | autoExecute=true | autoExecute=false |
|-----------------|------------------|-------------------|
| Terminal unavailable | ❌ Fail, notify user | ❌ Fail, log warning |
| Init timeout (5s) | ❌ Fail, notify user | ⚠️ Proceed, log warning |
| Text write failed | ❌ Fail, notify user | ❌ Fail, log warning |
| Enter write failed | ❌ Fail, notify user | N/A (no Enter sent) |
| IPC error | ❌ Fail, notify user | ❌ Fail, log warning |

---

## Race Condition Prevention

### Terminal Lifecycle States

```
┌─────────────────┐
│  Not Created    │
└────────┬─────────┘
         │ terminalService.createTerminal()
         ▼
┌─────────────────────────┐
│  Bootstrapping          │ hasReceivedMarker=false
│  (PTY spawning)         │ initializationComplete=false
└────────┬─────────────────┘ isClearing=false
         │ Marker detected
         ▼
┌─────────────────────────┐
│  Clearing               │ hasReceivedMarker=true
│  (Handshake in progress)│ initializationComplete=false
└────────┬─────────────────┘ isClearing=true
         │ clearComplete received
         ▼
┌─────────────────────────┐
│  Ready                  │ hasReceivedMarker=true
│  (Accepting input)      │ initializationComplete=true
└────────┬─────────────────┘ isClearing=false
         │
         ▼
   [Normal Operation]
```

### State Checking Before Writes

**isAvailable() API** (`TerminalService.ts:65-78`)

```typescript
isAvailable(terminalId?: string): {available: boolean, initialized?: boolean} {
  const available = pty !== null

  if (terminalId) {
    const terminal = this.terminals.get(terminalId)
    return {
      available,
      initialized: terminal ? terminal.initializationComplete : false
    }
  }

  return {available}
}
```

**Polling Loop** (`useTerminalStore.ts:91-111`)

Repeatedly checks `isAvailable(terminalId)` until:
- `initialized === true` (ready) → proceed with write
- `available === false` (disappeared) → fail immediately
- Timeout (5000ms) → fail (autoExecute) or proceed anyway (manual)

### Why This Prevents Race Conditions

1. **No writes before marker**: `hasReceivedMarker` must be true
2. **No writes during clear**: `isClearing` must be false
3. **No writes before confirmation**: `initializationComplete` must be true
4. **Polling ensures state**: Continuous checking catches state transitions
5. **Timeout prevents hangs**: 5s max wait ensures eventual resolution

---

## Test Coverage

### Test File: `useTerminalStore.autoExecute.test.ts`

**13 comprehensive tests** covering all error paths, edge cases, and timing scenarios.

### Test Categories

#### 1. Basic Functionality (2 tests)
- ✅ Sends Enter key after text when `autoExecute=true`
- ✅ Does NOT send Enter key when `autoExecute=false`

#### 2. Initialization Polling (1 test)
- ✅ Waits for terminal initialization before writing (simulated 150ms delay)

#### 3. Error Handling (4 tests)
- ✅ Returns false if terminal is not available
- ✅ Returns false if no active terminal
- ✅ Returns false if text write fails
- ✅ Returns false if Enter write fails

#### 4. Timeout Behaviors (2 tests)
- ✅ Timeout fails for `autoExecute=true` (no writes after 5s timeout)
- ✅ Timeout proceeds for `autoExecute=false` (writes anyway after 5s timeout)

#### 5. Edge Cases (4 tests)
- ✅ Handles long text content correctly (10,000 characters)
- ✅ Handles multiple concurrent calls correctly (parallel execution)
- ✅ Handles terminal becoming unavailable mid-operation
- ✅ Waits 200ms between text write and Enter key (timing validation)

### Mocking Strategy

**Mock PTY API** (`useTerminalStore.autoExecute.test.ts:24-36`)

```typescript
const mockTerminalApi = {
  isAvailable: vi.fn(),
  write: vi.fn(),
  // ... other methods
}

(global as any).window = {
  api: {terminal: mockTerminalApi}
}
```

**Realistic Implementations**:
- `isAvailable` can return different states over time (polling simulation)
- `write` can succeed or fail (error injection)
- Async delays simulate real-world timing

### Running Tests

```bash
npm run test:renderer -- useTerminalStore.autoExecute.test
```

**Expected Output**: 13 passed tests in ~11-12 seconds (includes 2 timeout tests at 5s each)

---

## Implementation Files Reference

### Modified Files (v0.3.3)

| File | Lines Changed | Purpose |
|------|---------------|---------|
| **TerminalService.ts** | +79 / -42 | Async writes with callbacks, enhanced isAvailable() |
| **terminal-handlers.ts** | +20 / -14 | Changed `on` → `handle` for awaitable IPC |
| **useTerminalStore.ts** | +87 / -36 | Polling, error handling, awaited writes |
| **preload/index.ts** | +9 / -4 | Promise API, type updates |
| **preload/index.d.ts** | +4 / -2 | Type definitions for new APIs |
| **TerminalService.test.ts** | +11 / -6 | Updated for async operations |
| **useTerminalStore.autoExecute.test.ts** | +290 / 0 | **NEW**: Comprehensive test suite |

**Total**: +500 / -104 lines (+396 net)

### Key Code Locations

**Polling Implementation**:
- `src/renderer/src/stores/useTerminalStore.ts:91-111` - While loop with timeout

**Promise-Based Write**:
- `src/main/services/TerminalService.ts:302-335` - Callback-based promise

**IPC Handler Change**:
- `src/main/ipc/terminal-handlers.ts:54-63` - Changed from `.on` to `.handle`

**Error Handling Differentiation**:
- `src/renderer/src/stores/useTerminalStore.ts:119-127` - autoExecute vs manual

**Initialization State Check**:
- `src/main/services/TerminalService.ts:65-78` - Enhanced `isAvailable()`

---

## Related Documentation

### Internal Documentation
- [Template Syntax](./template-syntax.md) - YAML frontmatter and variable syntax
- [Template Examples](./examples.md) - Sample templates and use cases
- [Prompt Templates README](./README.md) - User-facing overview
- [Terminal Bootstrap Pattern](../terminal/bootstrap-pattern.md) - Three-flag initialization
- [Terminal README](../terminal/README.md) - Terminal architecture overview
- [IPC Patterns](../ipc-patterns.md) - IPC communication patterns
- [Testing Strategy](../testing/README.md) - Test organization and coverage

### External Resources
- [node-pty Documentation](https://github.com/microsoft/node-pty) - PTY library reference
- [Electron IPC Guide](https://www.electronjs.org/docs/latest/tutorial/ipc) - IPC patterns
- [Zustand Documentation](https://docs.pmnd.rs/zustand) - State management
- [Vitest Documentation](https://vitest.dev/) - Test framework

---

## Summary

The v0.3.3 autoExecute implementation establishes important patterns for:
- ✅ **Async IPC Operations**: Promise-based communication with completion confirmation
- ✅ **State Polling**: Waiting for system readiness before proceeding
- ✅ **Differentiated Error Handling**: Fail-fast vs permissive strategies
- ✅ **Comprehensive Testing**: 13 tests covering normal and error paths

These patterns are reusable for other async operations requiring coordination across Electron's process boundaries.
