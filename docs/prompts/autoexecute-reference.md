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

The implementation uses a **fail-fast approach** for all error conditions.

### Philosophy

**Both modes** (autoExecute and manual) should fail if the write operation fails. The terminal store returns a boolean indicating success/failure, allowing callers to handle errors appropriately.

### Implementation

`createTerminalStore(terminalOps)` receives the terminal operations by injection (the default store passes `window.api.terminal`). Excerpt of `sendToTerminal` in `src/renderer/src/stores/useTerminalStore.ts`, with the logging lines left out:

```typescript
sendToTerminal: async (text: string, autoExecute = false): Promise<boolean> => {
  const terminalId = get().activeTerminalId

  if (!terminalId) {
    return false
  }

  try {
    // Multi-line text goes in as one bracketed paste, with line endings
    // converted to \r, so a CLI such as Claude Code sees a single paste
    const isMultiLine = /[\r\n]/.test(text)
    const textToWrite = isMultiLine
      ? `\x1b[200~${text.replace(/\r?\n/g, '\r')}\x1b[201~`
      : text

    const writeResult = await terminalOps.write(terminalId, textToWrite)
    if (!writeResult.success) {
      return false
    }

    // If autoExecute, send Enter after the 200ms delay
    if (autoExecute) {
      await new Promise(resolve => setTimeout(resolve, 200))

      const enterResult = await terminalOps.write(terminalId, '\r')
      if (!enterResult.success) {
        return false
      }
    }

    return true
  } catch (error) {
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

The terminal bootstrap pattern gates writes until the terminal is ready; before sending, `openPanelAndSendContent` also waits for the store to report an active terminal (`waitForTerminalReady`).

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
2. **Terminal readiness wait** - `waitForTerminalReady` in `panelUtils.ts` waits for an active terminal – event-based through the terminal manager's `waitForReady` when available, otherwise polling every 50 ms – and gives up after 5 s with a `PROMPT_TERMINAL_TIMEOUT` error toast
3. **Write ordering guaranteed** - TCP FIFO semantics ensure sequential writes arrive in order
4. **Fire-and-forget simplicity** - No async coordination needed between layers

See [Terminal Bootstrap Pattern](../terminal/bootstrap-pattern.md) for detailed initialization flow.

---

## Implementation Files Reference

The per-version modified-files tables (v0.3.3 and v0.3.4) are archived in [AutoExecute v0.3 history](../archive/autoexecute-v0.3-history.md#modified-files).

---

## Key Code Locations

### Current implementation

**Fire-and-Forget Write**:
- `src/main/services/TerminalService.ts` – `TerminalService.write`: synchronous write with EPIPE handling

**IPC Handler**:
- `src/main/ipc/terminal-handlers.ts` – the `terminal:write` handler: synchronous `registerHandle`, returns `{ success }`

**200ms Delay Implementation**:
- `src/renderer/src/stores/useTerminalStore.ts` – the comment above the `autoExecute` branch in `sendToTerminal` explains the delay

**AutoExecute Flow**:
- `src/renderer/src/stores/useTerminalStore.ts` – `sendToTerminal` (bracketed paste, write, delay, Enter)

**Template Configuration**:
- `src/renderer/src/prompts/templates/modify.md` - `autoExecute: true` example
- `src/renderer/src/prompts/templates/explain.md` - `autoExecute: true` example
- `src/renderer/src/prompts/templates/ask.md` - `autoExecute: true` example

**Context Menu Integration**:
- `src/renderer/src/components/ContextMenu/PreviewContextMenu.tsx` – builds the variables and calls `executePromptTemplate`

**Panel Utils**:
- `src/renderer/src/utils/panelUtils.ts` – `executePromptTemplate` (registry lookup, validation, rendering with the apply footer), `openPanelAndSendContent` and `waitForTerminalReady`

**Template Registry**:
- `src/renderer/src/prompts/registry.ts` - Prompt template registration (auto-discovers `templates/*.md`)

**Test Suite**:
- `src/renderer/src/stores/useTerminalStore.autoExecute.test.ts` - 15 tests

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
area: markdown-preview
subArea: context-menu
name: My Custom Operation
icon: sparkles
autoExecute: true  # Automatically press Enter
---

Please process this content:
{{selectedText}}
```

**Template without AutoExecute**:
```markdown
---
area: markdown-preview
subArea: context-menu
name: Review This
icon: sparkles
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

The v0.3.2→v0.3.4 migration guide is archived in [AutoExecute v0.3 history](../archive/autoexecute-v0.3-history.md#migration-guide).

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

`sendToTerminal` already logs each step through the renderer `logger` – the `autoExecute` flag, terminal id and text length, the 200ms wait, and whether Enter was sent – and `openPanelAndSendContent` / `executePromptTemplate` log the flag they pass on. Read them in the renderer log rather than adding `console.log` calls.

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
