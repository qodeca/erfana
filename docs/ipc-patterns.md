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

| Channel | Handler | Purpose |
|---------|---------|---------|
| `file:openProject` | file-handlers | Open folder dialog, save to settings |
| `file:getLastProjectPath` | file-handlers | Get last opened project path |
| `file:readDirectory` | file-handlers | Read directory tree |
| `file:readFile` | file-handlers | Read file content |
| `file:writeFile` | file-handlers | Write file content |
| `file:getStats` | file-handlers | Get file metadata |
| `file:getProjectPath` | file-handlers | Get current project path |
| `file:createFile` | file-handlers | Create new empty file |
| `file:createFolder` | file-handlers | Create new folder |
| `file:rename` | file-handlers | Rename file or folder |
| `file:deleteFile` | file-handlers | Delete file |
| `file:deleteFolder` | file-handlers | Delete folder recursively |
| `file-watch:start` | file-watcher-handlers | Start watching file for changes |
| `file-watch:stop` | file-watcher-handlers | Stop watching file |
| `file-watch:pause` | file-watcher-handlers | Pause watching (during save) |
| `file-watch:resume` | file-watcher-handlers | Resume watching after save |
| `file-watch:changed` | file-watcher-handlers | Event: File changed externally |
| `file-watch:deleted` | file-watcher-handlers | Event: File deleted externally |
| `directory-watch:start` | directory-watcher-handlers | Start watching directory tree |
| `directory-watch:stop` | directory-watcher-handlers | Stop watching directory |
| `directory-watch:pause` | directory-watcher-handlers | Pause watching (during CRUD) |
| `directory-watch:resume` | directory-watcher-handlers | Resume watching after CRUD |
| `directory-watch:changed` | directory-watcher-handlers | Event: Directory changed externally |
| `directory-watch:project-deleted` | directory-watcher-handlers | Event: Project folder deleted |
 
