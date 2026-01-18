# BRS-012: External File Drop to Project Tree

## Design Document

**Issue:** #87
**BRS Reference:** BRS-012 External File Drop to Project Tree
**Created:** 2026-01-17
**Status:** Proposed

---

## 1. Overview

This design document specifies the implementation approach for external file drop functionality, enabling users to drag files from Finder (or other file managers) directly into the Erfana project tree. The feature extends the existing internal dnd-kit drag-drop system with HTML5 DataTransfer API support for external sources.

### 1.1 Design Goals

1. **External file detection** - Distinguish external drags via DataTransfer.files from internal dnd-kit drags
2. **Drop mode selection** - Offer Move, Copy, and Import operations via dialog
3. **Hover-to-expand** - Reuse existing auto-expand timer pattern (1s delay)
4. **Conflict resolution** - Per-file Replace/Keep-both dialog for name conflicts
5. **Security validation** - Symlink checks, path traversal prevention on main process
6. **Keyboard accessibility** - Cmd+Shift+I shortcut when folder selected
7. **Silent folder rejection** - Silently ignore folder drops (files only)

### 1.2 Requirements Traceability

| Requirement | Priority | Implementation Component |
|-------------|----------|--------------------------|
| FR-001: Accept external file drops | High | useExternalFileDrop hook |
| FR-002: Visual feedback during drag | High | CSS data attributes |
| FR-003: Hover-to-expand folders | High | Reuse startAutoExpandTimer |
| FR-004: Drop mode selection dialog | High | DropModeDialog component |
| FR-005: Move operation | High | External file handlers + FileService |
| FR-006: Copy operation | High | External file handlers + FileService |
| FR-007: Import operation | High | useImport hook |
| FR-008: Validate drop target | High | useExternalFileDrop validation |
| FR-009: Multiple file drops | Medium | Batch processing in hook |
| FR-010: Conflict resolution | Medium | ConflictDialog component |
| FR-011: Reject folder drops | Medium | Detection in hook |
| NFR-001: Performance | High | 16ms feedback, non-blocking timers |
| NFR-002: Accessibility | Medium | Cmd+Shift+I keyboard shortcut |
| NFR-003: Error handling | High | Toast notifications |
| NFR-004: Security | High | Main process validation |

---

## 2. Component Architecture

### 2.1 Architecture Diagram

```
                              RENDERER PROCESS
    +--------------------------------------------------------------------+
    |                                                                     |
    |  +--------------------------------+                                 |
    |  | ProjectTree.tsx (MODIFIED)    |                                 |
    |  |                                |                                 |
    |  | - DndContext (internal drags)  |                                 |
    |  | - HTML5 native event handlers  |<-- onDragEnter, onDragOver,    |
    |  |   for external drags           |    onDragLeave, onDrop         |
    |  +----------------+---------------+                                 |
    |                   |                                                 |
    |                   v                                                 |
    |  +--------------------------------+                                 |
    |  | useExternalFileDrop (NEW)     |                                 |
    |  |                                |                                 |
    |  | - isExternalDrag state         |                                 |
    |  | - dropTargetPath state         |                                 |
    |  | - handleExternalDragEnter()    |                                 |
    |  | - handleExternalDragOver()     |                                 |
    |  | - handleExternalDragLeave()    |                                 |
    |  | - handleExternalDrop()         |                                 |
    |  | - validateDropTarget()         |                                 |
    |  | - detectExternalDrag()         |                                 |
    |  +----------------+---------------+                                 |
    |                   |                                                 |
    |       +-----------+-----------+                                     |
    |       |                       |                                     |
    |       v                       v                                     |
    |  +----------------+    +----------------+                           |
    |  | DropModeDialog |    | ConflictDialog |                          |
    |  | (NEW)          |    | (NEW)          |                          |
    |  |                |    |                |                          |
    |  | - Move btn     |    | - Replace btn  |                          |
    |  | - Copy btn     |    | - Keep both btn|                          |
    |  | - Import btn   |    | - File path    |                          |
    |  | - Cancel btn   |    |                |                          |
    |  +--------+-------+    +--------+-------+                           |
    |           |                     |                                   |
    |           v                     v                                   |
    |  +------------------------------------------+                       |
    |  | executeExternalDrop() (async)            |                       |
    |  |                                          |                       |
    |  | For each file:                           |                       |
    |  |   1. Check conflict                      |                       |
    |  |   2. Show ConflictDialog if needed       |                       |
    |  |   3. Call IPC based on drop mode         |                       |
    |  +------------------------------------------+                       |
    |                   |                                                 |
    +-------------------|-------------------------------------------------+
                        |
                        v IPC
    +--------------------------------------------------------------------+
    |                           MAIN PROCESS                              |
    |                                                                     |
    |  +--------------------------------+                                 |
    |  | external-file-handlers.ts (NEW)|                                 |
    |  |                                |                                 |
    |  | file:copyFromExternal         |                                 |
    |  | file:moveFromExternal         |                                 |
    |  | file:validateExternalFile     |                                 |
    |  +----------------+---------------+                                 |
    |                   |                                                 |
    |                   v                                                 |
    |  +--------------------------------+                                 |
    |  | ExternalFileService (NEW)      |                                 |
    |  |                                |                                 |
    |  | - validateExternalFile()       | Security checks:                |
    |  | - copyFromExternal()           | - isSymlink()                  |
    |  | - moveFromExternal()           | - isWithinProject()            |
    |  | - sanitizeFileName()           | - pathTraversalCheck()         |
    |  +--------------------------------+                                 |
    |                                                                     |
    +--------------------------------------------------------------------+
```

