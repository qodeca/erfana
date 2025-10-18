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

### Watch Depth (Performance)

The directory watcher supports an optional recursive depth cap to reduce load on very large projects.

- Config key: `directoryWatchDepth` (SettingsService)
- No UI control at the moment. Configure via preload settings API, e.g. in DevTools:
  - `await window.api.settings.setDirectoryWatchDepth(2)`
  - `await window.api.settings.setDirectoryWatchDepth(null)` for Unlimited
- Behavior: Applies to chokidar `depth` option; the watcher will use the new setting on the next start

Recommended:
- Start with "Unlimited"
- Use smaller depths when the tree is very large and deep

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

## Symlinks

- Watchers do not follow symlinks (security)
- Symlinked entries are flagged in the Project Tree with a small chain icon and tooltip
- Operations on symlink targets remain subject to project boundary checks

---

## Documentation Structure

This documentation is split into focused files for optimal Claude Code context usage:

- **[README.md](./README.md)** (this file) - Overview and service architecture
- **[Patterns & Testing](./patterns-and-testing.md)** - Implementation patterns, session tokens, test scenarios
- **[Technical Details](./technical-details.md)** - Performance, security, edge cases, integration points

---

See: [Architecture](../architecture.md) | [IPC Patterns](../ipc-patterns.md) | [Development Tasks](../development-tasks.md)
