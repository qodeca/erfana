# IPC Communication Patterns

## Standard Pattern

**1. Define in preload** (`src/preload/index.ts`):
```typescript
const api = {
  file: {
    readFile: (request: PathRequest) => ipcRenderer.invoke('file:readFile', request)
  }
}
contextBridge.exposeInMainWorld('api', api)
```

**2. Handle in main** (`src/main/ipc/file-handlers.ts`):
```typescript
import { registerHandle } from './registry'

registerHandle('file:readFile', async (_event, request: unknown) => {
  // ALWAYS validate input
  const { filePath } = PathRequestSchema.parse(request)
  return await fileService.readFile(filePath)
})
```

A channel that takes arguments takes **one request object**, validated by a strict Zod schema (`z.strictObject`, in `src/shared/ipc/*-schema.ts`): a key the schema does not list is refused, not ignored, and positional arguments are refused. The `file:*` channels register through `registerConfinedHandle`, whose `schema` is `payloadArgs(SomeRequestSchema)` and whose `paths` name the request key that holds each path (`{ arg: 0, key: 'filePath', mode: 'project' }`).
Never call `ipcMain.handle(...)` or `ipcMain.on(...)` yourself. `src/main/ipc/registry.ts` (`registerHandle` / `registerHandleOnce` / `registerOn` / `registerOnce`, paired with `unregisterHandle` / `unregisterOn`) is the **only** place a global handler is registered, and every listener it registers is gated on the app's own top-level renderer (`isTrustedAppSender`, `src/main/ipc/senderValidation.ts`) before the payload is seen – an untrusted `invoke` rejects, an untrusted `send` is dropped and logged by origin. Importing `ipcMain` anywhere else under `src/main/**` is an ESLint error (`no-restricted-imports` in `eslint.config.mjs`), so the gate cannot be skipped by forgetting it. Frame-scoped listeners (`webContents.ipc`, `webContents.mainFrame.ipc`) are deliberately outside the registry; they carry their own per-call token or frame check. Why an explicit entry point rather than a wrapped `ipcMain`: see the header of `registry.ts` and [Security § Sender-frame gating](./security.md#sender-frame-gating).

**3. Call from renderer**, through the bridge's gateway (see [Renderer gateways](#renderer-gateways)):
```typescript
const content = await fileGateway.readFile({ filePath: '/path/to/file.md' })
```

## Renderer gateways

Renderer code never reads `window.api`: every bridge has a gateway, and only the gateways read it. A bridge has three parts, and the renderer sees only the last:

1. a **contract** in `src/shared/ipc/*-schema.ts` – an interface such as `FileBridge`, one method per member, written once;
2. a **preload module** `src/preload/<name>Bridge.ts` typed as that contract, which `src/preload/index.ts` only references; event subscriptions go through `src/preload/ipcSubscribe.ts`, whose unsubscribe returns nothing (`removeListener` returns `ipcRenderer` itself, which must not reach the page);
3. a **gateway** in `src/renderer/src/services/`, typed as the same contract, that forwards every method and reads `window.api` on each call, so a test that replaces `window.api` is honoured.

