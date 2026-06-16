# File Watching & Auto-Refresh

Erfana automatically detects and responds to external file system changes using two complementary watching systems.

## Overview

**FileWatcherService**: Watches individual open files for content changes, surfaces editor reload/conflict UI
**DirectoryWatcherService**: Watches entire project directory for both structural changes (create/delete/rename) **and** in-place content changes (`fs.writeFile` in place), broadcasts `directory-watch:changed` for both

Both use [Chokidar](https://github.com/paulmillr/chokidar) for cross-platform file system monitoring with intelligent debouncing and race condition prevention.

> **Chokidar is pinned to exact `3.6.0` (v3 line; do not upgrade to v4).** v3 uses a single macOS FSEvents stream (~0 file descriptors per watched file); v4 dropped FSEvents and watches each file via kqueue (one FD per file), which exhausts the process FD table on large projects and breaks spawning child processes – PDF export's hidden render window crashed with `Failed to initialize sandbox` on a 20k-file folder (commit `68cfab8`, shipped in v0.12.0). The rationale is also in `DirectoryWatcherService.ts:202-206`.

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

- **Service**: `src/main/services/FileWatcherService.ts`
- **IPC Handlers**: `src/main/ipc/file-watcher-handlers.ts`
- **Renderer Hook**: `src/renderer/src/hooks/useFileWatcher.ts` (echo detection, external change handling, `notifySaveComplete` action)
- **Integration**: `src/renderer/src/components/Panels/MarkdownEditorPanel.tsx`
- **UI Component**: `src/renderer/src/components/FileConflictNotification/`

### Self-Save Echo Detection (v0.9.1, #124)

The `useFileWatcher` hook prevents autosave-triggered file change events from being treated as external modifications. Three-layer defense:

1. **`isSavingRef` guard** – Set during save operations, suppresses all change events while a save is in-flight
2. **Content comparison (`isEchoEvent`)** – Compares incoming file content against `lastSavedContentRef` with CRLF normalization to detect self-save echoes that arrive after the saving flag clears
3. **`hasLocalChangesRef`** – Ref mirror of `hasLocalChanges` state (avoids stale closures); if the user has local changes, external reload is suppressed

The `MarkdownEditorPanel` coordinates via:
- Reading content from Monaco editor model (not React state) to avoid stale closure overwrites
- Calling `notifySaveComplete(savedContent)` after successful write to update `lastSavedContentRef`
- Post-save dirty re-detection: checks if Monaco buffer diverged from saved content during the save, re-marks as modified if so

### Conflict Resolution UI

When a file has both external changes and unsaved local changes, an orange conflict bar appears with three options:

- **Reload from Disk**: Discard local changes, load external version
- **Keep My Version**: Ignore external changes, keep local edits
- **Dismiss**: Acknowledge conflict, decide later

---

## DirectoryWatcherService (Directory Watching)

Monitors entire project folder for structural changes (files/folders created, deleted, moved) **and** in-place content modifications (chokidar `change` events from `fs.writeFile` truncate-in-place, added in #241).

### Architecture

- **Library**: Chokidar (recursive watching)
- **Event Pipeline**: VS Code-inspired ThrottledWorker + EventCoalescer
  - 75ms collection window for batching events
  - 200ms throttle between processing rounds
  - AtomicSaveDetector (100ms) for unlink events
- **Events**: `add`, `addDir`, `unlink`, `unlinkDir`, `change`
- **Scope**: Entire project directory (recursive)
- **Cleanup**: Automatic on window close and app quit

> The `change` event covers in-place file content modifications from any source – Monaco autosave, terminal commands (`sed`, `echo >>`), external editors, format-on-save scripts. It is what wakes `useGitStatus.debouncedRefresh()` so the Project Tree's git badges update after an edit without a manual refresh. Prior to this, only structural changes broadcast on this channel, so badges only updated after create/delete/rename – not after editing an existing file.

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
| Create file externally | Tree updates automatically within 500ms |
| Delete folder externally | Tree updates, expanded folder state preserved |
| Edit file content (Monaco autosave or external edit) | Git status badge refreshes after autosave settles (~2.5–3 s total) |
| Git checkout (bulk changes) | Debounced to single refresh after changes settle |
| Internal CRUD (create/delete/rename) | Watcher paused, no double refresh |
| Expand folders, make external changes | Folders remain expanded after refresh |

**Auto-resume safety timeout (v0.7.2, #103):** The PauseController includes a 10-second safety timeout. If `resume()` is not called within 10 s of `pause()` – for example due to a lost IPC message – the controller auto-resumes, logs a warning, and triggers a compensating refresh to keep the tree in sync. This prevents the watcher from being permanently paused.

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `directory-watch:start` | Renderer → Main | Start watching project directory |
| `directory-watch:stop` | Renderer → Main | Stop watching directory |
| `directory-watch:pause` | Renderer → Main | Pause watching during internal CRUD |
| `directory-watch:resume` | Renderer → Main | Resume watching after CRUD completes |
| `directory-watch:changed` | Main → Renderer | Event: Directory structure changed |
| `directory-watch:project-deleted` | Main → Renderer | Event: Project folder deleted |
| `directory-watch:error` | Main → Renderer | Event: Watcher error (transient/permanent) |

### Implementation Location

- **Service**: `src/main/services/DirectoryWatcherService.ts`
- **IPC Handlers**: `src/main/ipc/directory-watcher-handlers.ts`
- **Renderer Hook**: `src/renderer/src/hooks/useDirectoryWatcher.ts` (lifecycle, event handling, AC-010 guard)
- **Pure Logic**: `src/renderer/src/hooks/useDirectoryWatcher.logic.ts` (state guards, message creation)
- **Pause Utility**: `src/renderer/src/components/ProjectTree/withWatcherPause.ts` (pause/resume wrapper)
- **Integration**: `src/renderer/src/components/ProjectTree/ProjectTree.tsx`
- **Component**: `src/renderer/src/components/ProjectTree/ProjectTreeNode.tsx` (controlled pattern)
- **Spec**: `specs/archived/spec-t3-016-project-tree-refresh/` (behavioral contract, archived)

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

**EMFILE log deduplication**: Uses `RateLimitedLogger` (10s cooldown) to prevent EMFILE error log spam during cascading FD exhaustion. See `src/main/utils/RateLimitedLogger.ts`.

**Implementation:** `DirectoryWatcherService.ts`, `WatcherMetrics.ts`, `RateLimitedLogger.ts`

---

## GitWatcherService (Git State Watching) - v0.6.3

Monitors git repository state files for real-time status updates in the Project Tree.

### Architecture

- **Library**: Chokidar (native fs events)
- **Multi-path Watching**: Watches all git state files that affect status
- **Ready Timeout**: 5s (`WATCHER_READY_TIMEOUT_MS`) – if chokidar doesn't emit `ready` within timeout, watcher proceeds with timeout path; `raceResolved` guard prevents double-fire; diagnostic logging includes `elapsedMs`, `pathCount`, `timeoutMs`
- **Event Coalescing**: 150ms window to prevent refresh storms
- **Auto-recovery**: Exponential backoff (800ms, 1600ms, 3200ms)
- **Session Tokens**: Guards against stale events during project switches

### Watched Git Paths

| Path | Purpose |
|------|---------|
| `.git/index` | Staged changes (git add/reset) |
| `.git/HEAD` | Branch switches, detached HEAD |
| `.git/refs/heads/` | New branches, branch commits |
| `.git/FETCH_HEAD` | git fetch/pull operations |
| `.git/stash` | Stash push/pop operations |

### Use Cases

| Scenario | Behavior |
|----------|----------|
| git add/reset | Index change detected, status refreshed within ~750ms |
| git checkout branch | HEAD change detected, tree updates |
| External git CLI operations | Detected via index/refs changes |
| Rapid git operations | Coalesced to single refresh (150ms window) |
| Network/cloud drives | Falls back to GitPollingService |

### Window Cleanup (#106)

`cleanupForWebContentsId(id)` is called from `webContents.on('destroyed')` in `index.ts` to prevent stale git watchers from accumulating after window close or dev refresh.

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `git-watcher:start` | Renderer → Main | Start watching git state files |
| `git-watcher:stop` | Renderer → Main | Stop git watching |
| `git:state-changed` | Main → Renderer | Event: Git state changed |

### Implementation Location

- **Service**: `src/main/services/GitWatcherService.ts`
- **Interface**: `src/main/interfaces/IGitWatcherService.ts`
- **IPC Handlers**: `src/main/ipc/git-watcher-handlers.ts`
- **Schema**: `src/shared/ipc/git-watcher-schema.ts`
- **Integration**: `src/renderer/src/hooks/useGitStatus.ts`

---

## GitPollingService (Hybrid Polling Fallback) - v0.6.3

Provides polling-based git status detection as fallback for unreliable file system events.

### Architecture

- **Purpose**: Fallback for network drives, cloud sync, VMs
- **Default Interval**: 5 seconds (user-configurable 3-10s)
- **Coordination**: Skips if GitWatcherService active within 2 seconds
- **Index Hash**: Detects changes by hashing `.git/index` file

### Polling Strategy

**Hybrid Coordination**:
```
If GitWatcherService triggered within 2s → skip this poll
Otherwise → hash .git/index → compare → emit if changed
```

This prevents duplicate refreshes when file watching works, while ensuring detection on systems where it doesn't.

### Use Cases

| Scenario | Behavior |
|----------|----------|
| File watching works | Polling skips (coordinator reports recent activity) |
| Network/cloud drive | Polling detects changes every 5s |
| VM shared folders | Polling handles missing fsevents |
| User disables polling | Only file watching active |

### Configuration

Users can configure polling via Settings overlay:

| Setting | Default | Range |
|---------|---------|-------|
| `gitStatus.pollingEnabled` | `true` | boolean |
| `gitStatus.pollingInterval` | `5000` | 3000-10000ms |

### Window Cleanup (#106)

`cleanupForWebContentsId(id)` is called from `webContents.on('destroyed')` in `index.ts` (synchronous) to stop polling for the destroyed window.

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `git-polling:start` | Renderer → Main | Start polling |
| `git-polling:stop` | Renderer → Main | Stop polling |
| `git-polling:set-enabled` | Renderer → Main | Enable/disable at runtime |
| `git-polling:git-poll-triggered` | Main → Renderer | Event: Poll detected changes |

### Implementation Location

- **Service**: `src/main/services/GitPollingService.ts`
- **IPC Handlers**: `src/main/ipc/git-watcher-handlers.ts`
- **Settings Schema**: `src/shared/ipc/global-settings-schema.ts`
- **Settings UI**: `src/renderer/src/components/Settings/SettingsOverlay.tsx`

---

## GitEventCoalescer (Git Event Coalescing) - v0.6.3

Specialized event coalescer for git state changes.

### Purpose

Git operations often touch multiple files rapidly (e.g., `git checkout` modifies index, HEAD, and refs). The GitEventCoalescer merges these into a single status refresh.

### Configuration

- **Window**: 150ms (`DEFAULT_COALESCE_WINDOW_MS`)
- **Deduplication**: Multiple events within window → single refresh

### Implementation

- **File**: `src/main/services/watcher/GitEventCoalescer.ts`
- **Tests**: `src/main/services/watcher/GitEventCoalescer.test.ts`

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
- Queue management with 30,000-event buffer cap + FIFO overflow
- **Backing structure**: offset-based deque (`buffer: T[]` + `bufferOffset: number`). Push + evict + chunk consumption are amortized O(1). Periodic compaction reclaims underlying array memory when ≥half of slots are wasted head (floor 1024 to avoid thrash). Prior implementation used `this.buffer = this.buffer.slice(n)` which allocated a fresh array per eviction — fine at low burst rate but O(n²) + heavy GC under sustained overflow (30 k × 30 k element copies during a 60 k-event stress burst). See #173 / `docs/windows/known-flakes.md` for the story.

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
- Watcher unit tests in `src/main/services/watcher/*.test.ts`
- Directory pipeline integration tests in `src/main/services/DirectoryWatcherService.pipeline.test.ts` (11 tests)
- Git pipeline integration tests in `src/main/services/GitWatcherService.pipeline.test.ts` (22 tests, #99)
  - Covers AC-004 (git add), AC-005 (git commit), AC-006 (git checkout), AC-018 (coalescer dedup)
  - Additional: all 5 event types, correlation ID, WatcherMetrics, disposal guards, circuit breaker
- Watcher resilience tests in `src/main/services/WatcherResilience.test.ts` (14 tests, #100)
  - AC-011 (polling fallback), AC-015 (redundant polling suppression), AC-016 (exponential backoff restart)
- Window visibility gating tests in `src/renderer/src/hooks/useGitStatus.test.ts` (5 tests, #102)
  - AC-012: git status refreshes dropped while hidden, single catch-up on restore, cooldown respected
- Event buffer overflow tests in `src/main/services/watcher/ThrottledWorker.test.ts` (24 tests, #102 + #173)
  - AC-017: 30,000-event cap, FIFO eviction, no crash/hang, post-burst recovery
  - Offset-deque coverage: 60 k-event stress burst runs in <1 s cross-platform after the refactor
- 016-NFR-001 main-process latency integration tests in `DirectoryWatcherService.pipeline.test.ts`
  - Isolates chokidar + Defender noise via fake timers; asserts <200 ms virtual latency for single add + atomic-save flows
- Hook tests in `src/renderer/src/hooks/useDirectoryWatcher.test.ts` (11 tests)
- Pause/resume tests in `src/renderer/src/components/ProjectTree/withWatcherPause.test.ts` (17 tests)
- Project switching tests in `src/main/services/ProjectService.switching.test.ts` (20 tests, #101)
  - Session token guards, step ordering, in-flight event handling during project switches
- Renderer switching tests in `src/renderer/src/components/ProjectTree/ProjectTree.switching.test.tsx` (11 tests, #101)
  - Tree clearing, new project loading, stale event rejection, git status updates

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
