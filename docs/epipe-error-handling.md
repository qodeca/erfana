# EPIPE Error Handling

## Problem Overview

**Error Type**: EPIPE (Broken Pipe)
**Location**: Main process console.log operations
**Impact**: Application crashes during cleanup/shutdown

### Root Cause

EPIPE errors occur when code attempts to write to stdout/stderr after the stream has been closed or disconnected. This typically happens in three scenarios:

1. **Process Cleanup**: During `app.on('before-quit')` when services are disposed
2. **Child Process Exit**: When Terminal PTY processes exit unexpectedly
3. **Stream Disconnection**: When renderer process closes but main process continues logging

### Original Error Stack Trace

```
Error: write EPIPE
at afterWriteDispatched (node:internal/stream_base_commons:161:15)
at writeGeneric (node:internal/stream_base_commons:152:3)
at Socket._writeGeneric (node:net:958:11)
at Socket._write (node:net:970:8)
at writeOrBuffer (node:internal/streams/writable:572:12)
at _write (node:internal/streams/writable:493:10)
at Writable.write (node:internal/streams/writable:510:10)
at console.value (node:internal/console/constructor:303:16)
at console.log (node:internal/console/constructor:378:26)
```

## Solution Architecture

### 1. Global Console Safety (`src/main/utils/safeConsole.ts`)

**Purpose**: Prevent EPIPE crashes from console.log operations app-wide

**Implementation**:
```typescript
function safeConsoleWrite(method: ConsoleMethod, ...args: unknown[]): void {
  try {
    console[method](...args)
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'EPIPE') {
      // Silently suppress - expected during shutdown
      return
    }
    // Attempt stderr fallback for other errors
    try {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr?.write(`[Console Error] ${message}\n`)
    } catch {
      // Fail silently if stderr unavailable
    }
  }
}
```

**Installation**: Called early in `src/main/index.ts` before any other code
```typescript
import { installSafeConsole } from './utils/safeConsole'
installSafeConsole()
```

### 2. TerminalService PTY protection

**Location**: `src/main/services/TerminalService.ts`

Protects against EPIPE when writing to a terminal PTY that has closed.

**Methods Enhanced**:
- `write()`: Suppress EPIPE, emit exit event, clean up terminal
- `killTerminal()`: Suppress EPIPE and ESRCH (process not found)
- `dispose()`: Suppress EPIPE and ESRCH during bulk cleanup

**Code Pattern**:
```typescript
try {
  terminal.ptyProcess.write(data)
  return true
} catch (error) {
  const code = (error as { code?: unknown }).code
  if (code === 'EPIPE') {
    logger.info(`ℹ️ Terminal ${terminalId} PTY closed (terminal likely exited)`)
    this.terminals.delete(terminalId)
    this.emit('exit', { terminalId, exitCode: 0 })
    return false
  }
  // Handle other errors
}
```

## Error Suppression Strategy

### When to Suppress EPIPE

✅ **Always suppress**:
- Console.log during shutdown
- Writing to closed stdin/stdout streams
- PTY write operations to terminated processes
- Process kill operations on already-dead processes

❌ **Never suppress**:
- Network socket errors (different context)
- File I/O errors (not related to process streams)
- User-facing operation failures

### Additional Error Codes

**ESRCH (No such process)**: Suppress when killing terminals during cleanup
- Indicates process already terminated
- Safe to treat as successful cleanup

## Testing Scenarios

### Manual Testing

1. **Normal Shutdown**:
   - Open project with terminal session
   - Quit application (Cmd+Q / Ctrl+Q)
   - **Expected**: Clean exit, no EPIPE errors in console

2. **Terminal PTY Termination**:
   - Start terminal session
   - Manually kill terminal process externally
   - Attempt to write to terminal
   - **Expected**: Graceful failure, no crash

3. **Terminal PTY Closure**:
   - Create terminal instance
   - Close terminal panel
   - **Expected**: Clean cleanup, no EPIPE errors

4. **Rapid Window Close**:
   - Open multiple files and terminal
   - Close window immediately
   - **Expected**: All services dispose gracefully

### Automated Testing

**Future**: Add integration tests
- Launch app
- Create terminal session
- Force-close processes
- Verify no crashes in logs

## Related Issues

- **Known Issues**: See [docs/known-issues.md](known-issues.md)
- **Service reference**: See [docs/api-services.md](api-services.md) (TerminalService) – `architecture.md` has no service-layer section
- **Testing**: See [docs/testing/README.md](testing/README.md)

## References

- Node.js Stream Documentation: https://nodejs.org/api/stream.html
- EPIPE Error Code: https://nodejs.org/api/errors.html#errors_common_system_errors
- Electron Process Communication: https://www.electronjs.org/docs/latest/tutorial/process-model
