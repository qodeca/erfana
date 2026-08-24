# IPC Communication Patterns

## Standard Pattern

**1. Define in preload** (`src/preload/index.ts`):
```typescript
const api = {
  file: {
    readFile: (path: string) => ipcRenderer.invoke('file:readFile', path)
  }
}
contextBridge.exposeInMainWorld('api', api)
```

**2. Handle in main** (`src/main/ipc/file-handlers.ts`):
```typescript
ipcMain.handle('file:readFile', async (_event, filePath: string) => {
  // ALWAYS validate input
  if (!isValidPath(filePath)) throw new Error('Invalid path')
  return await fileService.readFile(filePath)
})
```

**3. Call from renderer**:
```typescript
const content = await window.api.file.readFile('/path/to/file.md')
```

## Promise-Based Pattern with Completion Callback (v0.3.3)

For operations requiring confirmation of completion (e.g., terminal write operations), use Promise-based IPC with completion callbacks:

**1. Service layer with completion callback** (`src/main/services/TerminalService.ts`):
```typescript
write(terminalId: string, data: string): Promise<boolean> {
  return new Promise((resolve) => {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      resolve(false)
      return
    }
    try {
      // node-pty callback API - resolves when write completes
      ;(terminal.ptyProcess.write as (data: string, callback?: () => void) => void)(
        data,
        () => resolve(true)
      )
    } catch (error) {
      resolve(false)
    }
  })
}
```

**2. IPC handler awaits service promise** (`src/main/ipc/terminal-handlers.ts`):
```typescript
ipcMain.handle('terminal:write', async (_event, { terminalId, data }) => {
  try {
    const success = await terminalService.write(terminalId, data)
    return { success }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})
```

**3. Preload exposes Promise API** (`src/preload/index.ts`):
```typescript
write: (terminalId: string, data: string): Promise<{ success: boolean; error?: string }> =>
  ipcRenderer.invoke('terminal:write', { terminalId, data })
```

**4. Renderer awaits completion** (`src/renderer/src/stores/useTerminalStore.ts`):
```typescript
const writeResult = await window.api.terminal.write(terminalId, text)
if (!writeResult.success) {
  console.error('Write failed:', writeResult.error)
  return false
}
// Write confirmed complete, safe to send Enter key
```

**Benefits**:
- Guarantees operation completion before proceeding
- Prevents race conditions (e.g., sending Enter before text is written)
- Enables reliable sequential operations
- See [AutoExecute Reference](./prompts/autoexecute-reference.md) for full autoExecute implementation

## Adding New IPC Channel

1. Add to preload API with TypeScript types
2. Create handler in appropriate `src/main/ipc/*-handlers.ts`
3. Register handler in `src/main/index.ts`
4. Call from renderer component

## Security Rules

- **Always validate** inputs in main process
- **Never trust** renderer data
- **Use TypeScript** for type safety across IPC boundary
- **Return serializable** data only (no functions, class instances)

## Current IPC Channels

Every channel registered in `src/main/ipc/*.ts` is listed, plus the main → renderer
events those handlers and their services broadcast. Regenerate the handler half with:

```bash
grep -rnE "ipcMain\.(handle|on)\(" src/main/ipc --include='*.ts' | grep -v '\.test\.'
```

Note that several domains register through channel **constants**
(`src/shared/ipc/*-channels.ts`) rather than string literals, so a grep for
`ipcMain.handle('` alone under-reports by roughly a third.

