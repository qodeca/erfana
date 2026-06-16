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
function safeConsoleWrite(method: ConsoleMethod, ...args: any[]): void {
  try {
    console[method](...args)
  } catch (error: any) {
    if (error?.code === 'EPIPE') {
      // Silently suppress - expected during shutdown
      return
    }
    // Attempt stderr fallback for other errors
    try {
      process.stderr?.write(`[Console Error] ${error?.message || error}\n`)
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

### 2. PTY Stream Protection

**Location**: `src/main/services/TerminalService.ts`

Protects against EPIPE when writing to a terminal PTY that has closed.

### 3. TerminalService PTY Protection

**Location**: `src/main/services/TerminalService.ts`

**Methods Enhanced**:
- `write()`: Suppress EPIPE, emit exit event, clean up terminal
- `killTerminal()`: Suppress EPIPE and ESRCH (process not found)
- `dispose()`: Suppress EPIPE and ESRCH during bulk cleanup

**Code Pattern**:
```typescript
try {
  terminal.ptyProcess.write(data)
  return true
} catch (error: any) {
  if (error.code === 'EPIPE') {
    console.log(`ℹ️ Terminal ${terminalId} PTY closed (terminal likely exited)`)
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

## Benefits

### Stability Improvements

1. **Crash Prevention**: Eliminates EPIPE crashes during normal operations
2. **Graceful Degradation**: Failed writes become logged info, not errors
3. **Cleanup Reliability**: Services dispose successfully even with dead child processes

### User Experience

1. **No Data Loss**: Application closes cleanly without crashes
2. **Transparent**: Users unaware of suppressed EPIPE errors
3. **Better Logging**: Clear distinction between expected shutdown and real errors

### Development Experience

1. **Clear Patterns**: Consistent error handling across services
2. **Easy Debugging**: EPIPE suppression logged with context
3. **Maintainable**: Centralized console safety in single utility

## Future Enhancements

### Potential Improvements

1. **Stream State Tracking**: Track stdin/stdout state to avoid write attempts
2. **Graceful Write Queue**: Buffer writes and drain on stream availability
3. **Health Checks**: Periodic stream availability checks before writes
4. **Metrics**: Track EPIPE occurrences for monitoring

### Error Recovery

Current implementation suppresses EPIPE but could be enhanced with:
- Automatic session restart detection
- User notification for unexpected terminations
- Retry logic for transient stream issues

## Related Issues

- **Known Issues**: See [docs/known-issues.md](known-issues.md)
- **Architecture**: See [docs/architecture.md](architecture.md#service-layer)
- **Testing**: See [docs/testing/README.md](testing/README.md)

## References

- Node.js Stream Documentation: https://nodejs.org/api/stream.html
- EPIPE Error Code: https://nodejs.org/api/errors.html#errors_common_system_errors
- Electron Process Communication: https://www.electronjs.org/docs/latest/tutorial/process-model