| `settings:getProjectFilterMode` | settings-handlers | Get project filter mode (all/markdown) |
| `settings:setProjectFilterMode` | settings-handlers | Set project filter mode (all/markdown) |
| `settings:getDirectoryWatchDepth` | settings-handlers | Get directory watcher depth (number or undefined) |
| `settings:setDirectoryWatchDepth` | settings-handlers | Set directory watcher depth (number or null) |
| `project-lock:acquire` | project-lock-handlers | Acquire lock for project path |
| `project-lock:release` | project-lock-handlers | Release lock for project path |
| `project-lock:check` | project-lock-handlers | Check lock status for project path |
| `project-lock:requestFocus` | project-lock-handlers | Request focus from lock holder |
| `project-lock:cleanup` | project-lock-handlers | Cleanup stale locks |
| `screenshot:capture` | screenshot-handlers | Cross-platform capture, mode-discriminated request (`screen` / `window` (Windows) / `window-native` (macOS) / `area`); Zod-validated, `.strict()` (#164) |
| `screenshot:getDisplays` | screenshot-handlers | Get available displays for multi-monitor |
| `screenshot:getCapabilities` | screenshot-handlers | Per-capturer capability matrix (`supported`, `hasNativeWindowPicker`, `areaCaptureMode`) — renderer hook calls once on mount instead of branching on `process.platform` (#164) |
| `screenshot:enumerateWindows` | screenshot-handlers | List capturable windows for the in-app picker on Windows; returns `availability`-discriminated union (`'enumerable'` / `'native-picker'` (macOS) / `'unsupported'`) with bounded `thumbnailDataUrl` (#164) |
| `screenshot:areaSelected` | overlay-scoped (frame-IPC) | Overlay-only: renderer posts the chosen rectangle. Listener attached per-call by `AreaSelectOverlay.selectArea()` via `overlay.webContents.mainFrame.ipc.on`; rejected on token / `senderFrame.url` mismatch. Not registered in the global handler (#164) |
| `screenshot:areaCancelled` | overlay-scoped (frame-IPC) | Overlay-only: renderer signals user cancel (Escape / blur / close). Same per-call frame-scoped attachment as `screenshot:areaSelected`; not registered globally (#164) |
| `external-file:validate` | external-file-handlers | Validate external file before copy/move |
| `external-file:copy` | external-file-handlers | Copy external file into project |
| `external-file:move` | external-file-handlers | Move external file into project |
| `transcription:import` | transcription-handlers | Import audio file with transcription (streamed progress) |
| `transcription:cancel` | transcription-handlers | Cancel active transcription (AbortSignal) |
| `transcription:validate` | transcription-handlers | Validate audio file before transcription |
| `transcription:setApiKey` | transcription-handlers | Store API key via Electron safeStorage |
| `transcription:hasApiKey` | transcription-handlers | Check if API key exists for service |
| `transcription:clearApiKey` | transcription-handlers | Remove stored API key |
| `transcription:progress` | transcription-handlers | Event: Progress update (main → renderer) |
| `import:document` | import-handlers | Import document with options (streamed progress) |
| `import:documentProgress` | import-handlers | Event: Import progress update (main → renderer) |
| `import:documentCancel` | import-handlers | Cancel active document import |
| `import:getDocumentExtensions` | import-handlers | Query available document extensions |
| `import:dependenciesReady` | import-handlers | Event: Dependency detection complete (main → renderer) |
| `clipboard:readText` | clipboard-handlers | Read plain text from OS clipboard → `Promise<string>` |
| `clipboard:writeText` | clipboard-handlers | Write plain text to OS clipboard (Zod-validated, 5 MB cap) → `Promise<boolean>` |
| `claude-status:register` | claude-status-handlers | Register a terminal panel for Claude Code status tracking; carries `terminalId` only, pid resolved main-side (#216) |
| `claude-status:unregister` | claude-status-handlers | Stop tracking a panel (PTY exit / panel unmount) (#216) |
| `claude-status:nudge` | claude-status-handlers | Request an immediate status refresh for a panel (#216) |
| `claude-status:changed` | claude-status-handlers | Event: per-`terminalId` status snapshot update (main → renderer) (#216) |

## Clipboard Channels – async invoke + sender validation (#203)

The central text-clipboard service ([#203](https://github.com/qodeca/erfana/issues/203)) deliberately uses **async `ipcMain.handle`/`ipcRenderer.invoke`** rather than a synchronous `sendSync` bridge: `sendSync` blocks the renderer, and Monaco's paste override can simply `await` the async read. Channels backed by Electron's **main-process `clipboard` module** — the renderer is sandboxed, so neither `navigator.clipboard` nor the `clipboard` module is reachable in preload, and every read/write must cross IPC.

Both handlers (`src/main/ipc/clipboard-handlers.ts`) apply the standard security rules plus a **sender-frame check**: each request must originate from the app's own top-level frame (the electron-vite dev origin, or the bundled `file://` index). Sub-frames and other origins get the safe value (`''`/`false`) and a logged warning. `writeText` is additionally Zod-validated (`ClipboardWriteTextSchema = z.string().max(CLIPBOARD_MAX_TEXT_LENGTH)`, 5 MB) — oversize or non-string payloads return `false`. Renderer consumers go through the `textClipboard` singleton, never `window.api.clipboard` directly.

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
- Clipboard schemas — `ClipboardWriteTextSchema`, `CLIPBOARD_MAX_TEXT_LENGTH`, and the `ClipboardBridge` contract shared by the preload bridge and renderer service (see `src/shared/ipc/clipboard-schema.ts`); channel constants in `src/shared/ipc/clipboard-channels.ts`
- Claude Code status schemas — the per-`terminalId` `ClaudeStatusSnapshot` contract consumed by `useClaudeStatusStore` and the register/nudge payloads (see `src/shared/ipc/claude-status-schema.ts`); channel constants in `src/shared/ipc/claude-status-channels.ts` (#216)

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
