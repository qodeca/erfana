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
- **Scroll to Bottom**: ⬇️ button in panel header - Jump to latest output
- **Scroll Lock**: 🔒 button in panel header - Lock scroll to always stay at bottom
- **Restart**: 🔄 button in panel header - Kill and restart terminal session

## Features

### Auto-Open on Project Load (v0.6.3)

Terminal panel automatically opens when a project loads, providing immediate shell access.

**Behavior**:
- Opens automatically on Recent Projects selection or File > Open
- Tracks user intent: if user closes terminal, it stays closed until next project load
- Ephemeral state (`terminalUserClosed`) resets on project change

**Implementation**:
- Hook: `useAutoOpenTerminal` integrates with `useProjectChangedEffect`
- Store: `useActivityBarStore.terminalUserClosed` tracks manual closes
- Reset: `resetTerminalUserClosed()` called on project change

**Files**:
- `src/renderer/src/hooks/useAutoOpenTerminal.ts`
- `src/renderer/src/stores/useActivityBarStore.ts`

### Clipboard Support (v0.4.7)

Full copy/paste operations with keyboard shortcuts and context menu.

**Keyboard Shortcuts**:
- **Smart Ctrl/Cmd+C**: Copies text when selected, sends SIGINT when no selection
- **Cmd+V / Ctrl+V**: Paste (handled natively by xterm.js)
- **Ctrl+Shift+C / Ctrl+Shift+V**: Explicit copy/paste (Windows/Linux style)

**Context Menu**:
- Right-click opens context menu with Copy and Paste options
- Copy is disabled when no text is selected
- Platform-specific shortcut display (⌘C/⌘V on macOS, Ctrl+C/Ctrl+V on Windows)

**Behavior**:
- Selection preserved after copy (VS Code behavior)
- Toast notification on copy success
- Pure logic extraction pattern: `terminalClipboard.logic.ts` for testability

**Files**:
- `src/renderer/src/components/Panels/Terminal/terminalClipboard.logic.ts`
- `src/renderer/src/components/Panels/Terminal/useTerminalClipboard.ts`
- `src/renderer/src/components/Panels/Terminal/TerminalContextMenu.tsx`

### Smart File Path Links (v0.5.0)

Clickable file path links in terminal output with intelligent path resolution.

**Base Features**:
- Detects absolute, relative, and project-relative paths
- Supports line:column notation (`:42:10`, `(15,3)`)
- Path validation with LRU cache (100 entries, 30s TTL)
- Click to open file in editor at specified location

**Smart Resolution**:
- Falls back to filename search when exact path not found
- FilePickerDialog for disambiguation when multiple files match
- Keyboard navigation (Arrow Up/Down, Enter to select, Escape to cancel)

**Paths with Spaces Support** (VS Code-style fallback matchers):
- Detects paths with spaces on their own line
- Python error format: `File "/path/with spaces/file.py", line 42`
- Windows paths: `C:\Program Files\My App\app.exe`
- Bullet point lists: `- /path/to my/project/file.ts`
- Based on VS Code Issue #97941 and PR #43733

**Architecture** (Pure Logic Extraction):
- `filenameIndex.ts`: Map-based O(1) filename lookup
- `pathScoring.ts`: Candidate ranking algorithm
- `smartPathResolver.logic.ts`: Resolution orchestration
- `useFilenameIndex.ts`: Lazy index management hook
- `FilePickerDialog.tsx`: Disambiguation UI component
- `filePathLinks.logic.ts`: Fallback matchers for paths with spaces

**Files**:
- `src/renderer/src/components/Panels/Terminal/FileLinks/`

### Scroll Lock Toggle (v0.6.0)

Proactive scroll protection via a toggle button that locks terminal to always stay at bottom.

**Behavior**:
- Toggle button in terminal toolbar (also available in ChatBubble header)
- When ON: Blocks all scroll-up attempts (mouse wheel, PageUp/Home/ArrowUp, scrollbar drag)
- When OFF: Normal scroll behavior restored
- Default: OFF (user enables when needed)
- Ephemeral: State resets on app restart (not saved to settings)

**Icons**:
- 🔓 `LockKeyholeOpen` - Unlocked (scroll lock disabled)
- 🔒 `LockKeyhole` - Locked (scroll lock enabled, with accent color highlight)

**Implementation**:
Three complementary mechanisms ensure scroll lock works reliably:
1. **Wheel event handler**: Intercepts `WheelEvent`, blocks `deltaY < 0` (scroll up)
2. **Keyboard handler wrapper**: Blocks PageUp/Home/ArrowUp keys when locked
3. **Polling watcher**: 100ms interval detects scrollbar drag, snaps back to bottom

