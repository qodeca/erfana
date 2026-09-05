# Advanced Troubleshooting

Advanced troubleshooting for Terminal, Performance, UI/Layout, and Development issues.

## Overview

This guide covers advanced troubleshooting topics. For basic troubleshooting (Installation, File System, Markdown, Terminal), see [Troubleshooting Guide](./troubleshooting.md). For detailed terminal issues, see [Terminal Troubleshooting](./terminal/troubleshooting.md).

## Performance

### Large File Slow to Open

**Symptom:** Monaco editor freezes when opening large files

**Workaround:**
1. Use preview-only mode for very large files
2. Consider splitting large files into smaller chunks

**Future Enhancement:**
Virtual scrolling for Monaco editor (planned).

---

### High Memory Usage

**Symptom:** Erfana using excessive RAM

**Common Causes:**
- Too many open editor tabs
- Large file contents in memory
- Terminal buffer accumulation

**Solutions:**
1. Close unused editor tabs
2. Clear terminal buffers:
   ```typescript
   xterm.clear()  // TerminalPanel.tsx – the xterm.js Terminal instance
   ```
3. Restart Erfana if memory continues to grow

---

## UI/Layout

### Panel Won't Resize

**Symptom:** Resize cursor shows but dragging does nothing

**Cause:** This was a known issue, resolved in v0.1.0 with hybrid layout refactoring.

**Verification:**
Ensure using SplitviewReact (outer) + DockviewReact (center):
```tsx
<Splitview>  {/* Outer 3-column layout */}
  <Panel id="left">Project</Panel>
  <Panel id="center">
    <Dockview>  {/* Editor tabs only */}
      ...
    </Dockview>
  </Panel>
  <Panel id="right">Terminal/Git</Panel>
</Splitview>
```

