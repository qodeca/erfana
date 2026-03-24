# Terminal Troubleshooting

Known issues, common problems, and solutions for ERFANA's terminal panel.

## Known Issues

### Claude Code Scroll Jumping (External Issue)

**Status**: NOT an ERFANA bug - Claude CLI Ink library issue

**Issue**: When running Claude Code inside ERFANA's terminal, the viewport may jump to top repeatedly during streaming output, creating a "stroboscope effect."

**Root Cause**: Claude Code's Ink library (terminal UI framework) causes background buffer redraws that override scroll position management. This affects **ALL** terminals universally (VS Code, IntelliJ, iTerm2, GNOME Terminal, Cursor, Ghostty).

**Evidence**:
- GitHub Issue [anthropics/claude-code#826](https://github.com/anthropics/claude-code/issues/826) (183+ upvotes, 134 comments)
- GitHub Issue [anthropics/claude-code#1413](https://github.com/anthropics/claude-code/issues/1413) (Laggy scrolling with long history)
- Affects IDE-integrated terminals universally across all platforms
- Works correctly in native terminal windows
- ERFANA's scroll preservation logic is correctly implemented per xterm.js best practices

**Symptoms**:
- Scrolls to top every 1/10 second or 10-20 seconds
- Painful flashing/flickering that makes reading difficult
- Triggers after 5-6 pages of scrollback history accumulate
- Occurs when typing prompts, when Claude adds text, or reviewing diffs

**Workarounds**:
- **Built-in Helper**: ERFANA v0.3.2+ includes a "Scroll to Bottom" button (⬇️ icon) in the terminal header to instantly jump to the latest output. Use this when Claude Code causes unwanted scroll jumping.
- **Recommended**: Run Claude Code in a native terminal window (Terminal.app, iTerm2, etc.) instead of ERFANA's integrated terminal
- Resize ERFANA window (temporarily fixes until next buffer redraw)
- Select response options to pause scrolling during diffs
- Clear terminal history periodically

**ERFANA Implementation Status**: ✅ Correctly implements all xterm.js scroll preservation best practices:
- `scrollOnUserInput: false` - Prevents auto-scroll when typing
- Buffer API scroll position tracking (`viewportY` vs `baseY`)
- `smoothScrollDuration: 0` - Instant scroll response
- `overflow-y: hidden` - xterm v6 DomScrollableElement manages scrolling

**Why ERFANA Can't Fix This**: The issue is in Claude Code's closed-source Ink library, which controls terminal rendering and line management. The buffer redraws happen at a level below xterm.js's scroll management, making it impossible for terminal emulators to prevent.

**Related**: See [Scroll Fixes](./scroll-fixes.md) for ERFANA's scroll preservation implementation

---

### node-pty Build Failure (Python 3.13)

**Status**: Terminal feature deferred until resolved

**Issue**: node-pty fails to build with Python 3.13 due to native module compilation

**Error**:
```
ModuleNotFoundError: No module named 'distutils'
```

**Current State**: Terminal panel implemented but may not work if node-pty build failed

**Workaround**: Use Python 3.12 or earlier for development

```bash
# Check if node-pty is available
await window.api.terminal.isAvailable()
// Returns: {available: boolean}
```

**Solution**:
- Downgrade to Python 3.12, OR
- Wait for node-pty update

**References**:
- [node-pty GitHub Issues](https://github.com/microsoft/node-pty/issues)
- [Electron Rebuild Docs](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

---

### WebGL Context Loss

**Symptom**: Terminal rendering stops after GPU driver issues

**Cause**: GPU driver crash, device change, or power management

**Solution**: Auto-handled with context loss listener (v0.3.2+)

```typescript
webglAddon.onContextLoss(() => {
  webglAddon.dispose()
  // Attempts recovery after 100ms
  // Falls back to canvas renderer after second failure
})
```

**User Action**: None required - automatic recovery in v0.3.2

**Related**: See [Flickering Prevention](./flickering-prevention.md) for recovery implementation

---

### Terminal Appears Empty/Black

**Causes**:
1. xterm.js opened on hidden element (display:none)
2. Canvas renderer failure in Electron
3. useEffect cleanup disposing xterm too early

**Solutions**:
1. ✅ Visibility check before initialization
2. ✅ WebGL renderer as primary (canvas fallback)
3. ✅ useRef pattern to avoid cleanup issues

**Implementation** (`TerminalPanel.tsx`):
```typescript
// Check visibility before init
if (!isElementVisible(terminalRef.current)) {
  return
}

// Load WebGL AFTER open
xterm.open(container)
const webglAddon = new WebglAddon()
xterm.loadAddon(webglAddon)

// Use ref to avoid cleanup issues
const terminalIdRef = useRef<string | null>(null)
```

---

### Project Switching & Safety

#### Recent Activity Detection
- Tracks activity per-terminal on both output and user input
- Ignores shell warm-up noise for ~500ms after spawn
- Uses a default 20s window to consider an active session "busy"
- On project open/close, if busy, a confirmation dialog appears
- On confirm, the app sends Ctrl+C, waits briefly, and proceeds; clears activity if quiet

#### Deferred Initialization
- Terminal initialization is deferred when the panel is hidden to avoid xterm sizing issues
- Uses a ResizeObserver + visibility check to initialize once visible

#### CWD Verification
- After spawn, TerminalService explicitly sets and verifies cwd to ensure shells that override startup directories are corrected
- Implementation: sends platform-specific `cd` + prints `pwd` followed by a unique marker; updates cached cwd when detected

**Platform Details**:
- macOS/Linux: `cd "<projectRoot>" && printf "%s\n" "$(pwd)" && echo <MARKER>`
- Windows (PowerShell): `Set-Location -Path "<projectRoot>" ; Write-Output (Get-Location).Path ; Write-Output <MARKER>`
- Windows (cmd.exe): `cd /d "<projectRoot>" & cd & echo <MARKER>`

**References**:
- Main: `src/main/services/TerminalService.ts`
- Tests: `src/main/services/TerminalService.test.ts`

---

## Common Problems

### Terminal Not Available

**Symptom**: Terminal panel shows "Terminal Not Available" message

**Check**:
```typescript
const result = await window.api.terminal.isAvailable()
if (!result.available) {
  // node-pty not available
  // Check build logs for native module errors
}
```

**Actions**:
- Recheck (debounced) — attempts a quick availability check
- Copy Fix Command — copies `npm rebuild node-pty --build-from-source`

**Solution**: Rebuild node-pty
```bash
npm rebuild node-pty --build-from-source
```

---

### Terminal Not Resizing

**Symptom**: Terminal dimensions don't change when panel is dragged

**Verify**:
- ResizeObserver is attached to terminalRef.current
- fitAddon.fit() is being called
- window.api.terminal.resize() is called with new dimensions

**Debug**:
```typescript
console.log('Terminal dimensions:', xterm.cols, xterm.rows)
console.log('Container dimensions:', container.getBoundingClientRect())
```

**Common Cause**: Terminal not visible when ResizeObserver triggers

**Solution**: Ensure terminal is visible before calling fit()

---

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
3. Check your shell RC files (.zshrc, .bash_profile)
4. Restart ERFANA - terminal should inherit environment

**Environment Variables**: Terminal uses filtered environment (see [Bootstrap Pattern](./bootstrap-pattern.md))

---

### Bold Text Not Rendering

**Symptom**: All text appears same weight, no bold highlighting

**Verify Configuration**:
```typescript
new Terminal({
  fontWeight: 'normal',
  fontWeightBold: 'bold'  // Must be explicitly set
})
```

**Common Cause**: Missing `fontWeightBold` property

**Solution**: Add `fontWeightBold: 'bold'` to terminal options

---

### Terminal Input Lag

**Symptom**: Noticeable delay between typing and characters appearing

**Causes**:
1. WebGL renderer disabled (using slow canvas renderer)
2. High devicePixelRatio causing frequent resizes
3. Large scrollback buffer (> 10,000 lines)

**Solutions**:
1. Check WebGL is enabled (see [Flickering Prevention](./flickering-prevention.md))
2. Clear scrollback: `Cmd/Ctrl+K` or restart terminal
3. Reduce buffer size in terminal options (if needed)

**Debug**:
```typescript
// Check if WebGL is active
console.log('Using WebGL:', xterm.element?.querySelector('canvas')?.classList.contains('xterm-webgl'))
```

---

### Terminal Disconnects/Freezes

**Symptom**: Terminal stops responding to input or output

**Common Causes**:
1. PTY process crashed
2. Terminal panel hidden when xterm initialized
3. WebGL context loss without recovery

**Immediate Fix**: Click Restart button (🔄) in terminal header

**Prevention**:
- v0.3.2+ includes WebGL recovery
- Visibility checks prevent initialization issues
- PTY error handlers log crashes

**Check Logs**:
```typescript
// Main process logs
console.log('Terminal process state:', terminalService.getTerminalInfo(terminalId))

// Renderer logs
console.log('xterm state:', xterm.buffer.active)
```

---

## Debugging Tips

### Enable Verbose Logging

**Main Process** (`TerminalService.ts`):
```typescript
console.log('[Terminal]', terminalId, 'Created:', config)
console.log('[Terminal]', terminalId, 'Data:', data.length, 'bytes')
console.log('[Terminal]', terminalId, 'Exit:', { exitCode, signal })
```

**Renderer** (`TerminalPanel.tsx`):
```typescript
console.log('[TerminalPanel] Initializing:', terminalId)
console.log('[TerminalPanel] WebGL loaded')
console.log('[TerminalPanel] Resized:', cols, rows)
```

### Inspect Terminal State

```typescript
// Get terminal instance
const info = await window.api.terminal.getTerminalInfo(terminalId)
console.log('Terminal info:', info)

// Check xterm state
console.log('xterm cols/rows:', xterm.cols, xterm.rows)
console.log('Buffer size:', xterm.buffer.active.length)
console.log('Viewport position:', xterm.buffer.active.viewportY)
```

### Test node-pty Availability

```typescript
const result = await window.api.terminal.isAvailable()
console.log('node-pty available:', result.available)

if (!result.available) {
  console.log('Rebuild node-pty:', 'npm rebuild node-pty --build-from-source')
}
```

### Monitor WebGL Context

```typescript
webglAddon.onContextLoss(() => {
  console.warn('⚠️ WebGL context lost')
  // Check GPU state, driver issues
})
```

---

## References

- [xterm.js Documentation](https://xtermjs.org/docs/)
- [xterm.js API Reference](https://github.com/xtermjs/xterm.js/blob/master/typings/xterm.d.ts)
- [node-pty GitHub](https://github.com/microsoft/node-pty)
- [Terminal Emulator Basics](https://en.wikipedia.org/wiki/Terminal_emulator)
- [ANSI Escape Codes](https://en.wikipedia.org/wiki/ANSI_escape_code)

## Related Documentation

- [Terminal Overview](./README.md) - Main terminal documentation
- [Bootstrap Pattern](./bootstrap-pattern.md) - Clean initialization
- [Scroll Fixes](./scroll-fixes.md) - Scroll position preservation
- [Flickering Prevention](./flickering-prevention.md) - Rendering stability
- [Known Issues](../known-issues.md) - Project-wide known issues
- [UI Components](../ui-components.md) - Terminal panel UI integration