| `window.api.*` | Contract | Preload module | Renderer gateway |
|----------------|----------|----------------|------------------|
| `file` | `FileBridge` (`file-schema.ts`) | `fileBridge.ts` | `fileGateway` |
| `terminal` | `TerminalBridge` (`terminal-schema.ts`) | `terminalBridge.ts` | `terminalGateway` |
| `fileWatch` | `FileWatchBridge` (`file-watch-schema.ts`) | `fileWatchBridge.ts` | `fileWatchGateway` |
| `directoryWatch` | `DirectoryWatchBridge` (`directory-watch-schema.ts`) | `directoryWatchBridge.ts` | `directoryWatchGateway` |
| `git` | `GitBridge` (`git-schema.ts`) | `gitBridge.ts` | `gitGateway` (`gitGateway.ts`) |
| `gitWatcher` | `GitWatcherBridge` (`git-watcher-schema.ts`) | `gitBridge.ts` | `gitWatcherGateway` (`gitGateway.ts`) |
| `gitPolling` | `GitPollingBridge` (`git-watcher-schema.ts`) | `gitBridge.ts` | `gitPollingGateway` (`gitGateway.ts`) |
| `settings` | `SettingsBridge` (`settings-schema.ts`) | `settingsBridge.ts` | `settingsGateway` (`settingsGateway.ts`) |
| `globalSettings` | `GlobalSettingsBridge` (`global-settings-schema.ts`) | `settingsBridge.ts` | `globalSettingsGateway` (`settingsGateway.ts`) |
| `logging` | `LoggingBridge` (`logging-schema.ts`) | `loggingBridge.ts` | `loggingGateway` – log through `utils/logger`, which also serves the overlay window |
| `quit` | `QuitBridge` (`quit-schema.ts`) | `quitBridge.ts` | `quitGateway` |
| `system` | `SystemBridge` (`system-schema.ts`) | `systemBridge.ts` | `systemGateway` |
| `clipboard` | `ClipboardBridge` (`clipboard-schema.ts`) | `clipboardBridge.ts` | `clipboardGateway` – copy and paste through `services/textClipboard`, the transport-error chokepoint |
| `testHooks` | `Api['testHooks']` – a value the preload reads from its launch arguments, no IPC | inline in `index.ts` | `testHooksGateway` |
| `import` | `ImportBridge` (`import-schema.ts`) | `importBridge.ts` | `importGateway` |
| `transcription` | `TranscriptionBridge` (`transcription-schema.ts`) | `transcriptionBridge.ts` | `transcriptionGateway` (`transcriptionGateway.ts`) |
| `whisper` | `WhisperBridge` (`transcription-schema.ts`) | `transcriptionBridge.ts` | `whisperGateway` (`transcriptionGateway.ts`) |
| `camera` | `CameraBridge` (`camera-schema.ts`) | `cameraBridge.ts` | `cameraGateway` |
| `pdf` | `PdfBridge` (`pdf-schema.ts`) | `documentExportBridge.ts` | `pdfGateway` (`documentExportGateway.ts`) |
| `docx` | `DocxBridge` (`docx-schema.ts`) | `documentExportBridge.ts` | `docxGateway` (`documentExportGateway.ts`) |
| `imageExport` | `ImageExportBridge` (`image-export-schema.ts`) | `imageExportBridge.ts` (`imageExport.ts` is the hidden rasterize window's own preload) | `imageExportGateway` |
| `browser` | `BrowserBridge` (`browser-schema.ts`) | `browserBridge.ts` | `browserGateway` |
| `markdownImage` | `MarkdownImageBridge` (`markdown-image-schema.ts`) | `markdownImageBridge.ts` | `markdownImageGateway` |
| `preview` | `PreviewBridge` (`preview-bridge-types.ts`) | `previewBridge.ts` | `previewGateway` – `setVisibility` only from `services/preview/OverlayGuardService` (lint-enforced) |
| `claudeStatus` | `ClaudeStatusBridge` (`claude-status-schema.ts`) | `claudeStatusBridge.ts` | `claudeStatusGateway` |
| `screenshot` | `ScreenshotBridge` (`screenshot-schema.ts`) | `screenshotBridge.ts` (the overlay-only verbs are in `screenshotOverlay.ts`) | `screenshotGateway` |
| `utils` | `Api['utils']` – answered by the preload itself (`webUtils.getPathForFile`, `process.platform`, `process.arch`), no IPC | inline in `index.ts` | `utilsGateway` – for the platform, prefer `isMacOS()` / `isWindows()` from `utils/platform` |
| `projectLock` | `ProjectLockBridge` (`project-lock-schema.ts`) | `projectLockBridge.ts` | none – no renderer caller |

**Not finished yet: the TerminalPanel files.** `components/Panels/TerminalPanel.tsx` and its `useScreenshotCapture` / `useTerminalDragDrop` hooks still read `window.api.claudeStatus`, `window.api.utils` and `window.api.screenshot` directly, because another change owns those files. Until they move to `claudeStatusGateway`, `utilsGateway` and `screenshotGateway`, `Window['api']` keeps those three bridges and ESLint allows exactly those reads in exactly those three files (`RENDERER_TERMINAL_PANEL_FILES`). Remove both once they have moved.

What holds it in place:

- **Types.** `Window['api']` (`src/preload/index.d.ts`) lists no bridge but the three above, so a direct read does not type-check. `src/preload/apiContract.types.ts` proves each `Api` member is exactly its contract and that no `any` is in `Api`; `src/renderer/src/services/windowApi.types.ts` proves each gateway is exactly its contract. Both are compiled by `npm run typecheck`.
- **Lint.** `no-restricted-syntax` in `eslint.config.mjs` rejects every `window.api` expression (`window?.api`, `globalThis.api` and `self.api` too), so reading, aliasing and destructuring it all fail, plus the ways round the type: computed access on `window` / `globalThis` / `self`, a cast (`as`, `!`, `satisfies`, `<T>`), and destructuring `api` off the global itself (`const { api } = window`, also through a cast, in an assignment and as a default value such as `({ api } = window) => …`). A bare `{ api }` destructure of anything else is everyday code (`const { api } = props`) and passes. Not caught, so review for them: an alias of `window` itself (`const w = window; w.api`), and reaching it through `globalThis.window` (`globalThis.window.api`, `const { api } = globalThis.window`). The gateways and `bridgePresence.ts` (`RENDERER_GATEWAY_FILES`) are exempt, and tests and their helper folders may install mocks on `window.api`. The rule's own cases are in `scripts/eslint-layer-rules.test.mjs`.
- **Tests.** The wire of each bridge (channel, arguments, events and their unsubscribe) is pinned in `src/preload/__tests__/api-contract.test.ts` and `*-bridges.test.ts`, written out as strings because the channel names must not change; `src/renderer/src/services/gateways.test.ts` checks that every gateway forwards every method.
- **A bridge that may be missing.** A caller that must also work where the bridge is not there asks `hasBridge(domain)` or `hasBridgeMethod(domain, method)` from `services/bridgePresence.ts` first and then calls the gateway: code that unit tests run without installing one, the crash screen (`RootErrorFallback` offers only the actions whose bridge method is there), and the logger, which also runs in the screenshot-overlay window where there is no `window.api`. That module answers yes or no only; it never hands out the bridge.

Adding a bridge or a method: change the contract first, then the preload module and the gateway (the type checks fail until all three agree), and add the wire to the bridge tests. For a new bridge, also assert its contract in `apiContract.types.ts` and `windowApi.types.ts`, add the gateway to `gateways.test.ts`, and list the gateway file in `RENDERER_GATEWAY_FILES` in `eslint.config.mjs`.

## Invoke round-trip for terminal writes (v0.3.3)

`terminal:write` is an `invoke`/`handle` channel, but the only promise in the chain is the IPC round-trip itself. The service write is **synchronous**: `TerminalService.write()` returns a boolean that says whether the PTY accepted the data, and the handler returns that boolean as `{ success }` without awaiting anything.

**1. Service layer – synchronous write** (`src/main/services/TerminalService.ts`):
```typescript
write(terminalId: string, data: string): boolean {
  const terminal = this.terminals.get(terminalId)
  if (!terminal) {
    logger.error(`Terminal ${terminalId} not found`)
    return false
  }
  try {
    terminal.ptyProcess.write(data)   // node-pty buffers internally; no callback
    return true
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'EPIPE') {
      // PTY already closed – drop the entry and report it as an exit
      this.terminals.delete(terminalId)
      this.emit('exit', { terminalId, exitCode: 0 })
      return false
    }
    this.emit('error', { terminalId, error: String(error) })
    return false
  }
}
```

**2. IPC handler returns the boolean** (`src/main/ipc/terminal-handlers.ts`):
```typescript
registerHandle('terminal:write', (_event, { terminalId, data }) => {
  try {
    const success = terminalService.write(terminalId, data)
    return { success }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})
```

**3. Preload exposes the invoke** (`src/preload/terminalBridge.ts`, typed as `TerminalBridge`):
```typescript
write: (terminalId, data) => ipcRenderer.invoke(TERMINAL_CHANNELS.write, { terminalId, data })
```

**4. Renderer awaits the round-trip** through `terminalGateway` (for example `src/renderer/src/components/ProjectTree/switchHelpers.ts`, which `await`s the write before sending a follow-up signal):
```typescript
const result = await terminalGateway.write(terminalId, text)
if (!result.success) {
  // the PTY was gone or refused the write – result.error carries the reason
}
```

**What the promise does and does not guarantee**:
- Resolving means main has handed the bytes to node-pty (or refused to). It does **not** mean the shell has consumed them – node-pty buffers the write internally and no completion callback is used.
- `{ success: false }` without `error` means the terminal id was unknown or the PTY was already closed (EPIPE); `error` is set only when the write threw something else.
- Sequencing (write text, then send Enter) is ordered by the `invoke` calls themselves, not by a write-complete signal.
- See [AutoExecute Reference](./prompts/autoexecute-reference.md) for the autoExecute flow that relies on this ordering

## Adding New IPC Channel

1. Add the method to the domain's bridge contract and preload module (see [Renderer gateways](#renderer-gateways)); a domain that has no gateway yet is still declared inline in `src/preload/index.ts`
2. Create handler in appropriate `src/main/ipc/*-handlers.ts`, registered through `registry.ts` (never `ipcMain` directly)
3. Register handler in `src/main/index.ts`
4. Forward it in the domain's gateway and call the gateway from the renderer

## Security Rules

- **Always validate** inputs in main process
- **Never trust** renderer data
- **Use TypeScript** for type safety across IPC boundary
- **Return serializable** data only (no functions, class instances)

## Current IPC Channels

Every channel registered in `src/main/ipc/*.ts` is listed, plus the main → renderer
events those handlers and their services broadcast. Regenerate the handler half with:

```bash
grep -rnE "register(Handle|HandleOnce|On|Once)\(" src/main/ipc --include='*.ts' | grep -v '\.test\.'
```

Note that several domains register through channel **constants**
(`src/shared/ipc/*-channels.ts`) rather than string literals, so a grep for
`registerHandle('` alone under-reports by roughly a third. A grep for
`ipcMain.handle(` finds only `registry.ts` itself.

### File operations (`file-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `file:openProject` | Open folder dialog, save to settings |
| `file:openProjectByPath` | Open a project by an explicit path (recent projects, CLI) |
| `file:closeProject` | Close the current project. Optional request `{ expectedGeneration? }`: the project session generation the renderer last saw; a close for an older generation does nothing |
| `file:getSession` | The open project as the main process holds it: `{ root, generation }`, or `null` when none is open |
| `file:getProjectPath` | Get current project path |
| `file:readDirectory` | Read directory tree. Single-flight per resolved path (#208): at most one walk of a path runs; every request made during it shares one follow-up walk that starts after it settles, and a failed walk rejects only its own requests. See [File watching § Tree refresh is single-flight](./file-watching/technical-details.md#tree-refresh-is-single-flight-208). Ignored folders and folders past the 50,000-entry cap come back as `lazy` rows; `shallow: true` reads one level, which is how the tree expands one (finding [32]) |
| `file:findByName` | Files of one name in the project: `dirPath` must be the project root (confined like a tree read; the real root is walked, results use the requested spelling). Bounded – 20 results, 20,000 folders, 16 reads in flight, a hard 1.5 s deadline; at most 2 searches per process with reads in flight (a search keeps its slot until its last read settles, so hung reads stay bounded), one per session + root + spelling + name, 8 waiting for at most 1.5 s, the rest answer `truncated` – and never through a link; skips hidden, excluded and ignored folders; a project switch ends it. The terminal's file links call it on a click when the tree is incomplete (finding [32]) |
| `file:readFile` | Read file content |
| `file:readImage` | Read an image as a base64 data URL, or answer `unchanged` when the caller's version still matches (#70) |
| `file:writeFile` | Write file content. Request `{ filePath, content, createParentDirs?, generation? }`: `createParentDirs` (literal `true` only) recreates missing folders inside the project for the editor's "Save to restore it"; `generation` is the project session generation the file was opened under, and a write is refused with `PROJECT_CHANGED` (before anything is touched) when the open project is a different one |
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
| `file:validatePath` | Validate a path against the project boundary. Request `{ filePath }`; the answer's `insideProject` is computed from the open project, never from anything the renderer sends |
| `file:revealInFileManager` | Reveal the item in Finder / Explorer |
| `project:changed` | Event: project switched (main → renderer). Broadcast to every window by `ProjectService`, its only sender; payload `{ oldPath, newPath, generation }`, where `generation` is the project session's counter (+1 per open or close) |

### External files (`external-file-handlers.ts`)

Note the `file:` prefix – these are **not** `external-file:*`.

| Channel | Purpose |
|---------|---------|
| `file:selectExternalFiles` | Open a dialog for files outside the project |
| `file:validateExternal` | Validate an external file before copy/move. Request `{ sourcePath }` |
| `file:copyFromExternal` | Copy an external file into the project. Request `{ sourcePath, targetFolder, conflictResolution? }`; the target is checked against the open project, and there is no project-root field |
| `file:moveFromExternal` | Move an external file into the project (one confirmation box). Same request shape as copy |
| `file:moveBatchFromExternal` | Move several external files after one decision. Request `{ items: [{ sourcePath, conflictResolution? }], targetFolder }`, 1 to 100 distinct files; answers `{ results }`, one per item in order, or `{ results: [], error, errorCode }` when the whole request is refused. The files are asked in a sequence of boxes, at most ten files each. Move moves the files only if every box answers Move; Cancel, or a box that cannot be shown (hidden window, the window's box limit used up), moves none, including those an earlier box said Move to, and shows no further box. Every file then answers `EXTERNAL_FILE_MOVE_CANCELLED` or `EXTERNAL_FILE_MOVE_NOT_GRANTED`; the renderer shows one toast for the second. The confirmer's queue of 100 per window still applies. Name conflicts are settled in the renderer before the request (its per-file Skip drops only that file), and a drop over 100 files is refused there with "Too many files" before the Move / Copy / Import choice is shown |

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
| `directory-watch:recovered` | Event: watcher recovered after a recoverable ENOENT. Sent by main (`DirectoryWatcherService`) but **not exposed by preload** – no renderer consumer |
| `directory-watch:restart-failed` | Event: watcher restart gave up. Sent by main (`DirectoryWatcherService`) but **not exposed by preload** – no renderer consumer |

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
| `terminal:create` | Spawn a PTY from strict `{ cwd?, cols, rows }` (`cwd` must be an existing folder inside the open project; none means the project folder, or home with no project open); returns `{ success: true, terminalId, shellKind }` or `{ success: false, error }`, the reason passed through verbatim from `TerminalService.createTerminal` |
| `terminal:write` | Write to the PTY; returns `{ success, error? }` from a synchronous PTY write – the promise is only the invoke round-trip (see the invoke round-trip section above) |
| `terminal:resize` | `ipcMain.on` – resize the PTY (fire-and-forget) |
| `terminal:kill` | Kill a PTY (owner-checked, like `write`, `resize`, `getInfo`, `getActivity` and `clearComplete`: another window gets the answer for an unknown id) |
| `terminal:getInfo` | Metadata for one terminal |
| `terminal:list` | List the calling window's live terminals |
| `terminal:getActivity` | Whether a program other than the shell is running in the terminal: `{ success, busy, known }` (`known: false` on Windows). Owner-checked |
| `terminal:clearComplete` | `ipcMain.on` – renderer acknowledges that a clear finished |
| `terminal:ackOutput` | `ipcMain.on` – flow control: strict `{ terminalId, chars }` (an integer count of UTF-16 code units, 1–16 Mi), how much output xterm has parsed; sent once per 32 KiB, and on receipt while the window is hidden. Owner-checked – an ack from another window is ignored. Main pauses the PTY above 512 KiB unacknowledged and resumes below 128 KiB, or after 5 s with no ack progress (POSIX only; Windows is batched, never paused). See `src/main/services/terminalOutputFlow.ts` and [performance/terminal-output-batching.md](performance/terminal-output-batching.md) |
| `terminal:data` | Event: PTY output (main → the owning window), batched per terminal – every 8 ms or at 64 KiB, in order, and always before that terminal's `terminal:exit` |
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
| `globalSettings:changed` | Event: the validated global settings changed (main → renderer). Broadcast to every window by `global-settings-handlers.ts` from `GlobalSettingsService.onSettingsChanged`; not handler-registered |

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
| `import:toolStatus` | LibreOffice status – `found` / `missing` / `unsafe`, with `unsafe: { tool, reason }` (no path) – (`{ recheck: false }`), or "Check again" (`{ recheck: true }`, clears the per-session cache, rate-limited); strict schema in `import-schema.ts`, sender-gated, never rejects (#250) |

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
| `transcription:whisperCancelDownload` | Cancel the running binary or model download; the pending ensure call resolves with `cancelled: true` and the partial file is deleted |
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
| `screenshot:areaSelected` | Overlay-only (frame-IPC): renderer posts the chosen rectangle. Listener attached per-call by `ScreenshotOverlayWindow` (`src/main/services/screenshot/ScreenshotOverlayWindow.ts`) via `overlay.webContents.mainFrame.ipc.on`; rejected on token / `senderFrame.url` mismatch. Not registered on the global `ipcMain` (#164) |
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

### HTML preview (`preview/*-handlers.ts`, constants in `preview-channels.ts`) (#74)

Channel names come from the `PreviewChannels` / `PreviewEvents` constants in `src/shared/ipc/preview-channels.ts`. Every request is sender-validated main-side via `isTrustedPreviewSender` (`src/main/ipc/preview/isTrustedPreviewSender.ts`), on top of the registry gate every channel already has; a payload carries a `panelId` and the request's own arguments, nothing more – the previewed page's own trust is resolved main-side and never taken from the renderer. The 12 control channels (`checkEligibility`, `open`, `close`, `reload`, `approveHost`, `find`, `stopFind`, `exportPdf`, `navigate`, `focusPage`, `setBounds`, `setVisibility`) are `invoke`/`handle` **except** `setBounds` and `setVisibility`, which are high-frequency fire-and-forget `send`/`on`. `navigate` and `focusPage` (#124) run the sender gate before the payload is read. Main re-validates every event against its schema before it sends (`validateAndSend` in `src/main/ipc/preview/emit.ts`); the preload bridge (`src/preload/previewBridge.ts`) is a plain pipe and validates nothing in either direction, so each renderer consumer owns its own defence. There is no `preview:setZoom`: zoom is driven from the View menu main-side (`menu.ts` → `PreviewViewService`), not over IPC.

| Channel | Purpose |
|---------|---------|
| `preview:checkEligibility` | Whether a path may open as a running preview |
| `preview:open` | Mint the `WebContentsView` and open a preview for a panel. Refuses (`PREVIEW_VIEW_LIMIT_REACHED`) only when the same panel id is already live in *another* window; over `PREVIEW.MAX_LIVE_VIEWS` it suspends the least recently active preview instead. A payload that fails `PreviewOpenRequestSchema` answers `PREVIEW_OPEN_INVALID_REQUEST` |
| `preview:close` | Close and destroy the preview for a panel (bounded destroy) |
| `preview:setBounds` | `ipcMain.on` – update the native view bounds (fire-and-forget; stale seqs dropped) |
| `preview:setVisibility` | `ipcMain.on` – update view visibility with a diagnostic reason (fire-and-forget) |
| `preview:reload` | Reload the previewed page |
| `preview:approveHost` | Approve a remote **origin** — scheme, host and port — writing back to the project allowlist. The payload field is still named `host` for wire compatibility, but is validated with `PreviewOriginSchema`: it must already be canonical, so the string stored is the string both chokepoints compare |
| `preview:find` | Start / advance an in-page find |
| `preview:stopFind` | Stop the active in-page find |
| `preview:exportPdf` | Export the live previewed page to PDF |
| `preview:navigate` | Show another page in this tab, or step its history (#124). One invoke in two phases: `check` before anything happens, `commit` once the renderer has resolved the other tabs showing the target. The request (`PreviewNavigateRequestSchema`, strict) names a panel plus either `open` with a project `filePath` and an `anchor` (a fragment without its `#`, or `null`), or `back` / `forward` with main's own history `generation` – never a URL or a token. The service runs every other gate in the sender's window (the panel's view, real-root confinement, `.html` / `.htm`, eligibility, a navigation already pending). Answers `{ ok: true, target, generation }` or `{ ok: false, errorCode }`, re-validated before it goes back; a refusal carries the tab's new `history` only when main dropped a Back or Forward entry whose page is gone. A stale generation is refused with `PREVIEW_NAV_SKIPPED`; an untrusted sender, a bad payload or a failure reads `PREVIEW_NAV_UNAVAILABLE`, never a throw |
| `preview:focusPage` | Put keyboard focus in the previewed page (issue #124, QG-8 U1) – the keyboard's only way into a page the renderer's tab order cannot reach. Sender-gated before the payload is read; `PreviewPanelRequestSchema` (a bounded `panelId`, strict); the view is looked up in the sender's own window. Answers a plain `{ ok }`: `false` for no live view (closed, suspended), a view that is not drawn, another window's view, or anything it cannot serve – never a throw. Called only on the reader's Enter or Space on the panel's placeholder; Escape in the page is the way back |
| `preview:failuresChanged` | Event: the failure log for a panel changed (coalesced) |
| `preview:hostBlocked` | Event: a remote **origin** was blocked, with every kind it was refused for. Drives the permission band's blocked list. Deliberately validated LOOSER than the approve path — something that can never be granted must still be reportable, or a page fails for a reason nothing on screen explains. De-duplicated main-side (one message per origin per *change of kinds*, not per request), capped at `PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW` with a per-hostname sub-cap of `PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST` so one noisy host cannot spend the whole budget on ports; the `truncated` flag rides the last event that fits |
| `preview:allowlistChanged` | Event: the project's approved-**origin** set (field still named `hosts`). Seeded on open so a project can show what was granted in an earlier session, and fanned out after an approval to every live view of the project |
| `preview:visibilityApplied` | Event: a visibility change was APPLIED to the native view. The mirror of `boundsApplied`: `setVisibility` is fire-and-forget and the hide path awaits a `capturePage` first, so anything that reveals Erfana's controls *because* the page was hidden must wait for this |
| `preview:findResult` | Event: an in-page find produced a final result |
| `preview:stillFrameChanged` | Event: the still-frame captured on hide changed |
| `preview:loadStateChanged` | Event: the load state for a panel changed |
| `preview:backdropChanged` | Event: the colour painted behind the page changed – Erfana's chrome colour until the page first paints, then the page's own resolved background. The renderer writes it onto the placeholder so the DOM and the native view never disagree (sd-074 §1.8a) |
| `preview:boundsApplied` | Event: a `setBounds` that asked for confirmation was applied and the page has repainted at the new rect, echoing the request's `seq`. Anything that reveals Erfana's own chrome *because* the page moved (the permission band opening its list) waits for this rather than trusting the send |
| `preview:forwardedShortcut` | Event: an enumerated keyboard accelerator was forwarded from the sealed page – `f` / `s` / `w` / `Escape`, plus `back` / `forward` since #124 (matched on the physical key through `src/shared/previewNavKeys.ts`, so `accel` is `false` for both). For `f`, `w` and `Escape`, whose action moves focus out of the page, main gives the host window's contents native focus BEFORE sending (`previewHostFocus.ts`) |
| `preview:pageChanged` | Event (#124): a load main started has committed – the tab shows another page, or another place in the same one. `filePath` and `anchor` come from main's gated history entry, never from the URL that committed; also carries `sameDocument`, the tab's Back / Forward state (`canGoBack`, `canGoForward`, `backTarget`, `forwardTarget`, `generation`) and `failed` (the committing load answered 400 or above – a refused page still commits) |
| `preview:resizeHold` | Event (#124): a window-edge resize hid this panel's view (`held: true`) or ended (`held: false`). The renderer answers the end with a settled bounds push, and main shows the view again once that push is applied |

### Markdown preview images (`markdown-image-handlers.ts`, constants in `markdown-image-channels.ts`) (#71)

| Channel | Purpose |
|---------|---------|
| `markdown-image:read` | Read an image a Markdown document references. Request `{ filePath, knownVersion? }` (strict). Sender-gated with `isTrustedSender` before the payload is read, then confined to the open project: a path not lexically inside the root is refused before the file system is asked (`lexicalPrecheck`), then `project` mode with links resolved, must be an existing file. PNG / JPEG / GIF / WebP / SVG only – the requested and the canonical path must both carry one of those extensions. The file is opened once (non-blocking, last segment not followed, on POSIX), must be a regular file by `fstat` of that handle, and at most `MARKDOWN_IMAGE_MAX_BYTES` (16 MB) + 1 bytes are read. Answers `ok` (`data:` URL + version), `unchanged`, or `refused` with a reason (`outside-project`, `not-found`, `unsupported-type`, `too-large`, `unreadable`); never rejects for a refusal and never names a path. Refusals log at debug (`refusalLogLevel`) |

### Open in default browser (`browser-handlers.ts`, constants in `browser-channels.ts`) (#124)

| Channel | Purpose |
|---------|---------|
| `browser:openFile` | Open one `.html` / `.htm` project file in the default browser. Its own domain on purpose: not `shell:openExternal` (whose allow-list must stay web-only) and not `preview:` (the project tree uses it too, even with HTML execution off). `isTrustedSender` runs before the payload is read; the request is `{ filePath }` (strict, at most `MAX_BROWSER_OPEN_PATH_LENGTH` = 4096) – a file path, never an address. `BrowserLaunchService` then runs the project and real-path checks (see [security.md § HTML preview](security.md#html-preview)) and launches the real path it checked. Answers `{ success: true, usedFallback }` (`true` when no default browser was found and the file went to the system's `.html` app) or `{ success: false, errorCode, error }` with one of the six `OPEN_IN_BROWSER_*` codes and its `ERROR_MESSAGES` text; no raw error crosses IPC |

### Project lock (`project-lock-handlers.ts`)

| Channel | Purpose |
|---------|---------|
| `project-lock:acquire` | Acquire lock for project path |
| `project-lock:release` | Release lock for project path |
| `project-lock:check` | Check lock status for project path |
| `project-lock:requestFocus` | Request focus from lock holder |
| `project-lock:cleanup` | Cleanup stale locks |
| `project-lock:focused` | Event (main → renderer): another Erfana instance asked, via `project-lock:requestFocus`, for the window holding this project to come to the front; sent after main has focused it, with `{ projectPath, requesterPid }`. Broadcast by `ProjectLockService`, not handler-registered |

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
- Terminal event schemas — `TerminalDataSchema`, `TerminalExitSchema`, `TerminalErrorSchema`; the `TerminalBridge` contract (`terminal-schema.ts`) and channel constants (`terminal-channels.ts`)
- File bridge — the `FileBridge` contract and `FileNode` / `FileStats` (`src/shared/ipc/file-schema.ts`), channel constants in `src/shared/ipc/file-channels.ts` (`FILE_CHANNELS`, `FILE_EVENTS`). The preload implements both bridges in `src/preload/fileBridge.ts` and `terminalBridge.ts`; the renderer reaches them through `services/fileGateway.ts` and `terminalGateway.ts`
- Transcription schemas — `TranscriptionImportRequestSchema`, `TranscriptionProgress`, `TranscriptionImportResult`, `TranscriptionSettingsSchema` (see `src/shared/ipc/transcription-schema.ts`)
- Document import schemas — `DocumentImportRequestSchema`, `DocumentImportOptionsSchema`, `DocumentImportProgress`, `DocumentImportResult`, `DependencyReadyEvent` (see `src/shared/ipc/import-schema.ts`); channel constants in `src/shared/ipc/import-channels.ts`
- Markdown image schemas — `MarkdownImageReadRequestSchema`, the `ok` / `unchanged` / `refused` response, `MARKDOWN_IMAGE_EXTENSIONS`, `MAX_MARKDOWN_IMAGES_PER_DOCUMENT`, `MARKDOWN_IMAGE_MAX_BYTES`, `MARKDOWN_IMAGE_BYTE_BUDGET` and the `MarkdownImageBridge` contract (see `src/shared/ipc/markdown-image-schema.ts`); channel constant in `src/shared/ipc/markdown-image-channels.ts`; preload in `src/preload/markdownImageBridge.ts` (#71)
- Image read schemas — the contract behind `file:readImage` (#70): `ImageReadRequestSchema` plus the `unchanged`/`ok`-discriminated `ImageReadResponse`, which lets the renderer skip a re-encode when its cached `version` still matches (see `src/shared/ipc/file-image-schema.ts`)
- Image export schemas — `ImageExportRequestSchema` (`.strict()`, with the supported-extension allow-list expressed in the schema itself, so "unsupported format" needs no error code of its own) and the `success`-discriminated `ImageExportResponse`, whose failure branch **requires** both `errorCode` and `error`; plus the main-only harness render/result union (see `src/shared/ipc/image-export-schema.ts`); channel constants in `src/shared/ipc/image-export-channels.ts` (#73). The supported extensions and their MIME map are shared across the process boundary by `src/shared/ipc/image-formats.ts`, which both `main/services/file/imageRead.ts` and `renderer/src/utils/imageUtils.ts` import rather than re-declaring
- File schemas — `FileNodeSchema` (project-tree node, recursive) and `FileStatsSchema` (`file:getStats` result), with the inferred `FileNode` / `FileStats` types that preload, `FileService`, `IProjectTreeApi` and the context-menu types re-export (see `src/shared/ipc/file-schema.ts`); and the strict request objects of the `file:*` channels (`ReadDirectoryRequestSchema`, `PathRequestSchema`, `WriteFileRequestSchema`, …, with `payloadArgs()` wrapping one in the tuple `registerConfinedHandle` takes). The external-file requests and the batch move shape are in `src/shared/ipc/external-file-schema.ts`. The refusal codes a path check throws, and the reader that recovers a code from a rejected `invoke`, are in `src/shared/ipc/confinement.ts`; the renderer gateway turns them into a `FileGatewayError` with a `code`
- Clipboard schemas — `ClipboardWriteTextSchema`, `CLIPBOARD_MAX_TEXT_LENGTH`, and the `ClipboardBridge` contract shared by the preload bridge and renderer service (see `src/shared/ipc/clipboard-schema.ts`); channel constants in `src/shared/ipc/clipboard-channels.ts`
- Claude Code status schemas — the per-`terminalId` `ClaudeStatusSnapshot` contract consumed by `useClaudeStatusStore` and the register/nudge payloads (see `src/shared/ipc/claude-status-schema.ts`); channel constants in `src/shared/ipc/claude-status-channels.ts` (#216)
- HTML preview schemas — the open/close/find/export and host-approval payloads plus the push-event shapes (see `src/shared/ipc/preview-schema.ts`), the versioned per-project allowlist contract (`src/shared/ipc/preview-settings-schema.ts`), and the `htmlPreview.enabled` global switch (`src/shared/ipc/global-settings-schema.ts`); channel constants in `src/shared/ipc/preview-channels.ts` (#74). Since #124 the same-tab navigation and resize-hold shapes live in `src/shared/ipc/preview-navigation-schema.ts` and the bridge contract in `src/shared/ipc/preview-bridge-types.ts`, because `preview-schema.ts` is at its size cap
- Open in default browser schemas — the strict `{ filePath }` request and the `success`-discriminated response, whose failure branch carries one of the six `OPEN_IN_BROWSER_*` codes (see `src/shared/ipc/browser-schema.ts`); channel constant in `src/shared/ipc/browser-channels.ts` (#124)
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

### Preview channels not in this index (sd-074b)

Three preview channels are deliberately absent from the table above:

- **`preview-page:linkActivated`** — page → main, registered with `webContents.ipc` on the preview's own WebContents (`previewViewLifecycle.ts`), never on the global `ipcMain`. Only that WebContents can reach it, so it needs no sender predicate; the handler additionally rejects sub-frame senders. WebContents-scoped rather than frame-scoped on purpose: a `WebFrameMain` is replaced when a navigated page replaces it, which would silently drop a `mainFrame.ipc` listener. Same shape of "invisible to the rest of the app" as the `image-export:harness-*` channels, though those are frame-scoped.
- **`preview-page:linkNote`** – page → main, on that same `webContents.ipc` with the same sub-frame gate (`previewViewLifecycle.ts`). The preload reports a click one task after it, so the page's later listeners can cancel it first; this channel carries the click's `seen` note, sent during the click, and a `cancelled` note sent in place of the report. Main (`previewNavigationHold.ts`) uses them only to hold the browser's `will-navigate` for that click until the report has claimed it, capped at 1 s.
- **`preview-page:cspViolation`** – page → main, another channel on that same `webContents.ipc` (`previewCspViolationBridge.ts`, mirroring the link bridge). The preview's send-only preload forwards the page's own `securitypolicyviolation` reports, which is the only way a host the CSP refused in the renderer – before the network filter could see it – can reach the permission band. It widens nothing: both gates stay as they are, only the report is added.
- **`preview:openFileRequested`** — main → renderer, and the only preview event that is **window-scoped** rather than broadcast. Every other preview event carries a `panelId` and is harmless to send everywhere; this one causes a tab to open, so broadcasting it would make every window open a tab for one window's link click. Since #124 its payload carries an optional `disposition` – `same-tab`, `new-tab` or `by-mode` (the tab's link-mode toggle decides); absent means `new-tab`, which is every link before #124.
