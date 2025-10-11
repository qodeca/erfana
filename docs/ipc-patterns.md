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
| `file:openProject` | file-handlers | Open folder dialog |
| `file:readDirectory` | file-handlers | Read directory tree |
| `file:readFile` | file-handlers | Read file content |
| `file:writeFile` | file-handlers | Write file content |
| `file:getStats` | file-handlers | Get file metadata |
| `file:getProjectPath` | file-handlers | Get current project path |
| `file:createFile` | file-handlers | Create new empty file |
| `file:createFolder` | file-handlers | Create new folder |
| `file:renameFile` | file-handlers | Rename file or folder |
| `file:deleteFile` | file-handlers | Delete file or folder |

See: [Architecture](./architecture.md) | [Security](./security.md)
