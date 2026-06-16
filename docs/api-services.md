# API Services

**Location:** `src/main/services/`

Supporting service classes for terminal emulation, file operations, file watching, and persistent settings.

## Overview

## TerminalService

**File:** `src/main/services/TerminalService.ts`

Manages terminal emulator instances with xterm.js + node-pty. Cross-platform: macOS/Linux (POSIX shells), Windows (Git Bash, PowerShell 7 / pwsh, Windows PowerShell 5.1, cmd.exe). Marker-based bootstrap with three-flag output gating — see [Terminal Bootstrap Pattern](./terminal/bootstrap-pattern.md) for platform-specific shell invocation, cwd validation contract, `WindowsBootstrapBuilder` strategy pattern, `resolveWindowsShell()` fallback chain, and Windows ConPTY resize-reflow mitigation.

**cwd validation contract (Windows)**: cwds containing `" & | ^ < > \r \n` are rejected before bootstrap; `createTerminal` returns `null` and emits `'error'`. Callers must surface this. `(` and `)` are intentionally allowed (unblocks `C:\Program Files (x86)\…`).

**Resize race safety (Windows)**: `resize()` silently no-ops when the underlying node-pty process has exited between the `resize()` call and the deferred Windows resize execution — the method returns `false` and the stale terminal entry is dropped from the map.

**Constructor DI seam**: `new TerminalService(fsExists?)` — defaults to `fs.existsSync`; tests inject fakes to cover the shell fallback chain without module mocking.

**EPIPE handling:** Uses `safeConsole` utility to prevent EPIPE crashes during cleanup. See [EPIPE Error Handling](./epipe-error-handling.md).

### Public Methods

#### `async createTerminal(config?: TerminalConfig, webContentsId?: number): Promise<string | null>`
Create a new PTY instance. Async because `node-pty` is dynamically imported on first call.

**Parameters** (`config?: TerminalConfig`, all optional — defaults to `{}`):
- `cwd?` — Working directory; defaults to home dir
- `cols?` / `rows?` — Terminal dimensions
- `shell?` — Shell override; defaults to platform-resolved shell
- `env?: Record<string, string>` — Extra env vars (merged after `cleanEnvironment()` filtering)

**Parameters** (top-level):
- `webContentsId?: number` — Owning webContents ID; used by `cleanupForWebContentsId(id)` to kill orphaned PTYs when the window closes

**Returns:** Generated terminal ID (`terminal-N`), or `null` if cwd failed Windows deny-list validation or the shell could not be resolved.

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
Synchronously kill PTY process and remove from internal map. Returns `false` if the terminal is not found. Emits `'exit'` with `{ terminalId, exitCode: 0 }` on success.

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

#### `watchFile(filePath: string): void`
Start watching file for changes.

**Parameters:**
- `filePath` - Absolute path to file

**Side Effects:**
- Creates chokidar watcher (300ms debounce)
- Emits 'file-changed' events

---

#### `unwatchFile(filePath: string): void`
Stop watching file.

**Parameters:**
- `filePath` - Absolute path to file

---

#### `pauseWatching(filePath: string): void`
Temporarily pause watching (used during save operations).

**Parameters:**
- `filePath` - Absolute path to file

---

#### `resumeWatching(filePath: string): void`
Resume watching after pause.

**Parameters:**
- `filePath` - Absolute path to file

---

### Events

#### `'file-changed'`
**Payload:** `{ filePath: string }`

Emitted when file changes externally (after 300ms debounce).

**Note:** Not emitted during pause window.

---

#### `'file-deleted'`
**Payload:** `{ filePath: string }`

Emitted when watched file is deleted.

---

## DirectoryWatcherService

**File:** `src/main/services/DirectoryWatcherService.ts`

Watches directory tree for changes with auto-refresh and pause/resume pattern.

### Public Methods

#### `watchDirectory(dirPath: string): void`
Start watching directory recursively.

**Parameters:**
- `dirPath` - Absolute path to directory