### 2.2 Data Flow: External File Drop

```
T+0ms      User drags file from Finder over ProjectTree
T+0ms      dragenter fires, detectExternalDrag() returns true
T+1ms      isExternalDrag = true, CSS styling activates
T+50ms     dragover fires repeatedly as user moves cursor
T+100ms    User hovers over collapsed folder
T+1100ms   Auto-expand timer fires, folder expands
T+1500ms   User drops file on target folder
T+1500ms   drop event fires
T+1501ms   Extract File objects from dataTransfer.files
T+1502ms   Show DropModeDialog
T+2000ms   User clicks "Copy"
T+2001ms   Check for conflicts via IPC
T+2002ms   Conflict found: show ConflictDialog
T+3000ms   User clicks "Keep both"
T+3001ms   IPC: file:copyFromExternal with keepBoth=true
T+3100ms   Main process validates, copies file, returns path
T+3101ms   Refresh project tree, show success toast
```

### 2.3 Data Flow: Keyboard Shortcut (Cmd+Shift+I)

```
T+0ms      User selects folder in project tree
T+500ms    User presses Cmd+Shift+I
T+501ms    Check selectedFolder state
T+502ms    selectedFolder is directory? Yes
T+503ms    IPC: dialog:openFile (native file picker)
T+5000ms   User selects file(s) in native dialog
T+5001ms   Files returned to renderer
T+5002ms   Show DropModeDialog
...        Same flow as drag-drop from T+2000ms
```

---

## 3. Implementation Plan

### Step 1: Create IPC Schema for External File Operations

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/shared/ipc/external-file-schema.ts`

**Content:**
```typescript
import { z } from 'zod'

// Request to copy/move external file into project
export const ExternalFileRequestSchema = z.object({
  sourcePath: z.string(),
  targetFolder: z.string(),
  conflictResolution: z.enum(['replace', 'keepBoth']).optional()
})
export type ExternalFileRequest = z.infer<typeof ExternalFileRequestSchema>

// Response from external file operation
export const ExternalFileResponseSchema = z.object({
  success: z.boolean(),
  path: z.string().optional(),
  error: z.string().optional(),
  isSymlink: z.boolean().optional()
})
export type ExternalFileResponse = z.infer<typeof ExternalFileResponseSchema>

// Validation response
export const ExternalFileValidationSchema = z.object({
  valid: z.boolean(),
  isSymlink: z.boolean(),
  isDirectory: z.boolean(),
  exists: z.boolean(),
  error: z.string().optional()
})
export type ExternalFileValidation = z.infer<typeof ExternalFileValidationSchema>
```

**Rationale:** Type-safe IPC contracts following established Zod schema pattern.

**Dependencies:** None

### Step 2: Create ExternalFileService

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/main/services/ExternalFileService.ts`

