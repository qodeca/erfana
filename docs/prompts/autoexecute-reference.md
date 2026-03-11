# AutoExecute Feature - Implementation Reference

> Part of the [Prompt Templates](./README.md) documentation. For overview, see [AutoExecute Overview](./autoexecute-overview.md).

## Table of Contents
1. [Error Handling Strategy](#error-handling-strategy)
2. [Race Condition Prevention](#race-condition-prevention)
3. [Implementation Files Reference](#implementation-files-reference)
4. [Key Code Locations](#key-code-locations)
5. [Related Documentation](#related-documentation)

---

## Error Handling Strategy

The simplified v0.3.4 implementation uses a **fail-fast approach** for all error conditions.

### Philosophy

**Both modes** (autoExecute and manual) should fail if the write operation fails. The terminal store returns a boolean indicating success/failure, allowing callers to handle errors appropriately.

### Implementation

```typescript
sendToTerminal: async (text: string, autoExecute = false): Promise<boolean> => {
  const terminalId = get().activeTerminalId

  if (!terminalId) {
    console.warn('❌ No active terminal available')
    return false
  }

  try {
    // Write text to terminal
    const writeResult = await window.api.terminal.write(terminalId, text)

    if (!writeResult.success) {
      console.error(`❌ Write failed: ${writeResult.error}`)
      return false
    }

    // If autoExecute, send Enter after delay
    if (autoExecute) {
      await new Promise(resolve => setTimeout(resolve, 200))

      const enterResult = await window.api.terminal.write(terminalId, '\r')

      if (!enterResult.success) {
        console.error(`❌ Failed to send Enter: ${enterResult.error}`)
        return false
      }
    }

    return true
  } catch (error) {
    console.error('❌ Unexpected error:', error)
    return false
  }
}
```

### Error Scenarios

| Error Condition | Behavior | User Impact |
|-----------------|----------|-------------|
| No active terminal | Return `false` | Error logged, operation aborted |
| Text write failed | Return `false` | Error logged with message, operation aborted |
| Enter write failed (autoExecute) | Return `false` | Text written but not executed, user can press Enter |
| IPC error | Return `false` | Error logged, operation aborted |
| EPIPE (terminal closed) | Return `false` | Terminal cleaned up, silent failure |

### Simplified Benefits

✅ **Consistent**: Same error handling for both modes
✅ **Clear**: Boolean return makes success/failure obvious
✅ **Logged**: All failures logged with context
✅ **Safe**: Failed operations don't partially execute
✅ **Simple**: No complex state tracking needed

---

## Race Condition Prevention

### Terminal Lifecycle States

The v0.3.4 simplified implementation relies on the terminal bootstrap pattern for initialization, eliminating the need for explicit polling.

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

### Why Race Conditions Are Prevented

1. **Terminal bootstrap ensures ready state** - Three-flag gating system (hasReceivedMarker, initializationComplete, isClearing) prevents writes before terminal is ready
2. **Panel initialization delay** - 100ms wait in `panelUtils.ts` ensures panel is visible before writing
3. **Write ordering guaranteed** - TCP FIFO semantics ensure sequential writes arrive in order
4. **Fire-and-forget simplicity** - No async coordination needed between layers

See [Terminal Bootstrap Pattern](../terminal/bootstrap-pattern.md) for detailed initialization flow.

---

## Implementation Files Reference

### Modified Files

#### v0.3.3 (Complex Implementation)

| File | Lines Changed | Purpose |
|------|---------------|---------|
| **TerminalService.ts** | +79 / -42 | Async writes with callbacks, enhanced isAvailable() |
| **terminal-handlers.ts** | +20 / -14 | Changed `on` → `handle` for awaitable IPC |
| **useTerminalStore.ts** | +87 / -36 | Polling, error handling, awaited writes |
| **preload/index.ts** | +9 / -4 | Promise API, type updates |
| **useTerminalStore.autoExecute.test.ts** | +290 / 0 | Comprehensive test suite |

**Total**: +500 / -104 lines (+396 net)

#### v0.3.4 (Simplified Implementation)

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

## Key Code Locations

### v0.3.4 (Current Implementation)

**Fire-and-Forget Write**:
- `src/main/services/TerminalService.ts:313-342` - Synchronous write with EPIPE handling

**IPC Handler**:
- `src/main/ipc/terminal-handlers.ts:55-64` - Synchronous `ipcMain.handle`

**200ms Delay Implementation**:
- `src/renderer/src/stores/useTerminalStore.ts:91-95` - Comment explaining delay rationale

**AutoExecute Flow**:
- `src/renderer/src/stores/useTerminalStore.ts:73-111` - Complete sendToTerminal implementation

**Template Configuration**:
- `src/renderer/src/prompts/templates/modify.md` - `autoExecute: true` example
- `src/renderer/src/prompts/templates/explain.md` - `autoExecute: true` example
- `src/renderer/src/prompts/templates/ask.md` - `autoExecute: true` example

**Context Menu Integration**:
- `src/renderer/src/components/ContextMenu/PreviewContextMenu.tsx:93-148` - Template execution trigger

**Panel Utils**:
- `src/renderer/src/utils/panelUtils.ts:32-68` - Panel opening and content sending

**Template Registry**:
- `src/renderer/src/prompts/registry.ts` - Prompt template registration

**Test Suite**:
- `src/renderer/src/stores/useTerminalStore.autoExecute.test.ts` - Comprehensive 10-test suite

---

## Related Documentation

### Within Prompts
- [Template Syntax](./template-syntax.md) - YAML frontmatter and variable syntax
- [Template Examples](./examples.md) - Sample templates and use cases
- [Prompt Templates README](./README.md) - User-facing overview
- [AutoExecute Overview](./autoexecute-overview.md) - Feature overview and architecture
- [AutoExecute Technical](./autoexecute-technical.md) - Write pipeline and 200ms delay details
- [AutoExecute Testing](./autoexecute-testing.md) - Test coverage and mocking strategy

### Terminal & Architecture
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

## Code Examples

### Using AutoExecute in Templates

**Template with AutoExecute**:
```markdown
---
id: custom-operation
label: My Custom Operation
autoExecute: true  # Automatically press Enter
---

Please process this content:
{{selectedText}}
```

**Template without AutoExecute**:
```markdown
---
id: review-operation
label: Review This
autoExecute: false  # User must press Enter manually
---

Review the following and suggest improvements:
{{selectedText}}
```

### Checking Terminal Availability

```typescript
// In renderer process
const terminalId = useTerminalStore.getState().getActiveTerminalId()

if (!terminalId) {
  console.warn('No active terminal')
  return
}

// Send content
const success = await useTerminalStore.getState().sendToTerminal(text, true)
if (!success) {
  console.error('Failed to send to terminal')
}
```

### Custom Write Operations

```typescript
// Fire-and-forget write (no autoExecute)
await window.api.terminal.write(terminalId, 'command text')

// Write with manual Enter
await window.api.terminal.write(terminalId, 'command text')
await new Promise(resolve => setTimeout(resolve, 200))
await window.api.terminal.write(terminalId, '\r')
```

---

## Migration Guide

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

## Troubleshooting

### Common Issues

**Issue**: Enter key not executing after paste
**Solution**: Verify terminal is initialized (check Terminal Bootstrap Pattern)

**Issue**: Partial command execution
**Solution**: Increase delay if needed (current: 200ms, try 250ms)

**Issue**: Write operations failing
**Solution**: Check terminal availability with `getActiveTerminalId()`

**Issue**: IPC "reply was never sent" errors
**Solution**: Ensure using v0.3.4+ (v0.3.3 had this bug)

### Debug Logging

Enable debug logging to trace write operations:

```typescript
// In useTerminalStore.ts
console.log(`📝 Writing to terminal ${terminalId}:`, text.substring(0, 50))
console.log(`⏱️  Waiting 200ms for rendering...`)
console.log(`↩️  Sending Enter key`)
```

### Performance Monitoring

```typescript
const start = Date.now()
const success = await sendToTerminal(text, true)
const duration = Date.now() - start
console.log(`⏱️  AutoExecute completed in ${duration}ms`)
```

Expected timing:
- Text write: ~5-20ms
- Delay: 200ms
- Enter write: ~5-20ms
- **Total**: ~210-240ms
