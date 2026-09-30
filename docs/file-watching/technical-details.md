# Technical Details

Performance considerations, security measures, edge case handling, and integration points for file watching.

---

## Performance Considerations

### Debouncing Strategy

**File Watcher**: Fixed 300ms delay
- Optimized for individual file saves
- Handles rapid successive writes (e.g., auto-save in external editor)

**Directory Watcher**: Fixed-stage pipeline (VS Code values), not an adaptive delay
- chokidar runs with `awaitWriteFinish: false` (lower latency for editor saves); on Windows the native backend emits once its `lstat` classification is back, and folds lost events into one resync debounced to 1 s quiet / 5 s maximum wait (#211)
- `ThrottledWorker` (`src/main/services/watcher/ThrottledWorker.ts`): 75 ms collection window, then chunks of up to 500 events dispatched with a 200 ms throttle between chunks (`collectionDelay: 75`, `throttleDelay: 200` in `DirectoryWatcherService.watchDirectory`)
- `AtomicSaveDetector`: a delete is held ~100 ms so an atomic write (unlink + rename) coalesces into a change instead of a delete
- Renderer: `directory-watch:changed` is debounced a further 250 ms (`DIRECTORY_WATCHER.DEBOUNCE_DELAY`, `ProjectTree/constants.ts`)

### Event Batching

The worker accumulates events during the collection window and coalesces them per path. Example: a git checkout with 50 file additions arrives as one or a few chunks and produces a single tree refresh after the renderer debounce.

### Tree refresh is single-flight (#208)

The debounce above bounds how often a refresh is *asked for*; it does not bound how many full-tree reads run at once. On a very large project that keeps changing, one read can take minutes, so before [#208](https://github.com/qodeca/erfana/issues/208) reads started every 250 ms piled up, each building and cloning its own tree, and Erfana exited without a trace – most likely because the main process ran out of heap (inferred – see #208). Both halves of the read are now single-flight, on one shared primitive, `createCoalescingRunner` (`src/shared/coalescingRunner.ts`, no imports, so both processes run the same code):

- **The rule.** At most one read runs. A call made while a read runs never joins that read: every such call shares **one** follow-up read that starts only after the running one settles. So a caller is always served by a read that started after its call (a file created during a read shows up in the follow-up read), a burst of any size costs at most two reads, and two reads never overlap. A call made during the follow-up read queues the next one, so under constant churn reads run back to back – never side by side.
- **Renderer – one runner per project scope.** `useProjectManagement.refreshFiles` goes through the runner of the current scope. Opening, switching or closing a project opens a new scope with a fresh runner, so the new project's reads never wait behind the old project's read in the renderer. `refreshFiles` never rejects: a failed read is logged, and its callers resolve.
- **Stale results are dropped.** Every tree result carries a ticket – the scope's generation and a read sequence number taken when the read starts (`isTreeReadCurrent` in `useProjectManagement.logic.ts`). A result is shown only if its scope is still current and it started after the last tree shown, so the tree never goes back to an older state, including after a switch or close mid-read. The project-open load in the `project:changed` listener is not routed through the runner (it owns the toast and error state) but takes a ticket like every other read.
- **Main – one runner per path.** `FileService.readDirectory` keys its runners by `path.resolve(dirPath)`, so separators, a trailing separator and `..` segments collapse to one key; case does **not** fold, because on a case-sensitive volume `/x/Proj` and `/x/proj` are two folders. This covers the readers the renderer runner cannot see – the project-open load, a second window. Different paths are not serialised against each other. A walk snapshots the hidden patterns when it starts, so a settings change applies from the next walk. A failed walk (only the root `readdir` can fail one) rejects only its own callers; a queued follow-up walk still runs.

The honest bound is **one refresh read at a time per project scope** in the renderer and **one walk at a time per path** in main. Right after a switch, a walk of the old project can still be running next to the new project's reads; reads of the same path are always serialised in main.

Limits of this fix – tracked in the [large-project performance plan](../large-project-performance-plan.md#related-208--overlapping-tree-reads-fixed):

- **No cancellation.** A walk of the old project keeps running in main until it ends. Closing and reopening the **same** large project waits for that stale walk before a fresh one starts.
- **A hung walk blocks its path.** If `readdir` never returns (an unreachable network drive), every later read of that folder waits behind it until it settles or Erfana restarts, and the tree stops updating. The only warning is a single `FileService: readDirectory still running` line, `READ_DIRECTORY_SLOW_WARN_MS` (60 s) into the walk; the unclosed `started` line and the `joined follow-up read` lines naming it in `behindReadId` also show it.
- **Internal file operations can wait longer.** An operation inside `withWatcherPause` that calls `refreshFiles` while a read runs now waits for the rest of that read plus its own follow-up read. No deadlock is possible (the read path never waits on the watcher, and `refreshFiles` never rejects), and on a project large enough for this to matter a single read already outlasts the pause controller's 10 s safety timeout. The window in which an external change made *during* that follow-up read is missed – dropped by the paused watcher, or skipped while `isInternalOperationRef` is set – is one read long, as it was before; closing it needs own-versus-external attribution of events and is accepted debt.

Log lines, and how to check from `main.log` that no two walks of a project overlapped: [Logging § Tree reads and memory](../logging.md#tree-reads-and-memory-208).

### Resource Limits

- **File watcher**: 100 file limit (prevents memory issues)
- **Directory watcher, chokidar (macOS, Linux)**: no handle limit of its own; excluded, hidden and ignored folders are never scanned
- **Directory watcher, Windows native backend (#211)**: at most 512 `fs.watch` handles per project; 64 exclude path entries and 64 walk hints as split paths, each at most 16 segments deep; at most 2 `lstat` calls in flight and 10,000 queued paths; at most 3 re-opens of one path per 60 s
- **Exclude list (#211)**: per settings file 256 entries and 4,096 characters; merged list 512 entries and 8,192 characters; per entry 256 characters, 8 wildcards, 4 `**` segments; 20,000 character comparisons per match, and pattern entries switch off for the rest of the project session after 100 overruns
- **Cleanup**: Automatic on window close and app quit

### The Windows native watcher (#211)

Overview and the plan: [README § Watch backends](./README.md#watch-backends-211). The numbers below come from the [W0 spike](../spikes/211-windows-fs-watch.md), measured under Electron 39 (Node 22.22.1, libuv 1.51.0) on Windows 11.

**Classification queue** (`NativeEventClassifier.ts`). Each raw event that survives the filter is classified by one `lstat` (no link follow). At most **2** stats run at once – half of libuv's default four-thread pool, so a file open and the tree walk keep their slots. One queue entry per path (a re-check wins over `rename`, which wins over `change`); a path that changes again while its stat is in flight is classified once more afterwards. Past **10,000** queued paths new events are dropped and one resync is requested. Removals are collapsed: a `rename` for a path with queued descendants jumps the queue, and when that path is gone the classifier emits one `unlinkDir` and drops the queued descendants without a stat – Windows reports a deleted folder's own removals only in part, and only `unlinkDir` prunes a folder's children downstream.

| Raw event | `lstat` result | Emitted |
|---|---|---|
| `rename` | file or symlink | `add` |
| `rename` | directory | `addDir` – for a direct child of a split folder, only once its watch is open |
| `rename` | `ENOENT` / `ENOTDIR` | `unlinkDir` for a known folder (an open watch, a listing entry, an emitted `addDir`, queued descendants), else `unlink`; every watch at or under it is closed |
| `rename` | `EPERM` / `EBUSY` on a path with an open watch | close that watch, then the re-check below (defensive – not seen in W0) |
| `rename` | any other error | `add` |
| `change` | file | `change` |
| `change` | directory, or `ENOENT` / `ENOTDIR` | nothing (folder timestamp noise; a removal arrives as `rename`) |
| `change` | any other error | `change` |

Native `unlink` events skip `AtomicSaveDetector` in `queueEvent`: the `lstat` already confirmed the absence, a rename-style save is coalesced (`unlink` + `add` → `change`), and a large delete can no longer start one unthrottled `stat` per file.

**Lost events.** Windows fills a 4 KB change buffer (about 40–45 notifications of 40-character names) and libuv re-arms it only after the JavaScript callbacks for the batch have run. With the main thread busy, a burst of **20 files or more** is lost whole and reported as **exactly one** `null` filename; with it idle, a 5,000-file burst gave 63–123 `null`s in about 2.5 s while 15–35 % of the names still arrived. The watch keeps working after an overflow. So: a `null` on a split folder's own watch re-lists that folder and emits the differences; a `null` on a recursive watch, or the backlog cap, requests a resync debounced to 1 s quiet / 5 s maximum wait – W0 confirmed that a whole 5,000-file burst collapses into one resync about 1 s after it ends. The resync clears the classification queue (the re-read covers it) and then re-lists every split folder, so a folder whose event was cleared still gets its watch. Resync reasons are a closed set: `overflow`, `backlog`, `watch-error`, `reopen`.

**A watched folder's own removal.** Deleting a watched folder makes its own handle report `rename` with the folder's **absolute** path in Node's namespaced form (`\\?\C:\…` or `\\?\UNC\server\share\…`) – and libuv then re-arms and fails again at once, so the event repeats about **65,000–72,000 times a second, one core at 100 %, until the handle is closed**. chokidar closes its own handle after a few such events, so this is a risk of the native backend only. The watcher therefore:

1. checks, first in every callback, whether the handle is retired or closed – if so it returns (a retired handle that is still open is closed on its first absolute name);
2. strips the namespace prefix from an absolute filename, folds it, and compares it with the handle's own watched path; only an absolute name is tested;
3. on the first match, marks the handle for a re-check and closes it **inside the same callback**, before any `lstat`, timer, queue entry or log line;
4. runs **one** re-check `lstat`: only a readable directory (necessarily a new folder the old handle cannot see) gets a fresh watch and a resync; anything else means gone – a child emits `unlinkDir` and closes every watch under it, the root closes every handle and emits an `error` with code `ENOENT`, which takes the normal restart path.

**A renamed watched folder.** Renaming a watched folder succeeds on Windows, and its handle **follows the folder**, reporting later changes under the old name. So a parent's `rename` for a name that has an open watch retires that watch (and every watch under it) at once. Once the old name is classified the handle is closed: gone → `unlinkDir`; a readable directory at the old name (renamed back, or a new folder) → a fresh watch and a resync. The new name arrives as its own `rename` and is planned like a folder at start.

**Re-open cap.** A path is re-opened at most **3 times in 60 s**. Past that it is left unwatched, one resync is requested and a rate-limited warning logs the count, so a watch that keeps failing cannot loop on the main thread. The same applies after a watch reports an `error` (closed, then re-checked). A folder left unwatched – by the cap, or treated as gone while it is in fact still there – is still shown correctly by the re-read that follows, and is watched again at the next restart or project open.

**Log lines** carry codes and counts, never paths or Node error messages (which quote absolute paths): [Logging § Large projects on Windows](../logging.md#large-projects-on-windows-211).

---

## Security

### Path Validation

All file paths are validated against the project root:

```typescript
// DirectoryWatcherService.watchDirectory (paths normalized first)
// Security: Prevent watching directories outside project
// Uses normalized paths with separator check to prevent bypasses like /project/../sensitive
if (
  normalizedProjectPath &&
  !normalizedDirPath.startsWith(normalizedProjectPath + sep) &&
  normalizedDirPath !== normalizedProjectPath
) {
  throw new AppError('Cannot watch directories outside the project directory', ErrorCode.PATH_OUTSIDE_PROJECT)
}
```

The appended `path.sep` is what stops `/proj-evil` from passing as a prefix of `/proj`; a system-directory check (`isSystemDirectory`) runs before it.

Inside a watch, every event path is made project-relative with `toRootRelative` (`src/main/utils/projectPathFilter.ts`, built on `isLexicallyInside`, so `C:\proj-x` is not inside `C:\proj`); a path with no relative form is dropped (fail closed). The Windows backend never opens a handle through a link (#211).

### Untrusted exclude lists (#211)

A cloned repository's `.erfana/settings.json` is untrusted input, and its `files.exclude` list reaches a matcher that runs for every walked entry and every watcher event. `src/main/utils/excludeMatcher.ts` therefore uses no `RegExp` and no dependency – a segment DP over a two-pointer star matcher – and bounds the work twice: every call has a budget of 20,000 character comparisons, past which the path counts as **not** excluded (fail open: shown and watched), and after 100 such overruns in one project session the matcher switches its pattern entries off (path entries keep working) and logs one warning. Entry, character and wildcard caps apply first; a rejected entry is logged by index and reason, never by its text. `.erfana` and everything under it can never be excluded, so the file that hides things stays reachable. The parse is lenient, so a malformed `files` section can neither block a project from opening nor trigger the global file's corruption reset.

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
| Changes keep arriving while a tree read runs | Single-flight: one follow-up read after the running one, never two at once (#208) |
| Tree read finishes after a newer one, or after a switch/close | Result dropped by its generation + sequence ticket (#208) |
| Internal vs external changes | `isInternalOperation` flag |
| Multiple windows | Per-webContents tracking |
| Churn inside an excluded, hidden or ignored folder | Dropped before pause accounting and broadcast; on Windows before any `lstat` (#211) |
| Windows change buffer overflows | Split folder re-listed, or one debounced resync (#211) |
| Watched folder deleted on Windows | Handle closed inside the first self-event callback, one re-check, `unlinkDir` (#211) |
| Watched folder renamed on Windows | Old handle retired at once, new name planned afresh (#211) |
| Project lives under a folder named `build`, `out` or `dist` | Watched normally: the ignore rule runs on the project-relative path (#211) |

---

## Integration Points

### MarkdownEditorPanel (File Watching)

> Dockview keeps **every** opened editor panel mounted, so a background tab is a
> live React tree with a live watcher and live `window` listeners. "Unmounted"
> below means the tab was closed, not that the user switched away from it.
> Anything window-scoped added to this panel needs an active-panel gate - see
> [keyboard shortcuts](../keyboard-shortcuts.md).

- Starts file watcher when file is opened
- Stops watcher when panel is unmounted
- Shows conflict bar when needed
- Implements pause/resume during save

### ProjectTree (Directory Watching)

- Starts the directory watcher once the project's first tree read settles, not on mount (#211)
- Stops watcher when project is closed
- Preserves expanded folder state
- Implements pause/resume during CRUD operations

### FileService (CRUD Coordination)

- All file/folder operations go through FileService
- No direct fs operations from components
- Clean separation of concerns
- The tree walk skips an excluded entry – file or folder – before building a node, so an excluded folder is never read (#211). A completed walk of the project root records the walk hints for the Windows watcher's plan on the shared path filter

---

See: [README](./README.md) | [Patterns & Testing](./patterns-and-testing.md) | [Architecture](../architecture.md) | [IPC Patterns](../ipc-patterns.md)