**Responsibilities:**
- `validateExternalFile(sourcePath, projectRoot)` - Security validation
- `copyFromExternal(sourcePath, targetFolder, options)` - Copy with conflict handling
- `moveFromExternal(sourcePath, targetFolder, options)` - Move with conflict handling
- `sanitizeFileName(name)` - Remove path traversal characters
- `isSymlink(path)` - Check if path is a symlink
- `isWithinProject(path, projectRoot)` - Ensure target is within project

**Security validations:**
1. Resolve symlinks and validate target
2. Check path doesn't escape project root
3. Sanitize filename (remove `../`, `./`, etc.)
4. Verify source file exists and is readable
5. Log all external file operations for audit

**Rationale:** Dedicated service for external file operations with security focus.

**Dependencies:** Step 1

### Step 3: Create IPC Handlers for External Files

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/main/ipc/external-file-handlers.ts`

**Handlers:**
```typescript
// Validate external file before operation
ipcMain.handle('file:validateExternal', async (_event, sourcePath: string) => {
  // Security checks, return validation result
})

// Copy external file into project
ipcMain.handle('file:copyFromExternal', async (_event, request: ExternalFileRequest) => {
  // Validate, copy, return result
})

// Move external file into project
ipcMain.handle('file:moveFromExternal', async (_event, request: ExternalFileRequest) => {
  // Validate, move, return result
})

// Open native file dialog for keyboard shortcut
ipcMain.handle('file:selectExternalFiles', async () => {
  // Show native file picker, return selected paths
})
```

**Rationale:** Thin adapter layer following existing IPC handler patterns.

**Dependencies:** Steps 1, 2

### Step 4: Update Preload API

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/preload/index.ts`

**Changes:**
Add to `api.file` section:
```typescript
// External file operations
validateExternal: (sourcePath: string): Promise<ExternalFileValidation> =>
  ipcRenderer.invoke('file:validateExternal', sourcePath),

copyFromExternal: (request: ExternalFileRequest): Promise<ExternalFileResponse> =>
  ipcRenderer.invoke('file:copyFromExternal', request),

moveFromExternal: (request: ExternalFileRequest): Promise<ExternalFileResponse> =>
  ipcRenderer.invoke('file:moveFromExternal', request),

selectExternalFiles: (): Promise<{ paths: string[] } | null> =>
  ipcRenderer.invoke('file:selectExternalFiles'),
```

**Rationale:** Expose new IPC handlers to renderer following existing patterns.

**Dependencies:** Step 3

### Step 5: Create DropModeDialog Component

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/Dialog/DropModeDialog.tsx`

**Component design:**
- Extends BaseDialog pattern from existing dialogs
- Shows source file(s) path and count
- Shows target folder path
- Three action buttons: Move, Copy, Import
- Cancel button
- Uses existing dialog CSS classes

**Props:**
```typescript
interface DropModeDialogProps {
  files: Array<{ path: string; name: string }>
  targetFolder: string
  onMove: () => void
  onCopy: () => void
  onImport: () => void
  onCancel: () => void
}
```

**Rationale:** Dedicated dialog for drop mode selection, follows ConfirmDialog pattern.

**Dependencies:** None (can parallel with Steps 1-4)

### Step 6: Create ConflictDialog Component

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/Dialog/ConflictDialog.tsx`

**Component design:**
- Shows conflicting file name and target location
- Two action buttons: Replace, Keep both
- Cancel button (skip this file)
- Warning icon (danger styling)

**Props:**
```typescript
interface ConflictDialogProps {
  fileName: string
  targetFolder: string
  onReplace: () => void
  onKeepBoth: () => void
  onCancel: () => void
}
```

**Rationale:** Per-file conflict resolution following requirements (no "Apply to all").

**Dependencies:** None (can parallel with Steps 1-4)

### Step 7: Update Dialog Types and Exports

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/Dialog/types.ts`
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/Dialog/index.ts`
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/Dialog/DialogContext.tsx`

**Changes:**
1. Add `DropModeDialogConfig` and `ConflictDialogConfig` types
2. Add `showDropMode` and `showConflict` methods to DialogContext
3. Export new dialog components

**Rationale:** Integrate new dialogs into unified dialog framework.

**Dependencies:** Steps 5, 6

### Step 8: Create useExternalFileDrop Hook

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/hooks/useExternalFileDrop.ts`

