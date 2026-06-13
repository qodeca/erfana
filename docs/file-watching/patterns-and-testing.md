# Implementation Patterns & Testing

This document covers common implementation patterns, session token guards, and comprehensive testing scenarios for file watching.

---

## Common Patterns

### Pause/Resume Pattern (Race Prevention)

Used to prevent double-refresh when internal operations trigger external file system events.

```typescript
// ProjectTree.tsx - Internal CRUD operation using withWatcherPause utility
import { withWatcherPause } from './withWatcherPause'

const handleCreateFile = async () => {
  const result = await withWatcherPause(
    projectPath,
    isInternalOperationRef,
    setLoading,
    async () => {
      const createdFilePath = await window.api.file.createFile(targetPath, fileName)
      await refreshFileTree()
      return createdFilePath
    }
  )
}
```

**How `withWatcherPause` works** (`src/renderer/src/components/ProjectTree/withWatcherPause.ts`):
1. Sets `isInternalOperationRef.current = true` + `setLoading(true)`
2. Calls `window.api.directoryWatch.pause(projectPath)` (IPC to main process)
3. Executes the operation
4. Resets `isInternalOperationRef.current = false` **before** calling resume (prevents race condition – AC-010)
5. Calls `window.api.directoryWatch.resume(projectPath)`
6. Sets `setLoading(false)` in finally block (even on error)

**Dual-layer suppression**:
- **Main process**: `PauseController` (ref-counting) drops filesystem events while paused
- **Renderer**: `isInternalOperationRef` guard in `useDirectoryWatcher` hook suppresses any events that slip through

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

### Session Token Guards (Switch Tokens)

To avoid stale updates during project switches, both watcher services maintain a monotonic session token (`switchVersion`). Any late events/timers from a previous session are ignored.

Implementation:
- File watcher: guards in change/delete/notify paths
- Directory watcher: guards in queue/process/notify paths

Effect:
- Eliminates UI updates from old watchers after `stopAll()` and project change
- Prevents flicker and tree corruption during rapid switches

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
# - Within 500ms (75ms ThrottledWorker collection delay)
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

## Automated Test Suites

The directory and git watcher pipelines are covered by 72 automated tests added in v0.7.2, verifying all 18 acceptance criteria from [spec T3-016](../../specs/archived/spec-t3-016-project-tree-refresh/requirements/03-acceptance.md). For the full test breakdown (file names, test counts, AC coverage), see [Testing – spec 016 verification](../testing/README.md).

Key test files:
- `DirectoryWatcherService.pipeline.test.ts` – directory refresh pipeline (11 tests, AC-001/002/003/007/008/010/013)
- `GitWatcherService.pipeline.test.ts` – git status pipeline (22 tests, AC-004/005/006/014/018)
- `WatcherResilience.test.ts` – auto-restart and polling fallback (14 tests, AC-011/015/016)
- `ProjectService.switching.test.ts` – project switching orchestration (20 tests, AC-009/014)
- `useGitStatus.test.ts` – visibility gating and cooldowns (5 tests, AC-012)

---

## Watcher Debugging

Quick, low-noise checks to verify watcher health and boundaries.

### From Renderer DevTools Console

Stats snapshots:

```ts
// Directory watcher stats (total watched dirs, pending events per dir)
await window.api.directoryWatch.getStats()

// File watcher stats (total watched files)
await window.api.fileWatch.getStats()

// Current project path boundary
await window.api.file.getProjectPath()
```

Session reset (drops stale events):

```ts
// Stop all directory/file watchers for this window (safe; re-created on demand)
await window.api.directoryWatch.stopAll()
await window.api.fileWatch.stopAll()
```

Pause/resume around internal CRUD (if scripting flows):

```ts
await window.api.directoryWatch.pause(<projectPath>)
// ... perform file ops via window.api.file.*
await window.api.directoryWatch.resume(<projectPath>)
```

### Expected Behaviors

- Bulk changes aggregate at three layers: chokidar fires per-event → `EventCoalescer` deduplicates per path within the 75 ms collection window → `ThrottledWorker` waits 200 ms between broadcast rounds → the renderer's `useDirectoryWatcher` debounces by another 250 ms before re-listing the tree. Multi-file write storms (e.g., `prettier --write`, snapshot updates) therefore collapse to roughly one re-list per debounce-window. `git checkout` no longer reaches this channel for `.git/` internals — those flow exclusively through `GitWatcherService` with its own 150 ms coalescing window.
- Deleting the project folder emits `directory-watch:project-deleted` and clears internal watchers.
- After project switching, late events from previous sessions are dropped (guarded by session token).

---

See: [README](./README.md) | [Technical Details](./technical-details.md) | [Architecture](../architecture.md)
