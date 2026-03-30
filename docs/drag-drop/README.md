# Drag-Drop File Reorganization

## Overview

Erfana's project tree supports VS Code-style drag-drop file reorganization with:
- **Drag files into folders** - Visual drop indicators show target location
- **Drag folders into folders** - Nested hierarchy manipulation
- **Keyboard shortcuts** - Ctrl+X/C/V for cut/copy/paste operations
- **Cross-filesystem support** - Automatic fallback for moves across volumes
- **Conflict resolution** - Automatic numbering for copy operations, confirm dialog for moves
- **Accessibility** - ARIA live announcements for all operations

## Quick Start

### Mouse Operations
1. **Move files/folders**: Click and drag items to new locations
2. **Auto-scroll**: Drag near top/bottom edge to scroll (50px threshold, 60fps)
3. **Auto-expand**: Hover over folder for 1 second to auto-expand during drag
4. **Drop to root**: Drag items onto the project root folder (first item in tree)

### Keyboard Shortcuts

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+X` (Windows/Linux)<br>`Cmd+X` (macOS) | Cut | Mark file/folder for move operation |
| `Ctrl+C` (Windows/Linux)<br>`Cmd+C` (macOS) | Copy | Mark file/folder for copy operation |
| `Ctrl+V` (Windows/Linux)<br>`Cmd+V` (macOS) | Paste | Move/copy marked item to selected folder |
| `Enter` | Confirm | Confirm move operation in dialog |
| `Escape` | Cancel | Cancel current drag or dialog |

**Notes**:
- Cut items appear dimmed with dashed underline until pasted
- Paste only works when a folder is selected in the tree
- Keyboard operations work identically to mouse drag-drop
- All operations respect the same validation rules

### Context Menu
Right-click any file/folder in the project tree:
- **Cut** - Same as Ctrl+X
- **Copy** - Same as Ctrl+C
- **Paste** - Same as Ctrl+V (only enabled when clipboard has item and folder is selected)

## Documentation Structure

- **[architecture.md](./architecture.md)** - Core technical implementation, tree flattening, projection
- **[clipboard.md](./clipboard.md)** - Clipboard operations, cut/copy/paste logic
- **[visual-feedback.md](./visual-feedback.md)** - UX patterns, CSS styling, accessibility
- **[validation.md](./validation.md)** - Validation rules, constraints, edge cases
- **[integration.md](./integration.md)** - IPC security, watcher sync, context menu
- **[testing.md](./testing.md)** - Test coverage and scenarios
- **[troubleshooting.md](./troubleshooting.md)** - Performance, known limitations, future enhancements

## Key Features

### VS Code-Style Root Folder
- Project root appears as first collapsible tree item
- All files/folders are children of root folder
- Always-visible drop target for moving items to root level
- Matches VS Code Explorer panel UX exactly

### Smooth Drag Behavior
- No jumping or shifting during drag operations
- Custom tree-aware collision detection
- Visual feedback with folder highlighting
- Subtle pulse animation during auto-expand countdown

### Robust File Operations
- Atomic operations with rollback on failure
- Symlink detection and handling
- Cross-filesystem move support (fallback to copy+delete)
- Conflict resolution with user confirmation

## References

- **Main Implementation**: [src/renderer/src/components/ProjectTree/ProjectTree.tsx](/src/renderer/src/components/ProjectTree/ProjectTree.tsx)
- **Tree Utilities**: [src/renderer/src/hooks/useDragDropTree.ts](/src/renderer/src/hooks/useDragDropTree.ts)
- **Clipboard Store**: [src/renderer/src/stores/useClipboardStore.ts](/src/renderer/src/stores/useClipboardStore.ts)
- **File Service**: [src/main/services/FileService.ts](/src/main/services/FileService.ts)
- **dnd-kit Documentation**: https://docs.dndkit.com/
- **VS Code File Explorer**: https://code.visualstudio.com/docs/getstarted/userinterface#_explorer

---

## External file drop

### Overview

Users can drag files from external sources (Finder, file managers) into the project tree. This feature uses HTML5 DataTransfer API separately from the internal dnd-kit drag-drop system.

### Supported operations

- **Move**: Relocates file from source to project (source deleted)
- **Copy**: Duplicates file to project (source preserved)
- **Import**: Processes file through ImportService (always to `import/` folder)

### Visual feedback

- Drop zone border on project tree during drag
- Folder highlighting for valid drop targets
- Not-allowed cursor on files (invalid targets)
- Auto-expand collapsed folders after 1 second hover

### Conflict resolution

When a file with the same name exists at the target:
- **Replace**: Overwrites existing file
- **Keep both**: Creates auto-numbered copy (e.g., `file (1).md`)

### Keyboard shortcut

**Cmd+Shift+I** (Mac) or **Ctrl+Shift+I** (Windows/Linux):
- Opens file picker when a folder is selected in project tree
- Ignored when no folder is selected

### Security

- Path traversal patterns sanitized from filenames
- Symlinks to system directories rejected
- All operations validated within project boundary
- Special files (devices, pipes, sockets) rejected

### Technical implementation

- `useExternalFileDrop` hook handles drag detection and state
- `ExternalFileService` handles security validation and file operations
- IPC channels: `file:validateExternal`, `file:copyFromExternal`, `file:moveFromExternal`

### Batch document filtering

When multiple files are dropped simultaneously, document files (PDF, Office, images supported by LiteParse) are **filtered out** of the batch and not moved/copied. Instead:
- A warning toast notifies the user that document files require individual import
- Non-document files proceed with the normal move/copy/import flow
- To import document files, drop them individually – this opens the DocumentImportDialog with OCR, language, screenshot, and DPI options
- If required dependencies (LibreOffice, ImageMagick) are missing, a dependency-missing modal appears with install guidance

See [ui-components.md](../ui-components.md) for DocumentImportDialog details.

### Out of scope

- Folder drops (silently ignored)
- Remote/URL drops
- Drag from project tree to external destinations
