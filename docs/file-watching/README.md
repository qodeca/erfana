# File Watching & Auto-Refresh

Erfana automatically detects and responds to external file system changes using two complementary watching systems.

## Overview

**FileWatcherService**: Watches individual open files for content changes, surfaces editor reload/conflict UI
**DirectoryWatcherService**: Watches entire project directory for both structural changes (create/delete/rename) **and** in-place content changes (`fs.writeFile` in place), broadcasts `directory-watch:changed` for both

Both use [Chokidar](https://github.com/paulmillr/chokidar) for cross-platform file system monitoring with intelligent debouncing and race condition prevention.

> **Chokidar is pinned to exact `3.6.0` (v3 line; do not upgrade to v4).** v3 uses a single macOS FSEvents stream (~0 file descriptors per watched file); v4 dropped FSEvents and watches each file via kqueue (one FD per file), which exhausts the process FD table on large projects and breaks spawning child processes – PDF export's hidden render window crashed with `Failed to initialize sandbox` on a 20k-file folder (commit `68cfab8` – pre-migration; no longer resolvable, that history was rewritten at the 2026-06 migration – shipped in v0.12.0). The rationale is also in the comment above `disableGlobbing` in the `chokidar.watch(...)` options of `DirectoryWatcherService.watchDirectory`.

---

## FileWatcherService (File Content Watching)

Monitors open files for external content modifications.

### Architecture

- **Library**: Chokidar (native fs events, not polling)
- **Debouncing**: 300ms (optimized for single file saves)
- **Events**: `change`, `unlink`, `error`
- **Scope**: Per-file watching (on-demand when file is opened)
- **Limit**: 100 files maximum, app-wide (security). The cap governs **new** map entries only — joining a path that is already watched can never fail on it (#70)
- **Symlinks**: `followSymlinks: false` — the watch is on the path itself, never on what a link at that path points at (#70)
- **Consumers**: two renderer hooks — `useFileWatcher` (Markdown editor, read/write) and `useFileChangeSubscription` (read-only surfaces, #70). Both hold a `fileWatchSlot`

### Use Cases

| Scenario | Behavior |
|----------|----------|
| File modified externally, no local changes | Auto-reload silently, show "Reloaded from disk" in toolbar (1s) |
| File modified externally, has unsaved changes | Show orange conflict bar with options |
| File replaced atomically (write temp + rename) | Surfaces as `file-watch:changed`, not a delete — see [Single-file watch internals](#single-file-watch-internals-70) |
| File deleted externally | Show red warning banner, keep editor state |
| Watch dies for any other reason | `file-watch:error` — the consumer shows a degraded state instead of silently going stale (#70) |
| Rapid changes (git operations) | Debounced to single reload |

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `file-watch:start` | Renderer → Main | Start watching specific file |
| `file-watch:stop` | Renderer → Main | Stop watching specific file |
| `file-watch:stopAll` | Renderer → Main | Drop every watch held by this window |
| `file-watch:pause` | Renderer → Main | Pause watching during save operation |
| `file-watch:resume` | Renderer → Main | Resume watching after save completes |
| `file-watch:stats` | Renderer → Main | Watcher diagnostics |
| `file-watch:changed` | Main → Renderer | Event: File content changed externally (**including** an atomic replace, #70) |
| `file-watch:deleted` | Main → Renderer | Event: File genuinely deleted externally |
| `file-watch:error` | Main → Renderer | Event: chokidar error, **or** the watch died and cannot be re-armed (#70) |

### Implementation Location

- **Service**: `src/main/services/FileWatcherService.ts`
- **Watch factory**: `src/main/services/watcher/singleFileWatch.ts` (`SINGLE_FILE_WATCH_OPTIONS` + `createSingleFileWatcher`, #70)
- **Unlink branch**: `src/main/services/watcher/atomicRearm.ts` (atomic save vs genuine delete, #70)
- **Subscription counting**: `src/main/services/watcher/SubscriberCounter.ts` (#70)
- **Send loop**: `src/main/services/watcher/watchNotifier.ts` (#70)
- **IPC Handlers**: `src/main/ipc/file-watcher-handlers.ts`
- **Renderer Hooks**:
  - `src/renderer/src/hooks/useFileWatcher.ts` (editor: echo detection, external change handling, `notifySaveComplete` action)
  - `src/renderer/src/hooks/useFileChangeSubscription.ts` (read-only surfaces, #70)
  - `src/renderer/src/hooks/fileWatchSlot.ts` (shared acquire/release slot, #70)
- **Integration**: `src/renderer/src/components/Panels/MarkdownEditorPanel.tsx`, `src/renderer/src/components/Panels/ImageViewerPanel/`
- **UI Component**: `src/renderer/src/components/FileConflictNotification/`

### Self-Save Echo Detection (v0.9.1, #124)

The `useFileWatcher` hook prevents autosave-triggered file change events from being treated as external modifications. Three-layer defense:

1. **`isSavingRef` guard** – Set during save operations, suppresses all change events while a save is in-flight
2. **Content comparison (`isEchoEvent`)** – Compares incoming file content against `pendingSavedContentsRef`, a `Set` of recently saved content strings (a set, not a single ref, because rapid successive saves can leave several echoes in flight). Both sides are CRLF-normalized before comparison, so a self-save echo that arrives after the saving flag clears is still recognised. The set is cleared on reload, keep-local, file switch, and after a match
3. **`hasLocalChangesRef`** – Ref mirror of `hasLocalChanges` state (avoids stale closures); if the user has local changes, external reload is suppressed

The `MarkdownEditorPanel` coordinates via:
- Reading content from Monaco editor model (not React state) to avoid stale closure overwrites
- Calling `notifySaveComplete(savedContent)` after a successful write, which adds the content to `pendingSavedContentsRef`
- Post-save dirty re-detection: checks if Monaco buffer diverged from saved content during the save, re-marks as modified if so

### Conflict Resolution UI

When a file has both external changes and unsaved local changes, an orange conflict bar appears with three options:

- **Reload from Disk**: Discard local changes, load external version
- **Keep My Version**: Ignore external changes, keep local edits
- **Dismiss**: Acknowledge conflict, decide later

---

## Single-file watch internals (#70)

Issue #70 (a preview tab showing stale content forever) turned out to be three
independent defects. Two of them were in this service and therefore affected the
Markdown editor as well; the third was renderer-side.

### Atomic-save detection and watcher re-arm

A chokidar single-file watch is bound to the **inode** it opened. The dominant
agent / design-tool write pattern is *write a temp file, rename it over the
target*, which destroys that inode. Where the platform reports the rename as an
`unlink`, the old behaviour emitted `file-watch:deleted`, closed the watcher and
dropped the map entry — so every later edit was invisible until the tab was
closed and reopened.

`FileWatcherService` now runs one service-level `AtomicSaveDetector` (it already
keys pending deletes by path, and this service is 1 watcher : 1 path, so a
per-file detector would be a `Map` with one entry × 100 watches). The branch that
follows the detector's verdict lives in `watcher/atomicRearm.ts`:

| Verdict | Behaviour |
|---|---|
| File is back within the 100 ms window | Close the stale watcher, create a replacement through `createSingleFileWatcher`, mutate the existing entry in place, then **re-enter `handleFileChange`** |
| File still gone (one final `stat` confirms) | `file-watch:deleted`, close, drop the entry — today's behaviour |
| Session token bumped inside the window | `file-watch:error` (`WATCH_DEAD_SESSION_ENDED`), then drop — never a silent drop |
| Path no longer resolves inside the project | `file-watch:error` (`WATCH_DEAD_OUTSIDE_PROJECT`), then drop |
| `chokidar.watch()` throws on the replacement | `file-watch:error` (`WATCH_DEAD_REARM_FAILED`), then drop |
| Path vanishes between the existence check and `chokidar.watch()` | `file-watch:deleted` + drop, so no zombie entry holds a `MAX_WATCHED_FILES` slot |

Two design points that are easy to undo by accident:

- The re-arm calls **`handleFileChange`**, never `notifyWebContents` directly. A
  direct notify would skip `awaitWriteFinish.stabilityThreshold` (300 ms), the
  300 ms debounce and the `isPaused` check — so `rm x.md && <slow write> x.md`
  would tell the editor to reload a half-written file.
- The record is updated **in place**, so subscribers, `isPaused` and the map size
  survive. A re-arm can therefore never trip `MAX_WATCHED_FILES`.
- The path is re-checked for project confinement at re-arm time
  (`utils/projectConfinement.ts`). The entry check ran before somebody else
  replaced the file, so an in-project name can be a symlink out of the project by
  the time the replacement lands.

**Platform split — measured, not assumed.** On **macOS** (fsevents,
`usePolling: false`) chokidar v3 reports `mv tmp target` over a watched path as
**`change`**, not `unlink`, and the watch keeps working afterwards. The re-arm
branch is therefore **dormant on macOS**, and the ordinary debounced change path
is what carries the fix there. The branch matters on platforms that do report
`unlink`. This is pinned by
`src/main/services/watcher/singleFileWatch.rename.integration.test.ts`, which
drives the **real** production watcher factory against a real `rename` in
`os.tmpdir()` and asserts the disjunction: either `unlink` (the branch's premise)
or `change` *followed by a further change that still arrives* (proving the watch
survived). **Do not delete the re-arm branch as dead code** because it never
fires on a macOS box — and do not weaken that test to assert one platform's
answer, or a platform that reports `change` and then goes deaf would break the
fix silently.

### Subscriber counting

`WatchedFile.webContentsIds: Set<number>` became
`subscribers: SubscriberCounter` (`watcher/SubscriberCounter.ts`), a
`Map<number, number>`. A `Set` of window ids cannot represent **two consumers
inside one window** watching one path: the first `unwatchFile` removed the id and
closed the watcher out from under the second, which then went permanently deaf.

| Method | Semantics |
|---|---|
| `add(id)` | Increment (first add = 1) |
| `release(id)` | Decrement; delete the key at 0; returns how many windows still hold a subscription |
| `removeAll(id)` | Drop the key outright — the webContents itself is gone (window closed, dev refresh), so every subscription it held dies together |
| `has` / `size` / `countFor` / `totalSubscriptions` / `ids()` | Reads for `unwatchAll`, notification and diagnostics |

`unwatchFile` closes the chokidar watcher only when `release()` reaches 0;
`cleanupForWebContentsId` and `unwatchAll` use `removeAll`.

The guarantee is precisely "no `release` before the last one closes the watch" —
it holds only while every consumer that starts a watch releases it exactly once,
and while joining an existing watch cannot fail. That is why `watchFile` checks
`MAX_WATCHED_FILES` **after** the join branch: a refused join whose consumer
still released on unmount would decrement a count it never incremented.

### Renderer side: the read-only hook and the shared slot

- **`hooks/useFileChangeSubscription.ts`** — a read-only subscription for
  surfaces that only *display* a file. Deliberately **not** an option on
  `useFileWatcher`: that hook is structurally text-coupled (it reads the file as
  UTF-8 and hands a `string` to `onContentUpdate`), and its #124 echo/conflict
  machinery is dead weight for a surface that never writes. It returns
  `{ isReloading, isFileDeleted, isWatchUnavailable, unavailableReason,
  markReloaded, recover }`, depends on `[filePath]` only (callbacks live in
  refs), **never** calls `fileWatch.pause` / `resume` (those are global per path
  with no safety timeout, so a stuck pause would deafen every consumer of that
  path), and re-checks existence via `file:getStats` before reporting a delete.
  `classifyWatchStartFailure` maps a refused `start` to `'limit'` only for the
  watched-files cap, and `'watcher-error'` otherwise, so the UI never tells a
  user to close tabs for an unrelated fault.
- **`hooks/fileWatchSlot.ts`** — one consumer's hold on a main-process watch,
  used by **both** hooks. `window.api.fileWatch.start` is not idempotent (it
  increments a per-window count), so a consumer must send exactly as many stops
  as successful starts. The slot pairs an `isHeld` flag with a serialised
  operation queue, which makes three failure modes impossible: a double
  acquire (leaks a slot out of the 100 available until `start` refuses for every
  surface), an unmatched release (deafens whichever panel legitimately holds the
  count), and a stop overtaking its own start (leaks the slot permanently).
  `releaseFileWatch` is safe to call unconditionally in an effect cleanup.

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
| `directory-watch:stop-all` | Renderer → Main | Stop every directory watch held by the calling window (cleanup) |
| `directory-watch:get-stats` | Renderer → Main | Watcher statistics (debugging) |
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
| `git-watcher:status` | Renderer → Main | Get current watcher status |
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
| `git-polling:set-interval` | Renderer → Main | Update the polling interval at runtime |
| `git-polling:set-enabled` | Renderer → Main | Enable/disable at runtime |
| `git:poll-triggered` | Main → Renderer | Event: Poll detected changes (`GIT_EVENT_CHANNELS.POLL_TRIGGERED` in `src/shared/ipc/git-watcher-channels.ts`) |

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
- Directory pipeline integration tests in `src/main/services/DirectoryWatcherService.pipeline.test.ts` (17 tests)
- Git pipeline integration tests in `src/main/services/GitWatcherService.pipeline.test.ts` (22 tests, #99)
  - Covers AC-004 (git add), AC-005 (git commit), AC-006 (git checkout), AC-018 (coalescer dedup)
  - Additional: all 5 event types, correlation ID, WatcherMetrics, disposal guards, circuit breaker
- Watcher resilience tests in `src/main/services/WatcherResilience.test.ts` (14 tests, #100)
  - AC-011 (polling fallback), AC-015 (redundant polling suppression), AC-016 (exponential backoff restart)
- Window visibility gating tests in `src/renderer/src/hooks/useGitStatus.test.ts` – 5 of the file's 38 tests cover the visibility-gating case (#102)
  - AC-012: git status refreshes dropped while hidden, single catch-up on restore, cooldown respected
- Event buffer overflow tests in `src/main/services/watcher/ThrottledWorker.test.ts` (24 tests, #102 + #173)
  - AC-017: 30,000-event cap, FIFO eviction, no crash/hang, post-burst recovery
  - Offset-deque coverage: 60 k-event stress burst runs in <1 s cross-platform after the refactor
- 016-NFR-001 main-process latency integration tests in `DirectoryWatcherService.pipeline.test.ts`
  - Isolates chokidar + Defender noise via fake timers; asserts <200 ms virtual latency for single add + atomic-save flows
- Hook tests in `src/renderer/src/hooks/useDirectoryWatcher.test.ts` (13 tests)
- Pause/resume tests in `src/renderer/src/components/ProjectTree/withWatcherPause.test.ts` (17 tests)
- Project switching tests in `src/main/services/ProjectService.switching.test.ts` (20 tests, #101)
  - Session token guards, step ordering, in-flight event handling during project switches
- Renderer switching tests in `src/renderer/src/components/ProjectTree/ProjectTree.switching.test.tsx` (11 tests, #101)
  - Tree clearing, new project loading, stale event rejection, git status updates

---

## Symlinks

- Watchers do not follow symlinks (security)
- **Single-file watches set `followSymlinks: false` explicitly** (`watcher/singleFileWatch.ts`, added in #70). chokidar v3 defaults this to `true`, so a link planted inside the project would otherwise make the watcher — and the automatic re-read behind it — track an out-of-project target
- Symlinked entries are flagged in the Project Tree with a small chain icon and tooltip
- Operations on symlink targets remain subject to project boundary checks. Since #70 the read handlers enforce that with `fs.realpath` on both ends rather than by comparing path text — see [API Services § Path confinement](../api-services.md#path-confinement-for-the-file-read-ipc-handlers)

---

## Documentation Structure

This documentation is split into focused files for optimal Claude Code context usage:

- **[README.md](./README.md)** (this file) - Overview and service architecture
- **[Patterns & Testing](./patterns-and-testing.md)** - Implementation patterns, session tokens, test scenarios
- **[Technical Details](./technical-details.md)** - Performance, security, edge cases, integration points

---

See: [Architecture](../architecture.md) | [IPC Patterns](../ipc-patterns.md) | [Development Tasks](../development-tasks.md)
