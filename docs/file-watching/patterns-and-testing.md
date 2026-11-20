# Implementation Patterns & Testing

This document covers common implementation patterns, session token guards, and comprehensive testing scenarios for file watching.

---

## Common Patterns

### Pause/Resume Pattern (Race Prevention)

Used to prevent double-refresh when internal operations trigger external file system events.

```typescript
// hooks/useFileOperations.ts (and the drop/paste handlers in ProjectTree.tsx) -
// internal CRUD operations wrapped in the withWatcherPause utility
import { withWatcherPause } from '../components/ProjectTree/withWatcherPause'

const createFile = async () => {
  const createdFilePath = await withWatcherPause(
    projectPath,
    isInternalOperationRef,
    setLoading,
    async () => {
      const filePath = await api.file.createFile({ dirPath: targetPath!, name: fileName })
      await refreshProjectTree()
      return filePath
    }
  )
}
```

**How `withWatcherPause` works** (`src/renderer/src/components/ProjectTree/withWatcherPause.ts`):
1. Sets `isInternalOperationRef.current = true` + `setLoading(true)`
2. Calls `directoryWatchGateway.pause(projectPath)` (IPC `directory-watch:pause` to the main process)
3. Executes the operation
4. Resets `isInternalOperationRef.current = false` **before** calling resume (prevents race condition – AC-010) – on the error path too since #210, so a catch-up sent at resume is not skipped
5. Calls `directoryWatchGateway.resume(projectPath)`
6. Sets `setLoading(false)` in finally block (even on error)

**Dual-layer suppression**:
- **Main process**: `PauseController` (ref-counting) drops filesystem events while paused
- **Renderer**: `isInternalOperationRef` guard in `useDirectoryWatcher` hook suppresses any events that slip through

