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

See: [Architecture](./architecture.md) | [Security](./security.md) | [File Watching](./file-watching.md)
