# Technical Details

Performance considerations, security measures, edge case handling, and integration points for file watching.

---

## Performance Considerations

### Debouncing Strategy

**File Watcher**: Fixed 300ms delay
- Optimized for individual file saves
- Handles rapid successive writes (e.g., auto-save in external editor)

**Directory Watcher**: Fixed-stage pipeline (VS Code values), not an adaptive delay
- chokidar runs with `awaitWriteFinish: false` (lower latency for editor saves)
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
- **Directory watcher**: No limit (ignored patterns prevent issues)
- **Cleanup**: Automatic on window close and app quit

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

- Starts directory watcher when project is loaded
- Stops watcher when project is closed
- Preserves expanded folder state
- Implements pause/resume during CRUD operations

### FileService (CRUD Coordination)

- All file/folder operations go through FileService
- No direct fs operations from components
- Clean separation of concerns

---

See: [README](./README.md) | [Patterns & Testing](./patterns-and-testing.md) | [Architecture](../architecture.md) | [IPC Patterns](../ipc-patterns.md)
