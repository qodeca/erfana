# Architecture
*Live architecture overview. Past refactoring reviews and retrospectives → [`architecture-reviews/`](./architecture-reviews/).*

## Three-Process Model

1. **Main Process** (`src/main/`): Node.js environment
   - Window lifecycle, file system, native OS integration
   - IPC request handlers

2. **Preload Script** (`src/preload/`): Secure bridge
   - Exposes APIs via `contextBridge`
   - Type-safe IPC channels
   - NO direct Node.js access in renderer

3. **Renderer Process** (`src/renderer/`): React UI
   - Hybrid SplitviewReact + DockviewReact layout system
   - No Node.js integration (security)

## Hybrid Layout Architecture

Erfana uses a **hybrid architecture** matching VS Code's actual implementation pattern.

### Why Hybrid Architecture?

**Problem Solved**: DockviewReact is designed for tabbed docking panels (like editor tabs), NOT basic layout splits. Using it for a 3-column layout caused panels to have `flexGrow: 0`, breaking resize functionality.

**Solution**: Use the right tool for each job:
- **SplitviewReact**: Outer 3-column layout with working resize handles
- **DockviewReact**: Center area only, for editor file tabs

### Architecture Layers

```
SplitviewReact (outer horizontal 3-column split)
  ├─ Left: ProjectPanelWrapper (170-600px, resizable)
  │   └─ Wraps ProjectTree component
  ├─ Center: EditorAreaSplitPanel (400px min, flex-fills remaining)
  │   └─ Contains DockviewReact for tabbed editors
  └─ Right: TerminalSplitPanel (170-600px)
      └─ Separate panels, only one visible at a time
```

**SplitviewReact** (outer layer):
- 3-column horizontal split with resizable dividers ✅
- Proper flex-grow behavior (center auto-fills space) ✅
- Built-in resize handles that actually work ✅
- Min/max constraints enforced ✅

**DockviewReact** (center panel only):
- Tabbed docking for editor files
- Tab drag-and-drop reordering
- Multi-file editing with independent states
- Each opened file = new tab in DockviewReact

**Key Components**:
- `ProjectPanelWrapper` - Splitview panel wrapping ProjectTree
- `EditorAreaSplitPanel` - Splitview panel containing nested DockviewReact
- `TerminalSplitPanel` - Splitview panel for terminal (mutually exclusive with Git)
 

**Panel Communication**: DockviewApi passed via params to ProjectPanelWrapper for opening files as tabs.

