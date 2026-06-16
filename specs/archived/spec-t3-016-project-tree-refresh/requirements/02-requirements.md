# Project Tree refresh specification -- requirements

## Functional requirements

### 016-FR-001: External file system changes must trigger tree refresh

When files or directories are added, deleted, or renamed outside Erfana (e.g., in Finder, terminal, or external editor), the Project Tree MUST update to reflect the change.

**Pipeline:**

1. Chokidar detects `add`, `unlink`, `addDir`, or `unlinkDir` event (note: `change` events are not subscribed for directory watching)
2. `queueEvent()` validates session token and checks pause state
3. For `unlink` events only: `AtomicSaveDetector` checks for atomic save pattern (100ms window). If the file reappears within 100ms, the event is converted to `change`; otherwise it proceeds as `unlink`. Non-delete events bypass this step entirely.
4. `ThrottledWorker` collects the event (75ms batch window, 200ms inter-chunk throttle)
5. `EventCoalescer` deduplicates, cancels redundant pairs, and drops cascade events (events for paths inside deleted directories)
6. IPC broadcast `directory-watch:changed` sent to renderer
6. `useDirectoryWatcher` hook receives the event
7. `refreshFiles()` calls `readDirectory()` on the main process
8. `setFiles()` updates the tree state
9. React re-renders the Project Tree

**Priority:** Critical
**Traces to:** 016-AC-001, 016-AC-002, 016-AC-003

---

### 016-FR-002: Internal file operations must trigger tree refresh

When files are created, deleted, renamed, moved, or pasted within Erfana's UI, the tree MUST update after the operation completes.

**Dual-layer watcher pause mechanism:**

The `withWatcherPause()` utility implements a two-layer approach:

1. **Main process layer (IPC):** Sends `directory-watch:pause` before the operation and `directory-watch:resume` after. While paused, `DirectoryWatcherService` suppresses event broadcasting at the source.
2. **Renderer layer (ref guard):** Sets `isInternalOperationRef.current = true` before the operation and `false` after. This acts as a safety net -- if events slip through the main process pause (race condition), the renderer ignores them.

After the operation completes, an explicit `refreshFiles()` call updates the tree.

**Risk:** If `directory-watch:resume` IPC message is lost (e.g., operation throws before sending resume), events may be permanently suppressed at the main process level until the next project switch or manual refresh.

This prevents duplicate refreshes -- one from the watcher detecting the change and one from the internal operation completing.

**Priority:** Critical
**Traces to:** 016-AC-010

---

### 016-FR-003: Git operations must trigger git status refresh

When git operations modify git metadata files, git status indicators MUST update.

**Watched git files:**

- `.git/index` -- changes on `git add`, `git rm`, `git checkout`, `git merge`, `git reset`
- `.git/HEAD` -- changes on `git checkout`, `git switch`
- `.git/refs/heads/` -- changes on `git commit`, `git merge`, `git rebase`
- `.git/FETCH_HEAD` -- changes on `git fetch`, `git pull`
- `.git/stash` -- changes on `git stash`, `git stash pop`

**Pipeline:**

1. Chokidar detects change to a watched git file
2. `GitEventCoalescer` debounces events (150ms sliding window -- resets on each new event, so rapid sequential events can extend the total delay beyond 150ms)
3. IPC broadcast `git:state-changed` sent to renderer
4. `useGitStatus` hook receives the event
5. `debouncedRefresh()` applies 250ms debounce (with 500ms cooldown between consecutive refreshes)
6. `getStatus()` calls isomorphic-git on the main process
7. `setStatus()` updates the git status state
8. React re-renders status indicators in the tree

**Circuit breaker:** The `GitEventCoalescer` includes a defensive circuit breaker -- if the flush callback throws 5 consecutive errors, the coalescer auto-disposes and the git watcher silently stops emitting events. There is no automatic recovery; the watcher must be restarted (e.g., via project switch or manual refresh). This is a potential regression vector.

**Priority:** Critical
**Traces to:** 016-AC-004, 016-AC-005, 016-AC-006

---

### 016-FR-004: Directory changes must also trigger git status refresh

When directory content changes (new or deleted files), git status MUST also refresh because untracked and deleted files affect `git status` output.

The `useGitStatus` hook MUST subscribe to `directory-watch:changed` events in addition to `git:state-changed` events, and trigger a debounced git status refresh when directory content changes.

**Priority:** High
**Traces to:** 016-AC-001, 016-AC-002

---

### 016-FR-005: Polling fallback must cover unreliable watcher scenarios

`GitPollingService` MUST poll at a configurable interval (default 5s) to detect git changes when file system watchers are unreliable. The service accepts a programmatic range of 1s–60s (`MIN_POLLING_INTERVAL_MS=1000`, `MAX_POLLING_INTERVAL_MS=60000`), but the user-facing settings schema constrains the range to 3s–10s (`z.number().min(3000).max(10000).default(5000)` in `global-settings-schema.ts`).

