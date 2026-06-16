# Project Tree refresh specification -- acceptance criteria

## Acceptance criteria

### 016-AC-001: External file creation shows in tree

**Given** a project is open in Erfana
**When** a file is created via terminal (`touch newfile.md`)
**Then** the file appears in the Project Tree within 500ms

**Traces to:** 016-FR-001, 016-FR-004

---

### 016-AC-002: External file deletion removes from tree

**Given** a project is open with `file.md` visible in the tree
**When** `file.md` is deleted via Finder or terminal (`rm file.md`)
**Then** `file.md` disappears from the Project Tree within 500ms

**Traces to:** 016-FR-001, 016-FR-004

---

### 016-AC-003: External directory creation shows in tree

**Given** a project is open in Erfana
**When** a directory is created via terminal (`mkdir newdir`)
**Then** the directory appears in the Project Tree within 500ms

**Traces to:** 016-FR-001

---

### 016-AC-004: Git add updates status indicator

**Given** `file.md` shows as untracked (?) in the Project Tree
**When** `git add file.md` is run in the terminal
**Then** the indicator changes to staged (A) within 1000ms

**Traces to:** 016-FR-003

---

### 016-AC-005: Git commit updates status indicators

**Given** staged files exist with (A) indicators in the Project Tree
**When** `git commit -m "message"` runs in the terminal
**Then** all staged indicators clear (no status marker) within 1000ms

**Traces to:** 016-FR-003

---

### 016-AC-006: Git checkout updates both tree and status

**Given** a project is on branch `main` with certain files
**When** `git checkout feature` runs (which adds or removes files compared to `main`)
**Then** the tree structure AND git status indicators both update within 1500ms

**Note:** This is a combined test -- checkout changes both HEAD (git status) and the working directory (tree content). Both refresh pipelines must complete.

**Traces to:** 016-FR-003, 016-FR-001

---

### 016-AC-007: Manual refresh works immediately

**Given** the tree appears stale (known content mismatch)
**When** user presses Cmd+Alt+R (macOS) or Ctrl+Alt+R (Windows/Linux)
**Then** both tree content and git status update within 500ms
**And** the manual refresh path calls `executeRefresh(true)` for git status (bypassing cooldown) and `readDirectory()` directly for folder content (debounce is not involved since manual refresh does not go through the watcher pipeline)

**Traces to:** 016-FR-006

---

### 016-AC-008: Rapid file operations coalesce correctly

**Given** a project is open in Erfana
**When** 50 files are created rapidly via script (`for i in {1..50}; do touch f$i.md; done`)
**Then** the tree shows all 50 files after coalesced refreshes complete
**And** the total number of `readDirectory()` calls is significantly fewer than 50 (ideally 1--3)
**And** all files are visible within 2 seconds of the last file being created

**Traces to:** 016-FR-012

---

### 016-AC-009: Project switch clears old and loads new

**Given** project A is open in Erfana
**When** user switches to project B
**Then:**
- (a) Project A's tree clears promptly (within 100ms)
- (b) Project B's tree loads within 1 second
- (c) No stale events from project A appear in project B's tree (verified over 5 seconds)
- (d) Git status indicators show project B's status, not project A's

**Traces to:** 016-FR-007, 016-FR-010

---

### 016-AC-010: Internal operations don't cause duplicate refresh

**Given** a project is open in Erfana
**When** user creates a file via Erfana's UI (e.g., right-click > New file)
**Then** exactly one tree refresh occurs (not two)
**And** the watcher pause mechanism (`withWatcherPause`) prevents the watcher-triggered refresh
**And** only the explicit `refreshFiles()` call from the internal operation updates the tree

**Verification:** Monitor `readDirectory()` call count -- should be exactly 1 per internal operation.

**Traces to:** 016-FR-002

---

### 016-AC-011: Polling fallback works when watcher fails

**Given** `GitWatcherService` fails to start (simulated Chokidar error)
**When** `git add file.md` runs in the terminal
**Then** git status updates via `GitPollingService` within 5 seconds (default poll interval)
**And** the polling fallback does not require any user action

**Traces to:** 016-FR-005

---

### 016-AC-012: Window visibility gates refreshes

**Given** the Erfana app is minimized
**When** multiple git operations happen (e.g., `git add . && git commit -m "msg"`)
**Then** git status refresh requests are dropped (not queued) while minimized
**When** the app is restored (brought back to foreground)
**Then** a single git status refresh fires, showing the final state (full re-fetch, not replay)
**And** the number of `getStatus()` calls during the hidden period is 0
**And** on restore, a refresh is triggered (respecting cooldown -- `executeRefresh(false)` -- so it may be slightly deferred if a refresh completed within the last 500ms)

**Traces to:** 016-FR-008

---

### 016-AC-013: Atomic save detected correctly

**Given** `file.md` exists in the project and is visible in the tree
**When** VS Code saves `file.md` using atomic save (delete old file, write new file within ~50ms)
**Then** the tree shows a single CHANGE event (file remains visible throughout)
**And** the file does NOT briefly disappear from the tree

**Traces to:** 016-FR-013

---

### 016-AC-014: Session token prevents stale events

**Given** project A has an in-flight watcher event (event detected but not yet processed by renderer)
**When** user switches to project B before the event processes
**Then** the stale event from project A is silently dropped
**And** no project A data appears in project B's tree
**And** no error is logged (silent drop, not an error condition)

**Traces to:** 016-FR-010

---