**Architecture** (Pure Logic Extraction):
- `useScrollLock.ts`: Hook encapsulating all three blocking mechanisms
- `useTerminalStore.scrollLocked`: Global boolean state (single terminal architecture)
- `TerminalPortalContext.TerminalControls`: `isScrollLocked()`, `toggleScrollLock()` for ChatBubble access

**Coordination**:
- When lock engages, calls `resetAll()` from `useScrollAnomalyRecovery` to clear recovery queue
- Prevents conflict between proactive lock and reactive recovery mechanisms

**Files**:
- `src/renderer/src/hooks/useScrollLock.ts` (130 lines)
- `src/renderer/src/hooks/useScrollLock.test.ts` (22 tests)

**Related issues**:
- #60 - Add scroll-lock button to terminal toolbar
- #12, #22, #52 - Previous reactive scroll recovery (now complemented by proactive lock)

### Forced Scroll-to-Bottom After Prompt Execution (v0.5.4)

Automatic scroll to bottom 1 second after executing prompt templates, respecting user scroll intent.

**Behavior**:
- Terminal scrolls to bottom 1 second after prompt execution completes
- Skips scroll if user manually scrolled during the 1-second delay window
- Works with all prompt templates: Elaborate, Modify, Ask, diagram chat, Mermaid directions, import organization

**Architecture** (Pure Logic Extraction):
- `promptScrollScheduler.logic.ts`: Timestamp-based scheduling with user scroll detection
- `didUserScrollRecently()`: Checks if user scrolled within delay window
- `scheduleScrollIfNeeded()`: Coordinates scroll with terminal readiness and user intent
- Integrates with `useScrollAnomalyRecovery` via `lastUserScrollTsRef`

**Edge Cases Handled**:
- Terminal not ready → Graceful skip
- Controls unavailable → Graceful skip
- User scrolls during delay → Scroll cancelled
- Rapid execution → Independent scheduling

**Files**:
- `src/renderer/src/utils/promptScrollScheduler.logic.ts` (141 lines)
- `src/renderer/src/utils/promptScrollScheduler.logic.test.ts` (871 lines, 66 tests)

**Integration Points** (6 call sites):
- PreviewContextMenu (Elaborate, Modify, Ask)
- ChatBubble (diagram chat + direction changes)
- MermaidToolbar (direction buttons)
- MermaidDiagram (bug report)
- useImport (organize-import)

See [Scroll Fixes](./scroll-fixes.md) for related scroll preservation features.

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

### Terminal Initialization

**Clean Start Behavior**: Terminal uses a non-interactive bootstrap pattern to eliminate initialization artifacts and provide a clean user experience.

See [Bootstrap Pattern](./bootstrap-pattern.md) for detailed initialization documentation.

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
  write(terminalId: string, data: string): Promise<boolean>  // v0.3.3: Promise-based with completion callback
  resize(terminalId: string, cols: number, rows: number): boolean

  // Info
  getTerminalInfo(terminalId: string): {...} | null
  listTerminals(): Array<{id: string; title: string}>
}

export const terminalService = new TerminalService()
```

**Pattern**: OOP service with singleton instance (follows FileService pattern)

**v0.3.3 Enhancement**: The `write()` method now returns a Promise that resolves when the write operation completes. This enables reliable autoExecute behavior for prompt templates, preventing race conditions between text write and Enter key. See [Prompt Templates - Implementation Guide](../prompts/implementation.md) for details.

### IPC Handlers

**File**: `src/main/ipc/terminal-handlers.ts` (~120 lines)

**Exposed via contextBridge**:
```typescript
window.api.terminal = {
  isAvailable: (terminalId?) => Promise<{success, available, initialized?}>
  create: (config) => Promise<{success, terminalId?, error?}>
  write: (terminalId, data) => Promise<{success, error?}>  // v0.3.3: Promise-based
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
  sendToTerminal: (text: string, autoExecute?: boolean) => Promise<boolean>  // v0.3.3: autoExecute support
}
```

**Purpose**: Cross-component communication (PreviewContextMenu → Terminal Panel)

**v0.3.3 Enhancement**: `sendToTerminal()` now supports `autoExecute` parameter to automatically send Enter key after text. Includes initialization polling (5s timeout, 50ms intervals) to prevent race conditions. See [Prompt Templates - Implementation Guide](../prompts/implementation.md).

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

## Related Documentation

- [Bootstrap Pattern](./bootstrap-pattern.md) - Clean initialization without artifacts
- [Scroll Fixes](./scroll-fixes.md) - v0.3.1 scroll preservation and scroll to bottom button
- [Flickering Prevention](./flickering-prevention.md) - v0.3.2 rendering stability fixes
- [Troubleshooting](./troubleshooting.md) - Known issues and solutions
- [UI Components](../ui-components.md) - Terminal panel UI integration
- [Architecture](../architecture.md) - TerminalService in service layer
- [IPC Patterns](../ipc-patterns.md) - Terminal IPC communication patterns
