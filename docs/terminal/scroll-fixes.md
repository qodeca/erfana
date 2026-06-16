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

Changed `overflow-y: scroll !important` to `overflow-y: hidden` (updated in v6 upgrade):
- xterm v6 uses DomScrollableElement for scrolling – native scrollbar is no longer needed
- Prevents double scrollbar (native + custom widget)

```css
.xterm-viewport {
  overflow-y: hidden;
  /* v6: DomScrollableElement handles scrolling via its own custom scrollbar widget */
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
  overflow-y: hidden;  /* v6: DomScrollableElement handles scrolling via its own widget */
}
```

## Flicker-Free Scroll Recovery (v0.5.4) 🎉

### Problem Solved

**Before**: Terminal scroll recovery was visible as flicker - scroll jumps to top, brief pause, then recovers.
**After**: **No visible flicker** - scroll position restored in same frame via xterm.js parser hooks.

**Related Issues**:
- [Claude Code #826](https://github.com/anthropics/claude-code/issues/826) (183+ upvotes)
- [Claude Code #10769](https://github.com/anthropics/claude-code/issues/10769)
- [Internal #12](https://github.com/user/erfana/issues/12), [#22](https://github.com/user/erfana/issues/22)

### Root Cause

Claude Code's Ink library sends `\x1b[2J` (ED 2 - clear screen) and `\x1b[3J` (ED 3 - clear scrollback) when output exceeds terminal height. Previous approach detected these AFTER execution, causing visible scroll jump before recovery.

### Solution: Two-Layer Defense

#### Layer 1: Parser Hooks (Primary - No Flicker)

xterm.js parser API intercepts ED sequences **BEFORE** they execute:

```
PTY Data → Parser Hook → Save Position → Let Execute → Restore (microtask)
                ↑                                          ↑
            SYNCHRONOUS                              SAME FRAME
```

**Key Features**:
- Intercepts CSI ED 2/3 sequences before viewport updates
- Saves `viewportY` and `baseY` synchronously
- Restores position via `queueMicrotask()` in same frame
- 16ms debouncing for rapid ED2+ED3 sequences
- 300ms user scroll cooldown (respects manual scrolling)

#### Layer 2: Fallback Recovery (50ms interval)

Multi-signal detection catches edge cases parser hooks miss:

| Signal | Detection | Purpose |
|--------|-----------|---------|
| **Escape Sequences** | `\x1b[2J`, `\x1b[3J` via regex | Backup detection |
| **Buffer Truncation** | baseY shrinks ≥10 lines | Catches buffer wipes |
| **Position-Based** | Jump ≥10 lines to near-top | Fallback for anomalies |
| **User Activity** | Wheel/touch/keyboard scroll | Suppresses recovery |

### Architecture

```
useTerminalParserHooks.ts     xterm.js parser integration
├── registerHooks()           Register CSI handler for 'J' (ED)
├── scheduleRestore()         Debounce + queueMicrotask restoration
├── isScrollAffectingED()     Check if ED param is 2 or 3
├── calculateRestoredPosition() Smart recovery positioning
└── shouldSkipRestoration()   User scroll cooldown check

scrollAnomalyDetector.ts      Pure detection logic (fallback)
├── isAnomalousScroll()       Position-based detection
├── detectClearSequences()    Escape sequence detection (ED 2/3)
├── hasDestructiveClearSequence()  Check for destructive sequences
├── wasBufferTruncated()      Buffer shrinkage detection
└── calculateRecoveryTarget() Smart recovery positioning

useScrollAnomalyRecovery.ts   React hook (fallback)
├── wrapOnDataHandler()       Wraps terminal data handler
├── performRecovery()         Smart recovery with position targeting
├── Coordination              Skips if parserHandledRef is true
└── Fixed-interval check      50ms interval (down from 100ms)
```

### Coordination Mechanism

Prevents double-recovery when both layers trigger:

```typescript
// Parser hooks set flag when handling
parserHandledRef.current = true

// Fallback checks flag before recovering
if (parserHandledRef?.current) {
  anomalyCountRef.current = 0  // Reset, parser already handled
  return
}
```

### Configuration

**Parser Hooks** (Primary):
```typescript
{
  enabled: true,
  lastUserScrollTsRef: ref,   // Shared user scroll tracking
  onIntercept: (type) => {}   // Debug callback
}
```

**Fallback Recovery**:
```typescript
{
  userScrollRecencyMs: 300,      // User scroll cooldown
  dataStreamRecencyMs: 500,      // Data streaming window
  jumpThresholdLines: 10,        // Min lines for anomaly
  nearTopThreshold: 3,           // Lines from top = "near top"
  recoveryIntervalMs: 50,        // 50ms fallback (was 100ms)
  bufferTruncationThreshold: 10, // Min baseY shrinkage
  parserHandledRef: ref          // Coordination flag
}
```

### Test Coverage

- **Parser Hooks** (`useTerminalParserHooks.test.ts`): ED 2/3 detection, position restoration, user scroll cooldown, integration scenarios
- **Fallback Detection** (`scrollAnomalyDetector.test.ts`): Position-based detection, escape sequence detection, buffer truncation, recovery target calculation
- **Fallback Hook** (`useScrollAnomalyRecovery.test.ts`): Fixed-interval queue, coordination with parser hooks, keyboard scroll detection, RAF cancellation

### Implementation Files

**Parser Hooks (Primary)**:
- `src/renderer/src/hooks/useTerminalParserHooks.ts` - CSI handler registration
- `src/renderer/src/hooks/useTerminalParserHooks.test.ts` - 24 pure logic tests

**Fallback System**:
- `src/renderer/src/utils/scrollAnomalyDetector.ts` - Pure detection logic
- `src/renderer/src/hooks/useScrollAnomalyRecovery.ts` - React hook with coordination
- `src/renderer/src/components/Panels/TerminalPanel.tsx` - Integration

### Why Two Layers?

1. **Parser Hooks**: Eliminates flicker entirely (same-frame restoration)
2. **Fallback**: Defense-in-depth for edge cases (split sequences, timing issues)
3. **Coordination**: Prevents double-recovery when both trigger
4. **Faster Fallback**: 50ms interval (down from 100ms) for quicker edge case handling

### Technical References

- [xterm.js Parser Hooks Guide](https://xtermjs.org/docs/guides/hooks/)
- [xterm.js IParser API](https://xtermjs.org/docs/api/terminal/interfaces/iparser/)
- [ED Sequence Behavior Issue](https://github.com/xtermjs/xterm.js/issues/1727)

## References

- [xterm.js Buffer API](https://github.com/xtermjs/xterm.js/blob/master/typings/xterm.d.ts)
- [xterm.js Scroll Methods](https://xtermjs.org/docs/api/terminal/)
- [Claude Code Issue #826](https://github.com/anthropics/claude-code/issues/826) (183+ upvotes)
- [xterm.js onScroll Limitation](https://github.com/xtermjs/xterm.js/issues/3864)
