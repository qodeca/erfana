# Terminal Panel

Integrated terminal emulator with xterm.js and node-pty for native shell access within Erfana.

## Overview

**Status**: ✅ FULLY IMPLEMENTED

The Terminal Panel provides a full-featured terminal emulator using:
- **xterm.js v5.5.0** - Modern terminal emulator for web
- **node-pty v1.0.0** - Native pseudo-terminal (PTY) backend
- **WebGL rendering** - Hardware-accelerated rendering for performance

## Quick Access

- **Activity Bar**: Terminal icon in right sidebar (bottom)
- **Keyboard**: `Cmd/Ctrl+J` - Toggle terminal panel
- **Restart**: X button in panel header - Kill and restart terminal session

## Features

### Core Capabilities

- **Native Shell**: Spawns real PTY process (zsh on macOS, bash on Linux)
- **Auto-Resize**: Terminal automatically resizes when panel is dragged
- **WebGL Rendering**: Hardware acceleration with canvas fallback
- **Bold Font Support**: Renders bold text with proper font weight
- **Full Environment**: Login shell on macOS/Linux loads user's shell configuration and Homebrew paths
- **Context Integration**: "Send Selection to Terminal" from markdown preview

### Terminal Configuration

```typescript
// xterm.js settings
fontSize: 12
fontFamily: 'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace
fontWeight: 'normal'
fontWeightBold: 'bold'

// Theme - High contrast
background: '#000000'  // Pure black
foreground: '#ffffff'  // Bright white
cursor: '#4fc1ff'      // Cyan
```

### Scrollbar Styling

**Visibility**: Custom WebKit scrollbar styled for clear visibility against black background.

```css
/* Container padding */
.terminal-container { padding: 0; }
.xterm { padding: 8px; }

/* Scrollbar (16px wide, dark gray with lighter thumb) */
.xterm-viewport::-webkit-scrollbar {
  width: 16px;
}

.xterm-viewport::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.xterm-viewport::-webkit-scrollbar-thumb {
  background: #555555;        // Dark gray
  border-radius: 0;
  border: 3px solid #1e1e1e;  // Matches track
}

.xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: #707070;        // Lighter on hover
}
```

