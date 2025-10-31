# Architecture

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
│   │   └── TerminalService.ts   # PTY management with node-pty
│   └── ipc/
│       ├── file-handlers.ts     # IPC handlers
│       ├── file-watcher-handlers.ts  # File watching IPC
│       ├── directory-watcher-handlers.ts  # Directory watching IPC
│       └── terminal-handlers.ts # Terminal emulator IPC
├── preload/
│   ├── index.ts              # contextBridge setup
│   └── index.d.ts            # TypeScript definitions
└── renderer/
    └── src/
        ├── components/
        │   ├── DockLayout/      # Hybrid SplitviewReact + DockviewReact
        │   ├── ActivityBar/     # Vertical activity bars (left/right)
        │   ├── Panels/          # Panel implementations + WelcomePanel
        │   ├── Editor/          # Monaco + Preview + Context Menus
        │   ├── ProjectTree/     # Project tree with context menu
        │   ├── Dialog/          # Unified dialog system (Context + Provider + Hook)
        │   ├── ContextMenu/     # Right-click context menu
        │   └── Toast/           # Toast notification system
        ├── prompts/             # Prompt template system
        │   ├── templates/       # Markdown templates with YAML frontmatter
        │   ├── parser.ts        # CSP-safe YAML parser
        │   ├── renderer.ts      # Template renderer (Handlebars-style)
        │   ├── schema.ts        # Zod validation
        │   ├── registry.ts      # Dynamic template loading
        │   ├── helpers.ts       # Template helper functions
        │   └── types.ts         # TypeScript interfaces
        ├── stores/              # Zustand stores (useActivityBarStore)
        ├── hooks/               # React hooks
        ├── types/               # Shared TypeScript types (filters.ts)
        ├── utils/               # Shared utilities (fileUtils.ts, panelUtils.ts)
        ├── App.tsx              # Root component
        └── main.tsx
```

## Key Design Decisions

- **Hybrid Layout System**: SplitviewReact (outer) + DockviewReact (center) matches VS Code pattern
- **OOP Services**: Business logic in service classes
  - FileService: File operations (read, write, create, rename, delete)
  - FileWatcherService: Auto-reload files on external changes (300ms debounce)
  - DirectoryWatcherService: Auto-refresh file tree (1000ms debounce, ignored patterns)
  - SettingsService: Persistent storage with electron-store (dynamic ES Module import)
  
  - TerminalService: Terminal emulator with xterm.js + node-pty (PTY lifecycle, WebGL rendering, auto-resize, traditional zsh prompt, cwd verification)
- **Auto-Refresh**: Chokidar-based watching with pause/resume race prevention
  - Session token guards drop stale events during project switches
  - Configurable depth cap (settings-driven) to limit recursion in large projects
- **Secure IPC**: All main↔renderer communication via contextBridge
- **State Management**: Zustand for activity bar state (sidebar widths, active panels)
- **Component Registry**: Splitview and Dockview use string-based component lookup
- **Multi-model Editor**: Single Monaco instance, swap models per file
- **Mermaid Integration**: Client-side diagram rendering (22 types) with dark theme
- **Prompt Template System**: CSP-compliant markdown templates with Handlebars-style syntax for context menu AI prompts (see [Prompt Templates](./prompt-templates.md))
- **Line Range Tracking**: Enhanced markdown preview with `data-line-start/end` attributes for accurate source mapping
- **Project Persistence**: Auto-loads last opened project on startup
- **Shared Utilities**: `types/` for shared TypeScript types (FilterMode), `utils/` for shared functions (sanitizeFilePath, isMarkdownFile, panelUtils)

## Activity Bar System

Dual vertical activity bars (VS Code-style):

**Left Activity Bar**:
- Project panel toggle
- Keyboard: `Cmd/Ctrl+B`

**Right Activity Bar**:
 
- Terminal toggle (`Cmd/Ctrl+J`)

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

See: [IPC Patterns](./ipc-patterns.md) | [UI Components](./ui-components.md) | [Security](./security.md)