**Hybrid coordination rules:**

- If `GitWatcherService` triggered within the last 2 seconds, skip the poll (watcher is working)
- If `GitWatcherService` has not triggered recently, execute the poll
- Poll checks `.git/index` modification time AND file size (if either changes, a refresh triggers). Only `.git/index` is polled -- not the full set of watched git files. This means changes that only affect `.git/HEAD` or `.git/refs/` without touching `.git/index` may not be detected by polling alone.
- On change detection, broadcast `git:poll-triggered` to renderer

**Important:** There is no equivalent polling fallback for directory watching. Only the git pipeline has a polling fallback mechanism.

**Priority:** High
**Traces to:** 016-AC-011, 016-AC-015

---

### 016-FR-006: Manual refresh must bypass all debouncing and cooldowns

The manual refresh button (Cmd/Ctrl+Alt+R) MUST trigger an immediate, unconditional refresh of BOTH folder content AND git status.

**Behavior:**

- Bypass `ThrottledWorker` batch window
- Bypass `useGitStatus` 250ms debounce and 500ms cooldown
- Call `readDirectory()` directly for folder content
- Call `getStatus()` directly for git status
- Both calls happen in parallel
- Total time from keypress to visual update MUST be under 500ms on local file systems

This is the user's escape hatch for any perceived staleness.

**Priority:** Critical
**Traces to:** 016-AC-007

---

### 016-FR-007: Project switching must fully reset and reload the tree

When a project is opened, closed, or switched, the following sequence MUST execute:

1. Increment session `switchVersion` token (BEFORE cleanup -- critical ordering)
2. Stop all watchers for the old project
3. Clear the tree state (`setFiles([])`)
4. Clear git status state (`setStatus({})`)
5. Start watchers for the new project path
6. Call `readDirectory()` for the new project path
7. Call `getStatus()` for the new project path
8. Update tree and git status state

Steps 1--4 MUST happen synchronously to prevent stale events from the old project reaching the renderer.

**Priority:** Critical
**Traces to:** 016-AC-009, 016-AC-014

---

### 016-FR-008: Window visibility must gate git status refreshes

When the application window is hidden (minimized or behind other windows), git status refreshes from watcher and polling events SHOULD be suppressed to save CPU.

**Behavior (current implementation):**

- Track window visibility via `document.visibilityState` in the renderer
- While hidden: git status refresh requests are **dropped** (not queued). The `useGitStatus` hook skips the `getStatus()` call entirely when the document is not visible.
- On becoming visible: a single git status refresh fires to catch up on any missed changes. **Note:** This restore refresh respects the 500ms cooldown (`executeRefresh(false)`), so if a refresh completed very recently, the restore refresh may be slightly deferred by the remaining cooldown time.
- Directory content refreshes are NOT gated (folder changes are rarer and more critical)

**Note:** Because events are dropped rather than queued, the "catch-up" refresh on visibility restore relies on re-fetching the full git status, not replaying individual events. This is correct behavior since `getStatus()` returns the complete current state.

**Priority:** Medium
**Traces to:** 016-AC-012

---

### 016-FR-009: Watcher auto-restart on failure

If a directory or git watcher crashes (Chokidar error event), the service MUST automatically attempt to restart.

**Restart policy:**

- Exponential backoff: 800ms, 1600ms, 3200ms (3 attempts max)
- Each attempt creates a fresh Chokidar instance
- If all 3 attempts fail for **git watcher**: the watcher stops trying, and a warning is logged at `warn` level. `GitPollingService` acts as an **implicit** fallback -- it runs independently and its `shouldSkip()` logic stops skipping polls once the watcher's last event timestamp becomes stale (>2s). There is no explicit "fall back to polling" handoff or log message; the fallback is a consequence of the hybrid coordination design.
- If all 3 attempts fail for **directory watcher**: log a warning at `warn` level. **No polling fallback exists for directory watching** -- the tree will not auto-refresh until the watcher recovers or the user triggers a manual refresh (Cmd/Ctrl+Alt+R).
- On successful restart: reset the attempt counter

**Priority:** High
**Traces to:** 016-AC-016

---

### 016-FR-010: Session token guards must prevent stale events

Every watcher event callback MUST validate the current session `switchVersion` token before processing.

**Rules:**

- Events with a `switchVersion` that does not match the current value MUST be silently dropped
- The `switchVersion` MUST be incremented BEFORE watcher cleanup begins (not after), to prevent late events from the old session queuing into the pipeline
- The token is a monotonically increasing integer

**Priority:** Critical
**Traces to:** 016-AC-014

---

### 016-FR-011: Concurrent git status requests must be queued

Multiple simultaneous git status requests for the same project MUST be serialized (not run concurrently).

**Rationale:**

- Concurrent isomorphic-git operations can conflict on `.git/index.lock`
- Redundant parallel status calls waste CPU
- `GitStatusService` MUST maintain a per-project operation queue (promise chain or mutex)