**Hook responsibilities:**
1. Detect external drags via `dataTransfer.types.includes('Files')`
2. Manage drag state (`isExternalDrag`, `dropTargetPath`)
3. Validate drop targets (folders only, within project)
4. Provide event handlers for native drag events
5. Filter out directories from dropped files
6. Extract file paths using `window.api.utils.getPathForFile()`

**Interface:**
```typescript
interface UseExternalFileDropReturn {
  // State
  isExternalDrag: boolean
  dropTargetPath: string | null

  // Event handlers
  handleDragEnter: (e: DragEvent, nodePath: string, nodeType: 'file' | 'directory') => void
  handleDragOver: (e: DragEvent) => void
  handleDragLeave: (e: DragEvent) => void
  handleDrop: (e: DragEvent) => Promise<void>

  // Utilities
  isValidDropTarget: (nodeType: 'file' | 'directory') => boolean
}
```

**Rationale:** Encapsulate external drag-drop logic separate from internal dnd-kit.

**Dependencies:** Step 4

### Step 9: Integrate External Drop into ProjectTree

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/ProjectTree/ProjectTree.tsx`

**Changes:**
1. Import and use `useExternalFileDrop` hook
2. Add native drag event handlers to tree container
3. Integrate `isExternalDrag` state with CSS data attributes
4. Reuse `startAutoExpandTimer` for external drag hover-to-expand
5. Call `showDropMode` dialog on drop
6. Execute file operations based on dialog result

**Integration points:**
- `treeContainerRef` element gets `onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop`
- CSS attribute `data-external-drag` for styling
- Auto-expand timer shared between internal and external drags

**Rationale:** Extend existing ProjectTree with external drop support.

**Dependencies:** Steps 7, 8

### Step 10: Add CSS Styles for External Drop

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/ProjectTree/ProjectTree.css`

**Changes:**
```css
/* External drag zone active */
.project-tree-content[data-external-drag="true"] {
  outline: var(--border-width-thick) dashed var(--color-accent-drag);
  outline-offset: -2px;
}

/* Valid external drop target */
.project-tree-item[data-external-drop-target="true"].directory {
  background-color: var(--color-accent-drag-bg);
  border-radius: var(--border-radius);
}

/* Invalid external drop target (file) */
.project-tree-item[data-external-drop-invalid="true"] {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}
```

**Rationale:** Distinct visual feedback for external drags using design tokens.

**Dependencies:** None (can parallel)

### Step 11: Add Keyboard Shortcut (Cmd+Shift+I)

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/ProjectTree/ProjectTree.tsx`

**Changes:**
Add to existing `useEffect` with keyboard shortcuts:
```typescript
// Cmd+Shift+I - Add external file (when folder selected)
if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'i') {
  e.preventDefault()

  // Only active when a folder is selected
  if (!selectedFolder) return
  const node = flattenedItems.find(item => item.path === selectedFolder)
  if (!node || node.type !== 'directory') return

  // Open file picker and show drop mode dialog
  handleKeyboardExternalFile(selectedFolder)
}
```

**Rationale:** Keyboard accessibility requirement (NFR-002).

**Dependencies:** Steps 7, 8, 9

### Step 12: Register IPC Handlers in Main Process

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/main/index.ts`

**Changes:**
```typescript
import { registerExternalFileHandlers } from './ipc/external-file-handlers'

// In app.whenReady()
registerExternalFileHandlers()
```

**Rationale:** Initialize external file handlers at app startup.

**Dependencies:** Step 3

