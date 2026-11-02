# Drag-Drop File Reorganization

## Overview

Erfana's project tree supports VS Code-style drag-drop file reorganization with:
- **Drag files into folders** - Visual drop indicators show target location
- **Drag folders into folders** - Nested hierarchy manipulation
- **Keyboard shortcuts** - Ctrl+X/C/V for cut/copy/paste operations
- **Cross-filesystem support** - Automatic fallback for moves across volumes
- **Conflict resolution** - Automatic numbering for copy operations; a pasted cut asks "Replace Item" first, while a drag onto a folder that already holds the name fails with an error toast
- **Feedback** - Toast notifications (`showGlobalToast`) confirm cut, copy, move and copy results and report failures; there is no ARIA live announcer (see [visual-feedback.md § Accessibility](./visual-feedback.md#accessibility))

## Quick Start

### Mouse Operations
1. **Move files/folders**: Click and drag items to new locations
2. **Auto-scroll**: Drag near the top or bottom edge to scroll – dnd-kit's own `DndContext` auto-scroll, driven by the live pointer
3. **Auto-expand**: Hover over folder for 1 second to auto-expand during drag
4. **Drop to root**: Drag items onto the project root folder (first item in tree)

### Keyboard Shortcuts

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl+X` (Windows/Linux)<br>`Cmd+X` (macOS) | Cut | Mark file/folder for move operation |
| `Ctrl+C` (Windows/Linux)<br>`Cmd+C` (macOS) | Copy | Mark file/folder for copy operation |
| `Ctrl+V` (Windows/Linux)<br>`Cmd+V` (macOS) | Paste | Move/copy marked item to selected folder |
| `Enter` | Activate | Activates the focused button of the "Replace Item" dialog, which opens with Cancel focused |
| `Escape` | Cancel | Closes the "Replace Item" dialog without replacing |

**Notes**:
- Cut items appear dimmed with dashed underline until pasted
- Paste only works when a folder is selected in the tree
- Keyboard and menu paste ask before replacing a same-named item; a mouse drag does not
- All operations respect the same validation rules

### Context Menu
Right-click any file/folder in the project tree:
- **Cut** - Same as Ctrl+X
- **Copy** - Same as Ctrl+C
- **Paste** - Same as Ctrl+V (shown only on folders, and only when the clipboard holds an item)

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
- Folder stays highlighted during the 1 s auto-expand countdown (no pulse animation)

### Robust File Operations
- Atomic operations with rollback on failure
- Symlink detection and handling
- Cross-filesystem move support (fallback to copy+delete)
- Replace confirmation when a pasted cut meets an existing name

## References

- **Main Implementation**: [src/renderer/src/components/ProjectTree/ProjectTree.tsx](../../src/renderer/src/components/ProjectTree/ProjectTree.tsx)
- **Tree Utilities**: [src/renderer/src/hooks/useDragDropTree.ts](../../src/renderer/src/hooks/useDragDropTree.ts)
- **Clipboard Store**: [src/renderer/src/stores/useClipboardStore.ts](../../src/renderer/src/stores/useClipboardStore.ts)
- **File Service**: [src/main/services/FileService.ts](../../src/main/services/FileService.ts)
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

### Drop size limit

A drop of more than 100 files (`EXTERNAL_DROP_MAX` in `src/renderer/src/components/ProjectTree/externalDropLimit.ts` – the smaller of `EXTERNAL_MOVE_BATCH_MAX` and `IMPORT.MAX_BATCH_SIZE`, both 100) is refused **before** the Move / Copy / Import choice opens, with a "Too many files" toast ("Cannot add more than 100 files at once. Please drop fewer files."). Since v0.22.0 Copy has the same limit as the Add files picker; before, the choice opened first.

### Conflict resolution

When a file with the same name exists at the target:
- **Replace**: Overwrites existing file
- **Keep both**: Creates auto-numbered copy (e.g., `file (1).md`)

### Move asks before the original is removed

A move takes the original out of a folder outside the project, so main asks first (`ExternalMoveConfirmer`, `src/main/services/ExternalMoveConfirmer.ts`, v0.22.0). The original is deleted only after the user answers **Move** in a native box, modal to the window that owns the project:

- The box names each file and its folder, relative to the home folder (`~/Downloads`), never as a full path. It says the original will be removed from its current folder. Cancel is the default button.
- **A group move asks once.** The renderer sends all the dropped files in one `file:moveBatchFromExternal` request (`moveExternalBatch` in `ProjectTree/externalMoveBatch.ts`), and main shows one box: "Move N files into the project?". Moves that arrive within 150 ms of each other also share a box.
- A box lists at most 10 files (`MAX_FILES_PER_BOX`); a larger group gets further boxes. The boxes of one drop are **one decision**: the files move only if every box answers Move. Cancel in any box, or a box that cannot be shown, moves none of them.
- A box cannot be shown when the window is minimised or hidden, or when it has already opened 10 boxes in the last minute. Then nothing is moved and one toast says so: "The confirmation box could not be shown, so none of the N files were moved. Try again in a minute, or copy them instead."
- Cancel is not an error: it shows no failure toast.

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
- `ExternalMoveConfirmer` asks before any original is removed (see [Move asks before the original is removed](#move-asks-before-the-original-is-removed))
- IPC channels: `file:validateExternal`, `file:copyFromExternal`, `file:moveFromExternal`, `file:moveBatchFromExternal` (a drop's moves, at most 100 per request), `file:selectExternalFiles` (the Add files picker)

### Batch document filtering

When a drop is added with **Import**, it goes through `processFiles` in `src/renderer/src/hooks/useImport.ts`, which skips document files (PDF, Office, images supported by LiteParse) and audio/video files. Move and Copy do not filter by type. In the Import path:
- A mixed drop shows a "Document files skipped" warning toast and imports the rest
- A drop of only document files is refused with "Document files not supported in batch"
- To import a document with OCR, language, screenshot and DPI options, use the Import command (toolbar button or a folder's **Import...** menu item), which opens the DocumentImportDialog for the one file picked
- If LibreOffice is missing (or found in an unsafe location), a dependency-missing prompt points to Settings → Import tools

See [ui-components.md](../ui-components.md) for DocumentImportDialog details.

### Out of scope

- Folder drops (silently ignored)
- Remote/URL drops
- Drag from project tree to external destinations
