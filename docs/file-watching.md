# File Watching & Auto-Refresh

Erfana automatically detects and responds to external file system changes using two complementary watching systems.

## Overview

**FileWatcherService**: Watches individual open files for content changes
**DirectoryWatcherService**: Watches entire project directory for structural changes

Both use [Chokidar](https://github.com/paulmillr/chokidar) for cross-platform file system monitoring with intelligent debouncing and race condition prevention.

---

## FileWatcherService (File Content Watching)

Monitors open files for external content modifications.

### Architecture

- **Library**: Chokidar (native fs events, not polling)
- **Debouncing**: 300ms (optimized for single file saves)
- **Events**: `change`, `unlink`, `error`
- **Scope**: Per-file watching (on-demand when file is opened)
- **Limit**: 100 files maximum (security)

### Use Cases

| Scenario | Behavior |
|----------|----------|
| File modified externally, no local changes | Auto-reload silently, show "Reloaded from disk" in toolbar (1s) |
| File modified externally, has unsaved changes | Show orange conflict bar with options |
| File deleted externally | Show red warning banner, keep editor state |
| Rapid changes (git operations) | Debounced to single reload |

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `file-watch:start` | Renderer → Main | Start watching specific file |
| `file-watch:stop` | Renderer → Main | Stop watching specific file |
| `file-watch:pause` | Renderer → Main | Pause watching during save operation |
| `file-watch:resume` | Renderer → Main | Resume watching after save completes |
| `file-watch:changed` | Main → Renderer | Event: File content changed externally |
| `file-watch:deleted` | Main → Renderer | Event: File deleted externally |

### Implementation Location

- **Service**: `src/main/services/FileWatcherService.ts` (259 lines)
- **IPC Handlers**: `src/main/ipc/file-watcher-handlers.ts` (112 lines)
- **Integration**: `src/renderer/src/components/Panels/MarkdownEditorPanel.tsx`
- **UI Component**: `src/renderer/src/components/FileConflictNotification/`

### Conflict Resolution UI

When a file has both external changes and unsaved local changes, an orange conflict bar appears with three options:

- **Reload from Disk**: Discard local changes, load external version
- **Keep My Version**: Ignore external changes, keep local edits
- **Dismiss**: Acknowledge conflict, decide later

---

## DirectoryWatcherService (Directory Watching)

Monitors entire project folder for structural changes (files/folders created, deleted, moved).

### Architecture

- **Library**: Chokidar (recursive watching)
- **Debouncing**: Adaptive
  - Single events: 300ms
  - Bulk operations (5+ events/sec): 1000ms
- **Events**: `add`, `addDir`, `unlink`, `unlinkDir`
- **Scope**: Entire project directory (recursive)
- **Cleanup**: Automatic on window close and app quit

### Ignored Patterns

Prevents watching unnecessary files for performance:

```javascript
ignored: [
  /(^|[\/\\])\.[^\/\\]+$/,          // Hidden files
  /(^|[\/\\])node_modules($|[\/\\])/, // Dependencies
  /(^|[\/\\])\.git($|[\/\\])/,       // Git metadata
  /(^|[\/\\])out($|[\/\\])/,         // Build output
  /(^|[\/\\])dist($|[\/\\])/,
  /(^|[\/\\])build($|[\/\\])/,
  /\.DS_Store$/,                     // macOS system
  /\.swp$/,                          // Vim temp files
  /(^|[\/\\])\.vscode($|[\/\\])/,    // Editor config
]
```

### Use Cases

| Scenario | Behavior |
|----------|----------|
| Create file externally | Tree updates automatically within 1 second |
| Delete folder externally | Tree updates, expanded folder state preserved |
| Git checkout (bulk changes) | Debounced to single refresh after changes settle |
| Internal CRUD (create/delete/rename) | Watcher paused, no double refresh |
| Expand folders, make external changes | Folders remain expanded after refresh |

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `directory-watch:start` | Renderer → Main | Start watching project directory |
| `directory-watch:stop` | Renderer → Main | Stop watching directory |
| `directory-watch:pause` | Renderer → Main | Pause watching during internal CRUD |
| `directory-watch:resume` | Renderer → Main | Resume watching after CRUD completes |
| `directory-watch:changed` | Main → Renderer | Event: Directory structure changed |
| `directory-watch:project-deleted` | Main → Renderer | Event: Project folder deleted |

### Implementation Location

- **Service**: `src/main/services/DirectoryWatcherService.ts` (323 lines)
- **IPC Handlers**: `src/main/ipc/directory-watcher-handlers.ts` (103 lines)
- **Integration**: `src/renderer/src/components/ProjectTree/ProjectTree.tsx`
- **Component**: `src/renderer/src/components/ProjectTree/ProjectTreeNode.tsx` (controlled pattern)

### Expanded State Preservation

The file tree maintains a `Set<string>` of expanded folder paths. When the tree refreshes due to external changes, this state is preserved, ensuring folders remain expanded.

### Recoverable Project Deletion (ENOENT)

If the watched project folder is deleted or becomes unavailable mid‑session (ENOENT/no such file):

- Service broadcasts `directory-watch:project-deleted { dirPath }`
- Internally calls `stopAll()` (not `dispose()`), clearing watchers while keeping the service reusable
- User can select a new project without restarting the app

This avoids a non‑recoverable state after disruptive filesystem events.

---

## Common Patterns

### Pause/Resume Pattern (Race Prevention)

Used to prevent double-refresh when internal operations trigger external file system events.

```typescript
// ProjectTree.tsx - Internal CRUD operation
const handleCreateFile = async () => {
  try {
    // Mark as internal operation
    isInternalOperation.current = true

    // Pause directory watcher
    if (projectPath) {
      await window.api.directoryWatch.pause(projectPath)
    }

    // Perform operation
    const createdFilePath = await window.api.file.createFile(targetPath, fileName)
    await refreshFileTree()

    // Resume directory watcher
    if (projectPath) {
      await window.api.directoryWatch.resume(projectPath)
    }
    isInternalOperation.current = false
  } catch (err) {
    // Always resume even on error
    if (projectPath) {
      await window.api.directoryWatch.resume(projectPath)
    }
    isInternalOperation.current = false
  }
}
```

**Why This Works**:
- Directory watcher is paused before file creation
- File is created (triggers fs event, but watcher is paused)
- Tree refreshes manually via `refreshFileTree()`
- Watcher resumes after manual refresh
- No duplicate refresh from paused watcher event

### Event Listening Pattern

Standard pattern for listening to file system events in React components.

```typescript
// MarkdownEditorPanel.tsx - File content watching
useEffect(() => {
  if (!currentFile?.path) return

  // Start watching
  window.api.fileWatch.start(currentFile.path)

  // Listen for changes
  const unsubscribeChanged = window.api.fileWatch.onFileChanged((data) => {
    if (data.filePath === currentFile.path) {
      handleExternalChange()
    }
  })

  // Listen for deletion
  const unsubscribeDeleted = window.api.fileWatch.onFileDeleted((data) => {
    if (data.filePath === currentFile.path) {
      setIsFileDeleted(true)
    }
  })

  // Cleanup
  return () => {
    window.api.fileWatch.stop(currentFile.path)
    unsubscribeChanged()
    unsubscribeDeleted()
  }
}, [currentFile?.path])
```

**Key Points**:
- Watch starts when file is opened
- Multiple event listeners can be attached
- Each listener returns an unsubscribe function
- All listeners and watchers are cleaned up on unmount

### Auto‑Restore Watcher Boundaries

On app launch, when restoring the last project:

- `fileService.setProjectPath(lastPath)`
- `fileWatcherService.setProjectPath(lastPath)`
- `directoryWatcherService.setProjectPath(lastPath)`

This ensures watcher boundary checks ("inside project root") are correct immediately after auto‑restore.

### Expanded State Preservation Pattern

File tree uses `Set<string>` to track expanded folders. Refreshing file list preserves expansion state since they're separate React state variables.

---

## Testing Scenarios

### File Content Watching

**Test 1: Auto-reload (no local changes)**
```bash
# 1. Open file in Erfana
# 2. Modify externally
echo "# External Change" >> /path/to/project/test.md

# Expected:
# - File reloads automatically in editor
# - Toolbar shows "Reloaded from disk" (1 second)
# - No popup notification
```

**Test 2: Conflict detection (has local changes)**
```bash
# 1. Open file in Erfana
# 2. Type unsaved changes in Erfana
# 3. Modify externally
echo "# Conflict" >> /path/to/project/test.md

# Expected:
# - Orange conflict bar appears above editor
# - Options: "Reload from Disk", "Keep My Version", "Dismiss"
# - Modified indicator (*) still visible
```

**Test 3: File deletion**
```bash
# 1. Open file in Erfana
# 2. Delete externally
rm /path/to/project/test.md

# Expected:
# - Red warning banner: "This file has been deleted externally"
# - Editor content remains (not cleared)
# - Can still save to recreate file
```

**Test 4: Rapid changes (debouncing)**
```bash
# 1. Open file in Erfana
# 2. Make rapid changes
for i in {1..10}; do echo "Change $i" >> test.md; done

# Expected:
# - Single reload after changes settle (300ms)
# - Not 10 separate reloads
```

### Directory Tree Watching

**Test 5: File creation**
```bash
# 1. Erfana project is open
# 2. Create file externally
echo "# New File" > /path/to/project/new-file.md

# Expected:
# - File appears in tree automatically
# - Within 1 second
# - No manual refresh needed
```

**Test 6: Folder operations + state preservation**
```bash
# 1. Expand folders A, B, C in Erfana tree
# 2. Create folder D externally
mkdir /path/to/project/folder-D

# Expected:
# - Folder D appears in tree
# - Folders A, B, C remain expanded
# - Tree structure preserved
```

**Test 7: Bulk operations (git checkout)**
```bash
# 1. Erfana project open, some folders expanded
# 2. Checkout branch with many file changes
git checkout feature-branch

# Expected:
# - Tree refreshes once after all changes settle (~1 second)
# - Expanded folders remain expanded
# - Console log: "📁 Directory changed, refreshing project tree... (X events)"
```

**Test 8: Internal CRUD (no double refresh)**
```typescript
// 1. Enable debug logging in ProjectTree.tsx
// 2. Create file via Erfana's "New File" button
// 3. Check console logs

// Expected console output:
// "⏸️  Paused directory watch for: /path/to/project"
// "▶️  Resumed directory watch for: /path/to/project"
// NO "📁 Directory changed" message (watcher was paused)
```

**Test 9: Rename operation**
```bash
# 1. Erfana tree visible
# 2. Rename file externally
mv old-name.md new-name.md

# Expected:
# - Old file disappears
# - New file appears
# - Single tree update
```

**Test 10: Project deletion (edge case)**
```bash
# 1. Erfana project open
# 2. Delete entire project folder
rm -rf /path/to/project

# Expected:
# - Error message: "Project folder no longer exists"
# - File tree clears
# - Watchers cleaned up
# - No crashes
```

---

## Performance Considerations

### Debouncing Strategy

**File Watcher**: Fixed 300ms delay
- Optimized for individual file saves
- Handles rapid successive writes (e.g., auto-save in external editor)

**Directory Watcher**: Adaptive delay
- Single events: 300ms (responsive for individual operations)
- Bulk operations: 1000ms (batches git/npm operations)
- Threshold: 5+ events per second triggers bulk mode

### Event Batching

Directory watcher accumulates events during debounce period. Example: Git checkout with 50 file additions triggers single refresh after 1000ms.

### Resource Limits

- **File watcher**: 100 file limit (prevents memory issues)
- **Directory watcher**: No limit (ignored patterns prevent issues)
- **Cleanup**: Automatic on window close and app quit

---

## Security

### Path Validation

All file paths are validated against the project root:

```typescript
// DirectoryWatcherService.ts
async watchDirectory(dirPath: string, webContents: WebContents) {
  // Security: Prevent watching files outside project
  if (this.projectPath && !dirPath.startsWith(this.projectPath)) {
    throw new Error('Cannot watch directories outside the project directory')
  }
}
```

### Input Sanitization

All IPC handler inputs are validated:

```typescript
// file-watcher-handlers.ts
ipcMain.handle('file-watch:start', async (event, filePath: string) => {
  // Validate input
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'Invalid file path' }
  }
  // ... proceed
})
```

### Error Handling

- Project deletion → Graceful cleanup + error message
- Missing files → Automatic watcher cleanup
- IPC errors → Logged and returned to renderer
- No crashes on edge cases

---

## Edge Cases Handled

### File Watcher

| Edge Case | Solution |
|-----------|----------|
| Race: Save vs external change | Pause/resume pattern during save |
| Multiple tabs, same file | Single watcher, all tabs notified |
| File deleted while open | Warning banner, keep editor state |
| File recreated after delete | New watcher started automatically |

### Directory Watcher

| Edge Case | Solution |
|-----------|----------|
| Project folder deleted | Error message, cleanup all watchers |
| Rapid successive operations | Batched into single update |
| Internal vs external changes | `isInternalOperation` flag |
| Multiple windows | Per-webContents tracking |

---

## Integration Points

### MarkdownEditorPanel (File Watching)

- Starts file watcher when file is opened
- Stops watcher when panel is unmounted
- Shows conflict bar when needed
- Implements pause/resume during save

### ProjectTree (Directory Watching)

- Starts directory watcher when project is loaded
- Stops watcher when project is closed
- Preserves expanded folder state
- Implements pause/resume during CRUD operations

### FileService (CRUD Coordination)

- All file/folder operations go through FileService
- No direct fs operations from components
- Clean separation of concerns

---

See: [Architecture](./architecture.md) | [IPC Patterns](./ipc-patterns.md) | [Development Tasks](./development-tasks.md)