### Step 13: Add Test IDs

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/constants/testids.ts`

**Changes:**
```typescript
// External file drop dialogs
DIALOG_DROP_MODE: 'dialog-drop-mode',
DIALOG_DROP_MODE_BTN_MOVE: 'dialog-drop-mode-btn-move',
DIALOG_DROP_MODE_BTN_COPY: 'dialog-drop-mode-btn-copy',
DIALOG_DROP_MODE_BTN_IMPORT: 'dialog-drop-mode-btn-import',
DIALOG_CONFLICT: 'dialog-conflict',
DIALOG_CONFLICT_BTN_REPLACE: 'dialog-conflict-btn-replace',
DIALOG_CONFLICT_BTN_KEEP_BOTH: 'dialog-conflict-btn-keep-both',
```

**Rationale:** Enable E2E testing of new components.

**Dependencies:** Steps 5, 6

### Step 14: Create Unit Tests

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/main/services/ExternalFileService.test.ts`
- `/Users/marcinobel/Projects/erfana/src/main/ipc/external-file-handlers.test.ts`
- `/Users/marcinobel/Projects/erfana/src/renderer/src/hooks/useExternalFileDrop.test.ts`

**Test coverage:**
1. Security validation (symlinks, path traversal)
2. Copy operation with conflict resolution
3. Move operation with conflict resolution
4. External drag detection logic
5. Drop target validation

**Rationale:** Unit test coverage for critical functionality.

**Dependencies:** Steps 2, 3, 8