**Design Decision**: Darker scrollbar (#555555) provides subtlety while maintaining visibility. Border matches track for clean appearance.

### Shell Configuration

**Prompt Format**: `%n %~ $` (username directory $)

**Example**: `marcinmobel ~/Projects/erfana $`

**Environment Variables**:
- `PS1='%n %~ $ '` - Traditional zsh prompt
- `PROMPT='%n %~ $ '` - Zsh synonym for PS1
- `SHELL_SESSIONS_DISABLE='1'` - Disables macOS "Restored session" messages
- `TERM='xterm-256color'` - 256-color support
- `COLORTERM='truecolor'` - True color support

**Shell Arguments** (Platform-Specific):
- **macOS/Linux**: `-l` (login shell) - Sources RC files (.zprofile, .bash_profile) to load environment, Homebrew paths, and user configuration
- **Windows (PowerShell)**: `-NoProfile` - Loads full environment profile
- **Windows (cmd.exe)**: No arguments - Uses default environment

## Architecture

### Service Layer

**File**: `src/main/services/TerminalService.ts` (~260 lines)

```typescript
class TerminalService extends EventEmitter {
  private terminals: Map<string, TerminalInstance>

  // Lifecycle
  createTerminal(config: TerminalConfig): string | null
  killTerminal(terminalId: string): boolean
  dispose(): Promise<void>

  // Operations
  write(terminalId: string, data: string): boolean
  resize(terminalId: string, cols: number, rows: number): boolean

  // Info
  getTerminalInfo(terminalId: string): {...} | null
  listTerminals(): Array<{id: string; title: string}>
}

export const terminalService = new TerminalService()
```

**Pattern**: OOP service with singleton instance (follows FileService pattern)

### IPC Handlers

**File**: `src/main/ipc/terminal-handlers.ts` (~120 lines)

**Exposed via contextBridge**:
```typescript
window.api.terminal = {
  isAvailable: () => Promise<{available: boolean}>
  create: (config) => Promise<{success, terminalId?, error?}>
  write: (terminalId, data) => void
  resize: (terminalId, cols, rows) => void
  kill: (terminalId) => void

  // Events
  onData: (callback) => unsubscribe
  onExit: (callback) => unsubscribe
  onError: (callback) => unsubscribe
}
```

### UI Component

**File**: `src/renderer/src/components/Panels/TerminalPanel.tsx` (~250 lines)

**Key Features**:
- Visibility check before xterm initialization (prevents rendering issues)
- WebGL addon loaded AFTER `xterm.open()` (order matters)
- ResizeObserver for panel drag handling
- useRef pattern to avoid useEffect cleanup issues
- Clean screen on mount (`\x1b[2J\x1b[H`)

**Critical Implementation Detail**:
```typescript
// IMPORTANT: Use ref to avoid cleanup issues
const terminalIdRef = useRef<string | null>(null)

useEffect(() => {
  terminalIdRef.current = terminalId
}, [terminalId])

// Cleanup uses ref, not state
useEffect(() => {
  return () => {
    if (terminalIdRef.current) {
      window.api.terminal.kill(terminalIdRef.current)
    }
  }
}, [isAvailable]) // terminalId NOT in dependencies
```

**Why**: Including `terminalId` in dependencies causes cleanup to run when terminal ID changes, disposing xterm before it can render.

### State Management

**File**: `src/renderer/src/stores/useTerminalStore.ts`

```typescript
interface TerminalStore {
  activeTerminalId: string | null
  setActiveTerminalId: (id: string | null) => void
  sendToTerminal: (text: string) => Promise<boolean>
}
```

**Purpose**: Cross-component communication (PreviewContextMenu → Terminal Panel)

## Addons

### FitAddon
**Purpose**: Automatically fits terminal dimensions to container size
**Usage**: Called on resize, mount, show/hide

```typescript
fitAddon.fit()  // Recalculate dimensions
```

### WebLinksAddon
**Purpose**: Makes URLs in terminal clickable
**Auto-enabled**: Loaded automatically on terminal creation

### WebglAddon
**Purpose**: Hardware-accelerated rendering
**Loading Order**: MUST load AFTER `xterm.open()` or rendering fails

```typescript
xterm.open(container)

// Load WebGL renderer AFTER open
try {
  const webglAddon = new WebglAddon()
  webglAddon.onContextLoss(() => {
    webglAddon.dispose()
  })
  xterm.loadAddon(webglAddon)
} catch (error) {
  console.warn('WebGL failed, falling back to canvas:', error)
}

## Project Switching & Safety

### Recent Activity Detection
- Tracks activity per-terminal on both output and user input
- Ignores shell warm-up noise for ~500ms after spawn
- Uses a default 20s window to consider an active session "busy"
- On project open/close, if busy, a confirmation dialog appears
- On confirm, the app sends Ctrl+C, waits briefly, and proceeds; clears activity if quiet

### Deferred Initialization
- Terminal initialization is deferred when the panel is hidden to avoid xterm sizing issues
- Uses a ResizeObserver + visibility check to initialize once visible

### CWD Verification (Planned)
- After spawn, send an explicit `cd "<projectRoot>"` and `pwd` to verify cwd on shells that override working directory

## Unavailable Terminal (node-pty)

When `node-pty` is unavailable (not built or failed to load):

- Terminal panel shows a clear "Terminal Not Available" message
- Actions:
  - Recheck (debounced) — attempts a quick availability check
  - Copy Fix Command — copies `npm rebuild node-pty --build-from-source`

```

## Integration Points

### Activity Bar Toggle
**File**: `src/renderer/src/components/DockLayout/AppDockLayout.tsx`

- Terminal icon in right activity bar (bottom position)
- Toggles terminal splitview panel visibility

### Context Menu Integration
**File**: `src/renderer/src/components/ContextMenu/PreviewContextMenu.tsx`

**"Send Selection to Terminal"** menu item:
1. Opens terminal panel (if closed)
2. Waits 100ms for initialization
3. Calls `sendToTerminal(selectedText)`
4. Shows success/error toast

### Keyboard Shortcuts
**Global**: `Cmd/Ctrl+J` - Toggle terminal panel (works anywhere in app)

## Known Issues

### node-pty Build Failure (Python 3.13)

**Status**: Terminal feature deferred until resolved

**Issue**: node-pty fails to build with Python 3.13 due to native module compilation

**Current State**: Terminal panel implemented but may not work if node-pty build failed

**Workaround**: Use Python 3.12 or earlier for development

```bash
# Check if node-pty is available
await window.api.terminal.isAvailable()
// Returns: {available: boolean}
```

**References**:
- [node-pty GitHub Issues](https://github.com/microsoft/node-pty/issues)
- [Electron Rebuild Docs](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

### WebGL Context Loss

**Symptom**: Terminal rendering stops after GPU driver issues

**Solution**: Auto-handled with context loss listener
```typescript
webglAddon.onContextLoss(() => {
  webglAddon.dispose()
  // Falls back to canvas renderer
})
```

### Terminal Appears Empty/Black

**Causes**:
1. xterm.js opened on hidden element (display:none)
2. Canvas renderer failure in Electron
3. useEffect cleanup disposing xterm too early

**Solutions**:
1. ✅ Visibility check before initialization
2. ✅ WebGL renderer as primary (canvas fallback)
3. ✅ useRef pattern to avoid cleanup issues

## Troubleshooting

### Terminal Not Available

**Check**:
```typescript
const result = await window.api.terminal.isAvailable()
if (!result.available) {
  // node-pty not available
  // Check build logs for native module errors
}
```

### Terminal Not Resizing

**Verify**:
- ResizeObserver is attached to terminalRef.current
- fitAddon.fit() is being called
- window.api.terminal.resize() is called with new dimensions

**Debug**:
```typescript
console.log('Terminal dimensions:', xterm.cols, xterm.rows)
console.log('Container dimensions:', container.getBoundingClientRect())
```

### Commands Not Found

**Problem**: Commands installed via Homebrew or in shell RC files aren't accessible

**Solution**: This is now fixed! Terminal uses login shell (-l) which sources RC files, so Homebrew paths and custom aliases are available.

**Verify**:
```bash
which npm         # Should find npm
echo $PATH        # Should include /opt/homebrew/bin and other Homebrew paths
```

**If still not found**:
1. Close ERFANA
2. Verify command works in native terminal (e.g., `which npm`)
3. Restart ERFANA - terminal should inherit environment

### Bold Text Not Rendering

**Verify**:
```typescript
fontWeight: 'normal'
fontWeightBold: 'bold'  // Must be explicitly set
```

## References

- [xterm.js Documentation](https://xtermjs.org/docs/)
- [xterm.js API Reference](https://github.com/xtermjs/xterm.js/blob/master/typings/xterm.d.ts)
- [node-pty GitHub](https://github.com/microsoft/node-pty)
- [Terminal Emulator Basics](https://en.wikipedia.org/wiki/Terminal_emulator)
- [ANSI Escape Codes](https://en.wikipedia.org/wiki/ANSI_escape_code)

## Related Documentation

- [UI Components](./ui-components.md) - Terminal panel UI integration
- [Architecture](./architecture.md) - TerminalService in service layer
- [IPC Patterns](./ipc-patterns.md) - Terminal IPC communication patterns
- [Known Issues](./known-issues.md) - node-pty build issues
