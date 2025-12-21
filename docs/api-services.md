# API Services

**Location:** `src/main/services/`

Supporting service classes for terminal emulation, file operations, file watching, and persistent settings.

## Overview

This document covers supporting services.

## TerminalService

**File:** `src/main/services/TerminalService.ts` (~260 lines)

Manages terminal emulator instances with xterm.js + node-pty.

**EPIPE Error Handling:** Uses `safeConsole` utility to prevent EPIPE crashes during terminal cleanup. See [EPIPE Error Handling](./epipe-error-handling.md) for details.

### Public Methods

#### `createTerminal(id: string, cwd: string, cols: number, rows: number): Promise<void>`
Create new PTY instance.

**Parameters:**
- `id` - Unique terminal identifier
- `cwd` - Working directory for terminal
- `cols` - Terminal columns (width)
- `rows` - Terminal rows (height)

**Throws:** Error if terminal with ID already exists.

**Side Effects:**
- Spawns new PTY process (zsh shell)
- Emits 'data' events for output

---

#### `writeToTerminal(id: string, data: string): void`
Write data to terminal stdin.

**Parameters:**
- `id` - Terminal identifier
- `data` - Data to write (e.g., user input)

**Throws:** Error if terminal not found.

---

#### `resizeTerminal(id: string, cols: number, rows: number): void`
Resize PTY dimensions.

**Parameters:**
- `id` - Terminal identifier
- `cols` - New column count
- `rows` - New row count

**Throws:** Error if terminal not found.

---

#### `killTerminal(id: string): Promise<void>`
Gracefully kill PTY process.

**Parameters:**
- `id` - Terminal identifier

**Side Effects:**
- Removes terminal from internal map
- Kills PTY process

**Events Emitted:**
- `exit` - When process exits

---

### Events

#### `'data'`
**Payload:** `{ id: string; data: string }`

Emitted when PTY produces output.

---

#### `'exit'`
**Payload:** `{ id: string; code: number }`

Emitted when PTY process exits.

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
- Creates chokidar watcher (1000ms debounce)
- Ignores: `node_modules`, `.git`, `.next`, `dist`, `build`, `.DS_Store`

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

#### `'directory-changed'`
**Payload:** `{ dirPath: string; changeType: string; filePath?: string }`

Emitted when directory changes (after 1000ms debounce).

**Change Types:** `'add'`, `'unlink'`, `'addDir'`, `'unlinkDir'`

**Note:** Not emitted during pause window.

---

## FileService

**File:** `src/main/services/FileService.ts`

File operations with validation and error handling.

### Public Methods

#### `readFile(filePath: string): Promise<string>`
Read file contents.

**Parameters:**
- `filePath` - Absolute path to file

**Returns:** File contents as UTF-8 string.

**Throws:** Error if file not found or read fails.

---

#### `writeFile(filePath: string, content: string): Promise<void>`
Write file contents.

**Parameters:**
- `filePath` - Absolute path to file
- `content` - File contents

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

#### `renameFile(oldPath: string, newPath: string): Promise<void>`
Rename/move file.

**Parameters:**
- `oldPath` - Current file path
- `newPath` - New file path

**Throws:** Error if file exists at newPath or rename fails.

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

// Create terminal
await terminalService.createTerminal('main', '/path/to/project', 80, 24)

// Listen for output
terminalService.on('data', ({ id, data }) => {
  console.log(`Terminal ${id}:`, data)
})

// Write input
terminalService.writeToTerminal('main', 'ls -la\n')

// Resize
terminalService.resizeTerminal('main', 100, 30)

// Clean up
await terminalService.killTerminal('main')
```

### File Watching with Pause/Resume

```typescript
import { directoryWatcherService } from './services/DirectoryWatcherService'

// Start watching
directoryWatcherService.watchDirectory('/path/to/project')

// Listen for changes
directoryWatcherService.on('directory-changed', ({ dirPath, changeType, filePath }) => {
  console.log(`${changeType}: ${filePath}`)
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

### Usage
```typescript
import { MainLogger } from './services/LoggingService'

MainLogger.info('Application started')
MainLogger.error('Operation failed', error)
```

See [Logging Documentation](./logging.md) for details.

---

## PdfService

**File:** `src/main/services/PdfService.ts`

PDF generation from HTML content.

### Key Features
- Print-optimized PDF with A4 page size
- Vector Mermaid diagrams (not rasterized)
- Uses Electron's `webContents.printToPDF()`

### Public Methods

#### `generatePdf(html: string, outputPath: string): Promise<void>`
Generate PDF from HTML content.

---

## DocxService

**File:** `src/main/services/DocxService.ts`

DOCX generation from HTML content.

### Key Features
- Word format export
- Mermaid diagrams as high-resolution PNG
- Uses `docx` npm package

### Public Methods

#### `generateDocx(html: string, images: ImageData[], outputPath: string): Promise<void>`
Generate DOCX from HTML with embedded images.

---

## GitStatusService

**File:** `src/main/services/GitStatusService.ts`

Git status tracking with isomorphic-git.

### Key Features
- VS Code-style status indicators (M/U/D/A/!)
- Folder status propagation
- Operation queue to prevent index.lock conflicts
- Auto-refresh with debounce and cooldown

### Known Limitations
- Global `.gitignore` not supported (isomorphic-git limitation)

---

## See Also

- [Architecture](./architecture.md) - Service class overview
- [IPC Patterns](./ipc-patterns.md) - IPC handler integration
- [Terminal](./terminal/README.md) - Terminal panel implementation
- [File Watching](./file-watching/README.md) - Auto-refresh implementation
- [Logging](./logging.md) - Logging layer documentation
