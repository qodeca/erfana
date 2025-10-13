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
  ├─ Left: FileExplorerSplitPanel (170-600px, resizable)
  │   └─ Wraps FileTree component
  ├─ Center: EditorAreaSplitPanel (400px min, flex-fills remaining)
  │   └─ Contains DockviewReact for tabbed editors
  └─ Right: GitSplitPanel + TerminalSplitPanel (170-600px each, mutually exclusive)
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
- `FileExplorerSplitPanel` - Splitview panel wrapping FileTree
- `EditorAreaSplitPanel` - Splitview panel containing nested DockviewReact
- `GitSplitPanel` - Splitview panel for Git integration
- `TerminalSplitPanel` - Splitview panel for terminal (mutually exclusive with Git)

**Panel Communication**: DockviewApi passed via params to FileExplorerSplitPanel for opening files as tabs.

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
│   │   └── ClaudeCliService.ts  # Persistent Claude CLI session
│   └── ipc/
│       ├── file-handlers.ts     # IPC handlers
│       ├── file-watcher-handlers.ts  # File watching IPC
│       ├── directory-watcher-handlers.ts  # Directory watching IPC
│       └── claude-code-handlers.ts  # Claude Code integration IPC
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
        │   ├── FileTree/        # File explorer with context menu
        │   ├── ClaudeCode/      # Claude Code integration components
        │   ├── Dialogs/         # Modal dialogs (ToolApprovalDialog)
        │   ├── ContextMenu/     # Right-click context menu
        │   ├── ConfirmDialog/   # Confirmation dialog component
        │   └── Toast/           # Toast notification components
        ├── contexts/            # React contexts (ToastContext)
        ├── stores/              # Zustand stores (useActivityBarStore)
        ├── hooks/               # React hooks
        ├── App.tsx              # Root (wrapped with ToastProvider)
        └── main.tsx
```

## Key Design Decisions

- **Hybrid Layout System**: SplitviewReact (outer) + DockviewReact (center) matches VS Code pattern
- **OOP Services**: Business logic in service classes
  - FileService: File operations (read, write, create, rename, delete)
  - FileWatcherService: Auto-reload files on external changes (300ms debounce)
  - DirectoryWatcherService: Auto-refresh file tree (1000ms debounce, ignored patterns)
  - SettingsService: Persistent storage with electron-store (dynamic ES Module import)
  - ClaudeCliService: Persistent Claude CLI session (long-running process, JSONL stdin/stdout, tool approval system, auto-retry)
- **Auto-Refresh**: Chokidar-based watching with pause/resume race prevention
- **Secure IPC**: All main↔renderer communication via contextBridge
- **State Management**: Zustand for activity bar state (sidebar widths, active panels)
- **Component Registry**: Splitview and Dockview use string-based component lookup
- **Multi-model Editor**: Single Monaco instance, swap models per file
- **Mermaid Integration**: Client-side diagram rendering (22 types) with dark theme
- **Project Persistence**: Auto-loads last opened project on startup

## Activity Bar System

Dual vertical activity bars (VS Code-style):

**Left Activity Bar**:
- Explorer toggle
- Keyboard: `Cmd/Ctrl+B`

**Right Activity Bar**:
- AI Assistant toggle (top position)
- Git toggle (`Ctrl+Shift+G`)
- Terminal toggle (`Cmd/Ctrl+J`)

**Components**:
- `ActivityBar.tsx` - Container component
- `ActivityBarItem.tsx` - Individual clickable item
- `ActivityBarBadge.tsx` - Badge system for notifications
- `activityBarConfig.ts` - Panel configuration

**State**: Managed by `useActivityBarStore` (Zustand), persists sidebar widths and active panels.

## Toast Notification System

Global notification system implemented using React Context:

- **ToastContext.tsx**: Context provider with `showToast()` method
- **ToastNotification.tsx**: Visual toast component
- **Toast.css**: Styling for toast notifications
- **Integration**: App.tsx wrapped with `<ToastProvider>`

**Used for**: Clipboard operations, file operations, save confirmations

See: [IPC Patterns](./ipc-patterns.md) | [UI Components](./ui-components.md) | [Security](./security.md) | [Claude Code Integration](./claude-code/README.md)
