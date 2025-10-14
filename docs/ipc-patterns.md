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
| `claudeCode:startSession` | claude-code-handlers | Start persistent Claude CLI session (accepts planningMode: boolean) |
| `claudeCode:stopSession` | claude-code-handlers | Stop persistent session |
| `claudeCode:sendMessage` | claude-code-handlers | Send message to running session |
| `claudeCode:stop` | claude-code-handlers | Stop generation (limited in persistent mode) |
| `claudeCode:isInstalled` | claude-code-handlers | Check if Claude CLI is installed |
| `claudeCode:checkAuth` | claude-code-handlers | Check authentication status |
| `claudeCode:setToken` | claude-code-handlers | Set OAuth token |
| `claudeCode:getSessionState` | claude-code-handlers | Get current session state |
| `claudeCode:sessionStarted` | claude-code-handlers | Event: Session started |
| `claudeCode:sessionStopped` | claude-code-handlers | Event: Session stopped |
| `claudeCode:sessionRestarting` | claude-code-handlers | Event: Session restarting |
| `claudeCode:sessionError` | claude-code-handlers | Event: Session error |
| `claudeCode:approveTool` | claude-code-handlers | Approve tool use and restart session |
| `claudeCode:denyTool` | claude-code-handlers | Deny tool use and restart session |
| `claudeCode:message` | claude-code-handlers | Event: Message from Claude CLI |
| `claudeCode:complete` | claude-code-handlers | Event: Generation complete |
| `claudeCode:error` | claude-code-handlers | Event: Error occurred |
| `claudeCode:toolApprovalNeeded` | claude-code-handlers | Event: Tool approval request |
| `claudeCode:sessionResumed` | claude-code-handlers | Event: Session resumed with new tools |
| `settings:getApprovedTools` | settings-handlers | Get approved tools list |
| `settings:setApprovedTools` | settings-handlers | Set approved tools list |
| `settings:addApprovedTool` | settings-handlers | Add single tool to approved list |
| `settings:removeApprovedTool` | settings-handlers | Remove single tool from approved list |
| `settings:resetApprovedTools` | settings-handlers | Reset to safe defaults |
| `settings:getProjectFilterMode` | settings-handlers | Get project filter mode (all/markdown) |
| `settings:setProjectFilterMode` | settings-handlers | Set project filter mode (all/markdown) |

## Event-Based IPC Pattern

For streaming/event-based communication (Claude Code integration):

**1. Register event listener** in renderer:
```typescript
useEffect(() => {
  const unsubscribe = window.api.claudeCode.onMessage((data) => {
    setMessages((prev) => [...prev, data.message])
  })
  return unsubscribe
}, [])
```

**2. Emit events** from main process:
```typescript
claudeCliService.on('message', (message) => {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length > 0) {
    windows[0].webContents.send('claudeCode:message', { message })
  }
})
```

**Key Pattern**: Get window dynamically (timing-safe), use EventEmitter for service events.

See: [Architecture](./architecture.md) | [Security](./security.md) | [File Watching](./file-watching.md) | [Claude Code Integration](./claude-code/README.md)
