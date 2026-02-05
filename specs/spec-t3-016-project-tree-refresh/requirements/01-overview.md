# Project Tree refresh specification -- overview

## Purpose

The Project Tree is the primary navigation element showing the project's folder structure and per-file git status indicators. Users expect near-live responsiveness -- changes made in the terminal, Finder, or external editors must appear in the tree within a perceived "instant" (sub-second for local operations). This spec formalizes the refresh contract to prevent regressions.

## Background / motivation

A regression was observed where changes to the project folder are not immediately reflected in the Project Tree. This spec serves as a behavioral contract for the refresh mechanism -- documenting when refreshes MUST happen, with what latency, and through which pipeline stages.

The refresh system is one of the most complex subsystems in Erfana, involving multiple watchers, event coalescing, debouncing, session tokens, and fallback mechanisms. Without a formal specification, regressions are difficult to detect and debug because the expected behavior is undocumented.

## Scope

### In scope

- All triggers that cause Project Tree folder content to refresh
- All triggers that cause git status indicators to refresh
- The full event pipeline from file system to main process services to IPC to renderer to visual update
- Internal watcher submodules: `EventCoalescer`, `ThrottledWorker`, `GitEventCoalescer`, `AtomicSaveDetector`
- Session token and race condition prevention mechanisms
- Fallback mechanisms (polling when watchers fail)
- Performance constraints and timing budgets
- Known regression investigation and root cause analysis

### Out of scope

- Editor file content refresh (handled by `FileWatcherService` separately)
- Terminal output or behavior
- Prompt template system
- Export features (PDF, DOCX)
- Global settings or project settings refresh
- Multi-instance project locking (handled by `ProjectLockService`)

## Architecture overview

The refresh system consists of 4 layers:

### Layer 1 -- File system detection (main process)

Chokidar-based watchers plus a polling fallback detect file system changes.

- **`DirectoryWatcherService`** -- watches project directories for `add`, `unlink`, `addDir`, and `unlinkDir` events (note: `change` events are NOT subscribed -- content modifications without name changes do not trigger tree refresh). Configured with project-specific ignore patterns from `.erfana/settings.json`.
- **`GitWatcherService`** -- watches specific git metadata files: `.git/index`, `.git/HEAD`, `.git/refs/heads/`, `.git/FETCH_HEAD`, `.git/stash`. These files change when git operations (add, commit, checkout, merge, stash, fetch) execute. **Known gap:** `.git/MERGE_HEAD` and `.git/REBASE_HEAD` are not currently watched, so merge/rebase state transitions may not trigger immediate status refresh.
- **`GitPollingService`** -- fallback polling (default 5s, configurable range 1s–60s internally; user-facing settings constrain to 3s–10s via schema validation) that detects git changes by checking `.git/index` modification time and file size (if either changes, a refresh triggers). Only `.git/index` is polled -- changes that only affect `.git/HEAD` or `.git/refs/` without touching `.git/index` may not be detected by polling alone. Activated when file system watchers are unreliable (network drives, VMs, cloud-synced directories). Hybrid coordination skips polls when the watcher fired within the last 2 seconds. **Note:** There is no equivalent polling fallback for directory watching -- only the git pipeline has a polling fallback.

### Layer 2 -- Event processing (main process)

Submodules that coalesce, throttle, and deduplicate raw file system events before broadcasting.

- **`ThrottledWorker`** -- collects events for 75ms (batch window), then processes them. A 200ms inter-chunk throttle is applied between consecutive batches to prevent rapid-fire broadcasts. This means the 200ms delay only occurs when multiple batches queue up in rapid succession, not after every single batch.
- **`EventCoalescer`** -- cancels redundant event pairs (e.g., CREATE + DELETE for the same path = no event), merges duplicate CHANGEs, and collapses CREATE + CHANGE into a single CREATE.
- **`GitEventCoalescer`** -- 150ms debounce window (sliding -- resets on each new event) that coalesces multi-file git operations (e.g., `git checkout` touches HEAD + index + refs simultaneously) into a single notification. Because the window resets, rapid sequential events can extend the total delay beyond 150ms. Includes a **circuit breaker**: if the flush callback throws 5 consecutive errors, the coalescer auto-disposes and the git watcher silently stops emitting events with no automatic recovery.
- **`AtomicSaveDetector`** -- 100ms window that detects editor atomic save patterns (delete old file, write new file) and converts them to a single CHANGE event instead of a DELETE + CREATE pair.

### Layer 3 -- IPC transport

Broadcasts from the main process to the renderer.

