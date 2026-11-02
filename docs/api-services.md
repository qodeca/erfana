# API Services

**Location:** `src/main/services/`

Supporting service classes for terminal emulation, file operations, file watching, and persistent settings.

## TerminalService

**File:** `src/main/services/TerminalService.ts`

Manages PTY processes with node-pty (xterm.js draws them in the renderer). Cross-platform: macOS/Linux (POSIX shells), Windows (Git Bash, PowerShell 7 / pwsh, Windows PowerShell 5.1, cmd.exe). Marker-based bootstrap with three-flag output gating – see [Terminal Bootstrap Pattern](./terminal/bootstrap-pattern.md) for platform-specific shell invocation, cwd validation contract, `WindowsBootstrapBuilder` strategy pattern, `resolveWindowsShell()` fallback chain, and Windows ConPTY resize-reflow mitigation.

**cwd validation contract (Windows)**: cwds containing `" & | ^ < > \r \n` are rejected before bootstrap; `createTerminal` returns `{ error }` (was `null` before v0.19.0) and emits `'error'`. The handler passes `error` through to the renderer verbatim, so the sentence is what the user reads. `(` and `)` are intentionally allowed (unblocks `C:\Program Files (x86)\…`).

**Resize race safety (Windows)**: `resize()` silently no-ops when the underlying node-pty process has exited between the `resize()` call and the deferred Windows resize execution — the method returns `false` and the stale terminal entry is dropped from the map.

**Constructor DI seam**: `new TerminalService(fsExists?)` — defaults to `fs.existsSync`; tests inject fakes to cover the shell fallback chain without module mocking.

**EPIPE handling:** `TerminalService` does not use `safeConsole` itself – it catches `EPIPE` (in `write()`) and `EPIPE`/`ESRCH` (in `killTerminal()` and `dispose()`) around the node-pty calls and records them through `logger` (`LoggingService`). `safeConsole` is installed globally once, by `installSafeConsole()` in `src/main/index.ts`, and covers console output app-wide. See [EPIPE Error Handling](./epipe-error-handling.md).

### Public Methods

#### `async createTerminal(config?: TerminalConfig, webContentsId?: number): Promise<TerminalCreateResult>`

`TerminalCreateResult` is `{ terminalId; shellKind } | { error: string }`. The reason travels in the result because the IPC handler cannot match an `'error'` event to a terminal whose id it never learned; before v0.19.0 every failure was `null` and the renderer saw only "Failed to create terminal". A Windows cwd over 260 chars (`isWindowsLongPath`) is refused before validation with a plain-language sentence.
Create a new PTY instance. Async because `node-pty` is dynamically imported on first call.

**Parameters** (`config?: TerminalConfig`, all optional — defaults to `{}`):
- `cwd?` – Working directory; defaults to home dir. Over IPC the handler fills it: the checked `cwd` the renderer sent, else the open project's root for the window that opened it, else nothing (home)
- `cols?` / `rows?` — Terminal dimensions
- `shell?` – Shell override; defaults to platform-resolved shell. Main-only: `terminal:create` is strict `{ cwd?, cols, rows }`, so the renderer can never set it
- `env?: Record<string, string>` – Extra env vars (merged after `cleanEnvironment()` filtering). Main-only, like `shell`

**Parameters** (top-level):
- `webContentsId?: number` — Owning webContents ID; used by `cleanupForWebContentsId(id)` to kill orphaned PTYs when the window closes

**Returns:** `{ terminalId, shellKind }` — the generated terminal ID (`terminal-N`) plus the `ShellKind` resolved at create time, so the renderer can quote pasted paths for the right shell flavour without a follow-up IPC round-trip (#164). Never returns `null`: if `node-pty` is unavailable, the cwd failed Windows deny-list validation, or the shell could not be resolved, the result is `{ error: string }` with the reason as plain text.

**Side Effects:**
- Spawns new PTY process (platform-resolved shell)
- Emits `'data'` events with `{ terminalId, data, webContentsId }` (after bootstrap marker + clear confirm)
- Emits `'error'` event with `{ terminalId, error, webContentsId }` on cwd rejection or spawn failure
- Refused once `beginShutdown()` has run (quit in progress)

---

#### `write(terminalId: string, data: string): boolean`
Write data to terminal stdin. Returns `false` if the terminal is not found or PTY write fails. While a cmd.exe terminal still waits in its bootstrap `pause`, writes are held and replayed after it, so a typed key is not swallowed.

---

#### `resize(terminalId: string, cols: number, rows: number): boolean`
Resize PTY dimensions. Returns `false` if the terminal is not found.

---

#### `killTerminal(terminalId: string): boolean`
Synchronously kill PTY process and remove from internal map. Returns `false` if the terminal is not found. Emits nothing itself on success – the PTY's own `onExit` callback (registered in `createTerminal`) emits `'exit'` with the real `{ terminalId, exitCode, signal }`. If `kill()` throws `EPIPE`/`ESRCH` (process already gone) the entry is dropped and `true` is returned; any other throw emits `'error'` and returns `false`.

---

#### `getTerminalInfo(terminalId: string): { id: string; cwd: string; title: string } | null`
Returns terminal metadata, or `null` if not found.

---

#### `listTerminals(): Array<{ id: string; title: string }>`
Returns metadata for all live terminals. The `terminal:list` handler filters it to the calling window's own.

#### `getOwner(terminalId: string): number | undefined`
The `webContents` id that created the terminal (`-1` for none), or `undefined` for an unknown id. Every per-terminal IPC handler checks it: a window that does not own a terminal gets the same answer as for an unknown id.

#### `getActivity(terminalId: string): { busy: boolean; known: boolean } | null`
Whether a program other than the shell is in the terminal's foreground (`terminal:getActivity`, used by the terminal's restart prompt, `restartGuard.ts`). `known: false` on Windows, where node-pty cannot tell; `null` for an unknown id.

#### `getPid(terminalId: string): number | undefined`
Main-only: the PTY's OS pid, for the Claude Code status detector. Never sent to or taken from the renderer.

