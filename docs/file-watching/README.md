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

### Watched Files

Uses a **selective blacklist** approach (same as VS Code) with function-based ignore for reliability.

**What IS watched:**
- Dotfolders: `.claude/`, `.github/`, `.vscode/`, `.idea/`
- Dotfiles: `.env`, `.gitignore`, `.npmrc`, etc.
- Git state: `.git/HEAD`, `.git/config`, `.git/refs/`
- Build outputs: `out/`, `dist/`, `build/`

This ensures AI agent file changes (e.g., Claude Code creating `.claude/commands/`) are immediately detected.

**What is NOT watched (performance):**
- `node_modules/`, `.pnpm/`, `.yarn/cache/`, `bower_components/` - JS package managers
- `.venv/`, `venv/`, `.virtualenv/`, `.conda/` - Python virtual environments
- `.git/objects/`, `.git/subtree-cache/`, `.git/lfs/` - Git internals
- `dist/`, `build/`, `out/`, `.output/` - Build outputs
- `.next/`, `.nuxt/`, `.cache/`, `.parcel-cache/`, `.turbo/`, `.vite/` - Framework caches
- `coverage/`, `__pycache__/`, `.pytest_cache/`, `target/` - Test/build artifacts

This approach provides full dotfolder visibility while maintaining performance on large projects.

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

### Auto-Restart on Transient Errors (v0.6.x)

The DirectoryWatcherService automatically recovers from transient filesystem errors using exponential backoff:

**Transient Errors (auto-restart):**
- `ENOENT` - File/directory temporarily unavailable
- `EMFILE` - Too many open files (system limit)
- `EACCES` - Temporary permission issue
- `ESTALE` - Stale file handle (NFS)

**Permanent Errors (no restart):**
- `ENOSPC` - No space left on device
- `EPERM` - Operation not permitted
- Other unrecoverable errors

**Backoff Strategy:**
- Initial delay: 800ms
- Multiplier: 2x per attempt
- Sequence: 800ms → 1600ms → 3200ms
- Max attempts: 3

After 3 failed restart attempts, the service notifies the user and stops retrying. Restart statistics are tracked in `WatcherMetrics` for debugging.

**Implementation:** `DirectoryWatcherService.ts`, `WatcherMetrics.ts`

---

## VS Code-Inspired Performance Optimizations (v0.4.6)

The DirectoryWatcherService includes performance optimizations inspired by VS Code's file watching implementation.

### Watcher Components

Located in `src/main/services/watcher/`:

**EventCoalescer** (`EventCoalescer.ts`)
- Deduplicates and collapses redundant events
- 5 coalescing rules:
  - CREATE + DELETE → ∅ (cancel out)
  - DELETE + CREATE → CHANGE
  - Multiple CHANGEs → single CHANGE
  - etc.
- Prevents cascade effects from atomic save operations

**ThrottledWorker** (`ThrottledWorker.ts`)
- 75ms collection window for batching events
- 200ms throttle between processing rounds
- 500-event chunks to prevent UI blocking
- Queue management with size limits

**AtomicSaveDetector** (`AtomicSaveDetector.ts`)
- Detects write-to-temp-then-rename save patterns
- 100ms delay to distinguish atomic saves from deletes
- Prevents false "file deleted" events from editors that use atomic saves

**WatcherMetrics** (`WatcherMetrics.ts`)
- Throughput tracking (events/second)
- Latency measurement (event-to-process time)
- Coalesce efficiency (events removed by coalescing)
- Useful for debugging and performance monitoring

**PlatformConfig** (`PlatformConfig.ts`)
- Platform-specific handling (macOS, Linux, Windows)
- FSEvents configuration on macOS
- inotify handling on Linux

### DirectoryWatcherService Integration

The service integrates these components:
- ThrottledWorker replaces simple debounce for chunked processing
- EventCoalescer runs before event delivery
- AtomicSaveDetector distinguishes save vs delete
- WatcherMetrics available for monitoring
- 30,000 event buffer limit with FIFO overflow

### Files

- `src/main/services/watcher/` - All watcher optimization modules
- 57 tests in `src/main/services/watcher/__tests__/`

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
