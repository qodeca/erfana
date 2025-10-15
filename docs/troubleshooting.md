# Troubleshooting Guide

Centralized troubleshooting reference for common Erfana issues and their solutions.

## Installation & Setup

### node-pty Build Failure

**Symptom:** Terminal panel unavailable, build fails during `npm install`

**Error:**
```
ModuleNotFoundError: No module named 'distutils'
```

**Cause:** node-pty doesn't support Python 3.13 (missing `distutils` module).

**Solution:**
1. Downgrade to Python 3.12 or earlier:
   ```bash
   brew install python@3.12
   brew link python@3.12
   ```
2. Rebuild node-pty:
   ```bash
   npm rebuild node-pty
   ```

**Workaround:** Use system terminal for command-line operations until node-pty updates.

**Tracking:** https://github.com/microsoft/node-pty/issues

---

### Dockview CSS Not Loading

**Symptom:** Layout broken, panels not styled correctly

**Cause:** Incorrect import path for Dockview styles.

**Solution:**
Update import in your component:
```typescript
// ❌ WRONG
import 'dockview/dist/styles.css'

// ✅ CORRECT
import 'dockview/dist/styles/dockview.css'
```

**Files:** `src/renderer/src/App.tsx`, `src/renderer/src/components/DockLayout/AppDockLayout.tsx`

---

### electron-store Import Error

**Symptom:** `ERR_REQUIRE_ESM` error during startup

**Error:**
```
ERR_REQUIRE_ESM: require() of ES Module not supported
```

**Cause:** electron-store v11+ is ES Module only, cannot use `require()`.

**Solution:**
All SettingsService methods are async and use dynamic `import()`:
```typescript
// ✅ CORRECT pattern
const lastPath = await settingsService.getLastProjectPath()

// ❌ WRONG (sync access not possible)
const lastPath = settingsService.getLastProjectPath()
```

**Files:** `src/main/services/SettingsService.ts`, all IPC handlers using settings

---

## Claude Code Integration

### Claude CLI Not Found

**Symptom:** "Claude CLI not installed" message in Copilot panel

**Cause:** Claude CLI binary not in PATH.

**Solution:**
```bash
# Install Claude CLI
brew install claude

# Verify installation
which claude
# Should output: /opt/homebrew/bin/claude (or similar)
```

**Note:** Requires Anthropic MAX subscription for Claude Code access.

---

### Authentication Failed

**Symptom:** "Not authenticated" error when starting session

**Error:**
```
Not authenticated. Please run: claude setup-token
```

**Cause:** No OAuth token configured for Claude CLI.

**Solution:**
```bash
# Set up authentication
claude setup-token

# Follow browser OAuth flow
# Token saved to ~/.claude/
```

**Verification:**
```bash
ls ~/.claude/
# Should show: auth.json, config.json, projects/
```

---

### Session Won't Start

**Symptom:** Session stuck in "starting" state, never becomes "ready"

**Debug Steps:**
1. Check main process console for errors
2. Verify project path is valid directory
3. Check Claude CLI logs:
   ```bash
   ls ~/.claude/logs/
   cat ~/.claude/logs/claude-cli-$(date +%Y-%m-%d).log
   ```

**Common Causes:**
- Invalid project path (must be absolute)
- Project path doesn't exist
- Insufficient permissions on project directory
- Claude CLI process crashed (check stderr output)

**Solution:**
```typescript
// Ensure absolute path
const absolutePath = path.resolve(projectPath)

// Verify directory exists
const stats = await fs.stat(absolutePath)
if (!stats.isDirectory()) {
  throw new Error('Project path must be a directory')
}

// Start session
await claudeCliService.startSession(absolutePath)
```

---

### Tool Approval Dialog Won't Dismiss

**Symptom:** Dialog stuck open after approval

**Cause:** Session restart timing issue.

**Workaround:**
1. Close dialog manually
2. Wait 2-3 seconds for session restart
3. Resend message if needed

**Note:** This is expected behavior - session must restart to update tool permissions.

---

### Conversation Not Preserved After Tool Approval

**Symptom:** Context lost after approving tool

**Verification:**
Check that `--continue` flag is being used:
```bash
# In main process console, should see:
✅ Using --continue flag for conversation preservation
```

**Solution:**
Verify session restart uses `--continue` (automatic in `restartWithNewPermissions()`):
```typescript
private async restartWithNewPermissions(): Promise<void> {
  // ...
  await this.startSession(projectPath, planningMode)  // Uses --continue by default
  // ...
}
```

**Files:** `src/main/services/ClaudeCliService.ts:555-572`

