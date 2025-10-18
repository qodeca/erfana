# Technical Details

Performance considerations, security measures, edge case handling, and integration points for file watching.

---

## Performance Considerations

### Debouncing Strategy

**File Watcher**: Fixed 300ms delay
- Optimized for individual file saves
- Handles rapid successive writes (e.g., auto-save in external editor)

**Directory Watcher**: Adaptive delay
- Single events: 300ms (responsive for individual operations)
- Bulk operations: 1000ms (batches git/npm operations)
- Threshold: 5+ events per second triggers bulk mode

### Event Batching

Directory watcher accumulates events during debounce period. Example: Git checkout with 50 file additions triggers single refresh after 1000ms.

### Resource Limits

- **File watcher**: 100 file limit (prevents memory issues)
- **Directory watcher**: No limit (ignored patterns prevent issues)
- **Cleanup**: Automatic on window close and app quit

---

## Security

### Path Validation

All file paths are validated against the project root:

```typescript
// DirectoryWatcherService.ts
async watchDirectory(dirPath: string, webContents: WebContents) {
  // Security: Prevent watching files outside project
  if (this.projectPath && !dirPath.startsWith(this.projectPath)) {
    throw new Error('Cannot watch directories outside the project directory')
  }
}
```

### Input Sanitization

All IPC handler inputs are validated:

```typescript
// file-watcher-handlers.ts
ipcMain.handle('file-watch:start', async (event, filePath: string) => {
  // Validate input
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'Invalid file path' }
  }
  // ... proceed
})
```

### Error Handling

- Project deletion → Graceful cleanup + error message
- Missing files → Automatic watcher cleanup
- IPC errors → Logged and returned to renderer
- No crashes on edge cases

---

## Edge Cases Handled

### File Watcher

| Edge Case | Solution |
|-----------|----------|
| Race: Save vs external change | Pause/resume pattern during save |
| Multiple tabs, same file | Single watcher, all tabs notified |
| File deleted while open | Warning banner, keep editor state |
| File recreated after delete | New watcher started automatically |

### Directory Watcher

| Edge Case | Solution |
|-----------|----------|
| Project folder deleted | Error message, cleanup all watchers |
| Rapid successive operations | Batched into single update |
| Internal vs external changes | `isInternalOperation` flag |
| Multiple windows | Per-webContents tracking |

---

## Integration Points

### MarkdownEditorPanel (File Watching)

- Starts file watcher when file is opened
- Stops watcher when panel is unmounted
- Shows conflict bar when needed
- Implements pause/resume during save

### ProjectTree (Directory Watching)

- Starts directory watcher when project is loaded
- Stops watcher when project is closed
- Preserves expanded folder state
- Implements pause/resume during CRUD operations

### FileService (CRUD Coordination)

- All file/folder operations go through FileService
- No direct fs operations from components
- Clean separation of concerns

---

See: [README](./README.md) | [Patterns & Testing](./patterns-and-testing.md) | [Architecture](../architecture.md) | [IPC Patterns](../ipc-patterns.md)
