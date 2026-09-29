<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Troubleshooting – contributor notes

For app recovery, terminal availability, preview and Mermaid errors, use the [user troubleshooting reference](./user-guide/reference/troubleshooting.md).

## Installation & Setup

### node-pty Build Failure

**Symptom:** Terminal panel unavailable, build fails during `npm install`

**Error:**
```
ModuleNotFoundError: No module named 'distutils'
```

**Cause:** node-pty fails to build on Python 3.13 (its `distutils` module was removed). Only 3.13 fails.

**Solution:**
1. Use Python 3.12 (known good) or 3.14.x (3.14.3 verified):
   ```bash
   brew install python@3.12
   brew link python@3.12
   ```
2. Rebuild node-pty:
   ```bash
   npm rebuild node-pty
   ```

See [Known issues – node-pty build failure](./known-issues.md#node-pty-build-failure) and [CONTRIBUTING](../CONTRIBUTING.md#local-setup) for the full setup notes.

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

**Files:** `src/renderer/src/components/DockLayout/AppDockLayout.tsx`

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

**Pattern:** the constructor starts `import('electron-store')` and keeps the promise; every method awaits `ensureStore()` before touching the store.

**Files:** `src/main/services/SettingsService.ts`, all IPC handlers using settings

---

## Project Tree Unavailable

The project-scoped panel boundary is keyed by project path; see [user recovery](./user-guide/reference/troubleshooting.md#project-tree-unavailable) and [UI containment](./ui-components.md#error-containment). Logs carry `[PanelErrorBoundary]` entries.

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
   // In the main-process log, should see (FileWatcherService.ts):
   👁️  Starting watch for: /path/to/file.md
   ```

2. Check for debounce timing (300ms for files):
   ```bash
   # Edit file externally
   echo "test" >> file.md

   # Wait 400ms
   # Should see: 📝 File changed externally: /path/to/file.md
   ```

**Common Causes:**
- File is paused (during save operation)
- File path contains special characters
- Network file system (NFS/SMB) - may require polling

**Solution for Network FS:**
```typescript
// In src/main/services/watcher/singleFileWatch.ts (SINGLE_FILE_WATCH_OPTIONS)
const watcher = chokidar.watch(filePath, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 300 },
  usePolling: true,  // ADD THIS for network file systems (shipped value: false)
  interval: 1000     // Poll interval in ms
})
```

---

### Directory Tree Not Updating

**Symptom:** New files/folders don't appear in project tree

**Debug Steps:**
1. Check directory watcher is active
2. Verify the debounce: the main-process directory watcher runs with `awaitWriteFinish: false` (`DirectoryWatcherService.ts`); the renderer debounces the resulting `directory-watch:changed` events by `DIRECTORY_WATCHER.DEBOUNCE_DELAY` (250 ms, `ProjectTree/constants.ts`)
3. Check ignored patterns (`node_modules`, `.git`, build output, virtualenvs, …)

**Solution:**
If the file is in an ignored directory, create it elsewhere or update the ignore patterns. The default list is `DEFAULT_WATCHER_IGNORE_PATTERNS` in `src/shared/constants.ts`; `DirectoryWatcherService.ts` applies it through a function-based `ignored` predicate (`shouldIgnorePath`), not an inline array:
```typescript
// src/main/services/DirectoryWatcherService.ts
const watcher = chokidar.watch(dirPath, {
  persistent: true,
  ignoreInitial: true,
  ignored: (path) => this.shouldIgnorePath(path), // backed by DEFAULT_WATCHER_IGNORE_PATTERNS
  awaitWriteFinish: false,
  // ...
})
```
Per-project overrides go in `.erfana/settings.json` ignore patterns.

---

### Duplicate Refresh on File Creation

**Symptom:** Project tree refreshes twice when creating file via UI

**Cause:** CRUD operation not wrapped in `withWatcherPause()`.

**Solution:** wrap the operation in `withWatcherPause()` (`src/renderer/src/components/ProjectTree/withWatcherPause.ts`), which pauses the directory watcher, runs the operation, and resumes it in a `finally` block:
```typescript
const createdFilePath = await withWatcherPause(
  projectPath,
  isInternalOperationRef,
  setLoading,
  async () => {
    const path = await window.api.file.createFile(targetPath, fileName)
    await refreshFileTree()
    return path
  }
)
// Now: only ONE refresh (manual), not two
```

**Files:** `src/renderer/src/components/ProjectTree/withWatcherPause.ts`, callers in `src/renderer/src/hooks/useFileOperations.ts`, `src/renderer/src/components/ProjectTree/ProjectTree.tsx` and `src/renderer/src/components/ProjectTree/context-menu/commands.tsx` (through `ctx.withWatcherPause`)

---

## Markdown Editing

### Preview Not Updating

**Symptom:** Preview pane shows stale content

**Cause:** React key prop missing or incorrect.

**Solution:**
Ensure `MonacoMarkdownEditor` is keyed by the view mode so it remounts when the layout changes (the file path is passed as a prop, not as the key):
```tsx
<MonacoMarkdownEditor
  key={`editor-${viewMode}`}  // Forces remount on view-mode change
  filePath={currentFile.path}
  // ...
/>
```

**Files:** `src/renderer/src/components/Panels/EditorContentLayout.tsx`

---

### Scroll Sync Not Working

**Symptom:** Editor and preview scrolling not synchronized in split view

**Debug Steps:**
1. Check scroll map is built:
   ```typescript
   // In the renderer debug log, should see (useScrollSync.ts):
   Scroll map rebuilt: 296 entries
   ```

2. Verify data-line attributes in preview:
   ```html
   <p data-line-start="42" data-line-end="42">...</p>
   ```

**Common Causes:**
- React refs not initialized (check `editorRef.current` and `previewRef.current`)
- Scroll map empty (not built)
- View mode not a split view

**Solution:**
`useScrollSync` (`src/renderer/src/components/Editor/MarkdownEditorPanel/hooks/useScrollSync.ts`) exposes `rebuildScrollMap()`, which bails out unless both refs are set and the view is a split mode, then rebuilds after a double `requestAnimationFrame`. Ensure it is called after a view-mode or content change:
```typescript
const { rebuildScrollMap } = useScrollSync({ editorRef, previewRef, viewMode, currentFilePath, currentContent })
```

---

## Mermaid Diagram Rendering Error

See [user recovery](./user-guide/reference/troubleshooting.md#mermaid-diagram-rendering-error). Contributor detail: `MermaidDiagram.tsx` sends `mermaid-bug-report.md` to the terminal from the error box. `zenuml` is listed in `mermaidDirections.ts` but its package is not a dependency, so it errors.

## See Also

- [Advanced Troubleshooting](./troubleshooting-advanced.md) - Terminal, Performance, UI/Layout, Development
- [Known Issues](./known-issues.md) - Complete list of known issues and workarounds
- [Architecture](./architecture.md) - System design and component overview
- [Development Tasks](./development-tasks.md) - Common development patterns
- [API Services](./api-services.md) - Service class overview
- [HTML preview](./html-preview/README.md) - links, [Back and Forward](./html-preview/README.md#back-and-forward), [Open in default browser](./html-preview/README.md#open-in-default-browser), keyboard entry into the page; the preview and open-in-browser toasts are listed in [Error codes](./error-codes.md)
 
