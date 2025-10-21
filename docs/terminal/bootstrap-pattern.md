# Terminal Bootstrap Pattern

Non-interactive terminal initialization pattern that eliminates visible artifacts and provides a clean user experience.

## Overview

**Goal**: Zero visible commands during terminal startup

**Method**: Non-interactive shell script with exec transition

**Result**: Clean prompt with no visible `cd`, `pwd`, or `echo` commands

## Bootstrap Pattern (No TTY Echo)

Shell is spawned with a non-interactive `-c` script that:
1. Changes to target directory
2. Prints working directory (for verification)
3. Echoes unique marker
4. Execs into interactive login shell

```bash
# POSIX (zsh/bash)
shell -c 'cd "/target/path"; pwd; echo __ERFANA_PWD_MARKER_...; exec -l "$SHELL" -i'

# Windows PowerShell
powershell -NoProfile -Command 'Set-Location "..."; Write-Output (Get-Location).Path; Write-Output marker; & shell'
```

## Why Bootstrap Pattern

- Non-interactive mode prevents TTY echo of verification commands
- No visible `cd`, `pwd`, or `echo` commands in terminal
- `exec` replaces bootstrap process with interactive shell seamlessly
- Shell prompt appears only after user interaction (by design)

## Initialization Phases

### 1. Environment Filtering (Security Layer)

**Purpose**: Prevent environment variable leakage

**Excluded Variables**:
- `NODE_ENV` - Development/build environment
- `ELECTRON_*` - Electron internal variables
- `npm_*` - npm package manager variables
- `INIT_CWD` - Initial working directory
- `VITE_*` - Vite build tool variables
- `FORCE_COLOR` - Color output control

**Preserved Variables**:
- `PATH` - Command search path
- `HOME` - User home directory
- `USER` - Current user
- `SHELL` - User's preferred shell
- `LANG` - Language settings
- And other standard environment variables

**Implementation**: `TerminalService.ts` filters environment before passing to PTY

### 2. Non-Interactive Bootstrap (Zero Artifacts)

**Execution Context**: Non-interactive shell (`-c` flag)

**Key Behavior**:
- Verification runs in non-interactive shell context
- No TTY echo = no visible commands
- Output (pwd + marker) buffered by service
- User never sees bootstrap commands

**Bootstrap Script Generation** (`TerminalService.ts:124-168`):
```typescript
private generateBootstrapScript(
  projectRoot: string,
  marker: string,
  shell: string
): string {
  if (process.platform === 'win32') {
    if (shell.includes('powershell')) {
      return `Set-Location -Path "${projectRoot}" ; Write-Output (Get-Location).Path ; Write-Output ${marker} ; & "${shell}"`
    } else {
      return `cd /d "${projectRoot}" & cd & echo ${marker} & "${shell}"`
    }
  } else {
    return `cd "${projectRoot}"; pwd; echo ${marker}; exec -l "${shell}" -i`
  }
}
```

### 3. Marker Detection & Clear Handshake

**Service-Side Detection** (`TerminalService.ts:169-199`):
```typescript
ptyProcess.onData((data: string) => {
  dataBuffer += data

  // Look for marker in buffered output
  if (!hasReceivedMarker && dataBuffer.includes(marker)) {
    hasReceivedMarker = true

    // Parse working directory from output
    const lines = dataBuffer.split('\n')
    const pwdLine = lines[lines.length - 2]
    currentCwd = pwdLine.trim()

    // Emit clear event on bypass channel
    this.emit('terminal-clear', { terminalId })

    // Wait for renderer confirmation
    // (output gated until initializationComplete = true)
  }
})
```

**Renderer-Side Clear** (`TerminalPanel.tsx:185-202`):
```typescript
useEffect(() => {
  const unsubscribeClear = window.api.terminal.onClear((data) => {
    if (data.terminalId === terminalId && xtermRef.current) {
      // Clear xterm buffer and screen
      xtermRef.current.write('\x1b[2J\x1b[H', () => {
        // Confirm clear complete to service
        window.api.terminal.markClearComplete(terminalId)
      })
    }
  })

  return () => {
    unsubscribeClear()
  }
}, [terminalId])
```

**Bypass Channel**: Uses dedicated `terminal-clear` event (not mixed with data stream)

### 4. Three-Flag Gating System

**Purpose**: Ensure zero artifacts leak through to renderer

**Flags** (`TerminalService.ts`):
```typescript
interface TerminalInstance {
  hasReceivedMarker: boolean        // Bootstrap completed
  initializationComplete: boolean   // Clear confirmed
  isClearing: boolean               // Currently clearing
}
```

