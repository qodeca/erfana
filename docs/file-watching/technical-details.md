# Technical Details

Performance considerations, security measures, edge case handling, and integration points for file watching.

---

## Performance Considerations

### Debouncing Strategy

**File Watcher**: Fixed 300ms delay
- Optimized for individual file saves
- Handles rapid successive writes (e.g., auto-save in external editor)

**Directory Watcher**: Fixed-stage pipeline (VS Code values), not an adaptive delay
- chokidar runs with `awaitWriteFinish: false` (lower latency for editor saves)
- `ThrottledWorker` (`src/main/services/watcher/ThrottledWorker.ts`): 75 ms collection window, then chunks of up to 500 events dispatched with a 200 ms throttle between chunks (`collectionDelay: 75`, `throttleDelay: 200` in `DirectoryWatcherService.watchDirectory`)
- `AtomicSaveDetector`: a delete is held ~100 ms so an atomic write (unlink + rename) coalesces into a change instead of a delete
- Renderer: `directory-watch:changed` is debounced a further 250 ms (`DIRECTORY_WATCHER.DEBOUNCE_DELAY`, `ProjectTree/constants.ts`)

### Event Batching

The worker accumulates events during the collection window and coalesces them per path. Example: a git checkout with 50 file additions arrives as one or a few chunks and produces a single tree refresh after the renderer debounce.

### Resource Limits

- **File watcher**: 100 file limit (prevents memory issues)
- **Directory watcher**: No limit (ignored patterns prevent issues)
- **Cleanup**: Automatic on window close and app quit

---

## Security

### Path Validation

All file paths are validated against the project root:

```typescript
// DirectoryWatcherService.watchDirectory (paths normalized first)
// Security: Prevent watching directories outside project
// Uses normalized paths with separator check to prevent bypasses like /project/../sensitive
if (
  normalizedProjectPath &&
  !normalizedDirPath.startsWith(normalizedProjectPath + sep) &&
  normalizedDirPath !== normalizedProjectPath
) {
  throw new AppError('Cannot watch directories outside the project directory', ErrorCode.PATH_OUTSIDE_PROJECT)
}
```

The appended `path.sep` is what stops `/proj-evil` from passing as a prefix of `/proj`; a system-directory check (`isSystemDirectory`) runs before it.

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