#### `beginShutdown(): void` / `getLiveShells(): LiveShell[]`
Quit support (#305): `beginShutdown()` refuses every later `createTerminal`, and `getLiveShells()` lists every shell whose exit has not been reported, for the Windows quit helper (`conptyHostReaper.ts`).

#### `async dispose(): Promise<void>`
Kills every terminal, then waits for their exit reports, bounded by `TERMINAL_EXIT_WAIT_MS` (1.5 s) – a late exit report during shutdown used to abort the main process on Windows (#214).

#### `ackOutput(terminalId: string, chars: number): void`
Flow control (`terminal:ackOutput`): the owning window has parsed `chars` more UTF-16 code units of output. On macOS and Linux the PTY is paused above 512 KiB unacknowledged and resumed below 128 KiB; a pause with no ack progress for 5 s is lifted. Windows terminals are batched, never paused. See [performance/terminal-output-batching.md](performance/terminal-output-batching.md).

---

### Events

| Event | Payload | When |
|---|---|---|
| `'data'` | `{ terminalId: string; data: string; webContentsId: number }` | PTY output (after marker handshake + clear confirm), batched per terminal by `TerminalOutputFlow` (8 ms or 64 KiB) and always sent before that terminal's `'exit'` |
| `'exit'` | `{ terminalId: string; exitCode: number; signal?: number; webContentsId: number }` | PTY process exit |
| `'clearTerminal'` | `{ terminalId: string; webContentsId: number }` | Bootstrap marker detected; the renderer clears and sends `terminal:clearComplete`, which calls `markInitializationComplete()` |
| `'error'` | `{ terminalId: string; error: string; webContentsId: number }` | cwd deny-list rejection (Windows), shell resolution failure, or spawn failure |

`webContentsId` names the window that created the terminal (`-1` for none). `terminal-handlers.ts` sends each event only to that window, so an exit that arrives after the terminal left the service's table still reaches its owner.

---

## FileWatcherService

**File:** `src/main/services/FileWatcherService.ts`

Watches file content for external changes with auto-reload and conflict detection.

### Public Methods

#### `async watchFile(filePath: string, webContents: WebContents): Promise<void>`
Start watching file for changes. Watches are refcounted per `webContents`, so the caller must pass the owning window's `WebContents` (the same object is used to push change events back and to clean up via `cleanupForWebContentsId(id)`).

`MAX_WATCHED_FILES` (100) governs **new** entries only: joining a path that is already watched never fails on the cap. A refused join would watch nothing while its later `unwatchFile` still decremented the count, closing the watcher for the consumer that owns it (issue #70).

**Parameters:**
- `filePath` - Absolute path to file
- `webContents` - Electron `WebContents` of the subscribing window

**Side Effects:**
- Creates chokidar watcher (300ms debounce)
- Sends `file-watch:changed` with `{ filePath }` over IPC to the subscribing window (no EventEmitter event is emitted)

---

#### `async unwatchFile(filePath: string, webContents: WebContents): Promise<void>`
Stop watching file for one subscriber. The underlying chokidar watcher is closed only when the last subscriber unwatches.

**Parameters:**
- `filePath` - Absolute path to file
- `webContents` - Electron `WebContents` of the unsubscribing window

---

#### `pauseWatch(filePath: string): void`
Temporarily pause watching (used during save operations). Synchronous.

**Parameters:**
- `filePath` - Absolute path to file

---

#### `resumeWatch(filePath: string): void`
Resume watching after pause. Synchronous.

**Parameters:**
- `filePath` - Absolute path to file

---

#### Other public methods
- `async unwatchAll(webContents: WebContents): Promise<void>` - Drop every watch held by one window
- `async cleanupForWebContentsId(webContentsId: number): Promise<void>` - Called on window close to prevent stale watchers
- `setProjectPath(path: string): void` - Set the project root and bump the session token so stale events from the previous project are dropped
- `getStats(): { totalWatched: number; fileDetails: Array<{ path: string; watchers: number }> }`
- `async stopAll(): Promise<void>` / `async dispose(): Promise<void>` - Shutdown paths

---

### Renderer notifications

`FileWatcherService` is not an `EventEmitter` — it sends straight to the
subscribing windows over IPC (`watcher/watchNotifier.ts`, which skips destroyed
windows and swallows send failures). Two of the three contracts changed in #70.

| Channel | Payload | When |
|---|---|---|
| `file-watch:changed` | `{ filePath }` | Content changed externally, after `awaitWriteFinish` (300 ms) + a 300 ms debounce. **Since #70 this also covers an atomic replace** (write temp + rename): where the platform reports that as an `unlink`, the service re-arms the watch and re-enters the same debounced change path, so the renderer sees a change rather than a delete followed by silence |
| `file-watch:deleted` | `{ filePath }` | The file is **genuinely** gone — confirmed by one final `stat` after the 100 ms atomic-save window closes. An unreadable file counts as there, except on Windows: a file that answers EPERM or EBUSY again 250 ms after a first EPERM or EBUSY counts as gone, because it is being deleted while another process holds it open (#252) |
| `file-watch:error` | `{ filePath, error, ended? }` | A chokidar error, **and since #70 any watch teardown that is not a genuine delete** (then `ended: true`, so the renderer forgets its hold – #252): the session token was bumped mid-window, the path stopped resolving inside the project, or the replacement watcher could not be created. Sent by `notifyWatchDead`, which deliberately bypasses the session-version guard that `notifyWebContents` applies — a "your watch is dead" message that the guard dropped would leave the renderer showing stale content with no indicator, which is the symptom #70 exists to remove |

Neither `changed` nor `deleted` is emitted during a pause window. Full mechanics
in [File Watching § Single-file watch internals](./file-watching/README.md#single-file-watch-internals-70).

---

## DirectoryWatcherService

**File:** `src/main/services/DirectoryWatcherService.ts` – the public lifecycle (watch, unwatch, stop, dispose, stats). The class extends three layers in `src/main/services/watcher/` (lens review finding [65]): `DirectoryWatcherCore.ts` (shared state, the path drop rules, backend choice, notices to windows), `DirectoryWatcherRecovery.ts` (error classification, EMFILE teardown, restart back-off) and `DirectoryWatcherEvents.ts` (the event pipeline and the pause API). Helpers beside them: `directoryWatchBuilders.ts` (builds the chokidar or native watcher), `DirectoryWatchListeners.ts` (removal and coverage listeners), `WatcherHealthLogger.ts` (the 120 s health line), `watchErrorTypes.ts` and `directoryWatchTypes.ts`. The test suites reach into the layers' `protected` members by name (`watchedDirectories`, `switchVersion`, `queueEvent`, `processEvents`, `pendingRestarts`, `restartAttempts`, `handleWatcherError`, `scheduleRestart`, `restartWatcher`, …), so keep those names when you move code.

Watches directory tree for changes with auto-refresh and pause/resume pattern.

### Public Methods

#### `async watchDirectory(dirPath: string, webContents: WebContents): Promise<void>`
Start watching directory recursively. Watches are refcounted per `webContents`; the same object receives the change pushes and drives `cleanupForWebContentsId(id)`.

**Parameters:**
- `dirPath` - Absolute path to directory
- `webContents` - Electron `WebContents` of the subscribing window

**Side Effects:**
- Creates the backend watcher – a `NativeRecursiveWatcher` on Windows (#211) and, since v0.22.0, on macOS too (`fs.watch` recursive, FSEvents, about no file handles per file); chokidar on Linux, or everywhere when `ERFANA_DIRECTORY_WATCHER=chokidar` is set for diagnosis (see [File watching § Watch backends](./file-watching/README.md#watch-backends-211)) – feeding a 75 ms collection window + 200 ms throttle (VS Code pattern). The renderer's `useDirectoryWatcher` debounces its `onRefresh` callback by another 250 ms. Resolves without waiting for the backend's `ready`. When `ready` comes, sends one catch-up `'directory-watch:changed'` (`catchUp: true`) – or, while paused, records one unknown drop – because a change made between the first tree read and the watch opening reaches no event (design #211 risk R4). If the watcher cannot be built (the Windows backend throws at once for a missing root), a restart is scheduled and the error is rethrown.
- Drops every path the project path filter drops (see `setPathFilter` below): excluded (`files.exclude`), hidden (`tree.hiddenPatterns`, default `node_modules` and `.git`) and ignored (`watcher.ignoreList`, default `DEFAULT_WATCHER_IGNORE_PATTERNS` in `src/shared/constants.ts`: `node_modules`, `dist`, `build`, `out`, `.next`, `.vite`, `.cache`, `coverage`, `.venv`, `__pycache__`, etc.), tested on the project-relative path.
- The `'change'` listener (added in #241) suppresses paths under `.git/` so `GitWatcherService` stays the sole publisher for git-state changes.

---

#### `async unwatchDirectory(dirPath: string, webContents: WebContents): Promise<void>`
Stop watching directory for one subscriber. The backend watcher is closed only when the last subscriber unwatches.

**Parameters:**
- `dirPath` - Absolute path to directory
- `webContents` - Electron `WebContents` of the unsubscribing window

---

#### `pauseWatch(dirPath: string, senderId?: number): void`
Pause watching (used during CRUD operations). Synchronous, and reference-counted so nested pause/resume pairs nest safely. A no-op if no watcher exists for `dirPath`. The first pause opens a pause episode (`watcher/PauseEpisode.ts`, #210) that counts the structural changes dropped from outside until the full resume.

**Parameters:**
- `dirPath` - Absolute path to directory
- `senderId` - `webContents` id of the pausing window (the `directory-watch:pause` handler passes `event.sender.id`); only that window's tree reads cover the dropped changes

**Safety timeout:** A 10-second auto-resume guard prevents permanent pause states. If `resumeWatch()` is not called within 10 s (e.g., due to a lost IPC message), the PauseController auto-resumes, logs a warning, discards the pause episode and sends one compensating `'directory-watch:changed'` with `catchUp: true` (#103, #210).

**Usage Pattern:**
```typescript
// Before internal operation
directoryWatcherService.pauseWatch(projectPath)

// Perform CRUD
await fs.writeFile(newFilePath, content)

// After operation
directoryWatcherService.resumeWatch(projectPath)
```

---

#### `resumeWatch(dirPath: string): boolean`
Resume watching after pause. Synchronous. Decrements the pause reference count; the watcher only actually resumes once the count reaches 0.

**Parameters:**
- `dirPath` - Absolute path to directory

**Returns:** `false` if no watcher exists for `dirPath` (resume called for an unknown path), `true` otherwise — including when the watch stays paused because outer pauses are still outstanding.

**Catch-up (#210):** at the full resume, sends one `'directory-watch:changed'` with `catchUp: true` if the pause episode holds a structural change from outside that no completed tree read by the pausing window covers. Its log line carries a count (or the cap reason), never a path.

---

#### Other public methods
- `beginTreeRead(dirPath: string, senderId?: number): () => void` - Called by `file:readDirectory` before the walk; the returned commit, called only after the read succeeds, marks every change dropped so far as shown. A no-op commit unless `dirPath` resolves to a paused root and `senderId` is the pausing window (#210)
- `noteInternalChange(...changes: InternalChange[]): void` - Called by the file mutation handlers after success, so a paused watch does not count the operation's own events as missed; never logs the paths (#210)
- `async unwatchAll(webContents: WebContents): Promise<void>` - Drop every watch held by one window
- `async cleanupForWebContentsId(webContentsId: number): Promise<void>` - Called on window close to prevent stale watchers
- `setProjectPath(path: string): void` - Set the project root and bump the session token so stale events are dropped
- `setPathFilter(filter: ProjectPathFilter): void` - Set the project's path filter (`src/main/utils/projectPathFilter.ts`: the `files.exclude` list, hidden names and ignore patterns). Called by `ProjectService` after loading settings, with the same instance it hands to `FileService`; applies to watches started after the call and to every event queued after it. Until then the default hidden and ignore lists apply, with no exclude list (#211)
- `getStats()` / `getFormattedMetrics(): string` - Watcher diagnostics
- `async stopAll(): Promise<void>` / `async dispose(): Promise<void>` - Shutdown paths

---

### Renderer notifications (IPC)

`DirectoryWatcherService` is a plain class, not an event emitter: it pushes these channels to the owning window with `webContents.send`. The renderer subscribes through the preload bridge (`window.api.directoryWatch.onDirectoryChanged`, `onProjectDeleted`, `onDirectoryError`).

#### `'directory-watch:changed'`
**Payload** – `DirectoryChangedPayload` in `src/shared/ipc/directory-watch-schema.ts`, the one type the sender, the preload bridge and `IProjectTreeApi` share:
```ts
{
  dirPath: string
  eventCount: number          // events surviving coalescing
  originalEventCount: number  // raw events from the backend watcher, after the path filter
  coalescedCount: number      // events removed by the coalescer
  summary: Record<'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change', number>
  structural: boolean         // false only for content edits to entries already shown – the tree is unchanged
  catchUp?: true              // #210: only on a catch-up refresh (typed `boolean`)
}
```

Emitted when files or folders change anywhere in the watched project tree. Main process throttles via a 75 ms collection window + 200 ms throttle (VS Code pattern); the renderer's `useDirectoryWatcher` adds a 250 ms consumer debounce, capped at max(1 s, 2 × a tree read) – the read alone, smoothed, and never more than 10 s – from the first event of a burst, so multi-file write storms collapse to a single tree re-list and a steady stream still refreshes – about once a second, less often on a project whose read is slow.

**Structural flag:** `structural` is `true` when the coalesced batch holds an `add`, `addDir`, `unlink` or `unlinkDir`, or the raw batch holds an `addDir` or `unlinkDir` (cascade prevention drops events under a removed folder, and a folder created and removed again coalesces to nothing); when a file was swapped for a symlink or back, even if the coalescer shows that as a `change`; and always on a catch-up or compensating refresh and on the first batch after a buffer overflow, because what was lost cannot be known to be content-only. A save that renames a temp file over an existing one (Erfana's `atomicWrite`, many editors) arrives as an `add`; `DirectoryWatcherService` turns it into a `change` only when the tree on screen shows that entry with the same kind (file or symlink) and the exact same spelling – see `KnownEntries` (`src/main/services/watcher/KnownEntries.ts`). The record is seeded by a successful read of the project root (`beginKnownEntriesRead`, called by the `file:readDirectory` handler) minus every path an event touched while the read ran, is dropped on a folder removal until the next root read, and does not exist above 100,000 entries; every doubt counts as structural. A batch of only content edits is `structural: false`: `useDirectoryWatcher` does not re-read the tree for it, while `useGitStatus` refreshes the badges for every batch, as before. Open editor tabs are reloaded by their own file watchers, not by this channel. Measurement: [docs/performance/watcher-structural-refresh.md](./performance/watcher-structural-refresh.md).

**Event types:** `'add'`, `'addDir'`, `'unlink'`, `'unlinkDir'`, `'change'`. The `'change'` listener was added in #241 — in-place editor saves (Monaco autosave, terminal commands, external editors) now also wake the renderer. `'change'` events whose path is inside `.git/` are suppressed at the source listener (`GitWatcherService` is the canonical publisher for git internals).

**Note:** Events that arrive during a pause are dropped, not emitted. Zero-event sends carry `catchUp: true` instead (#210): the catch-up at full resume, sent only when a structural change from outside was dropped after the pausing window's last completed tree read, and the compensating refresh from the PauseController safety timeout (#103). The same zero-event `catchUp` send answers every other "changes may have been missed, nobody knows where": a native resync (#211), a restarted watcher, and the backend's `ready` at each watch start (design #211 risk R4). `useDirectoryWatcher` refreshes on `catchUp` even while an internal operation's flag is set, because it reports dropped external changes, not the operation's own.

#### `'directory-watch:project-deleted'`
**Payload:** `{ dirPath: string }`. Sent when the project root is gone (`ENOENT`) and the restart attempts are used up; the service then stops all watchers. Bridge: `onProjectDeleted`.

#### `'directory-watch:error'`
**Payload:** `{ dirPath: string; error: string; errorType }`. Sent for any other watcher error that is not retried – a non-transient type, or a transient one (`EACCES`, `ESTALE`) whose restart attempts are used up. `EMFILE` never reaches it: that path always tears down and schedules a restart. Bridge: `onDirectoryError` (typed without `errorType`).

#### `'directory-watch:recovered'` and `'directory-watch:restart-failed'`
**Payloads:** `{ dirPath }` after a successful automatic restart; `{ dirPath, attempts, message }` once `MAX_RESTART_ATTEMPTS` is reached. Both are sent from main, but the preload bridge exposes no listener for either. Since #211 the exhausted-restart notice goes to the windows captured when the restart was scheduled (`notifyIds`) – before, the watch's map entry was already gone and `restart-failed` was never sent – and a root still missing (`ENOENT`) gets `'directory-watch:project-deleted'` instead.

---

## FileService

**File:** `src/main/services/FileService.ts`

**Filename validation (#161, Phase 2)**: since v0.22.0 a name that holds `/`, `\` or NUL is refused at the IPC boundary (`entryNameField` in `src/shared/ipc/file-schema.ts`), so the name the user typed is the name that is used; `.` and `..` are refused too. Behind that, `createFile`, `createFolder`, and `rename` still strip separators as a second line, then invoke `assertValidUserFilename` from `src/main/utils/validateFilename.ts`. Throws `AppError(INVALID_FILENAME)` for Windows-reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`), forbidden chars (`<>:"/\|?*` on Windows), trailing dots/spaces (Windows), control chars, Unicode bidi overrides (security), empty, or > 255 chars. POSIX-only checks (control + bidi + length + empty) run on every platform.

`PdfService.getSavePath` and `DocxService.sanitizeFilename` use the sister `deriveSafeFilename(name, fallback?)` total function (silent transform, never throws). See `src/main/utils/validateFilename.ts` JSDoc for full pipeline order.

File operations with validation and error handling.

### Public Methods

#### `readFile(filePath: string): Promise<string>` / `writeFile(filePath: string, content: string): Promise<void>`
Read or write file contents (UTF-8). Throws on FS error. `writeFile` is crash-safe (`atomicWriteText`, `src/main/utils/atomicWrite.ts`): it writes a temp file next to the target and renames it over only when complete, so a crash cannot leave a half-written file; read-only files, symbolic links and shared hard links keep their old behaviour. Recreating a missing folder is not `FileService`'s job: the `file:writeFile` handler calls `restoreParentDirectory` (`src/main/services/file/`) first when the request carries `createParentDirs: true`, which the editor sets only for the manual "Save to restore it" of a tab whose folder was renamed or deleted (see [File watching § Use Cases](./file-watching/README.md#use-cases)).

#### `readDirectory(dirPath: string, options?: { shallow?: boolean }): Promise<FileNode[]>`
The project tree walk. Folders the watcher ignores (`dist`, `build`, `.venv`, `coverage`, …) come back as rows with `lazy: 'ignored'` and no children; folders a walk bound left unread – the entry cap (`MAX_WALK_ENTRIES`, 50,000), a shallow read, or the cap on folder links entered – come back `lazy: 'capped'`; a folder link whose real folder the walk already entered by another path is `lazy: 'linked'` (its files are in the tree under that path). Links that lead outside the project or loop back are not followed. The rest is read several folders at a time. `shallow: true` reads one level and leaves every sub-folder lazy – that is how the renderer expands a lazy folder (`useLazyFolderChildren`). Single-flight per path (#208). Measurement: [lazy tree walk](./performance/2026-10-22-lazy-tree-walk.md).

**Throws:** Error if write fails.

---

#### `createFile(dirPath: string, fileName: string): Promise<string>`
Create new empty file.

**Parameters:**
- `dirPath` - Directory path
- `fileName` - File name

**Returns:** Full path to created file.

**Throws:** Error if file exists or creation fails.

---

#### `deleteFile(filePath: string): Promise<void>`
Delete file.

**Parameters:**
- `filePath` - Absolute path to file

**Throws:** Error if deletion fails.

---

#### `async rename(oldPath: string, newName: string): Promise<string>`
Rename a file or folder. The second argument is a **basename**, not a full path — the new path is constructed via `join(dirname(oldPath), newName)`.

**Parameters:**
- `oldPath` — Current absolute path
- `newName` — New basename (path separators stripped before validation)

**Returns:** New absolute path.

**Throws (all `AppError` or `Error`):**
- Empty name (`'Name cannot be empty'`)
- `INVALID_FILENAME` from `assertValidUserFilename` (Windows-reserved basename, forbidden chars, control chars, bidi overrides — see [`createFile`](#createfiledirpath-string-filename-string-promisestring) above)
- Target already exists (`'"<name>" already exists'`)
- Path is outside the project root, or equals the project root

---

### IPC: `file:revealInFileManager`

**Handler:** `src/main/ipc/file-handlers.ts` · **Preload:** `window.api.file.revealInFileManager({ filePath })`

Reveals a file or folder in the native OS file manager (Finder/Explorer) by calling Electron `shell.showItemInFolder`. Backs the Project Tree "Reveal in Finder/Explorer" context-menu command (file, folder, and project-root nodes).

- **Request:** `{ filePath }`, the absolute path (the right-clicked tree node's `path`).
- **Returns `Promise<string>`:** `''` on success, otherwise a human-readable error message the renderer surfaces as an error toast (`'Item no longer exists on disk'`, `'Cannot reveal items outside the project'`, `'No project is open'`, `'Invalid path'`, or `'Cannot reveal this item'` for any other refusal).
- **Security:** registered through `registerConfinedHandle` with a stricter `senderGate`: an untrusted sender (`isTrustedSender`, `src/main/ipc/senderValidation.ts`, also used by the clipboard handlers) is a silent no-op returning `''` and learns nothing. The path is checked in `project` mode with `mustExist`, so links are followed and an in-project symlink cannot point the reveal outside the project; the root itself is allowed so the project-root node can be revealed. `shell.showItemInFolder` gets the canonical path. A refusal is mapped to the strings above in `onRefusal`.

---

<a id="path-confinement-for-the-file-read-ipc-handlers"></a>

### Path confinement for the file IPC handlers

**Handlers:** `src/main/ipc/file-handlers.ts`, `external-file-handlers.ts`, `markdown-image-handlers.ts`, and the `cwd` of `terminal:create` · **Checker:** `src/main/ipc/confinement/` (v0.22.0) · **Older helper:** `src/main/utils/projectConfinement.ts`

**Why two stages.** `path.resolve` normalises a path string but does not resolve symlinks, so a link planted inside the project used to carry an out-of-project target past the boundary check. Since #70 the file watcher re-reads a watched path automatically, which turns a one-shot user-initiated read into a repeating one. So every check runs **lexically** first (no filesystem access, and it never discloses whether an out-of-project path exists), then **canonically** against `realpath` of both the path and the project root. Both sides come from `realpath`, so platform canonicalisation – Windows casing, `/tmp` → `/private/tmp` on macOS – applies to each and an alias is not mistaken for an escape.

**The main-process checker (`src/main/ipc/confinement/`).** Every `file:*` channel that takes a path is registered through `registerConfinedHandle`: the sender gate, a one-element `payloadArgs(...)` schema, one `resolveConfinedPath` per path argument, then the handler. The check resolves the path against the canonical root that the project session holds (`ProjectService.session`, computed once at open), by whole path segments – `my-project-old` is not inside `my-project` – with links, junctions, drive aliases, UNC shares and letter case handled. Modes, request keys and refusal codes are tabled in [IPC patterns § Path checks in the main process](./ipc-patterns.md#path-checks-in-the-main-process). Handlers act on the canonical `real` path and answer with paths built from `requested`, the spelling the renderer used. Result-shaped channels turn a refusal into their usual value (`file:revealInFileManager` a sentence, `file:validatePath` `{ exists: false, error }`, `file:exists` `false`). A test over `registerFileHandlers()` (`file-handlers.pathChecks.test.ts`) fails if a `file:*` channel is neither confined nor on its explicit `UNCONFINED_ALLOW_LIST`. `FileService` keeps no prefix guards; its only own check is the refusal to delete or move the project root. Lint (`eslint.config.mjs`) bans `startsWith` tests against the project root and the plain JS `realpathSync` (it keeps `subst` drives; `fs.promises.realpath` and `realpathSync.native` are the native resolvers) in `src/main`.

**Why `file:getStats` is not confined.** It runs in `external` mode with `check: 'escape'`: a path that was never in the project is left alone; only a path that *looks* in-project and canonically resolves out of it is refused. The external-file import shortcut (spec #012, `ProjectTree.handleImportShortcut`) stats the paths the user picked in the native file dialog, and those are outside the project by definition. What the escape check still buys is the part #70 needs: the watcher's automatic re-stat of a watched, in-project path cannot be pointed somewhere else through a symlink. The clean fix – have `file:selectExternalFiles` return sizes so `ProjectTree` stops stat-ing external paths at all, after which `getStats` can be confined like the read handlers – is recorded in [Technical Debt](./technical-debt.md). `file:exists` uses the same mode.

**The older helper.** `projectConfinement.ts` (`isLexicallyInside`, `classifyConfinement`, `resolveInsideProject`, `assertInsideProject`, `assertNoConfinementEscape`) no longer guards any `file:*` channel. It still backs the file watcher's re-check after an unlink (`FileWatcherService`, `classifyConfinement`), the HTML preview's link graph (`buildPreviewGraph`, `classifyConfinement`), `BrowserLaunchService` (`resolveInsideProject`), `ImageExportService` (`assertInsideProject`), and the lexical `isLexicallyInside` test in the project path filter and the directory watcher. `classifyConfinement` returns one of four verdicts: `inside`, `outside`, `missing` (lexically inside but the path does not exist) or `unverifiable` (`realpath` failed for a reason other than ENOENT – EACCES, ELOOP, ENOTDIR).

---

## ProjectService and the project session

**Files:** `src/main/services/ProjectService.ts`, `src/main/services/session/ProjectSession.ts` (v0.22.0)

The main process keeps track of the open project in one place. `ProjectService` owns a `ProjectSessionStore` and exposes it read-only as `projectService.session`; it is the only writer. A snapshot holds `generation` (+1 on every open or close, never reused), `root` (the path as shown; on Windows the on-disk spelling, so two spellings of one folder are one name), `realRoot` (normalised `realpath`, what the path checks compare against), `caseSensitive` and `ownerWebContentsId` (the window that opened it). A snapshot is immutable and swapped whole at commit.

### Public methods
- `switchProject(newProjectPath, ctx?)` – Open or switch. Validates the path (the top of a drive or network share and system folders are refused, including Windows, Program Files, ProgramData and folders such as `.ssh` and `.aws`), takes the project lock, stops the watchers, loads the project settings, then **commits** the session, applies settings, saves the last path and recent list, broadcasts `project:changed` and releases the old lock. A failure before the commit leaves the session untouched. Returns `{ success, path, action: 'noop' | 'switched', error?, errorCode? }`
- `close(ctx)` – Close the project. `ctx.reason` is `'user'`, `'project-deleted'` (the renderer saw the folder vanish; carries `expectedGeneration`, and a close for an older generation does nothing) or `'window-destroyed'` (`src/main/index.ts` closes the project when the window that owns it goes away, which also releases its lock; the last path is kept)
- `session.current()` / `session.require()` / `session.onChange(listener)` – Read the snapshot; `require()` throws `ConfinementError('NO_PROJECT')`

### Rules
- **One at a time.** Every open, switch and close runs on one queue (`serialise`), so a quick double-click on two recent projects ends with the second one open, never half of each
- **Time-boxed steps.** Each I/O step of a transition has a 15 s limit (`TRANSITION_STEP_TIMEOUT_MS`), so a hung disk or share fails that transition instead of holding every later one
- **Services follow the session.** `FileService`, the watchers and the project settings cache are updated from `onChange`, not by hand, so they cannot drift from it
- **Renderer contract.** `file:getSession` answers `{ root, generation }`; `project:changed` carries the new `generation`; stale reads, writes and closes are refused – see [IPC patterns § Project generation](./ipc-patterns.md#path-checks-in-the-main-process)

---

## SettingsService

**File:** `src/main/services/SettingsService.ts`

Persistent settings storage using electron-store.

**Important:** All methods are async due to dynamic ES Module import.

### Public Methods

#### `getLastProjectPath(): Promise<string | null>`
Get last opened project path. Main-only since v0.22.0, when the unused `file:getLastProjectPath` channel was removed; `ProjectService` writes it on open and clears it on a close (not when the close comes from a window being destroyed), and start-up never reopens it.

**Returns:** Project path or null.

---

#### `setLastProjectPath(path: string): Promise<void>`
Save last opened project path.

**Parameters:**
- `path` - Project directory path

---

#### `clearLastProjectPath(): Promise<void>`
Clear last project path.

---

#### `getProjectFilterMode(): Promise<string>`
Get the project tree filter mode.

**Returns:** The stored mode, defaulting to `'all'`.

**Throws:** `SettingsServiceError` if the store cannot be read.

---

#### `setProjectFilterMode(mode: string): Promise<void>`
Persist the project tree filter mode.

**Parameters:**
- `mode` - Filter mode to store

---

#### `getDirectoryWatchDepth(): Promise<number | undefined>`
Get the recursion depth cap used by `DirectoryWatcherService` (performance tuning). chokidar takes it as its `depth` option; the native backend (macOS, Windows) keeps its handles recursive and drops events deeper than the cap.

**Returns:** The stored non-negative depth, or `undefined` when unset or invalid (unlimited depth).

---

#### `setDirectoryWatchDepth(depth: number | null): Promise<void>`
Persist the directory watch depth. Values are floored and clamped to `>= 0`; pass `null` to clear the override and restore unlimited depth.

**Parameters:**
- `depth` - Depth to store, or `null` to clear

---

#### `getRecentProjects(): Promise<RecentProject[]>`
Get the recent-projects list (max 5), newest first.

**Returns:** `Array<{ path: string; name: string; lastOpened: number }>`.

---

#### `addRecentProject(path: string, name: string): Promise<void>`
Add or promote a project in the recent list. Mutex-guarded against parallel project opens; duplicates are collapsed by canonical path via `RecentProjectsDeduplicator`.

**Parameters:**
- `path` - Absolute project path
- `name` - Display name

---

#### `removeRecentProject(path: string): Promise<void>`
Remove a project from the recent list (canonical-path match). Mutex-guarded.

**Parameters:**
- `path` - Absolute project path

---

#### `cleanupStaleProjects(): Promise<void>`
Drop recent projects that are no longer accessible (`access(R_OK | X_OK)` checked in parallel), freeing slots for valid projects. Only writes when something changed. Mutex-guarded; intended for app startup.

---

#### `clearRecentProjects(): Promise<void>`
Clear the entire recent-projects list. Mutex-guarded.

---

## Usage Examples

### Terminal Management

```typescript
import { terminalService } from './services/TerminalService'

// Create terminal – returns { terminalId, shellKind }, or { error } on failure (never null)
const created = await terminalService.createTerminal({
  cwd: '/path/to/project',
  cols: 80,
  rows: 24,
}, webContentsId)

if ('error' in created) {
  // node-pty unavailable, cwd validation failed (Windows deny-list),
  // or the shell could not be resolved. `created.error` is the reason as
  // plain text – the IPC handler passes it to the renderer verbatim.
  return
}

const { terminalId, shellKind } = created

// Listen for output (note: payload key is `terminalId`, not `id`)
terminalService.on('data', ({ terminalId: id, data }) => {
  console.log(`Terminal ${id}:`, data)
})

// Write input — returns false on failure
terminalService.write(terminalId, 'ls -la\n')

// Resize — returns false on failure
terminalService.resize(terminalId, 100, 30)

// Clean up — synchronous, returns false if not found
terminalService.killTerminal(terminalId)
```

### File Watching with Pause/Resume

```typescript
import { directoryWatcherService } from './services/DirectoryWatcherService'

// Start watching — the owning window's WebContents is required
await directoryWatcherService.watchDirectory('/path/to/project', webContents)

// Changes reach the renderer over IPC – the service has no `.on()`.
// Renderer side:
//   window.api.directoryWatch.onDirectoryChanged(({ dirPath, eventCount, summary }) => {
//     refreshProjectTree()
//   })

// Internal operation pattern
async function createNewFile(fileName: string) {
  // Pause watching (synchronous, reference-counted)
  directoryWatcherService.pauseWatch(projectPath)

  // Perform operation
  await fs.writeFile(path.join(projectPath, fileName), '')

  // Refresh UI
  await refreshProjectTree()

  // Resume watching
  directoryWatcherService.resumeWatch(projectPath)

  // No duplicate refresh event
}
```

### Settings Persistence

```typescript
import { settingsService } from './services/SettingsService'

// Get last project (async!)
const lastPath = await settingsService.getLastProjectPath()

// Save last project
await settingsService.setLastProjectPath('/path/to/project')

// Project filter mode
const mode = await settingsService.getProjectFilterMode()
await settingsService.setProjectFilterMode('all')
```

## GlobalSettingsService

**File:** `src/main/services/GlobalSettingsService.ts`

Application-wide settings with Zod schema validation.

### Key Features
- Settings persisted to `~/.erfana/settings.json`
- Corruption handling: backup to `settings.json.bak`, reset to defaults. A file that could not be read is copied before it is first overwritten
- Crash-safe writes (`atomicWriteJSON`): a crash mid-save cannot leave a half-written settings file
- If the service cannot be set up at start, the window still opens with defaults and a `crash.log` line explains why (see [Logging § crash.log](./logging.md#crashlog-start-up-and-crash-fallback))
- Reactive updates via IPC broadcast to renderer

### Public Methods

#### `getSettings(): GlobalSettings`
Get the whole in-memory settings object (synchronous).

#### `getSetting<K extends keyof GlobalSettings>(key: K): GlobalSettings[K]`
Get one setting by key (synchronous).

#### `async setSetting<K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]): Promise<void>`
Update one setting. Validates the resulting object against `GlobalSettingsSchema`, persists to disk, then notifies listeners. `$schema` writes are ignored (metadata only).

**Throws:** `AppError(GLOBAL_SETTINGS_VALIDATION_FAILED)` if the new value fails schema validation.

#### `async resetSettings(): Promise<void>`
Back up the current file, then reset to defaults and notify listeners.

#### Also public
- `async initialize(): Promise<void>` - Load and validate settings at startup
- `onSettingsChanged(callback): () => void` - Subscribe to change events; returns an unsubscribe function
- `getSettingsPath(): string` - Resolved path of the settings file

---

## LoggingService

**File:** `src/main/services/LoggingService.ts`

Centralized logging with file persistence.

### Key Features
- File-based logging to `~/.erfana/logs/`
- Separate files: `main.log`, `renderer.log`, `combined.log`
- Auto-rolling: 10MB size limit, 5 rotated files per log (was 100 before v0.22.0), 7-day retention
- 6 log levels: trace, debug, info, warn, error, fatal

### Public Methods

#### `getLogsDir(): string`
Get the resolved logs directory path (e.g., `~/.erfana/logs/`).

### IPC Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `logging:log` | Renderer → Main | Send log entry from renderer process. **Two senders**: the editor window via `api.logging.log` (`src/preload/index.ts`) and the screenshot-overlay window via `overlayApi.log` (`src/preload/screenshotOverlay.ts`, #60). Both are one-way `send`s and both are validated main-side with the same `LogEntrySchema` |
| `logging:getLevel` | Renderer → Main | Get the current log level (renderer syncs its initial level from this) |
| `logging:getLogsDir` | Renderer → Main | Get resolved logs directory path |
| `logging:openLogsFolder` | Renderer → Main | Open logs folder in native file manager |

### Preload Bridge

- `api.logging.log(entry)` – One-way send; the overlay window's equivalent is `overlayApi.log(entry)` on the same channel
- `api.logging.getLevel()` – Returns the current log level
- `api.logging.getLogsDir()` – Returns logs directory path
- `api.logging.openLogsFolder()` – Opens logs folder via `shell.openPath()`; returns `''` on success or an error string on failure. Called from Settings and from the crash recovery screen's **Open logs folder** button (#60), which is capability-probed like Restart

### Usage
The module exports the `LoggingService` class, the `loggingService` singleton, and a convenience `logger` object — `logger` is what main-process code imports.

```typescript
import { logger } from './services/LoggingService'

logger.info('Application started')
logger.error('Operation failed', error) // second arg is an Error, third an optional context object
```

See [Logging Documentation](./logging.md) for details.

---

## Clipboard service (#203)

Unlike the other entries on this page, the clipboard service lives in the **renderer** (`src/renderer/src/services/textClipboard.ts`); the main process only hosts a thin IPC bridge. It exists because Electron's sandbox blocks `navigator.clipboard` (Monaco copy/paste threw `NotAllowedError`), so all clipboard access is routed through the main-process `clipboard` module over IPC.

### Renderer: `textClipboard` singleton

**File:** `src/renderer/src/services/textClipboard.ts`

The single chokepoint every in-scope text surface (Monaco editor + context menu, terminal, dialog textareas, markdown preview, file-picker copy-path) routes through.

#### `writeText(text: string): Promise<boolean>`
Write plain text to the OS clipboard. Returns `true` on success, `false` on failure.

#### `readText(): Promise<string>`
Read plain text from the OS clipboard. Returns the text, or `''` on failure. **Returned text is untrusted** — consumers must treat it as data only (no `innerHTML`/`eval`/`dangerouslySetInnerHTML`).

**Transport-error chokepoint:** a failed `invoke` (throw, or a `false` write) is retried once after ~50 ms; on continued failure the service ALWAYS `logger.error`s and surfaces a **debounced** error toast (a burst of failures coalesces into one). Clipboard *semantics* — empty selection, empty clipboard, over-limit — stay per-surface by design. The error toast is screen-reader announced (`aria-live`).

Monaco's Cmd/Ctrl+C/X/V overrides and paste-end-position math live in the pure module `src/renderer/src/utils/monacoClipboardCommands.ts` (`clipboardCopy`/`Cut`/`Paste`, `computePasteEndPosition`, `buildMonacoClipboardDeps`, `registerClipboardActions`). The terminal copy/paste decision table (`terminalClipboard.logic.ts`, #28/#122) is unchanged — it now writes/reads through this service.

### Main: clipboard IPC bridge

**File:** `src/main/ipc/clipboard-handlers.ts` (register via `registerClipboardHandlers()` at startup)

Async `ipcMain.handle` over Electron's main-process `clipboard` module. Each handler validates the sender frame (`event.senderFrame` — top-level frame from the dev origin or bundled `file://` index; sub-frames/other origins return the safe value and log a warning). `writeText` is Zod-validated (`ClipboardWriteTextSchema = z.string().max(CLIPBOARD_MAX_TEXT_LENGTH)`, 5 MB).

| Channel | Direction | Description |
|---------|-----------|-------------|
| `clipboard:readText` | Renderer → Main | Read plain text → `Promise<string>` (`''` on failure/untrusted) |
| `clipboard:writeText` | Renderer → Main | Write plain text → `Promise<boolean>` (`false` on failure/reject/untrusted) |

**Preload bridge** (`api.clipboard`, typed via the shared `ClipboardBridge` contract):
- `api.clipboard.readText()` → `Promise<string>`
- `api.clipboard.writeText(text)` → `Promise<boolean>`

See [IPC Patterns § Clipboard channels](./ipc-patterns.md#clipboard-channels--async-invoke--sender-validation-203).

---

## System actions (`api.system`)

Like the clipboard entry above, this has **no main-process service class** — it is a pair of sender-gated IPC handlers in `src/main/ipc/system-handlers.ts` fronted by a preload bridge. It exists for the macOS Screen Recording grant-and-relaunch flow (`ScreenPermissionDialog`); since #60 `relaunchApp` has a second, platform-independent caller — see below.

### `api.system.openScreenRecordingSettings(): Promise<void>`
Opens the macOS Screen Recording privacy pane via `shell.openExternal` on a fixed constant URL. Payload-free. No-ops off `darwin`.

### `api.system.relaunchApp(): Promise<void>`
`app.relaunch()` + `app.quit()`. Required because macOS applies a fresh Screen Recording grant **only to a newly-launched process** — an existing process keeps the old denial for its lifetime, so "grant then retry" cannot work without a restart. Payload-free and deliberately **not** platform-gated. Uses `app.quit()` rather than `app.exit()` so the `before-quit` path still releases the project lock, watchers and PTYs.

Second caller (#60): the crash recovery screen's **Restart** button (`src/renderer/src/components/RootErrorBoundary/RootErrorFallback.tsx`), on every platform. It is capability-probed — `hasBridgeMethod('system', 'relaunchApp')` (`services/bridgePresence.ts`), so a missing or partially-exposed bridge hides the button instead of rendering a dead control — and bounded by a stall timer that tells the user to quit and reopen manually if the relaunch has not happened in 3 s. The screen also calls `file.closeProject()` best-effort first (raced against a 1.5 s timeout) so a crash caused by the open project cannot be reopened into a loop.

Both handlers validate `event.senderFrame` (`isTrustedSender`) — a compromised child frame must not be able to quit the app or fire OS-level navigations.

The paired read side lives with the screenshot API: `api.screenshot.getScreenPermission()` (the main-process method behind it is `ScreenshotService.getScreenRecordingPermission()`) — see [API Services – Features](./api-services-features.md). It is **advisory only**: a capture is always attempted first and is never gated on a pre-check, so a stale TCC record cannot block a user who does have access.

**Channels:** `system:openScreenRecordingSettings`, `system:relaunchApp` — see [IPC Patterns](./ipc-patterns.md).

---

## See Also

- [API Services - Feature Services](./api-services-features.md) - Git, Lock, Screenshot, Camera, External, PDF, DOCX, Transcription, AudioMetadata, ApiKey, [Import](./api-services-features.md#importservice), [ImageExport](./api-services-features.md#imageexportservice), [HTML preview](./api-services-features.md#html-preview-74), [BrowserLaunch](./api-services-features.md#browserlaunchservice)
- [Architecture](./architecture.md) - Service class overview
- [IPC Patterns](./ipc-patterns.md) - IPC handler integration
- [Terminal](./terminal/README.md) - Terminal panel implementation
- [File Watching](./file-watching/README.md) - Auto-refresh implementation
- [Logging](./logging.md) - Logging layer documentation
- [Drag-Drop](./drag-drop/README.md) - External file drop documentation