### File operations (`file-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `file:openProject` | Open folder dialog, save to settings |
| `file:openProjectByPath` | Open a project by an explicit path (recent projects, CLI) |
| `file:closeProject` | Close the current project |
| `file:getLastProjectPath` | Get last opened project path |
| `file:getProjectPath` | Get current project path |
| `file:readDirectory` | Read directory tree |
| `file:readFile` | Read file content |
| `file:readImage` | Read an image as a base64 data URL, or answer `unchanged` when the caller's version still matches (#70) |
| `file:writeFile` | Write file content |
| `file:getStats` | Get file metadata |
| `file:exists` | Existence check |
| `file:createFile` | Create new empty file |
| `file:createFolder` | Create new folder |
| `file:rename` | Rename file or folder |
| `file:deleteFile` | Delete file |
| `file:deleteFolder` | Delete folder recursively |
| `file:moveItem` | Move file/folder – `fs.rename` with copy+delete fallback on EXDEV (drag-drop, cut/paste) |
| `file:copyItem` | Copy file/folder with automatic `(1)`, `(2)` name numbering |
| `file:checkConflict` | Case-insensitive name-conflict probe before a move/copy |
| `file:validatePath` | Validate a path against the project boundary |
| `file:revealInFileManager` | Reveal the item in Finder / Explorer |
| `project:changed` | Event: project switched (main → renderer). Broadcast to every window by `ProjectService` and `file-handlers`; payload `{ oldPath, newPath }` |

### External files (`external-file-handlers.ts`)

Note the `file:` prefix – these are **not** `external-file:*`.

| Channel | Purpose |
|---------|---------|
| `file:selectExternalFiles` | Open a dialog for files outside the project |
| `file:validateExternal` | Validate an external file before copy/move |
| `file:copyFromExternal` | Copy an external file into the project |
| `file:moveFromExternal` | Move an external file into the project |

### File watching (`file-watcher-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `file-watch:start` | Start watching a file for changes |
| `file-watch:stop` | Stop watching a file |
| `file-watch:stopAll` | Stop every single-file watch |
| `file-watch:pause` | Pause watching (during save) |
| `file-watch:resume` | Resume watching after save |
| `file-watch:stats` | Diagnostics: active watch counts |
| `file-watch:changed` | Event: file changed externally |
| `file-watch:deleted` | Event: file deleted externally |
| `file-watch:error` | Event: watcher error |

### Directory watching (`directory-watcher-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `directory-watch:start` | Start watching a directory tree |
| `directory-watch:stop` | Stop watching a directory |
| `directory-watch:stop-all` | Stop every directory watch |
| `directory-watch:pause` | Pause watching (during CRUD) |
| `directory-watch:resume` | Resume watching after CRUD |
| `directory-watch:get-stats` | Diagnostics: watched-path and queue counts |
| `directory-watch:changed` | Event: directory changed externally |
| `directory-watch:project-deleted` | Event: project folder deleted |
| `directory-watch:error` | Event: watcher error |
| `directory-watch:recovered` | Event: watcher recovered after a recoverable ENOENT |
| `directory-watch:restart-failed` | Event: watcher restart gave up |

### Git (`git-handlers.ts`, `git-watcher-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `git:getStatus` | One-shot status read; runs in the git-status worker thread |
| `git-watcher:start` | Start watching the repo for state changes |
| `git-watcher:stop` | Stop the repo watcher |
| `git-watcher:status` | Query watcher state |
| `git-polling:start` | Start the polling fallback |
| `git-polling:stop` | Stop polling |
| `git-polling:set-interval` | Change the polling interval |
| `git-polling:set-enabled` | Enable/disable polling |
| `git:state-changed` | Event: git state changed (main → renderer). No handler registers this – `GitWatcherService` pushes it via `broadcastToAllWindows`. Carries both file-content and repo-state events; see `git-watcher-schema.ts` |
| `git:poll-triggered` | Event: a polling cycle fired (main → renderer). Broadcast, not handler-registered |
| `git-status:health` | Declared in `git-watcher-channels.ts` (`GIT_WATCHER_CHANNELS.HEALTH`) but **not sent or listened to anywhere** – reserved name, not a live channel |

