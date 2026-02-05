# API Services - Feature Services

**Location:** `src/main/services/`

Feature-specific services for git integration, multi-instance support, media capture, and file import.

See [api-services.md](./api-services.md) for core services (Terminal, File, Settings, Watchers).

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

## ProjectLockService

**File:** `src/main/services/ProjectLockService.ts`

File-based project locking for multi-instance support.

### Key Features
- Multiple independent Erfana instances can run simultaneously
- File-based locks in `~/.erfana/locks/` (SHA-256 hashed filenames)
- Atomic lock creation with O_EXCL flag (prevents race conditions)
- Hybrid stale detection: PID check (same host) + 60-min timeout (cross-host)
- Focus request polling for cross-instance window coordination
- Graceful degradation when lock acquisition fails

### Public Methods

#### `acquireLock(projectPath: string): Promise<LockResult>`
Attempt to acquire lock for a project.

**Returns:** `{ status: 'acquired' | 'already_locked' | 'error', holderPid?, holderHostname?, message? }`

---

#### `releaseLock(projectPath: string): Promise<void>`
Release lock for a project.

---

#### `checkLock(projectPath: string): Promise<LockStatus>`
Check lock status without acquiring.

**Returns:** `{ status: 'unlocked' | 'locked_by_self' | 'locked_by_other' | 'error' }`

---

#### `requestFocus(projectPath: string): Promise<boolean>`
Request focus from the lock holder (triggers window focus via polling).

---

#### `cleanupStaleLocks(): Promise<number>`
Cleanup stale locks from dead processes or timed-out network locks.

---

### Lock File Format
```json
{
  "projectPath": "/path/to/project",
  "pid": 12345,
  "hostname": "machine-name",
  "instanceId": "uuid",
  "createdAt": "2025-12-26T00:00:00.000Z",
  "focusRequestedAt": null
}
```

---

## ScreenshotService

**File:** `src/main/services/ScreenshotService.ts`

macOS screenshot capture using native `screencapture` command.

### Key Features
- Three capture modes: screen, window, area
- Multi-monitor support with monitor selection dialog
- Captures saved to OS temp directory as PNG
- 30-second timeout for interactive selections

### Public Methods

#### `captureScreen(options?: { monitorIndex?: number }): Promise<ScreenshotResult>`
Capture entire screen (primary or specified monitor).

#### `captureWindow(): Promise<ScreenshotResult>`
Open macOS window picker for user selection.

#### `captureArea(): Promise<ScreenshotResult>`
Open crosshair tool for area selection.

#### `getMonitors(): Promise<MonitorInfo[]>`
Get list of available monitors for multi-monitor selection.

### Related Files
- `src/main/ipc/screenshot-handlers.ts` - IPC handlers
- `src/shared/ipc/screenshot-schema.ts` - Zod schemas
- `src/renderer/src/components/Panels/TerminalPanel/hooks/useScreenshotCapture.ts` - UI hook

---

## CameraService

**File:** `src/main/services/CameraService.ts`

Saves camera photos captured from the renderer process to the filesystem.

### Key Features
- JPEG photo saving to OS temp directory
- Timestamped filenames (`erfana-camera-YYYY-MM-DD-HHMMSS.jpg`)
- Base64 data URL validation
- 20MB size limit protection
- Singleton pattern with exported instance

### Public Methods

#### `save(dataUrl: string, timestamp?: number): Promise<SaveResult>`
Save a camera photo to the temp directory.

**Parameters:**
- `dataUrl` - Base64 data URL (must be `data:image/jpeg;base64,...`)
- `timestamp` - Optional timestamp for filename (defaults to current time)

**Returns:**
- `filePath` - Absolute path to saved file (on success)
- `error` - Error message (on failure)
- `errorCode` - `CAMERA_INVALID_DATA` or `CAMERA_SAVE_FAILED`

**Validations:**
- Data URL must start with `data:image/jpeg;base64,`
- Data URL size must be under 20MB
- Base64 decoding must succeed

### Related Files
- `src/main/ipc/camera-handlers.ts` - IPC handlers
- `src/shared/ipc/camera-schema.ts` - Zod schemas
- `src/renderer/src/hooks/useCameraCapture.ts` - Camera access hook
- `src/renderer/src/components/Dialog/CameraDialog.tsx` - Dialog UI

---

## ExternalFileService

**File:** `src/main/services/ExternalFileService.ts`

Handles external file operations for Spec #012 (external file drop to project tree).

### Key Features
- Security validation (symlinks, project boundary, special files)
- Path traversal protection (sanitizes dangerous patterns from filenames)
- Copy and move operations from external locations into project
- Conflict resolution (replace or auto-number)

### Public Methods

#### `validateExternalFile(sourcePath: string, projectRoot: string): Promise<ValidationResult>`
Validate an external file before copy/move operation.

**Returns:**
- `valid` - Whether file can be imported
- `isSymlink` - Whether source is a symlink
- `isDirectory` - Whether source is a directory (rejected)
- `exists` - Whether source exists
- `isRegularFile` - Whether source is a regular file (not device, pipe, socket)
- `error` - Error message if validation failed
- `errorCode` - Structured error code

---

#### `copyFromExternal(options: CopyOptions): Promise<OperationResult>`
Copy a file from external location into project.

**Parameters:**
- `sourcePath` - Absolute path to external source file
- `targetFolder` - Absolute path to target folder within project
- `projectRoot` - Project root path (for boundary validation)
- `conflictResolution` - `'replace'` or `'keepBoth'` (optional)

**Returns:** `{ success, path?, isSymlink?, error?, errorCode? }`

---

#### `moveFromExternal(options: MoveOptions): Promise<OperationResult>`
Move a file from external location into project (deletes source after copy).

**Parameters:** Same as `copyFromExternal`

**Returns:** `{ success, path?, isSymlink?, error?, errorCode? }`

---

### Security Validations
1. **Path traversal** - Rejects paths with `..` or null bytes
2. **Symlinks** - Detects and reports symlinks (warns user)
3. **System directories** - Rejects symlinks pointing to system paths
4. **Project boundary** - Ensures target is within project root
5. **Special files** - Rejects devices, pipes, sockets

### Related Files
- `src/main/ipc/external-file-handlers.ts` - IPC handlers
- `src/shared/ipc/external-file-schema.ts` - Zod schemas
- `src/renderer/src/hooks/useExternalFileDrop.ts` - UI hook

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

## See Also

- [API Services - Core](./api-services.md) - Terminal, File, Settings, Watchers
- [Architecture](./architecture.md) - Service class overview
- [IPC Patterns](./ipc-patterns.md) - IPC handler integration
- [Terminal](./terminal/README.md) - Terminal panel implementation
- [Drag-Drop](./drag-drop/README.md) - External file drop documentation
