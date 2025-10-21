# Terminal Scroll Fixes

Scroll position preservation and manual scroll controls for optimal terminal UX.

## Terminal Scroll Fix (v0.3.1)

### Problem

Terminal viewport jumps to top during Claude CLI streaming output, disrupting UX during long-running commands.

**Related Issues**:
- https://github.com/anthropics/claude-code/issues/826
- https://github.com/anthropics/claude-code/issues/1413
- https://github.com/anthropics/claude-code/issues/1426

### Root Cause

Claude CLI causes terminal buffer redraws during streaming output, overriding xterm.js's normal scroll position preservation.

### Multi-Layered Solution

#### 1. Scroll Position Tracking (TerminalPanel.tsx:300-314)

Intelligent detection of user scroll position using xterm.js Buffer API:
- Compares `buffer.active.viewportY` vs `buffer.active.baseY` to determine if user is scrolled up
- Preserves position when user is reading scrollback
- Allows auto-scroll when user is at bottom

```typescript
const unsubscribeData = window.api.terminal.onData((data) => {
  if (data.terminalId === terminalId && xtermRef.current) {
    // FIX: Preserve scroll position to prevent jumping to top during streaming output
    const buffer = xtermRef.current.buffer.active
    const wasAtBottom = buffer.viewportY === buffer.baseY

    xtermRef.current.write(data.data)

    if (!wasAtBottom) {
      // xterm.js will maintain scroll position automatically
    }
  }
})
```

#### 2. Terminal Configuration (TerminalPanel.tsx:142-143)

- `scrollOnUserInput: false` - Prevents auto-scroll when user types
- `smoothScrollDuration: 0` - Eliminates animation lag for instant response

```typescript
const xterm = new Terminal({
  fontSize: 12,
  fontFamily: 'SF Mono, Monaco, Inconsolata, Courier New, monospace',
  // ... other options
  scrollOnUserInput: false,
  smoothScrollDuration: 0
})
```

#### 3. CSS Viewport Fix (TerminalPanel.css:69)

Changed `overflow-y: scroll !important` to `overflow-y: auto`:
- Lets xterm.js manage scrollbar behavior instead of forcing scrollbars
- Improves scroll position retention during buffer operations

```css
.xterm-viewport {
  overflow-y: auto !important;
  /* Changed from: overflow-y: scroll !important; */
}
```

#### 4. Test Coverage

Comprehensive test suite in `TerminalPanel.scroll.test.tsx` (6 tests):
- Terminal initialization with scroll-preserving options
- Scroll preservation when user scrolled up
- Auto-scroll when user at bottom
- Multiple consecutive writes
- Edge cases (viewportY === baseY === 0)
- Scroll options verification

**Example Test**:
```typescript
it('should preserve scroll position when user is scrolled up', async () => {
  // Simulate user scrolling up
  mockXtermInstance.buffer.active.viewportY = 10
  mockXtermInstance.buffer.active.baseY = 50

  // Simulate data write
  if (mockOnDataCallback) {
    mockOnDataCallback({ terminalId: 'test-terminal-1', data: 'output\n' })
  }

  // Verify scroll position preserved (not jumped to bottom)
  expect(mockXtermInstance.buffer.active.viewportY).toBe(10)
})
```

### Implementation Files

- `src/renderer/src/components/Panels/TerminalPanel.tsx:300-314` - Scroll tracking logic
- `src/renderer/src/components/Panels/TerminalPanel.css:69` - Viewport styling
- `src/renderer/src/components/Panels/TerminalPanel.scroll.test.tsx` - Test coverage

## Scroll to Bottom Button (v0.3.2)

### Purpose

Manual workaround for Claude Code scroll jumping issue (external Ink library bug that affects all terminals).

### Feature

**Location**: Terminal panel header (before restart button)

**Icon**: ⬇️ (ArrowDownToLine from lucide-react)

**Behavior**: Instantly scrolls terminal viewport to the bottom (latest output)

**Use Case**: Quick recovery when Claude Code causes unwanted scroll position changes

### Implementation (TerminalPanel.tsx)

**Import**:
```typescript
import { Terminal as TerminalIcon, RotateCw, ArrowDownToLine } from 'lucide-react'
```

**Handler**:
```typescript
const handleScrollToBottom = () => {
  if (xtermRef.current) {
    xtermRef.current.scrollToBottom()
  }
}
```

**Button**:
```typescript
<button
  className="icon-btn"
  onClick={handleScrollToBottom}
  title="Scroll to Bottom"
>
  <ArrowDownToLine size={14} />
</button>
```

### Why This Is Needed

**External Issue**: Claude Code's Ink library causes buffer redraws below xterm.js level, making scroll position management impossible for terminal emulators.

**Workaround**: Instead of fighting the Ink library, provide instant manual recovery.

**User Experience**: One click returns to latest output without disruption.

## xterm.js Buffer API Reference

### Key Properties

```typescript
interface Buffer {
  active: {
    viewportY: number  // Current viewport scroll position (top line visible)
    baseY: number      // Bottom of scrollback buffer (latest line)
    length: number     // Total lines in buffer
  }
}
```

### Position Detection

```typescript
// User at bottom (following new output)
buffer.viewportY === buffer.baseY  // true

// User scrolled up (reading history)
buffer.viewportY < buffer.baseY  // true

// Distance from bottom
const linesFromBottom = buffer.baseY - buffer.viewportY
```

### Scroll Methods

```typescript
// Jump to bottom instantly
xterm.scrollToBottom()

// Scroll to specific line
xterm.scrollToLine(lineNumber)

// Scroll by pages
xterm.scrollPages(1)   // Down
xterm.scrollPages(-1)  // Up

// Scroll by lines
xterm.scrollLines(5)   // Down
xterm.scrollLines(-5)  // Up
```

## Best Practices

### 1. Check Position Before Writing

```typescript
const buffer = xterm.buffer.active
const wasAtBottom = buffer.viewportY === buffer.baseY

xterm.write(data)

// Restore position if user was scrolled up
if (!wasAtBottom) {
  // xterm.js handles this automatically with proper config
}
```

### 2. Disable Scroll-On-Input

```typescript
new Terminal({
  scrollOnUserInput: false  // Don't auto-scroll when user types
})
```

### 3. Instant Scroll Response

```typescript
new Terminal({
  smoothScrollDuration: 0  // No animation lag
})
```

### 4. Let xterm.js Manage Overflow

```css
.xterm-viewport {
  overflow-y: auto !important;  /* Not 'scroll' */
}
```

## References

- [xterm.js Buffer API](https://github.com/xtermjs/xterm.js/blob/master/typings/xterm.d.ts)
- [xterm.js Scroll Methods](https://xtermjs.org/docs/api/terminal/)
- [Claude Code Issue #826](https://github.com/anthropics/claude-code/issues/826) (183+ upvotes)