### Terminal (`terminal-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `terminal:isAvailable` | Whether node-pty loaded and a PTY can be spawned |
| `terminal:create` | Spawn a PTY, returns the terminal id |
| `terminal:write` | Write to the PTY; resolves when the write completes (see the Promise-based pattern above) |
| `terminal:resize` | `ipcMain.on` – resize the PTY (fire-and-forget) |
| `terminal:kill` | Kill a PTY |
| `terminal:getInfo` | Metadata for one terminal |
| `terminal:list` | List live terminals |
| `terminal:clearComplete` | `ipcMain.on` – renderer acknowledges that a clear finished |
| `terminal:data` | Event: PTY output (main → renderer) |
| `terminal:exit` | Event: PTY exited, with exit code and signal |
| `terminal:error` | Event: PTY error |
| `terminal:clear` | Event: main asks the renderer to clear the xterm buffer |

### Settings (`settings-handlers.ts`, `global-settings-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `settings:getProjectFilterMode` | Get project filter mode (all/markdown) |
| `settings:setProjectFilterMode` | Set project filter mode (all/markdown) |
| `settings:getDirectoryWatchDepth` | Get directory watcher depth (number or undefined) |
| `settings:setDirectoryWatchDepth` | Set directory watcher depth (number or null) |
| `settings:getRecentProjects` | List recent projects for the welcome panel |
| `settings:addRecentProject` | Record a project as recently opened |
| `settings:removeRecentProject` | Drop a project from the recents list |
| `globalSettings:get` | Read the validated global settings object |
| `globalSettings:set` | Write global settings (Zod-validated main-side) |
| `globalSettings:reset` | Restore defaults |

### Logging (`logging-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `logging:log` | `ipcMain.on` – forward a renderer log entry; the only channel with two preload senders (see below) |
| `logging:getLevel` | Current log level |
| `logging:getLogsDir` | Absolute path of the log directory |
| `logging:openLogsFolder` | Reveal the log directory in the OS file manager |

### Import (`import-handlers.ts`)

Two surfaces coexist: the original file-import handlers and the document-import
flow added later, whose channel names come from `import-channels.ts`.

| Channel | Purpose |
|---------|---------|
| `import:selectFile` | Open a dialog for an importable file |
| `import:validate` | Validate a file before import |
| `import:process` | Run the import |
| `import:getSupportedExtensions` | Extensions the importer accepts |
| `import:isSupported` | Whether one extension is importable |
| `import:document` | Import a document with options (streamed progress) |
| `import:documentCancel` | Cancel an active document import |
| `import:getDocumentExtensions` | Query available document extensions |
| `import:documentProgress` | Event: import progress update (main → renderer) |
| `import:dependenciesReady` | Event: dependency detection complete (main → renderer); sent from `src/main/index.ts` |

