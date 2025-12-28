# Troubleshooting Guide

Centralized troubleshooting reference for common Erfana issues and their solutions.

## Overview

This guide covers basic troubleshooting for installation, file system, markdown editing, and terminal. For advanced troubleshooting (Terminal, Performance, UI/Layout, Development), see [Advanced Troubleshooting](./troubleshooting-advanced.md).

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

---

## Terminal

### Terminal Not Available

**Symptom:** Terminal panel shows "Terminal Not Available" message

**Check:**
```typescript
const result = await window.api.terminal.isAvailable()
if (!result.available) {
  // node-pty not available, check build logs
}
```

**Solution:** Rebuild node-pty
```bash
npm rebuild node-pty --build-from-source
```

**For Advanced Terminal Issues:** See [Terminal Troubleshooting](./terminal/troubleshooting.md) for comprehensive coverage of WebGL context loss, scroll issues, resize problems, and debugging tips.

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
4. Use bug report button (🐛) in error message to send formatted report to Terminal panel

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

## See Also

- [Advanced Troubleshooting](./troubleshooting-advanced.md) - Terminal, Performance, UI/Layout, Development
- [Known Issues](./known-issues.md) - Complete list of known issues and workarounds
- [Architecture](./architecture.md) - System design and component overview
- [Development Tasks](./development-tasks.md) - Common development patterns
- [API Services](./api-services.md) - Service class overview
 