### 016-AC-015: Git polling skips when watcher is active

**Given** `GitWatcherService` is functioning normally
**When** a `GitPollingService` poll timer fires
**Then** the poll is skipped because the watcher triggered within the last 2 seconds
**And** no redundant `getStatus()` call is made

**Verification:** In a 30-second window with active watcher, the number of poll-triggered status calls should be 0.

**Traces to:** 016-FR-005

---

### 016-AC-016: Watcher auto-restarts on crash

**Given** a directory watcher encounters a Chokidar error
**Then** the service attempts restart with exponential backoff:
- Attempt 1: after 800ms
- Attempt 2: after 1600ms
- Attempt 3: after 3200ms
**If** all 3 attempts fail:
- A warning is logged at `warn` level
- For **git watcher**: `GitPollingService` acts as an **implicit** fallback (it runs independently and stops skipping polls once the watcher's last event timestamp becomes stale). There is no explicit handoff or "falling back to polling" log message.
- For **directory watcher**: **no polling fallback exists** -- the tree will not auto-refresh until the watcher recovers or the user triggers manual refresh (Cmd/Ctrl+Alt+R)
**If** any attempt succeeds:
- The attempt counter resets to 0
- Normal watcher operation resumes

**Traces to:** 016-FR-009

---

### 016-AC-017: Event buffer overflow is handled gracefully

**Given** a project generates more than 30,000 watcher events in rapid succession (e.g., extracting a large archive)
**Then** the oldest events are dropped (FIFO eviction)
**And** a warning is logged: `"Watcher event buffer overflow: {count} events dropped"`
**And** the system does not crash, hang, or run out of memory
**And** subsequent events after the burst are processed normally

**Traces to:** 016-NFR-003

---

### 016-AC-018: Concurrent git status requests are serialized

**Given** two git operations happen within 100ms of each other (e.g., `git add file1.md` then `git add file2.md`)
**Then** git status is fetched sequentially (second call waits for first to complete)
**And** no `index.lock` errors occur
**And** the final status reflects both operations

**Traces to:** 016-FR-011

---

## Regression scenarios (gaps to investigate)

### 016-AC-019: Identify root cause of current regression

The current regression where "changes to the project folder are not immediately reflected" MUST be investigated. Likely areas to check:

1. **Session token mismatch** -- recent refactoring may have changed when `switchVersion` is incremented, causing valid events to be dropped as stale
2. **Watcher not restarting after crash** -- Chokidar error may be swallowed without triggering the auto-restart mechanism
3. **Event coalescing too aggressive** -- `EventCoalescer` rules may be canceling valid events (e.g., treating a legitimate CREATE as part of an atomic save pair)
4. **`watcher:resume` IPC message lost** -- `withWatcherPause` uses a dual-layer mechanism (IPC pause/resume + renderer ref). If the operation throws before sending `watcher:resume`, the main process `PauseController` remains paused, permanently suppressing all watcher events at the source. The renderer ref alone is insufficient because events are blocked before reaching the renderer. This is the higher-risk failure mode compared to the ref getting stuck.
5. **`useDirectoryWatcher` hook not receiving IPC events** -- the IPC listener may not be registered or may be registered on the wrong channel
6. **Chokidar not initialized** -- watcher may fail silently on startup, with no fallback for directory watching (unlike git which has polling)
7. **`readDirectory()` returning stale data** -- caching layer may serve old data after a refresh call
8. **`GitEventCoalescer` circuit breaker tripped** -- if the flush callback throws 5 consecutive errors (e.g., transient IPC failure), the coalescer auto-disposes and the git watcher silently stops emitting events. There is no automatic recovery -- the watcher must be restarted via project switch or manual refresh.

**Investigation approach:**

- Add temporary logging at each pipeline stage (Chokidar callback, ThrottledWorker output, EventCoalescer output, IPC send, IPC receive, refreshFiles call, readDirectory call, setFiles call)
- Create a test file via terminal and trace the event through each stage
- Check if the event reaches the renderer or is dropped somewhere in the main process pipeline

**Traces to:** 016-FR-001, 016-FR-009, 016-FR-010, 016-FR-012, 016-FR-013

---

### 016-AC-020: Verify full pipeline end-to-end

An integration test MUST trace a file creation through the complete pipeline to verify no stage is broken.

**Test procedure:**

1. Open a project in Erfana
2. Open developer tools console
3. Add logging hooks at each pipeline stage (or enable debug-level logging)
4. In the terminal, run `touch test-pipeline-verify.md`
5. Verify each stage fires in order:
   - Chokidar `add` event for `test-pipeline-verify.md`
   - `queueEvent()` passes session token and pause checks
   - `AtomicSaveDetector` is bypassed (only applies to `unlink` events, not `add`)
   - `ThrottledWorker` collects and processes the event (after 75ms batch window)
   - `EventCoalescer` passes the event through (single CREATE, no cancellation)
   - IPC `directory-watch:changed` broadcast sent
   - `useDirectoryWatcher` callback fires
   - `refreshFiles()` called
   - `readDirectory()` called on main process
   - `setFiles()` called with updated file list including `test-pipeline-verify.md`
   - React re-render shows `test-pipeline-verify.md` in the tree
6. Measure total elapsed time from step 4 to step 5 (last sub-step)
7. Verify elapsed time is within 500ms

**Any break in this chain is a potential regression point.**

**Traces to:** 016-FR-001, 016-NFR-001

Clean up: `rm test-pipeline-verify.md`
