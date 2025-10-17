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

## Event-Based IPC Pattern

Use event-based IPC for watchers and terminal events (e.g., `terminal:data`, `directory-watch:changed`).

See: [Architecture](./architecture.md) | [Security](./security.md) | [File Watching](./file-watching.md)

## Shared Schemas (Type Safety)

To keep IPC payloads consistent across processes, shared zod schemas live at `src/shared/ipc/schema.ts`.

- `ProjectChangedSchema` — payload for `project:changed` events
  - Shape: `{ oldPath: string | null; newPath: string | null }`
  - Used in main when broadcasting, and in preload typings for `onProjectChanged`
- Terminal event schemas — `TerminalDataSchema`, `TerminalExitSchema`, `TerminalErrorSchema`

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