---

### Planning Mode Doesn't Restrict Tools

**Symptom:** Write/Edit tools still available in planning mode

**Verification:**
Check planning mode flag in console:
```
📋 Planning mode enabled: using 9 safe tools
🔵 Added planning mode flag
```

**Expected Safe Tools** (9 total):
Read, LS, Glob, Grep, Task, WebSearch, TodoRead, TodoWrite, NotebookRead

**Solution:**
Ensure planning mode toggle actually restarts session:
```typescript
// In CopilotPanel.tsx
const handlePlanningModeToggle = async () => {
  await window.api.claudeCode.stopSession()
  await window.api.claudeCode.startSession(projectPath, !isPlanningMode)
}
```

---

## File System

### Files Not Auto-Refreshing

**Symptom:** External file changes don't appear in Erfana

**Debug Steps:**
1. Check if file watcher is active:
   ```typescript
   // In main process console, should see:
   👁️ Watching file: /path/to/file.md
   ```

2. Check for debounce timing (300ms for files):
   ```bash
   # Edit file externally
   echo "test" >> file.md

   # Wait 400ms
   # Should see: 📝 File changed: /path/to/file.md
   ```

**Common Causes:**
- File is paused (during save operation)
- File path contains special characters
- Network file system (NFS/SMB) - may require polling

**Solution for Network FS:**
```typescript
// In FileWatcherService.ts
const watcher = chokidar.watch(filePath, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 300 },
  usePolling: true,  // ADD THIS for network file systems
  interval: 1000     // Poll interval in ms
})
```

---

### Directory Tree Not Updating

**Symptom:** New files/folders don't appear in project tree

**Debug Steps:**
1. Check directory watcher is active
2. Verify debounce period (1000ms for directories)
3. Check ignored patterns (node_modules, .git, .next, dist, build)

**Solution:**
If file is in ignored directory, create it elsewhere or update ignore patterns:
```typescript
// In DirectoryWatcherService.ts
const watcher = chokidar.watch(dirPath, {
  ignored: /(^|[/\\])\../, // hidden files
  ignoreInitial: true,
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 1000 },
  // EDIT THESE PATTERNS:
  ignored: [
    '**/node_modules/**',
    '**/.git/**',
    '**/.next/**',
    '**/dist/**',
    '**/build/**',
    '**/.DS_Store'
  ]
})
```

---

### Duplicate Refresh on File Creation

**Symptom:** Project tree refreshes twice when creating file via UI

**Cause:** Missing pause/resume pattern around CRUD operation.

**Solution:**
```typescript
const handleCreateFile = async () => {
  // CRITICAL: Pause before operation
  await window.api.directoryWatch.pause(projectPath)

  await window.api.file.createFile(targetPath, fileName)
  await refreshFileTree()

  // CRITICAL: Resume after operation
  await window.api.directoryWatch.resume(projectPath)

  // Now: only ONE refresh (manual), not two
}
```

**Files:** `src/renderer/src/components/ProjectTree/ProjectTree.tsx`

---

## Markdown Editing

### Preview Not Updating

**Symptom:** Preview pane shows stale content

**Cause:** React key prop missing or incorrect.

**Solution:**
Ensure `MonacoMarkdownEditor` has file path as key:
```tsx
<MonacoMarkdownEditor
  key={currentFile.path}  // Forces remount on file change
  // ...
/>
```

**Files:** `src/renderer/src/components/Editor/MarkdownEditorPanel.tsx`

---

### Scroll Sync Not Working

**Symptom:** Editor and preview scrolling not synchronized in split view

**Debug Steps:**
1. Check scroll map is built:
   ```typescript
   // In console, should see:
   📊 Scroll map: 296 entries
   ```

2. Verify data-line attributes in preview:
   ```html
   <p data-line-start="42" data-line-end="42">...</p>
   ```

**Common Causes:**
- React ref not initialized (check `viewRef.current`)
- Scroll map empty (not built)
- View mode not split view

**Solution:**
Ensure scroll map builds after view mode change:
```typescript
useEffect(() => {
  if (viewMode === 'split' && viewRef.current) {
    buildScrollMap()
  }
}, [viewMode, content])
```

---

### Mermaid Diagram Rendering Error

**Symptom:** Diagram shows error box instead of rendering

**Example Error:**
```
Syntax error in graph
```

**Cause:** Invalid Mermaid syntax.

**Solution:**
1. Check diagram syntax at https://mermaid.js.org/
2. Verify diagram type is supported (22 types available)
3. Check for typos in keywords

