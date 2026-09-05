# API Services

**Location:** `src/main/services/`

Supporting service classes for terminal emulation, file operations, file watching, and persistent settings.

## Overview

## TerminalService

**File:** `src/main/services/TerminalService.ts`

Manages terminal emulator instances with xterm.js + node-pty. Cross-platform: macOS/Linux (POSIX shells), Windows (Git Bash, PowerShell 7 / pwsh, Windows PowerShell 5.1, cmd.exe). Marker-based bootstrap with three-flag output gating — see [Terminal Bootstrap Pattern](./terminal/bootstrap-pattern.md) for platform-specific shell invocation, cwd validation contract, `WindowsBootstrapBuilder` strategy pattern, `resolveWindowsShell()` fallback chain, and Windows ConPTY resize-reflow mitigation.

**cwd validation contract (Windows)**: cwds containing `" & | ^ < > \r \n` are rejected before bootstrap; `createTerminal` returns `{ error }` (was `null` before v0.19.0) and emits `'error'`. The handler passes `error` through to the renderer verbatim, so the sentence is what the user reads. `(` and `)` are intentionally allowed (unblocks `C:\Program Files (x86)\…`).

**Resize race safety (Windows)**: `resize()` silently no-ops when the underlying node-pty process has exited between the `resize()` call and the deferred Windows resize execution — the method returns `false` and the stale terminal entry is dropped from the map.

**Constructor DI seam**: `new TerminalService(fsExists?)` — defaults to `fs.existsSync`; tests inject fakes to cover the shell fallback chain without module mocking.

**EPIPE handling:** `TerminalService` does not use `safeConsole` itself – it catches `EPIPE` (in `write()`) and `EPIPE`/`ESRCH` (in `killTerminal()` and `dispose()`) around the node-pty calls and records them through `logger` (`LoggingService`). `safeConsole` is installed globally once, by `installSafeConsole()` in `src/main/index.ts`, and covers console output app-wide. See [EPIPE Error Handling](./epipe-error-handling.md).

### Public Methods

#### `async createTerminal(config?: TerminalConfig, webContentsId?: number): Promise<TerminalCreateResult>`

`TerminalCreateResult` is `{ terminalId; shellKind } | { error: string }`. The reason travels in the result because the IPC handler cannot match an `'error'` event to a terminal whose id it never learned; before v0.19.0 every failure was `null` and the renderer saw only "Failed to create terminal". A Windows cwd over 260 chars (`isWindowsLongPath`) is refused before validation with a plain-language sentence.
Create a new PTY instance. Async because `node-pty` is dynamically imported on first call.

**Parameters** (`config?: TerminalConfig`, all optional — defaults to `{}`):
- `cwd?` — Working directory; defaults to home dir
- `cols?` / `rows?` — Terminal dimensions
- `shell?` — Shell override; defaults to platform-resolved shell
- `env?: Record<string, string>` — Extra env vars (merged after `cleanEnvironment()` filtering)

**Parameters** (top-level):
- `webContentsId?: number` — Owning webContents ID; used by `cleanupForWebContentsId(id)` to kill orphaned PTYs when the window closes