**Side Effects:**
- Creates chokidar watcher feeding a 75 ms collection window + 200 ms throttle (VS Code pattern). The renderer's `useDirectoryWatcher` debounces its `onRefresh` callback by another 250 ms.
- Ignores: `node_modules`, `.git/objects`, `.git/subtree-cache`, `.git/lfs`, `dist`, `build`, `out`, `.next`, `.vite`, `.cache`, `coverage`, `.venv`, `__pycache__`, etc. — see `DEFAULT_WATCHER_IGNORE_PATTERNS` in `src/shared/constants.ts` for the full list.
- The `'change'` listener (added in #241) suppresses paths under `.git/` so `GitWatcherService` stays the sole publisher for git-state changes.

---

#### `unwatchDirectory(dirPath: string): void`
Stop watching directory.

**Parameters:**
- `dirPath` - Absolute path to directory

---

#### `pauseWatching(dirPath: string): void`
Pause watching (used during CRUD operations).

**Parameters:**
- `dirPath` - Absolute path to directory

**Safety timeout:** A 10-second auto-resume guard prevents permanent pause states. If `resume()` is not called within 10 s (e.g., due to a lost IPC message), the PauseController auto-resumes, logs a warning, and triggers a compensating refresh (#103).

**Usage Pattern:**
```typescript
// Before internal operation
await directoryWatcherService.pauseWatching(projectPath)

// Perform CRUD
await fs.writeFile(newFilePath, content)

// After operation
await directoryWatcherService.resumeWatching(projectPath)
```

---

#### `resumeWatching(dirPath: string): void`
Resume watching after pause.

**Parameters:**
- `dirPath` - Absolute path to directory

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
- `INVALID_FILENAME` from `assertValidUserFilename` (Windows-reserved basename, forbidden chars, control chars, bidi overrides — see [Filename validation](#filename-validation-161-phase-2) above)
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

#### `getApprovedTools(): Promise<string[]>`
 

**Returns:** Array of tool names (defaults to all 17 tools).

---

#### `setApprovedTools(tools: string[]): Promise<void>`
Set approved tools.

**Parameters:**
- `tools` - Array of tool names

---

#### `addApprovedTool(toolName: string): Promise<void>`
Add single tool to approved list.

**Parameters:**
- `toolName` - Tool to add

---

#### `removeApprovedTool(toolName: string): Promise<void>`
Remove single tool from approved list.

**Parameters:**
- `toolName` - Tool to remove

---

#### `resetApprovedTools(): Promise<void>`
Reset to default (all 17 tools).

---

## Usage Examples

### Terminal Management

```typescript
import { terminalService } from './services/TerminalService'

// Create terminal — returns the generated ID, or null on failure
const terminalId = await terminalService.createTerminal({
  cwd: '/path/to/project',
  cols: 80,
  rows: 24,
}, webContentsId)

if (terminalId === null) {
  // Cwd validation failed (Windows deny-list) or shell could not be resolved.
  // Inspect the most recent 'error' event for details.
  return
}

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

// Start watching
directoryWatcherService.watchDirectory('/path/to/project')

// Listen for changes (renderer subscribes via preload bridge:
//   window.api.directoryWatch.onDirectoryChanged((data) => …))
directoryWatcherService.on('directory-watch:changed', ({ dirPath, eventCount, summary }) => {
  console.log(`${eventCount} events: ${JSON.stringify(summary)}`)
  refreshProjectTree()
})

// Internal operation pattern
async function createNewFile(fileName: string) {
  // Pause watching
  await directoryWatcherService.pauseWatching(projectPath)

  // Perform operation
  await fs.writeFile(path.join(projectPath, fileName), '')

  // Refresh UI
  await refreshProjectTree()

  // Resume watching
  await directoryWatcherService.resumeWatching(projectPath)

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

#### `get(): GlobalSettings`
Get current settings.

#### `update(partial: Partial<GlobalSettings>): GlobalSettings`
Update settings (partial merge).

#### `reset(): GlobalSettings`
Reset to defaults.

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
| `logging:log` | Renderer → Main | Send log entry from renderer process |
| `logging:getLogsDir` | Renderer → Main | Get resolved logs directory path |
| `logging:openLogsFolder` | Renderer → Main | Open logs folder in native file manager |

### Preload Bridge

- `api.logging.getLogsDir()` – Returns logs directory path
- `api.logging.openLogsFolder()` – Opens logs folder via `shell.openPath()`

### Usage
```typescript
import { MainLogger } from './services/LoggingService'

MainLogger.info('Application started')
MainLogger.error('Operation failed', error)
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

## See Also

- [API Services - Feature Services](./api-services-features.md) - Git, Lock, Screenshot, Camera, External, PDF, DOCX, Transcription, AudioMetadata, ApiKey
- [Architecture](./architecture.md) - Service class overview
- [IPC Patterns](./ipc-patterns.md) - IPC handler integration
- [Terminal](./terminal/README.md) - Terminal panel implementation
- [File Watching](./file-watching/README.md) - Auto-refresh implementation
- [Logging](./logging.md) - Logging layer documentation
- [Drag-Drop](./drag-drop/README.md) - External file drop documentation