**Catch-up** ([#210](https://github.com/qodeca/erfana/issues/210)): main counts the structural changes from outside that the pause dropped and the pausing window's refresh read did not cover, and sends one `catchUp: true` refresh at resume, which the renderer guard lets through. See [README § DirectoryWatcherService](./README.md#directorywatcherservice-directory-watching).

### Event Listening Pattern

Standard pattern for listening to file system events in React components.

No component calls `window.api.fileWatch` directly. A tab follows its file through the shared freshness tracker (#478): `useFreshness` (`src/renderer/src/hooks/useFreshness.ts`) builds one `FreshnessTracker` per tab, and the adapters – `useFileWatcher` (the Markdown editor) and `useFileChangeSubscription` (the image viewer) – supply only the update rule.

```typescript
// hooks/useFileWatcher.ts (simplified) - the editor's rule on the shared tracker
const rule = useMemo<UpdateRule<TextVersion>>(() => ({
  read: async () => textReadOutcome(await freshnessEnvironment().source.readText(filePath)),
  readNow: () => true,
  apply: (version, _stamp, force) => (force || !edited ? take(version) : 'held')
}), [filePath])

const { state, tracker } = useFreshness<TextVersion>({ filePath, profile: 'editor', rule, ready, baseline, visible })
```

```typescript
// hooks/useFreshness.ts (simplified) - one subscription per tab, released with it
const tracker = new FreshnessTracker({ filePath, profile, rule, source, clock, newId })
const unregister = registerTracker(tracker)
void tracker.begin(baselineRef.current)
return () => {
  unregister()
  tracker.dispose() // unsubscribes its own watchId only
}
```

**Key Points**:
- The watch starts once the tab's first read is in, from that read's stamp, so a write before the watch was live is caught up (G3)
- Each tab's subscription has its own `watchId`; events, pauses and releases never reach another tab
- The tracker is disposed on unmount, which releases its subscription

### Session Token Guards (Switch Tokens)

To avoid stale updates during project switches, both watcher services maintain a monotonic session token (`switchVersion`). Any late events/timers from a previous session are ignored.

Implementation:
- File watcher: guards in change/delete/notify paths
- Directory watcher: guards in queue/process/notify paths

Effect:
- Eliminates UI updates from old watchers after `stopAll()` and project change
- Prevents flicker and tree corruption during rapid switches

### Watcher boundaries follow the open project

Erfana does not reopen the last project at launch (#60 – a crash caused by a project must not repeat on relaunch). Whenever the open-project session changes, `ProjectService.updateServices(root)` points the two services that still take a pushed root at the new root:

- `fileService.setProjectPath(root)`
- `directoryWatcherService.setProjectPath(root)`

`FileWatcherService` takes no pushed root (#478): `ProjectService` binds it to the read-only session (`bindSession`), and it reads the root, the real root, the case rule and the generation from there on every subscribe and every arm. `''` means no project.

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
# - The deleted notice: "test.md was deleted, renamed or moved on disk." with Restore file and Close tab
# - Editor content remains (not cleared)
# - Restore file (or Cmd/Ctrl+S) recreates the file
```

**Test 4: Rapid changes (debouncing)**
```bash
# 1. Open file in Erfana
# 2. Make rapid changes
for i in {1..10}; do echo "Change $i" >> test.md; done

# Expected:
# - The tab updates at once for the first change, then at most every 250 ms,
#   and ends on the last line (leading + trailing throttle)
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
# - After the 75 ms ThrottledWorker collection window and the renderer's 250 ms debounce
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
# - Tree refreshes once after changes settle (250 ms debounce; a steady stream is held back at most about 1 s – DIRECTORY_WATCHER.MAX_WAIT)
# - Expanded folders remain expanded
# - Console log: "📁 Directory changed, refreshing project tree... (X events)"
```

**Test 8: Internal CRUD (no double refresh)**
```typescript
// 1. Open the main-process log (Settings → Logging → Logs folder → Open)
// 2. Create file via Erfana's "New File" button
// 3. Check the log

// Expected main-process log output (DirectoryWatcherService):
// "⏸️  Paused directory watch for: /path/to/project"
// "▶️  Resumed directory watch for: /path/to/project"
// NO "📁 Directory changed" message (watcher was paused)
// NO "🔄 Catch-up refresh after pause" line (nothing else changed, #210)
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

The directory and git watcher pipelines are covered by 78 automated tests added in v0.7.2, verifying all 18 acceptance criteria from [spec T3-016](../../specs/archived/spec-t3-016-project-tree-refresh/requirements/03-acceptance.md). The breakdown below (file names, test counts, AC coverage) is the reference for that suite; the general testing guide is [Testing](../testing/README.md).

Key test files:
- `DirectoryWatcherService.pipeline.test.ts` – directory refresh pipeline (26 tests, counted 2026-10-25, AC-001/002/003/007/008/010/013)
- `GitWatcherService.pipeline.test.ts` – git status pipeline (22 tests, AC-004/005/006/014/018)
- `WatcherResilience.test.ts` – auto-restart and polling fallback (14 tests, AC-011/015/016)
- `ProjectService.switching.test.ts` – project switching orchestration (AC-009/014)
- `useGitStatus.test.ts` – visibility gating and cooldowns (5 of the file's 39 tests, counted 2026-10-25, AC-012)

Single-flight tree refresh ([#208](https://github.com/qodeca/erfana/issues/208), see [Technical Details § Tree refresh is single-flight](./technical-details.md#tree-refresh-is-single-flight-208)) – five new files (test counts below re-counted 2026-10-29), plus `isTreeReadCurrent` cases added to `useProjectManagement.logic.test.ts`. All drive reads with deferred promises and microtask flushing; fake timers appear only where a timer is the subject, and fake only the timer pair involved:
- `src/shared/coalescingRunner.test.ts` – the runner's state machine: trailing run, latest task wins, never two at once, re-entrancy, per-run errors, `onIdle` ordering (12 tests; runs in the main vitest project)
- `src/main/services/FileService.readDirectory.singleFlight.test.ts` – one walk per path, one follow-up walk for N callers, key normalisation without case folding, hidden-pattern snapshot, the five `readDirectory` log lines, and the 60 s slow-walk warning (14 tests, AC2/AC3/AC6). Split from the main `FileService` suite because its mocks hoist to module scope
- `src/renderer/src/hooks/useProjectManagement.refreshSingleFlight.test.ts` – one refresh read per scope, stale-result dropping after a newer read, a switch, a close or from a stale caller, spinner and toast ownership, the never-rejects contract (21 tests, AC2/AC3/AC4/AC6)
- `src/main/utils/processMemorySnapshot.test.ts` – MB rounding, per-process working sets, one failing source never hides the other (5 tests, AC5)
- `src/main/services/DirectoryWatcherService.health.test.ts` – the 120 s health line at `info` (`warn` when stressed) with the memory fields, and silence after `stopAll()` (6 tests, AC5; later additions cover the #211 health fields). Split from `DirectoryWatcherService.test.ts`, which fakes only the timeout pair on purpose

Catch-up after a pause ([#210](https://github.com/qodeca/erfana/issues/210)):
- `src/main/services/watcher/PauseEpisode.test.ts` – the pure episode: `change` never counts, a completed owner read covers earlier drops, a failed read or a drop after the read began stays uncovered, another window's read covers nothing, kind-matched own-change filtering (subtree vs exact, `copied-2` is not inside `copied`), the 256-record cap (27 tests, including the later `recordUnknownDrop` and #252 removal cases; paths built with `path.join`, so they hold on Windows)
- `DirectoryWatcherService.pipeline.test.ts` › `#210 catch-up after a pause` – the service end to end: exactly one `catchUp: true` send, which reads cover (subfolder, other window, trailing separator), own change filtered, safety timeout, nested pauses (9 tests)
- `file-handlers.test.ts` › `#210 watcher catch-up hooks` – `beginTreeRead` before the walk and a commit only on success; each mutation channel records its change on success only (20 tests). Renderer: one catch-up case each in `useDirectoryWatcher.test.ts`, `useDirectoryWatcher.logic.test.ts` and `withWatcherPause.test.ts`

### File freshness (#478)

How the shared capability is tested (design: [README § Following a file](./README.md#following-a-file-the-freshness-capability-478), [ADR 0013](../adrs/0013-one-freshness-capability.md)).

**Core against a fake disk, clock and source.** `src/shared/freshness/__test__/` holds `fakeClock.ts`, `fakeDisk.ts` and `fakeSource.ts` (a `ready` that can be held, scripted events including ones before `started`, injectable failures). The tracker suites (`FreshnessTracker.*.test.ts`: catch-up, ids, restart, limit, deleted, dropped, safety net, content, burst, limited) and `saveAddOn.test.ts` run on them with no real timers. `freshnessPurity.test.ts` fails when a file under `src/shared/freshness/` imports anything outside `src/shared/`. These suites run in the Node `main` Vitest project, not jsdom.

**One contract suite for every adapter.** `__test__/freshnessContract.ts` exports `describeFreshnessContract(name, harness)`. The harness supplies the adapter, what the tab shows, whether it is edited, visibility, and a map of scenarios the adapter skips, each with a reason. It runs for the editor (`editorFreshness.contract.test.ts`), the image viewer (`imageFreshness.contract.test.ts`), Markdown preview images (`markdownImageFreshness.contract.test.ts`), the HTML preview (`previewFreshness.contract.test.ts`) and the comments (`commentFreshness.contract.test.ts`). A new tab type adds one adapter and one short test file like these.

**Symptom-pinned gap tests.** Each gap of the issue has a test that states the correct behaviour (`FileWatcherService.gaps.test.ts`, `useFileWatcher.gaps.test.ts`, `imageRead.gaps.test.ts`, `e2e/file-freshness-gaps.e2e.ts`). They were written first, against the old code, inside `expectGap(…, /symptom/)` so they passed only on the named failure; each was converted to the plain assertion when its fix landed, and none remains.

**End to end (Playwright, condition waits only).** `e2e/file-freshness-gaps.e2e.ts` (G1, G2, G4–G6, G8, G9), `-writers` (in place, temp and rename, stream, a copy that keeps the modified time, `git checkout`, by tab type, visible and hidden), `-content` (empty, too large, binary, encoding, unreadable, rename and move), `-save` (own save, conflict, Restore file), `-safety-net` (focus, shown, wake, limited), `-comments`. Main-process test hooks in `src/main/testHooks/freshnessHook.ts` (`watchStats`, `setWatchLimit`, `failNextSubscribe`, `muteWatchEvents`, `killWatchesSilently`, `simulateResume`, `holdNextWrite` / `releaseWrite`) reach states a real run cannot order. Writers live in `e2e/utils/freshness-writers.ts`.

**Latency gates.** `e2e/file-freshness-latency.timing.e2e.ts` runs in the `timing` Playwright project (one worker, `*.timing.e2e.ts`): 30 runs per case, each with a unique marker; the time is measured from the write call returning to the marker in the page. The editor, image and Markdown preview image gates are p50 ≤ 250 ms and p95 ≤ 400 ms; the HTML preview must stay within its recorded reference plus a margin. A second file, `file-freshness-burst.timing.e2e.ts`, covers a burst of writes and the partial-file case. Run on Windows locally; the gate is meant to pass 20 times in a row (`npx playwright test --project=timing --no-deps --repeat-each=20 e2e/file-freshness-latency.timing.e2e.ts`).

**Cost of a check.** `src/main/services/freshness/fileStamp.perf.test.ts` asserts a fresh stamp with hash of a 16 MiB file stays under 200 ms, the budget of one safety-net check.

### Large projects on Windows (#211)

**Test setup forces chokidar.** `tests/setup/setupTests.main.ts` mocks `src/main/services/watcher/directoryWatchBackend.ts` wholesale so `selectDirectoryWatchBackend()` returns `chokidar` on every host – the same precedent as its `senderValidation` default. Without it the `DirectoryWatcherService` suites, written against a mocked `chokidar`, would exercise chokidar on Linux CI and a real native watcher on a Windows host. The stub is a plain function, not `vi.fn`, so a suite's `vi.resetAllMocks()` cannot turn the answer into `undefined`; the module exports nothing else at runtime, so the wholesale factory is complete. The selector's own suite declares `vi.unmock`; the native wiring suite constructs the service with `{ backend: 'native-recursive' }` instead.

Unit suites (main project, run on Linux CI, a Windows host and the advisory `Windows checks` job):

- `src/main/utils/excludeMatcher.test.ts` – normalisation, the rejection reasons, path versus pattern entries, `**`, the ancestor rule, `.erfana` never excluded, case modes; the match budget (hostile lists finish in bounded time and count overruns) and the 100-overrun tripwire
- `src/main/utils/projectPathFilter.test.ts` – project-relative paths from POSIX and Windows-style input, `C:\proj-x` is not inside `C:\proj`, outside → dropped, the hidden-segment rule, the ignore rule on the relative path (`/x/build/proj` is still watched), split-path and hint caps
- `src/shared/ipc/files-exclude-schema.test.ts` – the lenient parse: non-array → `[]`, non-string entry → `''` (indexes kept), malformed section → default
- `src/main/services/FileService.readDirectory.exclude.test.ts` – on a real temp folder with `readdir` spied: an excluded folder is never read, excluded files are left out, walks outside the project unaffected, the filter snapshotted per walk, hints only from root walks and capped, the new `completed` log fields. Split from the main `FileService` suite because its mocks hoist to module scope
- `src/main/services/DirectoryWatcherService.filter.test.ts` – chokidar's `ignored` covers exclude, hidden and ignore; a dropped event never reaches pause accounting or `eventsReceived`; an all-dropped burst sends nothing; `setPathFilter` replaces the filter
- `src/main/services/DirectoryWatcherService.native.test.ts` – the Windows wiring with `NativeRecursiveWatcher` mocked: constructor inputs (root, split paths, hints, depth-aware drop test), chokidar untouched, native `unlink` bypasses `AtomicSaveDetector`, a resync unpaused (one `catchUp` send) and paused (caught up at resume unless a later read covers it), `watchDirectory` never waits for `ready`, a failed start schedules a restart, exhausted `ENOENT` restarts send `project-deleted`
- `src/main/services/watcher/directoryWatchBackend.test.ts` (`vi.unmock`) – `win32` → native, other platforms → chokidar, the env override, an unknown value ignored
- `src/main/services/watcher/NativeEventClassifier.test.ts` – the mapping table incl. the defensive `EPERM` row, never more than 2 stats in flight, de-duplication, in-flight re-queue, the backlog callback, `clear()`, removal collapse on a large folder delete, nothing after `dispose`
- `src/main/services/watcher/NativeRecursiveWatcher.test.ts` – injected `fsWatch` / `lstat` / `readdir` / `realpathNative` / `now` and fake timers: plan shape (no handle for dropped folders, hinted nested folders or links), caps and `planCapped`, handles on the realpath while events carry the caller's root, overflow re-list versus one debounced resync, the self-event flood (10,000 events before the close takes effect → no `lstat`, timer, queue entry or log), renamed children, the re-open cap, silence after `close`
- `WatcherMetrics.test.ts`, `PauseEpisode.test.ts` (`recordUnknownDrop`), `DirectoryWatcherService.health.test.ts` (new health fields; a resync counts as stress only on the first line after it), `ProjectSettingsService.test.ts` (global-then-project merge, rejections by source and index, a malformed `files` does not throw), `GlobalSettingsService.test.ts` (`"files": 42` keeps the other settings and writes no backup), `ProjectService.switching.test.ts` (one warning per source, the same filter instance reaches both services)
- Renderer: `src/renderer/src/hooks/useProjectManagement.watcherGate.test.ts` – the gate stays closed while the first read is pending, opens after success and after failure, stays closed for a superseded load and when the IPC reply lands mid-read, opens after main's no-op re-open, closes on close; `ProjectTree.timing` and `ProjectTree.switching` now wait for the first read before expecting the watcher to start

**Real file system, Windows only:** `src/main/services/watcher/NativeRecursiveWatcher.win32.test.ts` (`describe.runIf(process.platform === 'win32')`, so skipped on Linux CI; it runs on a Windows host and in the advisory `Windows checks` job). Real `fs.watch`, `lstat` and `readdir` in temp folders resolved with `realpathSync.native`; every wait is `vi.waitFor` on a condition, and every watcher is closed before its folder is removed. Nine cases, with the W0 spike's findings as expectations: file and folder add, remove and rename; a new top-level folder reported only once its watch is open; 200 files churned in two excluded paths produce no event, no `lstat` and no handle; a deleted watched folder is closed at once (fewer than 100 raw events), reported gone once, and a re-created one is watched afresh; a file written in a renamed watched folder is reported under the new path only; a 1,000-file burst from another process costs at most two resyncs and the watch keeps reporting; a deleted root yields `ENOENT` with every handle closed; a junction gets no handle; `close()` releases every handle. If an Electron or Node upgrade changes the self-event shape or the renamed-folder behaviour, this suite is meant to fail.

**End to end (local only):** `e2e/directory-watcher.e2e.ts` has an excluded-folder case: a project whose `.erfana/settings.json` excludes `scratch`, files churned into `scratch` from the terminal, a file created in a visible folder still appears within the existing budget, and `scratch` never appears. Run it with `npm run test:e2e` – on Windows it exercises the native backend.

**By hand on Windows:** open a project with `{ "files": { "exclude": ["scratch"] } }` in `.erfana/settings.json`, run `1..2000 | % { ni "scratch/f-$_.txt" -Force }` in the terminal, and check that `main.log` shows no `FileService: readDirectory started` line and no `📁 Directory changed` line for that churn, while a file created at the project root still appears.

**Testing the race**: a real chokidar run cannot order "read began, then outside change, then resume" reliably, so the pipeline test does it by hand – `pauseWatch('/proj', 1)`, `beginTreeRead('/proj', 1)()`, `queueEvent` with a foreign `add`, `resumeWatch` – and asserts one `catchUp: true` send. By hand: on a large project, run `for i in $(seq 1 50); do touch "race-$i.md"; sleep 0.2; done` (PowerShell: `1..50 | % { ni "race-$_.md"; sleep -m 200 }`) in the terminal while renaming or creating items in the tree; every `race-*.md` must appear without a manual refresh, and `main.log` shows `🔄 Catch-up refresh after pause (N external changes missed while paused)`.

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
// Stop the directory watchers for this window (safe; re-created on demand).
// File watches are per-tab subscriptions: closing or reloading the window drops them.
await window.api.directoryWatch.stopAll()
```

Pause/resume around internal CRUD (if scripting flows):

```ts
await window.api.directoryWatch.pause(<projectPath>)
// ... perform file ops via window.api.file.*
await window.api.directoryWatch.resume(<projectPath>)
```

### From `main.log` (tree reads and memory, #208)

- **No overlapping reads of one project**: pair the `FileService: readDirectory started` / `completed` / `failed` lines by `readId` and group them by `pathDigest`. Within one `pathDigest`, every `started` is closed by its `completed` or `failed` before the next `started`.
- **Who is waiting**: `FileService: readDirectory joined follow-up read` names in `behindReadId` the walk a call is queued behind.
- **Slow or hung walk**: `FileService: readDirectory still running` (once, 60 s into a walk). If no `completed` or `failed` line with that `readId` ever follows, the walk is hung and every later read of that folder waits behind it.
- **Memory trend**: the `DirectoryWatcher health` line (every 120 s while a project is open, `info`) carries `mainMemoryMb` and `processMemoryMb`. `heapUsed` climbing towards `heapLimit` across successive lines means main is heading for heap exhaustion.

Full field list: [Logging § Tree reads and memory](../logging.md#tree-reads-and-memory-208).

### From `main.log` (exclude list and Windows backend, #211)

- **Which backend**: `Directory watcher backend selected` (once, at the first watch) names `chokidar` or `native-recursive`.
- **Plan size on Windows**: `Native directory watcher ready` logs `recursiveWatches`, `splitFolders`, `walkHints`, `planCapped` and `elapsedMs`. `planCapped: true` means some dropped folder still sits inside a recursive watch.
- **Exclude list applied**: `FileService: readDirectory completed` carries `excludePatternCount` and `excludedEntryCount`; a rejected entry shows up as `Project switch: files.exclude entries rejected` (by index and reason).
- **Excluded churn is silent**: while something writes only inside excluded, hidden or ignored folders, no `📁 Directory changed` and no `FileService: readDirectory started` line appears; the `DirectoryWatcher health` line's `eventsFiltered` grows instead.
- **Lost Windows events**: `Directory watcher resync` (with `reason`) and the health line's `nativeOverflows` / `nativeResyncs`.

Full list: [Logging § Large projects on Windows](../logging.md#large-projects-on-windows-211).

### Expected Behaviors

- Bulk changes aggregate at three layers: the backend (chokidar, or the native watcher on Windows and macOS) fires per-event → `EventCoalescer` deduplicates per path within the 75 ms collection window → `ThrottledWorker` waits 200 ms between broadcast rounds → the renderer's `useDirectoryWatcher` debounces by another 250 ms before re-listing the tree. Multi-file write storms (e.g., `prettier --write`, snapshot updates) therefore collapse to roughly one re-list per debounce-window. `git checkout` no longer reaches this channel for `.git/` internals — those flow exclusively through `GitWatcherService` with its own 150 ms coalescing window.
- Deleting the project folder emits `directory-watch:project-deleted` and clears internal watchers.
- After project switching, late events from previous sessions are dropped (guarded by session token).
- Each re-list is single-flight (#208): while a tree read runs, further refreshes queue into one follow-up read, so a burst never costs more than two reads and the renderer log's `[useProjectManagement] File tree refreshed` lines show `followUp: true` with `callers` counting the calls it served. `applied: false` on that line means the result was stale and was not shown.

---

See: [README](./README.md) | [Technical Details](./technical-details.md) | [Architecture](../architecture.md)