**Priority:** High
**Traces to:** 016-AC-018

---

### 016-FR-012: Event coalescing must reduce redundant refreshes

The `EventCoalescer` MUST apply the following rules to events within a single batch:

| Sequence | Result | Rationale |
|----------|--------|-----------|
| CREATE + DELETE (same path) | Cancel (no event) | File was created then immediately deleted |
| DELETE + CREATE (same path) | Single CHANGE event | File was replaced |
| Multiple CHANGE (same path) | Single CHANGE event | Only the final state matters |
| CREATE + CHANGE (same path) | Single CREATE event | File was created then modified |
| DELETE + DELETE (same path) | Single DELETE event | Duplicate deletes collapsed |
| Any other sequence (same path) | Replace with latest event | Default clause (e.g., CHANGE + DELETE → DELETE) |

**Note:** The CHANGE + DELETE → DELETE case is handled by the default clause (replace with latest event), not a specific rule.

**Cascade prevention:** When a directory is deleted (`unlinkDir`), the `EventCoalescer` also drops all queued events for paths inside that directory, since those events are now irrelevant.

**Priority:** High
**Traces to:** 016-AC-008

---

### 016-FR-013: Atomic save detection must prevent false delete events

The `AtomicSaveDetector` (100ms detection window) MUST detect atomic save patterns used by editors like VS Code.

**Atomic save pattern:**

1. Editor deletes the original file
2. Editor writes a new file with the same name (within 100ms)

**Expected behavior:**

- The DELETE + CREATE pair within 100ms for the same path MUST be converted to a single CHANGE event
- The tree MUST NOT briefly show the file as deleted

**Priority:** High
**Traces to:** 016-AC-013

---

## Non-functional requirements

### 016-NFR-001: External file change latency budget

External file changes MUST be visible in the Project Tree within 500ms on local file systems under normal load (fewer than 100 pending events).

**Budget breakdown:**

| Stage | Typical latency | Max latency |
|-------|----------------|-------------|
| Chokidar detection | ~50ms | 100ms |
| AtomicSaveDetector window (unlink only) | 0--100ms | 100ms |
| ThrottledWorker collection | 75ms | 75ms |
| EventCoalescer processing | ~5ms | 20ms |
| IPC broadcast | ~5ms | 10ms |
| readDirectory call | ~50ms | 200ms |
| React render | ~50ms | 100ms |
| **Total** | **~235ms** | **~605ms** |

Note: The AtomicSaveDetector window (100ms) only applies when an `unlink` event is detected. For `add`, `addDir`, and `unlinkDir` events, this stage adds 0ms. AtomicSaveDetector runs BEFORE ThrottledWorker in the pipeline.

**Priority:** Critical

---

### 016-NFR-002: Git status update latency budget

Git status changes MUST be visible within 1000ms of the triggering git operation on local file systems.

**Budget breakdown:**

| Stage | Typical latency | Max latency |
|-------|----------------|-------------|
| Chokidar detection | ~50ms | 100ms |
| GitEventCoalescer debounce | 150ms | 150ms+ (sliding window -- extends if events keep arriving within 150ms of each other) |
| IPC broadcast | ~5ms | 10ms |
| useGitStatus debounce | 250ms | 250ms |
| isomorphic-git getStatus | ~100ms | 400ms |
| React render | ~50ms | 100ms |
| **Total** | **~605ms** | **~1010ms** |

The 500ms cooldown in `useGitStatus` means a second git operation within 500ms of the first will be delayed by the remaining cooldown time.

**Priority:** High

---

### 016-NFR-003: Event buffer overflow protection

The watcher event buffer MUST be capped at 30,000 events.

**Behavior on overflow:**

- Oldest events are dropped (FIFO)
- A warning is logged: `"Watcher event buffer overflow: {count} events dropped"`
- The system continues operating with the remaining events
- No crash or hang

**Priority:** Medium

---

### 016-NFR-004: Large repository scalability

- Git status MUST be capped at 10,000 files (`GIT_STATUS_CAP`). When exceeded, the UI MUST show a truncation indicator (e.g., "Git status truncated: showing 10,000 of {total} files").
- Directory tree reading via `readDirectory()` MUST complete within 2 seconds for projects containing up to 50,000 files.
- Chokidar watcher initialization MUST complete within 5 seconds for projects with up to 50,000 files.

**Priority:** Medium

---

### 016-NFR-005: Watcher cleanup on window close

All watchers MUST be cleaned up when a `BrowserWindow` is destroyed (via `cleanupForWebContentsId`).

**Cleanup sequence:**

1. Bump session token (prevents stale events)
2. Close Chokidar instances (directory + git watchers)
3. Stop polling timer
4. Clear event buffers
5. Remove IPC listeners

Failure to clean up causes memory leaks and orphaned file handles.

**Priority:** High