| Channel | Source | Payload | Purpose |
|---------|--------|---------|---------|
| `directory-watch:changed` | `DirectoryWatcherService` | `{ dirPath: string, eventCount: number, originalEventCount: number, coalescedCount: number, summary: Record<string, number> }` | Folder content changed. `summary` keys are Chokidar event types (e.g., `{ add: 3, unlink: 1 }`) |
| `git:state-changed` | `GitWatcherService` | `{ projectPath: string, eventTypes: GitEventType[], timestamp: number, correlationId?: string }` | Git state file changed (watcher). `eventTypes` indicates which git files changed (e.g., `['index', 'head']`) |
| `git:poll-triggered` | `GitPollingService` | `{ projectPath: string, timestamp: number, reason: 'index_changed' \| 'no_watcher' }` | Git state changed (polling fallback) |
| `project:changed` | `ProjectService` | `{ oldPath, newPath }` | Project opened/closed/switched |

### Layer 4 -- Renderer update

React hooks receive IPC events and trigger state updates.

- **`useDirectoryWatcher`** -- subscribes to `directory-watch:changed`, calls `refreshFiles()` which invokes `readDirectory()` on the main process and updates the file tree state via `setFiles()`.
- **`useGitStatus`** -- subscribes to `git:state-changed` and `git:poll-triggered` with a 250ms debounce + 500ms cooldown (constants defined in `ProjectTree/constants.ts`). Calls `getStatus()` on the main process and updates status indicators.
- **`useProjectManagement`** -- handles project lifecycle. On `project:changed`, clears the tree, resets session tokens, and calls `readDirectory()` for the new project path.

### Event flow diagrams

**Directory pipeline (folder content):**

```
File system change (add/unlink/addDir/unlinkDir)
  |
  v
Chokidar (DirectoryWatcherService)
  |
  v
queueEvent() -- session token + pause checks
  |
  +-- unlink events only ──→ AtomicSaveDetector (100ms window)
  |                              |
  |                              v
  |                          resolved as 'change' (atomic save) or 'unlink' (real delete)
  |                              |
  +-- non-delete events ────────+
  |
  v
ThrottledWorker (75ms batch + 200ms inter-chunk throttle)
  |
  v
EventCoalescer (dedup + cancel pairs + cascade prevention)
  |
  v
IPC broadcast: directory-watch:changed (summary stats payload)
  |
  v
useDirectoryWatcher hook receives event
  |
  v
refreshFiles() → readDirectory() on main process
  |
  v
setFiles() → React re-render (tree visually updates)
```

**Key:** `AtomicSaveDetector` runs BEFORE `ThrottledWorker`, only for `unlink` events. Non-delete events (`add`, `addDir`, `unlinkDir`) bypass it entirely and go directly to `ThrottledWorker`.

**Git pipeline (status indicators):**

```
Git metadata file change (.git/index, .git/HEAD, etc.)
  |
  v
Chokidar (GitWatcherService)
  |
  v
GitEventCoalescer (150ms debounce -- resets on each new event)
  |
  v
IPC broadcast: git:state-changed
  |
  v
useGitStatus hook receives event
  |
  v
debouncedRefresh (250ms debounce + 500ms cooldown)
  |
  v
getStatus() → isomorphic-git on main process
  |
  v
setStatus() → React re-render (indicators update)
```

**Note:** The directory and git pipelines use **different** event processing stacks. The directory pipeline uses `AtomicSaveDetector` (unlink only) → `ThrottledWorker` → `EventCoalescer`. The git pipeline uses `GitEventCoalescer` only. They should not be confused.

### Internal operation pause mechanism

Internal file operations (create, delete, rename, move, paste) use a **dual-layer pause** to prevent duplicate refreshes:

1. **Main process layer** -- `PauseController` via IPC `directory-watch:pause` / `directory-watch:resume` commands. While paused, the main process `DirectoryWatcherService` suppresses event broadcasting.
2. **Renderer layer** -- `isInternalOperationRef` flag. If events slip through (race condition), the renderer ignores them while this ref is `true`.

Both layers are managed by the `withWatcherPause()` utility. If either layer fails (e.g., IPC resume message lost), events may be permanently suppressed until the next manual refresh or project switch.

## Key stakeholders

- **End users** -- expect near-live tree updates when working with files via terminal, Finder, or external editors
- **Developers maintaining the watcher subsystem** -- need a clear behavioral contract to avoid introducing regressions
- **QA / testing** -- need acceptance criteria with concrete timing budgets to verify correct behavior

## Success criteria

1. All acceptance criteria in `03-acceptance.md` pass
2. The current regression (delayed or missing tree refresh) is identified and resolved
3. The end-to-end pipeline from file system event to visual update is verified with timing within the specified budgets
4. No duplicate refreshes occur for internal operations (watcher pause mechanism works correctly)
5. Session token guards reliably prevent stale events from appearing after project switches