### Export (`pdf-handlers.ts`, `docx-handlers.ts`, `image-export-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `pdf:exportToPdf` | Render the document to PDF via Electron's `printToPDF` |
| `docx:exportToDocx` | Render the document to DOCX via `@turbodocx/html-to-docx` |
| `image-export:run` | Export the image a viewer tab is showing as PNG, as PDF, or to the clipboard (#73). Payload `{ filePath, target }`; the response carries a code and its mapped message, never image bytes. **Sender-gated by `isTrustedSender` before the payload is parsed** — unlike `pdf:` / `docx:` above, which have no such gate (recorded as technical debt) |

Three further `image-export:*` names exist in `src/shared/ipc/image-export-channels.ts` — `harness-ready`, `harness-render`, `harness-result`. They are **not** in the table above because they are never registered on the global `ipcMain`: `ImageRasterizeWindow` attaches them per run to the hidden rasterize window's `webContents.mainFrame.ipc`, the same frame-scoping the screenshot overlay uses for `screenshot:areaSelected`. A send from any other `webContents` cannot reach them, and each message additionally carries the run's UUID token and is checked against `senderFrame.url`.

### Transcription (`transcription-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `transcription:import` | Import audio file with transcription (streamed progress) |
| `transcription:cancel` | Cancel active transcription (AbortSignal) |
| `transcription:validate` | Validate audio file before transcription |
| `transcription:setApiKey` | Store API key via Electron safeStorage |
| `transcription:hasApiKey` | Check if API key exists for service |
| `transcription:clearApiKey` | Remove stored API key |
| `transcription:whisperEnsureBinary` | Ensure the local whisper.cpp binary is present, signature-verified and SHA-pinned |
| `transcription:whisperEnsureModel` | Ensure a whisper model is downloaded and verified |
| `transcription:whisperListModels` | List locally available whisper models |
| `transcription:whisperDeleteModel` | Delete a downloaded whisper model |
| `transcription:progress` | Event: progress update (main → renderer) |
| `transcription:whisperDownloadProgress` | Event: binary/model download progress (main → renderer) |

### Screenshot and camera (`screenshot-handlers.ts`, `camera-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `screenshot:capture` | Cross-platform capture, mode-discriminated request (`screen` / `window` (Windows) / `window-native` (macOS) / `area`); Zod-validated, `.strict()` (#164) |
| `screenshot:getDisplays` | Get available displays for multi-monitor |
| `screenshot:getCapabilities` | Per-capturer capability matrix (`supported`, `hasNativeWindowPicker`, `areaCaptureMode`) — renderer hook calls once on mount instead of branching on `process.platform` (#164) |
| `screenshot:getScreenPermission` | Advisory macOS Screen Recording status (`ScreenRecordingPermission`: `granted` / `denied` / `not-determined` / `restricted` / `unknown`). Read from `systemPreferences.getMediaAccessStatus('screen')`; returns `'unknown'` off macOS, on a handler error, or when the sender is untrusted. Used only to tailor the failure-path dialog copy – **never** to gate a capture |
| `screenshot:enumerateWindows` | List capturable windows for the in-app picker on Windows; returns `availability`-discriminated union (`'enumerable'` / `'native-picker'` (macOS) / `'unsupported'`) with bounded `thumbnailDataUrl` (#164) |
| `screenshot:areaSelected` | Overlay-only (frame-IPC): renderer posts the chosen rectangle. Listener attached per-call by `AreaSelectOverlay.selectArea()` via `overlay.webContents.mainFrame.ipc.on`; rejected on token / `senderFrame.url` mismatch. Not registered on the global `ipcMain` (#164) |
| `screenshot:areaCancelled` | Overlay-only (frame-IPC): renderer signals user cancel (Escape / blur / close). Same per-call frame-scoped attachment; not registered globally (#164) |
| `camera:save` | Persist a captured camera frame into the project |

### Clipboard (`clipboard-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `clipboard:readText` | Read plain text from OS clipboard → `Promise<string>` |
| `clipboard:writeText` | Write plain text to OS clipboard (Zod-validated, 5 MB cap) → `Promise<boolean>` |

### Claude Code status (`claude-status-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `claude-status:register` | Register a terminal panel for Claude Code status tracking; carries `terminalId` only, pid resolved main-side (#216) |
| `claude-status:unregister` | Stop tracking a panel (PTY exit / panel unmount) (#216) |
| `claude-status:nudge` | Request an immediate status refresh for a panel (#216) |
| `claude-status:changed` | Event: per-`terminalId` status snapshot update (main → renderer) (#216) |

### Project lock (`project-lock-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `project-lock:acquire` | Acquire lock for project path |
| `project-lock:release` | Release lock for project path |
| `project-lock:check` | Check lock status for project path |
| `project-lock:requestFocus` | Request focus from lock holder |
| `project-lock:cleanup` | Cleanup stale locks |

### App and OS integration (`system-handlers.ts`, `shell-handlers.ts`, `quit-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `system:openScreenRecordingSettings` | Payload-free. Opens the macOS Screen Recording privacy pane via `shell.openExternal` on a fixed constant URL; no-ops off `darwin`. Sender-gated by `isTrustedSender` |
| `system:relaunchApp` | Payload-free. `app.relaunch()` + `app.quit()` – needed because macOS applies a fresh Screen Recording grant only to a newly-launched process. **Not** platform-gated; `app.quit()` (not `app.exit()`) so `before-quit` releases the project lock, watchers and PTYs. Sender-gated by `isTrustedSender` |
| `shell:openExternal` | Open an external URL in the default browser |
| `quit:requested` | Event: main asks the renderer to confirm a quit (`{ reason: 'close' }`), sent from `src/main/index.ts` |
| `quit:confirmResponse` | `ipcMain.on` – renderer answers the quit prompt with `{ proceed }` |

## Clipboard Channels – async invoke + sender validation (#203)

The central text-clipboard service (#203) deliberately uses **async `ipcMain.handle`/`ipcRenderer.invoke`** rather than a synchronous `sendSync` bridge: `sendSync` blocks the renderer, and Monaco's paste override can simply `await` the async read. Channels backed by Electron's **main-process `clipboard` module** — the renderer is sandboxed, so neither `navigator.clipboard` nor the `clipboard` module is reachable in preload, and every read/write must cross IPC.

Both handlers (`src/main/ipc/clipboard-handlers.ts`) apply the standard security rules plus a **sender-frame check**: each request must originate from the app's own top-level frame (the electron-vite dev origin, or the bundled `file://` index). Sub-frames and other origins get the safe value (`''`/`false`) and a logged warning. `writeText` is additionally Zod-validated (`ClipboardWriteTextSchema = z.string().max(CLIPBOARD_MAX_TEXT_LENGTH)`, 5 MB) — oversize or non-string payloads return `false`. Renderer consumers go through the `textClipboard` singleton, never `window.api.clipboard` directly.

## `logging:log` – one channel, two preloads (#60)

No new channel was added for the screenshot-overlay window's log trail. `logging:log` is simply now the **only** channel with two distinct preload scripts as senders:

| Sender | Preload | Exposed as |
|--------|---------|------------|
| Editor window | `src/preload/index.ts` | `window.api.logging.log(entry)` |
| Area-select overlay window | `src/preload/screenshotOverlay.ts` | `window.overlayApi.log(entry)` |

The contrast with the overlay's *other* channels is deliberate. `screenshot:areaSelected` / `screenshot:areaCancelled` are frame-scoped (attached per capture to that overlay's `webContents.mainFrame.ipc`, never global `ipcMain`) and carry the round's freshly minted UUID token, because they are **commands** — a forged payload steals or cancels a capture. The log forward is **not** tokenised: its payload is a log record, not a command, it is one-way and fire-and-forget, and the worst a forged entry achieves is a junk line in a file that already accepts renderer-authored text. Main re-validates both senders identically with `LogEntrySchema` (`src/main/ipc/logging-handlers.ts`) before anything reaches `LoggingService`; an invalid entry is dropped.

Renderer-side, `resolveLogSink()` (`src/renderer/src/utils/logger.ts`) resolves `api` → `overlayApi` → `console.error` on every call and never caches, so a window that logs before its bridge attaches is not silenced for the rest of its life. See [Logging § Architecture](./logging.md#architecture).

## Event-Based IPC Pattern

Use event-based IPC for watchers and terminal events (e.g., `terminal:data`, `directory-watch:changed`).

See: [Architecture](./architecture.md) | [Security](./security.md) | [File Watching](./file-watching/README.md)

## Shared Schemas (Type Safety)

To keep IPC payloads consistent across processes, shared zod schemas live at `src/shared/ipc/schema.ts`.

- `ProjectChangedSchema` — payload for `project:changed` events
  - Shape: `{ oldPath: string | null; newPath: string | null }`
  - Used in main when broadcasting, and in preload typings for `onProjectChanged`
- Terminal event schemas — `TerminalDataSchema`, `TerminalExitSchema`, `TerminalErrorSchema`
- Transcription schemas — `TranscriptionImportRequestSchema`, `TranscriptionProgress`, `TranscriptionImportResult`, `TranscriptionSettingsSchema` (see `src/shared/ipc/transcription-schema.ts`)
- Document import schemas — `DocumentImportRequestSchema`, `DocumentImportOptionsSchema`, `DocumentImportProgress`, `DocumentImportResult`, `DependencyReadyEvent` (see `src/shared/ipc/import-schema.ts`); channel constants in `src/shared/ipc/import-channels.ts`
- Image read schemas — the contract behind `file:readImage` (#70): `ImageReadRequestSchema` plus the `unchanged`/`ok`-discriminated `ImageReadResponse`, which lets the renderer skip a re-encode when its cached `version` still matches (see `src/shared/ipc/file-image-schema.ts`)
- Image export schemas — `ImageExportRequestSchema` (`.strict()`, with the supported-extension allow-list expressed in the schema itself, so "unsupported format" needs no error code of its own) and the `success`-discriminated `ImageExportResponse`, whose failure branch **requires** both `errorCode` and `error`; plus the main-only harness render/result union (see `src/shared/ipc/image-export-schema.ts`); channel constants in `src/shared/ipc/image-export-channels.ts` (#73). The supported extensions and their MIME map are shared across the process boundary by `src/shared/ipc/image-formats.ts`, which both `main/services/file/imageRead.ts` and `renderer/src/utils/imageUtils.ts` import rather than re-declaring
- Clipboard schemas — `ClipboardWriteTextSchema`, `CLIPBOARD_MAX_TEXT_LENGTH`, and the `ClipboardBridge` contract shared by the preload bridge and renderer service (see `src/shared/ipc/clipboard-schema.ts`); channel constants in `src/shared/ipc/clipboard-channels.ts`
- Claude Code status schemas — the per-`terminalId` `ClaudeStatusSnapshot` contract consumed by `useClaudeStatusStore` and the register/nudge payloads (see `src/shared/ipc/claude-status-schema.ts`); channel constants in `src/shared/ipc/claude-status-channels.ts` (#216)
- System schemas – OS-integration actions with no payload, so there is nothing for Zod to validate and sender-frame gating is the sole guard. `system:openScreenRecordingSettings` opens the macOS Screen Recording privacy pane and is the **only** one of the two that is platform-gated (it no-ops off `darwin`). `system:relaunchApp` restarts the app on every platform; the macOS Screen Recording grant is merely the reason the flow exists, since macOS applies a fresh grant only to a newly-launched process. Channel constants in `src/shared/ipc/system-channels.ts`; both handlers are sender-gated main-side in `src/main/ipc/system-handlers.ts` via `isTrustedSender` (see [security.md § Sender-frame gating](./security.md#sender-frame-gating))

Recommended:
- Validate payloads in tests using these schemas (see contract tests under `src/preload/__tests__/`)
- Import types from the shared module rather than re-declaring shapes

## Multi-Window Notifications

For app-wide events (e.g., `project:changed`), broadcast to all BrowserWindow instances:

- Iterate `BrowserWindow.getAllWindows()`
- Send to each non-destroyed window's `webContents`
- Avoid assuming a single-window app

This ensures secondary windows remain in sync when project context changes.

## Race Guards (Version Tokens)

For long-running async operations during project switching (watcher shutdown, tree reload, terminal init), use a monotonic "switch token":

- Increment the token at the start of a switch
- Attach the token to async tasks
- Before applying results, compare against the latest token; ignore stale work

This pattern avoids stale updates from previous switches.

Applied in services:
- File watcher: src/main/services/FileWatcherService.ts (`switchVersion` guards change/delete/notify)
- Directory watcher: src/main/services/DirectoryWatcherService.ts (`switchVersion` guards queue/process/notify)
