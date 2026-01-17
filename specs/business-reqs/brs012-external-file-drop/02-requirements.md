# Requirements

## Functional requirements

### FR-001: Accept external file drops on project tree

**Priority**: High
**Traces to**: Overview/Scope

The project tree component must detect and accept file drops from external sources (Finder, other file managers, desktop) using the HTML5 DataTransfer API. External drags are distinguished from internal dnd-kit drags by the presence of `dataTransfer.files` in the drag event.

**Acceptance**: External file drag from Finder triggers drop zone activation in project tree.

---

### FR-002: Visual feedback during external drag

**Priority**: High
**Traces to**: Overview/Scope

During external drag operations, the project tree must provide clear visual feedback indicating:
- Valid drop targets (folders) with highlight styling
- Invalid drop targets (files, root when not folder) with disabled styling
- Current hover target with distinct highlight

Reuse existing CSS classes from internal drag-drop: `.drop-zone-active`, `.drop-indicator`.

**Acceptance**: Visual indicators appear immediately when dragging external file over project tree.

---

### FR-003: Hover-to-expand folders during external drag

**Priority**: High
**Traces to**: Overview/Scope

When hovering over a collapsed folder during external drag, the folder must automatically expand after the configured delay (AUTO_EXPAND.HOVER_DELAY = 1000ms) to allow dropping into subfolders.

Reuse existing auto-expand timer logic from useDragDropTree.ts.

**Acceptance**: Collapsed folder expands after 1 second hover during external drag.

---

### FR-004: Drop mode selection dialog

**Priority**: High
**Traces to**: Overview/Scope

When a file is dropped, display a dialog offering three options:
1. **Move** - Move file from source location to target folder
2. **Copy** - Copy file to target folder (source unchanged)
3. **Import** - Process through ImportService (type detection, conversion)

Dialog must show:
- Source file path(s)
- Target folder path
- Clear action buttons for each mode
- Cancel option

**Acceptance**: Dialog appears on drop with all three options functional.

---

### FR-005: Move operation

**Priority**: High
**Traces to**: FR-004

When user selects "Move", relocate the file from its source location to the target folder using FileService.moveItem(). The source file is deleted after successful move.

**Acceptance**: File appears in target folder; source file no longer exists.

---

### FR-006: Copy operation

**Priority**: High
**Traces to**: FR-004

When user selects "Copy", duplicate the file to the target folder using FileService.copyItem(). The source file remains unchanged.

**Acceptance**: File appears in target folder; source file still exists at original location.

---

### FR-007: Import operation

**Priority**: High
**Traces to**: FR-004

When user selects "Import", trigger the existing import flow via ImportService/useImport hook. This allows:
- File type detection
- Appropriate conversion (e.g., PDF to markdown)
- Import configuration dialog if needed

**Note**: Import always saves to the `import/` directory (existing ImportService behavior), regardless of which folder the file was dropped on. The drop target folder is ignored for import operations.

**Acceptance**: Import flow launches with dropped file; result saved to `import/` directory.

---

### FR-008: Validate drop target

**Priority**: High
**Traces to**: Overview/Scope

Drop operations must be validated to ensure:
- Target is a folder (not a file)
- Target is within the current project root
- User has write permissions to target folder

Invalid drops are rejected with appropriate visual feedback (cursor change, no drop indicator).

**Acceptance**: Drops on files or outside project root are rejected with feedback.

---

### FR-009: Handle multiple file drops

**Priority**: Medium
**Traces to**: Overview/Scope

When multiple files are dropped simultaneously, process all files with the same selected operation (move/copy/import). Show:
- Count of files being processed
- Progress indication for batch operations
- Summary of results (success/failure count)

**Acceptance**: Dropping 3 files shows count in dialog; all 3 processed with selected operation.

---

### FR-010: Conflict resolution

**Priority**: Medium
**Traces to**: Overview/Scope

When a file with the same name already exists at the target location, prompt user with options:
- **Replace** - Overwrite existing file
- **Keep both** - Rename new file with auto-increment (e.g., "file (1).md", "file (2).md")

For batch operations with multiple conflicts, show the conflict dialog for each file individually. No "Apply to all" option - user decides per-file.

**Acceptance**: Dropping file with existing name shows conflict dialog; batch drops show dialog per conflict.

---

### FR-011: Reject folder drops silently

**Priority**: Medium
**Traces to**: Overview/Out of scope

When a folder (directory) is dropped instead of a file, the operation is silently rejected:
- No error message or toast displayed
- No visual feedback beyond standard "not allowed" cursor during drag
- Drop operation simply does nothing

This behavior is intentional - folder drops are out of scope for this feature.

**Acceptance**: Dropping a folder on project tree does nothing; no error shown.

---

## Non-functional requirements

### NFR-001: Performance

**Priority**: High
**Traces to**: Overview/Success criteria

Drag feedback must be smooth with no visible lag:
- Drop zone indicators appear within 16ms of drag enter
- Hover target updates within 16ms of mouse movement
- Auto-expand timer does not block UI thread

**Measurement**: No frame drops (>16ms) during drag operations.

---

### NFR-002: Accessibility

**Priority**: Medium
**Traces to**: Overview/Scope

Provide keyboard alternatives for users who cannot use drag-and-drop:
- Keyboard shortcut Cmd+Shift+I to trigger "Add external file" dialog
- Shortcut is only active when a folder is selected in the project tree
- When no folder selected, shortcut does nothing (no error, no feedback)
- File picker dialog opens to select external file(s)
- Same move/copy/import options available after file selection

**Measurement**: All drop functionality accessible via keyboard when folder selected.

---

### NFR-003: Error handling

**Priority**: High
**Traces to**: Overview/Success criteria

All failure scenarios must provide clear, actionable feedback:
- Source file not found (moved/deleted during drag)
- Permission denied on target folder
- Disk full during copy/move
- Import failure (unsupported format, conversion error)

Error messages must include:
- What went wrong
- Which file(s) affected
- Suggested action to resolve

**Measurement**: All error scenarios show user-friendly messages with resolution hints.

---

### NFR-004: Security

**Priority**: High
**Traces to**: -

Validate all external file operations for security:
- Verify dropped file paths are real files (not symlinks to sensitive locations)
- Restrict operations to within project boundary
- Sanitize file names to prevent path traversal
- Log external file operations for audit

**Measurement**: No arbitrary file access outside project root possible.