**Gating Logic** (`TerminalService.ts:200-210`):
```typescript
ptyProcess.onData((data: string) => {
  // Gate 1: Has marker been received?
  if (!instance.hasReceivedMarker) {
    dataBuffer += data
    return // Block output until marker detected
  }

  // Gate 2: Has clear been confirmed?
  if (!instance.initializationComplete) {
    return // Block output until renderer confirms clear
  }

  // Gate 3: Is clear in progress?
  if (instance.isClearing) {
    return // Block output during clear operation
  }

  // All gates passed - forward output to renderer
  this.emit('terminal-data', { terminalId, data })
})
```

**Clear Completion** (`TerminalService.ts:211-236`):
```typescript
markClearComplete(terminalId: string): void {
  const instance = this.terminals.get(terminalId)
  if (instance) {
    instance.isClearing = false
    instance.initializationComplete = true
    // Output forwarding now enabled
  }
}
```

### 5. Interactive Shell Starts

**User Experience**:
- User sees only clean prompt
- All commands and output display normally
- Zero initialization artifacts

**Shell Behavior**:
- Login shell sources RC files (.zshrc, .bash_profile)
- Environment fully loaded (Homebrew paths, aliases, functions)
- Working directory verified and set correctly

## Implementation Files

- `src/main/services/TerminalService.ts:124-236` - Bootstrap script generation, marker detection, three-flag gating
- `src/renderer/src/components/Panels/TerminalPanel.tsx:185-202` - One-time clear handler before PTY creation
- `src/main/ipc/terminal-handlers.ts` - Clear event bypass channel
- `src/preload/index.ts` - `onClear()` and `markClearComplete()` API

## Design Rationale

**Why Non-Interactive Script?**
- Interactive shells echo all input to TTY
- Non-interactive mode (`-c`) suppresses echo
- User never sees verification commands

**Why Three-Flag Gating?**
- Prevents race conditions during initialization
- Ensures no pre-marker data leaks through
- Guarantees deterministic clear handshake

**Why Bypass Channel?**
- Separates control messages from data stream
- Prevents marker from appearing in terminal
- Enables reliable state synchronization

**Why exec Instead of Spawn?**
- `exec` replaces process instead of creating child
- No parent-child relationship after exec
- Shell becomes PID 1 in PTY (cleaner process tree)
- Seamless transition without process overhead

## Platform Differences

### macOS/Linux (POSIX Shells)
```bash
/bin/zsh -c 'cd "/path"; pwd; echo MARKER; exec -l /bin/zsh -i'
```

**Flags**:
- `-c`: Execute command string (non-interactive)
- `-l`: Login shell (sources RC files)
- `-i`: Interactive mode (after exec)

### Windows PowerShell
```powershell
powershell -NoProfile -Command 'Set-Location "C:\path"; Write-Output (Get-Location).Path; Write-Output MARKER; & powershell'
```

**Flags**:
- `-NoProfile`: Skip profile loading (faster bootstrap)
- `-Command`: Execute command string

**Note**: Windows doesn't use `exec` - spawns new shell instance instead

### Windows cmd.exe
```cmd
cmd /c cd /d "C:\path" & cd & echo MARKER & cmd
```

**Flags**:
- `/c`: Execute command and exit
- `/d`: Change drive as well as directory

## Testing

**Test Coverage**: `src/main/services/TerminalService.test.ts` (18 tests, 46% coverage)

**Key Test Scenarios**:
- Bootstrap script generation per platform
- Marker detection in buffered output
- Three-flag gating prevents premature output
- Clear handshake confirmation
- Environment variable filtering
- Platform-specific shell arguments

**Example Test**:
```typescript
it('should gate output until initialization complete', async () => {
  // Simulate marker detection
  mockPty.onData('marker')

  // Verify output blocked until clear confirmed
  expect(terminalService.emit).not.toHaveBeenCalledWith('terminal-data')

  // Confirm clear complete
  terminalService.markClearComplete(terminalId)

  // Verify output now forwarded
  mockPty.onData('user input')
  expect(terminalService.emit).toHaveBeenCalledWith('terminal-data', {
    terminalId,
    data: 'user input'
  })
})
```

## References

- [TerminalService Implementation](../../src/main/services/TerminalService.ts)
- [TerminalPanel Component](../../src/renderer/src/components/Panels/TerminalPanel.tsx)
- [Terminal Tests](../../src/main/services/TerminalService.test.ts)
- [node-pty Documentation](https://github.com/microsoft/node-pty)