**Example Fix:**
```mermaid
# ❌ WRONG
graph TD
    A[Start] -> B[End]  # Wrong arrow syntax

# ✅ CORRECT
graph TD
    A[Start] --> B[End]  # Correct arrow syntax
```

**Supported Diagram Types:**
flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, journey, gantt, pie, quadrantChart, requirementDiagram, gitGraph, C4Context, mindmap, timeline, sankey-beta, xychart-beta, block-beta, packet-beta, kanban, architecture-beta, radar-beta, treemap-beta

---

## Terminal

### Terminal Not Rendering

**Symptom:** Blank terminal panel

**Cause:** node-pty not built correctly (see Installation section).

**Verification:**
```bash
# Check if node-pty native module exists
ls node_modules/node-pty/build/Release/
# Should show: pty.node
```

**Solution:**
```bash
npm rebuild node-pty
# Or full reinstall:
rm -rf node_modules
npm install
```

---

### Terminal Commands Not Executing

**Symptom:** Typing in terminal has no effect

**Debug Steps:**
1. Check PTY is created:
   ```typescript
   // In main process console:
   ✅ Terminal PTY created: terminal-1
   ```

2. Verify stdin is writable:
   ```typescript
   terminalService.writeToTerminal('terminal-1', 'ls\n')
   // Should execute command
   ```

**Common Causes:**
- PTY not initialized
- Shell crashed (check stderr)
- Terminal ID mismatch

**Solution:**
Verify terminal ID matches between create and write:
```typescript
await window.api.terminal.create('main', projectPath, 80, 24)
await window.api.terminal.write('main', 'ls\n')  // Same ID
```

---

### Terminal Resize Issues

**Symptom:** Terminal content wrapping incorrectly after window resize

**Cause:** PTY dimensions not updated.

**Solution:**
Ensure resize handler calls both xterm and PTY resize:
```typescript
const handleResize = useCallback(() => {
  if (terminalRef.current) {
    const { cols, rows } = terminalRef.current.getDimensions()

    // Resize xterm.js display
    terminalRef.current.terminal.resize(cols, rows)

    // Resize PTY backend
    window.api.terminal.resize(terminalId, cols, rows)
  }
}, [terminalId])
```

**Files:** `src/renderer/src/components/Panels/TerminalPanel.tsx`

---

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
   terminalRef.current?.terminal.clear()
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

**See:** [Known Issues - Panel Resizing](./known-issues.md#panel-resizing-resolved-in-v010-commit-4ff94cb)

---

### Keyboard Shortcuts Not Working

**Symptom:** Cmd/Ctrl+B doesn't toggle sidebar

**Cause:** Global shortcuts override Monaco shortcuts.

**Expected Behavior:**
- `Cmd/Ctrl+B` = Toggle left sidebar (NOT Monaco bold)
- `Cmd/Ctrl+J` = Toggle terminal panel
- `Cmd/Ctrl+Shift+A` = Toggle Copilot panel
- `Ctrl+Shift+G` = Toggle Git panel

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
   localStorage.getItem('erfana-sidebar-state')
   ```

2. Clear state to reset:
   ```javascript
   localStorage.removeItem('erfana-sidebar-state')
   // Reload app
   ```

3. Verify state saves on change:
   ```typescript
   // In useActivityBarStore
   setSidebarStates((prev) => {
     const newState = { ...prev, ...updates }
     localStorage.setItem('erfana-sidebar-state', JSON.stringify(newState))
     return newState
   })
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

**Cause:** ESLint 9 vs ESLint 8 peer dependencies in electron-toolkit.

**Action:** Ignore warnings. electron-toolkit will update in future releases.

---

## Getting Help

### Logs & Debug Info

**Main Process Logs:**
Check terminal where `npm run dev` is running.

**Renderer Logs:**
Open DevTools in app (F12 or View → Toggle Developer Tools).

**Claude CLI Logs:**
```bash
ls ~/.claude/logs/
cat ~/.claude/logs/claude-cli-$(date +%Y-%m-%d).log
```

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
5. **Logs:** Main process + renderer console + Claude CLI logs
6. **Screenshots:** If UI-related

**Submit to:** https://github.com/qodeca/erfana/issues

---

## See Also

- [Known Issues](./known-issues.md) - Complete list of known issues and workarounds
- [Architecture](./architecture.md) - System design and component overview
- [Development Tasks](./development-tasks.md) - Common development patterns
- [API Reference](./api-reference.md) - Service class API documentation
- [Claude Code Integration](./claude-code/README.md) - Claude CLI integration details