**Returns:** `{ terminalId, shellKind }` — the generated terminal ID (`terminal-N`) plus the `ShellKind` resolved at create time, so the renderer can quote pasted paths for the right shell flavour without a follow-up IPC round-trip (#164). Never returns `null`: if `node-pty` is unavailable, the cwd failed Windows deny-list validation, or the shell could not be resolved, the result is `{ error: string }` with the reason as plain text.

**Side Effects:**
- Spawns new PTY process (platform-resolved shell)
- Emits `'data'` events with `{ terminalId, data }` (after bootstrap marker + clear confirm)
- Emits `'error'` event with `{ terminalId, error }` on cwd rejection or spawn failure

---

#### `write(terminalId: string, data: string): boolean`
Write data to terminal stdin. Returns `false` if the terminal is not found or PTY write fails.

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
Returns metadata for all live terminals.

---

### Events

| Event | Payload | When |
|---|---|---|
| `'data'` | `{ terminalId: string; data: string }` | PTY output (after marker handshake + clear confirm) |
| `'exit'` | `{ terminalId: string; exitCode: number; signal?: string }` | PTY process exit |
| `'clearTerminal'` | `{ terminalId: string }` | Bootstrap marker detected; renderer should clear and call `markClearComplete()` |
| `'error'` | `{ terminalId: string; error: string }` | cwd deny-list rejection (Windows), shell resolution failure, or spawn failure |

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
| `file-watch:deleted` | `{ filePath }` | The file is **genuinely** gone — confirmed by one final `stat` after the 100 ms atomic-save window closes |
| `file-watch:error` | `{ filePath, error }` | A chokidar error, **and since #70 any watch teardown that is not a genuine delete**: the session token was bumped mid-window, the path stopped resolving inside the project, or the replacement watcher could not be created. Sent by `notifyWatchDead`, which deliberately bypasses the session-version guard that `notifyWebContents` applies — a "your watch is dead" message that the guard dropped would leave the renderer showing stale content with no indicator, which is the symptom #70 exists to remove |

Neither `changed` nor `deleted` is emitted during a pause window. Full mechanics
in [File Watching § Single-file watch internals](./file-watching/README.md#single-file-watch-internals-70).

---

## DirectoryWatcherService

**File:** `src/main/services/DirectoryWatcherService.ts`

Watches directory tree for changes with auto-refresh and pause/resume pattern.

### Public Methods

#### `async watchDirectory(dirPath: string, webContents: WebContents): Promise<void>`
Start watching directory recursively. Watches are refcounted per `webContents`; the same object receives the change pushes and drives `cleanupForWebContentsId(id)`.

**Parameters:**
- `dirPath` - Absolute path to directory
- `webContents` - Electron `WebContents` of the subscribing window

**Side Effects:**
- Creates chokidar watcher feeding a 75 ms collection window + 200 ms throttle (VS Code pattern). The renderer's `useDirectoryWatcher` debounces its `onRefresh` callback by another 250 ms.
- Ignores: `node_modules`, `.git/objects`, `.git/subtree-cache`, `.git/lfs`, `dist`, `build`, `out`, `.next`, `.vite`, `.cache`, `coverage`, `.venv`, `__pycache__`, etc. — see `DEFAULT_WATCHER_IGNORE_PATTERNS` in `src/shared/constants.ts` for the full list.
- The `'change'` listener (added in #241) suppresses paths under `.git/` so `GitWatcherService` stays the sole publisher for git-state changes.

---

#### `async unwatchDirectory(dirPath: string, webContents: WebContents): Promise<void>`
Stop watching directory for one subscriber. The chokidar watcher is closed only when the last subscriber unwatches.

**Parameters:**
- `dirPath` - Absolute path to directory
- `webContents` - Electron `WebContents` of the unsubscribing window

---

#### `pauseWatch(dirPath: string): void`
Pause watching (used during CRUD operations). Synchronous, and reference-counted so nested pause/resume pairs nest safely. A no-op if no watcher exists for `dirPath`.

**Parameters:**
- `dirPath` - Absolute path to directory

**Safety timeout:** A 10-second auto-resume guard prevents permanent pause states. If `resumeWatch()` is not called within 10 s (e.g., due to a lost IPC message), the PauseController auto-resumes, logs a warning, and triggers a compensating refresh (#103).

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

---

#### Other public methods
- `async unwatchAll(webContents: WebContents): Promise<void>` - Drop every watch held by one window
- `async cleanupForWebContentsId(webContentsId: number): Promise<void>` - Called on window close to prevent stale watchers
- `setProjectPath(path: string): void` - Set the project root and bump the session token so stale events are dropped
- `setIgnorePatterns(patterns: string[]): void` / `getIgnorePatterns(): string[]`
- `getStats()` / `getFormattedMetrics(): string` - Watcher diagnostics
- `async stopAll(): Promise<void>` / `async dispose(): Promise<void>` - Shutdown paths

---

### Events

#### `'directory-watch:changed'`
**Payload:**
```ts
{
  dirPath: string
  eventCount: number          // events surviving coalescing
  originalEventCount: number  // raw events from chokidar
  coalescedCount: number      // events removed by the coalescer
  summary: Record<'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change', number>
}
```

Emitted when files or folders change anywhere in the watched project tree. Main process throttles via a 75 ms collection window + 200 ms throttle (VS Code pattern); the renderer's `useDirectoryWatcher` adds a 250 ms consumer debounce so multi-file write storms collapse to a single tree re-list.

**Event types:** `'add'`, `'addDir'`, `'unlink'`, `'unlinkDir'`, `'change'`. The `'change'` listener was added in #241 — in-place editor saves (Monaco autosave, terminal commands, external editors) now also wake the renderer. `'change'` events whose path is inside `.git/` are suppressed at the source listener (`GitWatcherService` is the canonical publisher for git internals).

**Note:** Not emitted during pause window. The `'directory-watch:changed'` payload is also used by the PauseController auto-resume safety timeout (#103) to issue a compensating refresh after a stuck pause.

---

## FileService

**File:** `src/main/services/FileService.ts`

**Filename validation (#161, Phase 2)**: `createFile`, `createFolder`, and `rename` invoke `assertValidUserFilename` from `src/main/utils/validateFilename.ts` after stripping path separators. Throws `AppError(INVALID_FILENAME)` for Windows-reserved names (`CON`, `PRN`, `COM1-9`, `LPT1-9`), forbidden chars (`<>:"/\|?*` on Windows), trailing dots/spaces (Windows), control chars, Unicode bidi overrides (security), empty, or > 255 chars. POSIX-only checks (control + bidi + length + empty) run on every platform.

`PdfService.getSavePath` and `DocxService.sanitizeFilename` use the sister `deriveSafeFilename(name, fallback?)` total function (silent transform, never throws). See `src/main/utils/validateFilename.ts` JSDoc for full pipeline order.

File operations with validation and error handling.

### Public Methods

#### `readFile(filePath: string): Promise<string>` / `writeFile(filePath, content): Promise<void>`
Read or write file contents (UTF-8). Throws on FS error.

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

**Handler:** `src/main/ipc/file-handlers.ts` · **Preload:** `window.api.file.revealInFileManager(filePath)`

Reveals a file or folder in the native OS file manager (Finder/Explorer) by calling Electron `shell.showItemInFolder`. Backs the Project Tree "Reveal in Finder/Explorer" context-menu command (file, folder, and project-root nodes).

- **Arg:** absolute path (the right-clicked tree node's `path`).
- **Returns `Promise<string>`:** `''` on success, otherwise a human-readable error message the renderer surfaces as an error toast (`'Item no longer exists on disk'`, `'Cannot reveal items outside the project'`, `'No project is open'`, `'Invalid path'`).
- **Security:** validates the IPC sender via the shared `isTrustedSender` (`src/main/ipc/senderValidation.ts`, also used by the clipboard handlers) and confines the path to the open project root (the root itself is allowed so the project-root node can be revealed); an untrusted sender is a silent no-op returning `''`. The path is `fs.realpath`-canonicalized before the boundary check, so an in-project symlink cannot escape the project.

---

### Path confinement for the file-read IPC handlers

**Handlers:** `src/main/ipc/file-handlers.ts` · **Helper:** `src/main/utils/projectConfinement.ts`

`path.resolve` normalises a path string but does not resolve symlinks, so a link planted inside the project used to carry an out-of-project target past the boundary check. Since #70 the file watcher re-reads a watched path automatically, which turns a one-shot user-initiated read into a repeating one, so the read handlers check twice: **lexically** first (no filesystem access, and it never discloses whether an out-of-project path exists), then **canonically** against `fs.realpath` of both the path and the project root. Both sides come from `realpath`, so platform canonicalisation — Windows casing, `/tmp` → `/private/tmp` on macOS — applies to each and an alias is not mistaken for an escape.

`classifyConfinement` returns one of four verdicts: `inside`, `outside`, `missing` (lexically inside but the path does not exist, so the canonical stage could not run) or `unverifiable` (`realpath` failed for a reason other than ENOENT — EACCES, ELOOP, ENOTDIR). Two guards sit on top of it:

| Channel | Guard | Rule when it escapes |
|---|---|---|
| `file:readFile`, `file:readImage` | `assertInsideProject` | Requires an open project; throws `Cannot read files outside the project directory`, or `Cannot verify this path is inside the project directory` on an `unverifiable` verdict |
| `file:getStats` | `assertNoConfinementEscape` | **Deliberately not confined.** A path that was never in the project is left alone; only a path that *looks* in-project and canonically resolves out of it is refused |

**Why `file:getStats` keeps the carve-out.** The external-file import shortcut (spec #012, `ProjectTree.handleImportShortcut`) stats the paths the user picked in the native file dialog, and those are outside the project by definition. Confining the channel would break that flow. What the weaker guard still buys is the part #70 needs: the watcher's automatic re-stat of a watched, in-project path cannot be pointed somewhere else through a symlink. The clean fix — have `file:selectExternalFiles` return sizes so `ProjectTree` stops stat-ing external paths at all, after which `getStats` can be confined like the read handlers — is recorded in [Technical Debt](./technical-debt.md).

A path that simply does not exist passes both guards, so the caller's own ENOENT stays the error the renderer sees rather than this module claiming the file left the project. The same helper backs the file watcher's re-arm re-check (`watcher/atomicRearm.ts`), which re-validates after an unlink because the file was replaced by someone else in between. `file:revealInFileManager` deliberately keeps its own copy of the two-stage check: it needs the canonical path itself to hand to `shell.showItemInFolder`, and it answers with per-verdict user-facing strings instead of throwing.

---

## SettingsService

**File:** `src/main/services/SettingsService.ts`

Persistent settings storage using electron-store.

**Important:** All methods are async due to dynamic ES Module import.

### Public Methods

#### `getLastProjectPath(): Promise<string | null>`
Get last opened project path.

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
Get the chokidar recursion depth used by `DirectoryWatcherService` (performance tuning).

**Returns:** The stored non-negative depth, or `undefined` when unset or invalid (chokidar then watches unlimited depth).

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

// Listen for changes (renderer subscribes via preload bridge:
//   window.api.directoryWatch.onDirectoryChanged((data) => …))
directoryWatcherService.on('directory-watch:changed', ({ dirPath, eventCount, summary }) => {
  console.log(`${eventCount} events: ${JSON.stringify(summary)}`)
  refreshProjectTree()
})

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
- Corruption handling: backup to `.bak`, reset to defaults
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
- Auto-rolling: 10MB size limit, 100-file rotation, 7-day retention
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

Second caller (#60): the crash recovery screen's **Restart** button (`src/renderer/src/components/RootErrorBoundary/RootErrorFallback.tsx`), on every platform. It is capability-probed — `typeof window.api?.system?.relaunchApp === 'function'`, so a missing or partially-exposed bridge hides the button instead of rendering a dead control — and bounded by a stall timer that tells the user to quit and reopen manually if the relaunch has not happened in 3 s. The screen also calls `file.closeProject()` best-effort first (raced against a 1.5 s timeout) so a crash caused by the open project cannot be reopened into a loop.

Both handlers validate `event.senderFrame` (`isTrustedSender`) — a compromised child frame must not be able to quit the app or fire OS-level navigations.

The paired read side lives with the screenshot API: `api.screenshot.getScreenPermission()` (the main-process method behind it is `ScreenshotService.getScreenRecordingPermission()`) — see [API Services – Features](./api-services-features.md). It is **advisory only**: a capture is always attempted first and is never gated on a pre-check, so a stale TCC record cannot block a user who does have access.

**Channels:** `system:openScreenRecordingSettings`, `system:relaunchApp` — see [IPC Patterns](./ipc-patterns.md).

---

## See Also

- [API Services - Feature Services](./api-services-features.md) - Git, Lock, Screenshot, Camera, External, PDF, DOCX, Transcription, AudioMetadata, ApiKey
- [Architecture](./architecture.md) - Service class overview
- [IPC Patterns](./ipc-patterns.md) - IPC handler integration
- [Terminal](./terminal/README.md) - Terminal panel implementation
- [File Watching](./file-watching/README.md) - Auto-refresh implementation
- [Logging](./logging.md) - Logging layer documentation
- [Drag-Drop](./drag-drop/README.md) - External file drop documentation