Reference: [Dockview Documentation](https://dockview.dev/)

## Directory Structure

```
src/
├── main/
│   ├── index.ts                 # Main process entry
│   ├── services/                # Business logic (OOP)
│   │   ├── FileService.ts       # File operations + rename
│   │   ├── FileWatcherService.ts    # File content auto-refresh
│   │   ├── DirectoryWatcherService.ts  # Directory tree auto-refresh
│   │   ├── SettingsService.ts   # Persistent settings (electron-store)
│   │   ├── GlobalSettingsService.ts  # App-wide settings (~/.erfana/)
│   │   ├── LoggingService.ts    # File-based logging with rotation
│   │   ├── GitStatusService.ts  # Git status orchestrator (delegates to worker)
│   │   ├── GitStatusWorkerAdapter.ts  # worker_threads adapter (IGitStatusWorker)
│   │   ├── GitStatusCircuitBreaker.ts # Per-project + global crash tracking
│   │   ├── GitWatcherService.ts # Git state file watching (v0.6.3)
│   │   ├── GitPollingService.ts # Hybrid polling fallback (v0.6.3)
│   │   ├── ProjectLockService.ts # Multi-instance project locking (v0.6.5)
│   │   ├── ProjectService.ts    # Project switching orchestration
│   │   ├── PdfService.ts        # PDF export
│   │   ├── DocxService.ts       # DOCX export
│   │   ├── TranscriptionService.ts  # OpenAI audio transcription with chunking
│   │   ├── LocalWhisperService.ts   # Local whisper.cpp transcription (macOS universal + Windows x64, Phase 4 #165)
│   │   ├── WhisperModelManager.ts   # Whisper binary + model downloads; 9-step install flow with trust chain
│   │   ├── whisper-assets.ts        # Pinned release spec + classifyPlatform (Phase 4)
│   │   ├── whisper-pubkeys.ts       # Dual minisign pubkeys: primary (CI) + rotation (offline) (Phase 4)
│   │   ├── AudioMetadataService.ts  # Audio metadata extraction (music-metadata)
│   │   ├── AudioExtractionService.ts # Video → audio extraction (ffmpeg)
│   │   ├── ApiKeyService.ts     # Encrypted API key storage (Electron safeStorage)
│   │   ├── TerminalService.ts   # PTY management with node-pty
│   │   ├── workers/             # worker_threads scripts (git-status.worker.ts)
│   │   ├── watcher/             # ThrottledWorker (offset-deque, #173), EventCoalescer, AtomicSaveDetector, WatcherMetrics
│   │   └── import/converters/   # LiteParseConverter, Audio/VideoConverter, TextConverter (IConverter)
│   ├── interfaces/
│   │   └── IGitStatusWorker.ts  # Worker adapter interface
│   ├── ipc/
│   │   ├── file-handlers.ts     # IPC handlers
│   │   ├── file-watcher-handlers.ts  # File watching IPC
│   │   ├── directory-watcher-handlers.ts  # Directory watching IPC
│   │   ├── logging-handlers.ts  # Logging IPC (getLevel, getLogsDir, openLogsFolder)
│   │   ├── git-watcher-handlers.ts # Git watching IPC
│   │   ├── project-lock-handlers.ts # Project lock IPC
│   │   ├── import-handlers.ts   # Document import IPC (LiteParse)
│   │   ├── transcription-handlers.ts # Transcription IPC
│   │   └── terminal-handlers.ts # Terminal emulator IPC
│   └── utils/
│       ├── PauseController.ts   # Pause/resume with safety timeout
│       ├── RateLimitedLogger.ts # Cooldown-based log deduplication
│       ├── validateFilename.ts  # Phase 2 #161: assertValid + deriveSafe, Unicode bidi-strip
│       └── {zipArchive,tarArchive,secureDownloader,verifyManifest}.ts  # Phase 4 trust chain (#165)
├── preload/
│   ├── index.ts              # contextBridge setup
│   └── index.d.ts            # TypeScript definitions
└── renderer/
    └── src/
        ├── assets/              # Vendored fonts (Cascadia Mono) and static assets
        ├── components/
        │   ├── DockLayout/      # Hybrid SplitviewReact + DockviewReact
        │   ├── ActivityBar/     # Vertical activity bars (left/right)
        │   ├── Panels/          # Panel implementations + WelcomePanel
        │   ├── Editor/          # Monaco + Preview + Context Menus
        │   ├── ProjectTree/     # Project tree with context menu
        │   ├── Tabs/            # EditorTab, WelcomeTab (Chrome-style tabs)
        │   ├── Dialog/          # Unified dialog system (Context + Provider + Hook)
        │   ├── ContextMenu/     # Right-click context menu
        │   ├── Toast/           # Toast notification system
        │   ├── Settings/        # Settings overlay
        │   └── Transcription/   # TranscriptionDialog, LanguageSelect
        ├── constants/           # Shared renderer constants
        ├── context/             # React contexts (ProjectManagementContext, TerminalPortalContext)
        ├── hooks/               # React hooks
        ├── interfaces/          # Renderer-only TypeScript interfaces
        ├── prompts/             # Prompt template system
        │   ├── templates/       # Markdown templates with YAML frontmatter
        │   ├── parser.ts        # CSP-safe YAML parser
        │   ├── renderer.ts      # Template renderer (Handlebars-style)
        │   ├── schema.ts        # Zod validation
        │   ├── registry.ts      # Dynamic template loading
        │   ├── helpers.ts       # Template helper functions
        │   └── types.ts         # TypeScript interfaces
        ├── providers/           # React provider components
        ├── services/            # Renderer-side services (textClipboard transport)
        ├── stores/              # Zustand stores (ActivityBar, Settings, GlobalSettings, Transcription)
        ├── styles/              # Global stylesheets
        │   ├── fonts.css            # @font-face declarations (Cascadia Mono)
        │   ├── design-tokens.css    # Design system tokens (colors, spacing, typography)
        │   ├── utilities.css        # Cross-cutting CSS policies (text-selection, etc.)
        │   └── userSelect.audit.test.ts  # Raw-CSS policy audit (#211/#228)
        ├── test-utils/          # Vitest helpers for renderer-side tests
        ├── types/               # Shared TypeScript types (filters.ts)
        ├── utils/               # Shared utilities (fileUtils.ts, panelUtils.ts, platform.ts)
        ├── App.css              # Root layout styles
        ├── App.tsx              # Root component
        ├── index.css            # Global stylesheet entry (imports fonts/tokens/utilities)
        └── main.tsx
```

## Key Design Decisions

- **Hybrid Layout System**: SplitviewReact (outer) + DockviewReact (center) matches VS Code pattern
- **OOP Services**: Business logic in service classes
  - FileService: File operations (read, write, create, rename, delete)
  - FileWatcherService: Auto-reload files on external changes (300ms debounce)
  - DirectoryWatcherService: Auto-refresh file tree on create/delete/rename and in-place edits (75 ms collect + 200 ms throttle main side, 250 ms renderer debounce; ignored patterns; `.git/` content events suppressed in favor of `GitWatcherService`)
  - SettingsService: Persistent storage with electron-store (dynamic ES Module import)
  - TerminalService: Terminal emulator with xterm.js + node-pty (PTY lifecycle, auto-resize)
- **Auto-Refresh**: Chokidar-based watching with pause/resume race prevention
  - Session token guards drop stale events during project switches
  - Configurable depth cap (settings-driven) to limit recursion in large projects
- **Secure IPC**: All main↔renderer communication via contextBridge
- **State Management**: Zustand for activity bar state (sidebar widths, active panels)
- **Component Registry**: Splitview and Dockview use string-based component lookup
- **Multi-model Editor**: Single Monaco instance, swap models per file
- **Worker thread offloading**: Git status runs in a `worker_threads` Worker to keep the main thread responsive. Three-layer design: `IGitStatusWorker` (interface) → `GitStatusWorkerAdapter` (wraps worker_threads) → `git-status.worker.ts` (runs isomorphic-git or native git). Circuit breaker disables worker after repeated crashes. Strategy selector uses `.git/index` file size to choose between isomorphic-git (small repos) and native `git status --porcelain` (large repos). See [API Services – Features](./api-services-features.md) for details.
- **Mermaid Integration**: Client-side diagram rendering (22 types) with dark theme
- **Prompt Template System**: CSP-compliant markdown templates with Handlebars-style syntax for context menu AI prompts (see [Prompt Templates](./prompts/README.md))
- **Line Range Tracking**: Enhanced markdown preview with `data-line-start/end` attributes for accurate source mapping
- **Project Persistence**: Auto-loads last opened project on startup
- **Shared Utilities**: `types/` for shared TypeScript types (FilterMode), `utils/` for shared functions (sanitizeFilePath, isMarkdownFile, panelUtils)

## Activity Bar System

Dual vertical activity bars (VS Code-style):

**Left Activity Bar**: Project panel toggle — `Cmd/Ctrl+B`.
**Right Activity Bar**: Terminal toggle — `Cmd/Ctrl+J`.

**Components**:
- `ActivityBar.tsx` - Container component
- `ActivityBarItem.tsx` - Individual clickable item
- `ActivityBarBadge.tsx` - Badge system for notifications
- `activityBarConfig.ts` - Panel configuration

**State**: Managed by `useActivityBarStore` (Zustand), persists sidebar widths and active panels.

## Dialog System

**Unified Dialog Framework** (following Toast system pattern):

**Architecture**:
- **Context + Provider + Hook**: `DialogContext.tsx` provides `useDialog()` hook
- **Promise-based API**: `showConfirm()`, `showPrompt()`, `showAlert()` return Promises
- **Auto-incrementing Z-index**: Supports stacked dialogs
- **Portal rendering**: All dialogs render to `#portal-root`
- **Shared styling**: `Dialog.css` with CSS variables for consistent theming

**Components**:
- `DialogContext.tsx` - Context, Provider, and useDialog hook
- `DialogManager.tsx` - Renders active dialogs from context
- `BaseDialog.tsx` - Shared dialog logic (keyboard, focus, backdrop)
- `ConfirmDialog.tsx` - Confirmation dialogs (confirm/cancel with danger mode)
- `PromptDialog.tsx` - Text input dialogs (validation, character count)
- `AlertDialog.tsx` - Simple alert dialogs (single OK button)
- `dialogService.ts` - Non-React imperative API for global dialogs

**Usage**:
```typescript
// Before: 20+ lines of boilerplate
const [confirmDialog, setConfirmDialog] = useState(null)
setConfirmDialog({ title: 'Delete', message: '...', onConfirm: ... })
{confirmDialog && <ConfirmDialog {...confirmDialog} />}

// After: 2-3 lines
const { showConfirm } = useDialog()
const confirmed = await showConfirm({ title: 'Delete', message: '...', danger: true })
if (confirmed) await deleteFile()
```

**Benefits**:
- 85% code reduction per dialog usage
- Consistent UX across all dialogs
- No manual state management required
- Type-safe API with full TypeScript support
- Focus management and keyboard shortcuts built-in

### File System Dialogs (SOLID Architecture)

**SOLID Principles Applied** to file/folder creation and rename operations:

**Base Component**: `FileSystemDialog.tsx`
- Consolidates common logic for file system operations
- Shared validation, keyboard shortcuts, focus management, UI consistency
- Configurable via props: `itemType` (file/folder), `operation` (create/rename), `parentPath`, `currentName`
- Single Responsibility Principle: One component, one clear purpose

**Validation Utilities**: `utils/fileValidation.ts`
- Cross-platform validation logic extracted to reusable module
- Handles 6 validation error codes:
  - `EMPTY` - Name cannot be empty
  - `TOO_LONG` - Exceeds 255 character limit
  - `INVALID_CHARS` - Contains forbidden characters (/\?*:|"<>)
  - `RESERVED` - Windows reserved names (CON, PRN, AUX, COM1-9, LPT1-9)
  - `UNCHANGED` - Rename operation with same name
  - `DUPLICATE` - Case-insensitive duplicate detection
- Edge cases: Dotfiles (`.CON` is valid, `CON` without dot is reserved)
- Function: `validateFileSystemName(name, existingNames?, currentName?, itemType?)`

**Wrapper Components** (Thin wrappers following Open/Closed Principle):
- `NewFileDialog.tsx` - Configures FileSystemDialog for file creation
- `NewFolderDialog.tsx` - Configures FileSystemDialog for folder creation
- `RenameDialog.tsx` - Configures FileSystemDialog for rename (file ↔ folder)
- Each wrapper: ~50 lines, just props configuration and icon selection
- Easy to add new file system dialog types without modifying base component

**Features**:
- Auto-focus input on mount (select-all for rename operations)
- Character counter with visual feedback (0/255 characters)
- Inline validation errors below input field
- Error class styling (red border when validation fails)
- Keyboard shortcuts: Enter to submit, Esc to cancel
- Submit button disabled when input invalid/empty
- Context display showing parent path (e.g., "in /project/docs")

**Test Coverage**: 129 tests (see [Testing](./testing/README.md#dialog-system))
- `fileValidation.test.ts` - 80 tests covering all validation scenarios
- `FileSystemDialog.test.tsx` - 49 tests covering component behavior
- `WrapperDialogs.test.tsx` - Integration tests for wrapper components

**Benefits of SOLID Refactoring**:
- DRY: Eliminated duplication across 3 dialog types
- Maintainability: Single source of truth for validation logic
- Testability: Validation logic testable independently of UI
- Extensibility: Easy to add new file system operations
- Type Safety: Shared TypeScript interfaces enforce consistency

## Drag-Drop File Reorganization

**VS Code-style drag-drop** for project tree file/folder manipulation.

### Architecture Overview

**Three-layer system**:
1. **Backend Layer** (`FileService`): File system operations with cross-filesystem fallback
2. **IPC Layer** (`file-handlers`): Secure bridge with input sanitization
3. **Frontend Layer** (`ProjectTree` + `useDragDropTree`): Tree manipulation algorithms + UI

### Core Components

**FileService Methods** (`src/main/services/FileService.ts`):
- `moveItem(source, target, newName?)` - Move with fs.rename + copy/delete fallback for EXDEV
- `copyItem(source, target, newName?)` - Copy with automatic name conflict numbering (1), (2), etc.
- `checkNameConflict(targetPath, itemName)` - Case-insensitive duplicate detection

**Tree Algorithm Hook** (`src/renderer/src/hooks/useDragDropTree.ts`):
- `flattenTree()` - Convert hierarchy to flat array with depth/parent metadata
- `buildTree()` - Reconstruct hierarchy from flat array
- `getProjection()` - Calculate target depth/parent based on horizontal drag offset
- `isDescendant()` - Detect circular move attempts (folder into its own subfolder)
- `validateMove()` - Validate all constraints before operation

**Clipboard Store** (`src/renderer/src/stores/useClipboardStore.ts`):
- Zustand store for cut/copy/paste state management
- Cut: Move operation, clears clipboard after paste
- Copy: Copy operation, keeps clipboard for multiple pastes
- Visual feedback via `data-clipboard-cut` attribute

### Key Design Decisions

**dnd-kit Library Choice**:
- Chosen over alternatives for small bundle size (10kb vs 96kb)
- Tree flattening strategy compatible with dnd-kit's flat array expectation
- `useSortable` hook per tree node, `DndContext` + `SortableContext` at container level

**Cross-Filesystem Move Pattern**:
```typescript
try {
  await fsRename(sourcePath, targetPath)  // Fast atomic rename
} catch (error) {
  if (error.code === 'EXDEV') {
    await cp(sourcePath, targetPath, { recursive: true })  // Fallback
    await rm(sourcePath, { recursive: true, force: true })
  }
}
```
- Try `fs.rename()` first (instant for same filesystem)
- Fallback to `copy + delete` on EXDEV error (cross-volume moves)
- Preserves timestamps with `preserveTimestamps: true`

**Watcher Synchronization**:
- Problem: File watcher triggers refresh during move, causing stale tree state
- Solution: Pause watcher → execute operation → refresh tree → resume watcher
- Pattern used for all file mutations (drag-drop, keyboard shortcuts, context menu)

**Tree Flattening Algorithm**:
```typescript
interface FlattenedNode extends FileNode {
  parentId: string | null  // Track parent for hierarchy reconstruction
  depth: number           // Track depth for indentation/projection
  index: number           // Track sibling order
}
```
- Depth-first traversal preserves visual order
- Metadata enables validation (circular move detection)
- Memoized via `useMemo(() => flattenTree(files), [files])`

### Validation Constraints

**Circular Move Prevention**:
- Cannot drag folder into its own descendant
- Validation: `isDescendant(targetPath, sourcePath)` checks path prefix

**Project Root Protection**:
- Cannot move/rename project root directory itself
- Enforced in FileService validation layer

**Name Conflict Handling**:
- Move conflicts: Show confirm dialog (overwrite or cancel)
- Copy conflicts: Auto-numbering (file.md → file (1).md → file (2).md)
- Case-insensitive detection for cross-platform compatibility

### Keyboard Shortcuts

**Cut/Copy/Paste**:
- `Ctrl+X` / `Cmd+X` - Cut selected item
- `Ctrl+C` / `Cmd+C` - Copy selected item
- `Ctrl+V` / `Cmd+V` - Paste into selected folder

**Visual Feedback**:
- Cut items: 50% opacity + dashed underline
- Clipboard persists across re-renders (Zustand store)

### Visual Feedback States

**Drag States** (CSS data attributes):
- `data-dragging="true"` - 40% opacity on source item
- `data-drop-target="true"` - Blue outline + background on target folder
- `data-drop-invalid="true"` - Red outline for invalid drop locations
- `data-clipboard-cut="true"` - Dimmed + dashed underline for cut items

**Drop Indicators**:
- `DropIndicator.tsx` - Horizontal blue line showing exact drop position
- `FolderDropHighlight.tsx` - Folder outline during "move into" operation
- Position calculated from projected depth × indentation width

### Accessibility

**ARIA Live Announcements**:
- "Dragging [filename]" on drag start
- "Moved [filename] to [folder]" on successful drop
- "Cut/Copied [filename]" on keyboard operations
- Off-screen live region (`aria-live="polite"`, `aria-atomic="true"`)

**Keyboard Support**:
- Full cut/copy/paste via keyboard shortcuts
- Context menu accessible via right-click or context menu key
- Focus management during dialog interactions

### Integration Points

**IPC Handlers** (`src/main/ipc/file-handlers.ts`):
- `file:moveItem` - Sanitizes input (strips path separators), calls FileService
- `file:copyItem` - Same sanitization, handles numbering
- `file:checkConflict` - Returns boolean for duplicate detection

**Preload Bridge** (`src/preload/index.ts`):
```typescript
moveItem: (sourcePath, targetParentPath, newName?) =>
  ipcRenderer.invoke('file:moveItem', sourcePath, targetParentPath, newName)
```
- Type-safe API via `index.d.ts` definitions
- No direct Node.js access from renderer

**ProjectTree Component** (`src/renderer/src/components/ProjectTree/ProjectTree.tsx`):
- DndContext with sensors (5px activation distance prevents accidental drags)
- Drag handlers: `onDragStart`, `onDragOver`, `onDragEnd`
- Keyboard event listener for Ctrl+X/C/V
- Context menu integration with Cut/Copy/Paste items

### Performance Considerations

**Tree Flattening**:
- Memoized: Only recalculates when `files` array changes
- Typical project (500 files) flattens in <5ms

**Watcher Pause/Resume**:
- Brief delay (<100ms) during operations
- Trade-off: Prevents race conditions vs. slight UX latency

**Drag Sensor Configuration**:
- 5px activation distance (prevents click interference)
- `closestCenter` collision detection (better performance than `closestCorners`)

### Known Limitations

1. No undo/redo - Operations are immediate and permanent
2. No multi-select drag - One item at a time
3. No manual file ordering - Alphabetical sort only
4. No auto-open folders on hover during drag
5. No progress indicators for large folder copies

### Future Enhancements

Undo/redo, multi-select drag (Shift/Ctrl+Click), custom drag previews, auto-open on hover (1s), progress indicators with cancel.

See: [Drag-Drop](./drag-drop/README.md) · [IPC](./ipc-patterns.md) · [UI](./ui-components.md) · [Security](./security.md) · [Testing](./testing/README.md)

## ProjectTree Modularization

**v0.3.7 Refactoring**: Reduced ProjectTree.tsx complexity by 38.4% (1,338 → 824 lines) through SOLID principles and design patterns.

**Key Achievements**:
- Applied Strategy + Command + Factory patterns for context menus
- Created 3 custom hooks: useProjectManagement, useFileOperations, useDirectoryWatcher
- Extracted 57 pure functions using "Extract Pure Logic" pattern
- Added 320 comprehensive tests (964 total tests passing)
- Zero breaking changes

**Architecture Components**:
- **Custom Hooks**: useProjectManagement (project lifecycle), useFileOperations (CRUD), useDirectoryWatcher (monitoring)
- **Context Menu**: 11 command classes, node-type strategies, factory selection
- **Helper Functions**: switchHelpers (terminal activity tracking), withWatcherPause (race prevention), constants
- **Pure Logic**: 57 functions extracted to `.logic.ts` files for fast, deterministic testing

**Pure Logic Pattern Examples** (v0.6.3):
- `markdownEditorPanel.logic.ts` - Stats calculation, scroll sync algorithms (591 lines, 83 tests)
- `promptScrollScheduler.logic.ts` - Timestamp-based scroll scheduling with user intent detection (141 lines, 66 tests)
- `chatBubble.logic.ts` / `diagramViewer.logic.ts` / `mermaidDirections.ts` - Validation helpers, zoom/pan math, chart-type detection — all testable without React

**Shared utility patterns** (cross-platform / cross-process):
- `src/main/utils/validateFilename.ts` (#161, Phase 2) — two self-documenting entry points: `assertValidUserFilename` throws on invalid input (FileService callers); `deriveSafeFilename` is a total function that silently transforms (Pdf/DocxService callers). Single 9-step pipeline, platform-aware policy, security checks (Unicode bidi-override stripping). Renderer detects via shared `INVALID_FILENAME_MARKER` constant in `src/shared/errors.ts` since `AppError.code` does not survive Electron IPC.
- `tests/setup/flakeGuard.ts` — surfaces post-teardown unhandled rejections / uncaught exceptions across all 3 vitest projects with scope-labeled stack traces. Exposes counters on `globalThis.__flakeGuardCount__` for future CI assertions.

**SOLID Principles Applied**:
- Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion

## ProjectManagementContext

**Singleton Pattern** for project management state (v0.4.0):

**Problem**: Both ProjectTree and WelcomePanel were creating separate `useProjectManagement` instances, each registering their own IPC listeners, causing duplicate "Project Opened" toasts.

**Solution**: Context ensures only ONE instance of the hook exists, meaning ONE IPC listener and ONE toast per event.

**Components** (`src/renderer/src/context/ProjectManagementContext.tsx`):
- `ProjectManagementProvider` - Wraps app, provides singleton instance
- `useProjectManagementContext()` - Full hook access (ProjectTree)
- `useOpenProjectByPath()` - ISP-compliant focused subset (WelcomePanel)
- `useProjectChangedEffect()` - Register for project change notifications
- `registerProjectChangedCallback()` - Manual callback registration

**SOLID Principles Applied**:
- **SRP**: Context has single responsibility (singleton management)
- **ISP**: `useOpenProjectByPath()` provides focused subset for components that only need project opening
- **DIP**: Components depend on context abstractions, not concrete hook implementations