**See:** [Resolved issues – Panel resizing (v0.1.0)](./archive/resolved-issues.md#panel-resizing-v010)

---

### Keyboard Shortcuts Not Working

**Symptom:** Cmd/Ctrl+B doesn't toggle sidebar

**Cause:** Global shortcuts override Monaco shortcuts.

**Expected Behavior:**
- `Cmd/Ctrl+B` = Toggle left sidebar (NOT Monaco bold)
- `Cmd/Ctrl+J` = Toggle terminal panel
 

**Workaround:**
Use Monaco's command palette (F1) or formatting toolbar for editor commands.

**See:** [UI Components - Global Keyboard Shortcuts](./ui-components.md#global-keyboard-shortcuts)

---

### Panel State Not Persisting

**Symptom:** Sidebar widths reset after restart

**Cause:** localStorage state corrupted or not saved.

**Solution:**
1. Check localStorage:
   ```javascript
   // In DevTools Console
   localStorage.getItem('erfana-activity-bar-state')
   ```

2. Clear state to reset:
   ```javascript
   localStorage.removeItem('erfana-activity-bar-state')
   // Reload app
   ```

3. Verify state saves on change – `useActivityBarStore` (`src/renderer/src/stores/useActivityBarStore.ts`) is a Zustand store wrapped in `persist` under the key `erfana-activity-bar-state`; its `partialize` writes only `leftActivePanel`, `rightActivePanel`, `leftWidth` and `rightWidth`. Widths change through the store's `setSidebarWidth(width, side)` action:
   ```typescript
   useActivityBarStore.getState().setSidebarWidth(320, 'left')
   // persist middleware writes the partialized state to localStorage
   ```

**Files:** `src/renderer/src/stores/useActivityBarStore.ts`

---

## Development

### Hot Reload Not Working

**Symptom:** Changes not appearing without full restart

**Cause:** File outside `src/renderer` directory.

**Solution:**
- Main process changes: Requires full restart
- Renderer changes: Should hot reload automatically

**Restart Electron:**
```bash
# Kill dev server
# Restart:
npm run dev
```

---

### TypeScript Errors in Build

**Symptom:** Build fails with type errors, but dev mode works

**Cause:** Stricter checks in production build.

**Solution:**
Run type check locally:
```bash
npm run typecheck
# Fix all errors before building
npm run build
```

---

### ESLint Peer Dependency Warnings

**Symptom:** `npm install` shows ESLint version warnings

**Impact:** None (warnings only, doesn't affect functionality).

**Cause:** ESLint 9 vs ESLint 8 peer dependencies in electron-toolkit – historical.

**Action:** Resolved – `@electron-toolkit/eslint-config-ts` and `@electron-toolkit/eslint-config-prettier` now declare `eslint >=9.0.0` as their peer, so no warning is expected on a current `npm ci`.

---

## Getting Help

### Logs & Debug Info

**Persistent log files (every build, dev or installed):**
```
~/.erfana/logs/combined.log    # Both processes – start here
~/.erfana/logs/main.log        # Main process only (IPC, file system, terminal)
~/.erfana/logs/renderer.log    # Renderer only (React, state, user actions)
```
Reachable without a terminal: the crash screen's **Open logs folder** button opens this directory in Finder/Explorer. See [Logging](./logging.md) for levels, rotation and the log format.

**Crash / hang tags** (grep `combined.log`, #60):

| Tag | Meaning |
|-----|---------|
| `[crash] render-process-gone` | The renderer process died |
| `[crash] child-process-gone` | A child process died (GPU, utility, export render window) |
| `[crash] renderer-console-error` | A renderer `console.error` (capped at 20 per 10 s per window; a `… suppressed` line reports the drops) |
| `[crash] preload-error` | A preload script threw |
| `[hang] window-unresponsive` / `[hang] window-responsive` | Event loop blocked / recovered |
| `[GlobalErrorTrail] uncaught error` / `… unhandled rejection` | Uncaught error or rejected promise in the renderer (`fatal`) |

**Main Process Logs (dev):**
Check terminal where `npm run dev` is running.

**Renderer Logs (dev):**
Open DevTools in app (F12 or View → Toggle Developer Tools).

---

### App Froze (Beachball / "Not Responding")

**Symptom:** The window stops repainting and the OS marks it unresponsive

**Diagnosis:** Grep `~/.erfana/logs/combined.log` for `[hang]`. A `[hang] window-unresponsive` (warn) followed by `[hang] window-responsive` (info) is a recoverable freeze — the event loop was blocked and came back, so the timestamps bracket exactly how long. An `unresponsive` with no matching `responsive`, or a `[crash] render-process-gone` instead, means the renderer died rather than stalled.

**Note:** Hang and crash logging is deliberately log-only — no auto-reload, no dialog. Recovery UI appears only for errors a React boundary can catch.

---

**File Watcher Logs:**
```bash
# Enable debug logging in FileWatcherService.ts
const watcher = chokidar.watch(filePath, {
  // ...
}).on('all', (event, path) => {
  console.log(`📝 Chokidar event: ${event} - ${path}`)
})
```

---

### Reporting Issues

When reporting bugs, include:
1. **Erfana version:** `git describe --tags` or commit hash
2. **Environment:** macOS version, Node version, Python version
3. **Steps to reproduce:** Detailed steps
4. **Expected vs actual behavior**
5. **Logs:** `~/.erfana/logs/combined.log` (the relevant excerpt, not the whole file) — or, if a recovery screen appeared, press **Copy error details** on it and paste the report: it carries the version, timestamp, error name and message, the stack and the React component stack, capped at ~16 KB
6. **Screenshots:** If UI-related

**Submit to:** https://github.com/qodeca/erfana/issues

---

## See Also

- [Troubleshooting Guide](./troubleshooting.md) - Basic troubleshooting (Installation, File System, Markdown)
- [Known Issues](./known-issues.md) - Complete list of known issues and workarounds
- [Architecture](./architecture.md) - System design and component overview
- [Development Tasks](./development-tasks.md) - Common development patterns
- [API Services](./api-services.md) - Service class documentation
 
