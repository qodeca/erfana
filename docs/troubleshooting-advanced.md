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
5. **Logs:** Main process + renderer console
6. **Screenshots:** If UI-related

**Submit to:** https://github.com/qodeca/erfana/issues

---

## See Also

- [Troubleshooting Guide](./troubleshooting.md) - Basic troubleshooting (Installation, File System, Markdown)
- [Known Issues](./known-issues.md) - Complete list of known issues and workarounds
- [Architecture](./architecture.md) - System design and component overview
- [Development Tasks](./development-tasks.md) - Common development patterns
- [API Services](./api-services.md) - Service class documentation
- [API Services](./api-services.md) - Supporting services documentation
 