### Step 15: Update Documentation

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/docs/drag-drop/README.md`

**Changes:**
Add "External file drop" section documenting:
- How external drops are detected
- Drop mode options
- Conflict resolution behavior
- Keyboard shortcut
- Security considerations

**Rationale:** Keep documentation up-to-date per Definition of Done.

**Dependencies:** All previous steps

---

## 4. File Changes Summary

### New Files (9)

| Path | Action | Description |
|------|--------|-------------|
| `src/shared/ipc/external-file-schema.ts` | create | Zod schemas for external file IPC |
| `src/main/services/ExternalFileService.ts` | create | Security-focused external file service |
| `src/main/ipc/external-file-handlers.ts` | create | IPC handlers for external files |
| `src/renderer/src/components/Dialog/DropModeDialog.tsx` | create | Drop mode selection dialog |
| `src/renderer/src/components/Dialog/ConflictDialog.tsx` | create | File conflict resolution dialog |
| `src/renderer/src/hooks/useExternalFileDrop.ts` | create | External drop detection hook |
| `src/main/services/ExternalFileService.test.ts` | create | Unit tests for service |
| `src/main/ipc/external-file-handlers.test.ts` | create | Unit tests for handlers |
| `src/renderer/src/hooks/useExternalFileDrop.test.ts` | create | Unit tests for hook |

### Modified Files (8)

| Path | Action | Description |
|------|--------|-------------|
| `src/preload/index.ts` | modify | Add external file IPC methods |
| `src/renderer/src/components/Dialog/types.ts` | modify | Add dialog config types |
| `src/renderer/src/components/Dialog/index.ts` | modify | Export new dialogs |
| `src/renderer/src/components/Dialog/DialogContext.tsx` | modify | Add showDropMode, showConflict |
| `src/renderer/src/components/ProjectTree/ProjectTree.tsx` | modify | Integrate external drop |
| `src/renderer/src/components/ProjectTree/ProjectTree.css` | modify | Add external drop styles |
| `src/renderer/src/constants/testids.ts` | modify | Add test IDs |
| `src/main/index.ts` | modify | Register handlers |
| `docs/drag-drop/README.md` | modify | Document feature |

---

## 5. Test Strategy

### 5.1 Coverage Target

**Target:** 80% coverage

### 5.2 Test Types

- **Unit tests** - ExternalFileService, external-file-handlers, useExternalFileDrop
- **Integration tests** - IPC flow, dialog interactions
- **E2E tests** - Full drop workflow via Playwright (optional)

### 5.3 Test Files

| File | Focus |
|------|-------|
| `ExternalFileService.test.ts` | Security validation, file operations |
| `external-file-handlers.test.ts` | IPC handler validation, error handling |
| `useExternalFileDrop.test.ts` | Drag detection, target validation |

### 5.4 Key Scenarios (Mapping to Acceptance Criteria)

| Scenario | Test Case | FR/NFR |
|----------|-----------|--------|
| External drag detection | TC-001 | FR-001 |
| Visual drop indicators | TC-002 | FR-002 |
| Hover-to-expand | TC-003 | FR-003 |
| Drop mode dialog | TC-004 | FR-004 |
| Move operation | TC-005 | FR-005 |
| Copy operation | TC-006 | FR-006 |
| Import operation | TC-007 | FR-007 |
| Drop on file rejected | TC-008 | FR-008 |
| Drop outside project rejected | TC-009 | FR-008 |
| Multiple file drop | TC-010 | FR-009 |
| Conflict - replace | TC-011 | FR-010 |
| Conflict - keep both | TC-012 | FR-010 |
| Batch conflict resolution | TC-013 | FR-010 |
| Performance 16ms feedback | TC-014 | NFR-001 |
| Keyboard Cmd+Shift+I (folder selected) | TC-015 | NFR-002 |
| Keyboard shortcut (no folder) | TC-015b | NFR-002 |
| Error - source deleted | TC-016 | NFR-003 |
| Error - permission denied | TC-017 | NFR-003 |
| Security - symlink validation | TC-018 | NFR-004 |
| Security - path traversal | TC-019 | NFR-004 |
| Folder drop rejection | TC-020 | FR-011 |

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| DnD-kit interference with native events | Medium | High | Separate event handling paths, native events on container |
| Symlink to sensitive file read | Low | High | Resolve symlinks before validation, block system paths |
| Path traversal in filename | Medium | High | Sanitize all filenames on main process |
| Large file freeze UI | Low | Medium | Show progress indicator, use streaming copy |
| Cross-platform drag format differences | Medium | Medium | Test on macOS, document known limitations |
| Auto-expand conflicts with internal drag | Low | Medium | Share timer logic, reset on drag type change |

---

## 7. Verification Criteria

**Phase 8 (Implementation Verification) Checklist:**

- [ ] External drags from Finder detected and distinguished from internal drags
- [ ] Visual feedback appears within 16ms of dragenter
- [ ] Folders auto-expand after 1 second hover during external drag
- [ ] DropModeDialog appears on drop with Move/Copy/Import options
- [ ] Move operation removes source file
- [ ] Copy operation preserves source file
- [ ] Import operation uses existing ImportService (saves to import/)
- [ ] Drops on files rejected with appropriate cursor
- [ ] Drops outside project root rejected
- [ ] Multiple file drops show count in dialog
- [ ] ConflictDialog appears per-file for conflicts
- [ ] "Replace" overwrites existing file
- [ ] "Keep both" creates auto-numbered filename
- [ ] Cmd+Shift+I opens file picker when folder selected
- [ ] Cmd+Shift+I does nothing when no folder selected
- [ ] Folder drops silently rejected (no error message)
- [ ] Symlinks resolved and validated
- [ ] Path traversal characters sanitized
- [ ] All external file operations logged
- [ ] Unit test coverage > 80%
- [ ] No regression in internal drag-drop functionality
- [ ] All 21 acceptance test cases addressable

---

## 8. Estimates

| Metric | Value |
|--------|-------|
| Complexity | Medium |
| Files affected | 17 (9 new, 8 modified) |
| New files | 9 |
| Test files | 3 |
| Estimated effort | 4-6 days |

---

## 9. Patterns to Follow

From codebase exploration:

1. **Singleton services** - Use `export const service = new Service()` pattern
2. **Zod schemas** - All IPC types defined in `src/shared/ipc/` with Zod validation
3. **IPC handlers** - Follow `registerXxxHandlers()` pattern
4. **Dialog pattern** - Extend BaseDialog, use DialogContext for Promise-based API
5. **Hook pattern** - Custom hooks in `src/renderer/src/hooks/`
6. **CSS data attributes** - Use `data-*` for state-based styling
7. **Design tokens** - All CSS uses `var(--color-*)`, `var(--space-*)` etc.
8. **Logger usage** - Use `logger` from LoggingService in main process
9. **Test IDs** - Add to `testids.ts` for E2E testing

## 10. Patterns to Avoid

1. **Class components** - Use functional React with hooks
2. **Hardcoded CSS values** - Use design tokens only
3. **Direct console.log** - Use logger facades
4. **Inline event handlers** - Use useCallback for performance
5. **Blocking operations** - Use async/await, show progress for long ops
6. **Trusting external input** - Always validate on main process

---

*Design document created following BRS-012 specification and established codebase patterns.*
