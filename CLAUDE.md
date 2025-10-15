# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Erfana** is an Electron desktop IDE for managing consulting and research projects with Claude Code integration. Multi-panel workspace with superior markdown editing, auto-refresh for external changes, git integration, and direct Claude AI assistance.

## Quick Start

```bash
npm run dev          # Start development with hot reload
npm run build        # Build for production
npm run lint         # Run ESLint
npm run typecheck    # Type-check TypeScript
```

## Architecture Quick Reference

Erfana follows Electron's three-process model:

1. **Main Process** (`src/main/`): Node.js environment - window lifecycle, file operations, IPC handlers
2. **Preload Script** (`src/preload/`): Secure bridge using `contextBridge` for type-safe IPC
3. **Renderer Process** (`src/renderer/`): React UI with hybrid SplitviewReact + DockviewReact layout, no Node.js access

**Key Technologies:**
- electron-vite (build tool)
- Splitview (outer 3-column layout with working resize)
- Dockview (center editor tabs)
- Monaco Editor (markdown editing)
- react-markdown + remark-gfm (preview)
- Zustand (activity bar state management)
- chokidar (file system watching)
- xterm.js + node-pty (terminal emulator)
- Claude CLI binary (Claude AI via MAX subscription)
- simple-git (git operations)

**Project Structure:**
```
src/
├── main/
│   ├── index.ts           # Entry point
│   ├── services/          # Business logic (OOP)
│   └── ipc/               # IPC handlers by domain
├── preload/
│   ├── index.ts           # contextBridge API
│   └── index.d.ts         # window.api types
└── renderer/src/
    ├── components/
    │   ├── DockLayout/      # Hybrid SplitviewReact + DockviewReact system
    │   ├── ActivityBar/     # Vertical activity bars (left/right)
    │   ├── Panels/          # Panel implementations + WelcomePanel
    │   ├── Editor/          # Monaco + Preview + Context Menus
    │   ├── ProjectTree/     # Project tree with filtering
    │   ├── ContextMenu/     # Right-click menu (project tree)
    │   └── ConfirmDialog/   # Confirmation dialogs
    ├── stores/              # Zustand stores (useActivityBarStore)
    ├── hooks/               # React hooks
    ├── types/               # Shared TypeScript types (filters.ts)
    ├── utils/               # Shared utilities (fileUtils.ts)
    └── App.tsx              # Root component
```

📚 **Detailed architecture**: See [docs/architecture.md](docs/architecture.md)

## Essential Patterns

### IPC Communication

**Standard secure pattern:**
1. Define in `src/preload/index.ts` with contextBridge
2. Handle in `src/main/ipc/*-handlers.ts` with validation
3. Call from renderer via `window.api.*`

📚 **Full IPC patterns**: See [docs/ipc-patterns.md](docs/ipc-patterns.md)

### Service Classes (OOP)

Business logic lives in service classes (`src/main/services/`):
- `FileService.ts` - File operations (read, write, create, delete, rename)
- `FileWatcherService.ts` - File content auto-refresh (300ms debounce)
- `DirectoryWatcherService.ts` - Directory tree auto-refresh (1000ms debounce)
- `SettingsService.ts` - Persistent storage with electron-store (async, dynamic ES Module import)
- `ClaudeCliService.ts` - Persistent Claude CLI session (long-running process, JSONL stdin/stdout, EPIPE-safe logging)
- `TerminalService.ts` - Terminal emulator (xterm.js + node-pty, PTY lifecycle, WebGL rendering, EPIPE-safe logging)
- `GitService.ts` - Git operations (future)

**EPIPE Error Handling**: TerminalService and ClaudeCliService use `safe-console` utility to prevent crashes from broken pipe errors during cleanup. See [docs/epipe-error-handling.md](docs/epipe-error-handling.md)

```typescript
export class MyService {
  constructor(private config: Config) {}
  async doWork(): Promise<Result> { /* ... */ }
}
export const myService = new MyService(config)
```

**Note**: SettingsService uses dynamic `import()` for electron-store. See [Known Issues](docs/known-issues.md#electron-store-es-module-import).

### Layout System & Panels

Erfana uses a **hybrid architecture**:
- **SplitviewReact** (outer layer): 3-column layout with resizable sidebars
- **DockviewReact** (center only): Tabbed editor area for file editing

**Adding Splitview Panel** (sidebar): Create component, register in `splitviewComponents`, add via SplitviewApi
**Adding Dockview Panel** (editor tab): Create component, register in `editorComponents`, add via DockviewApi

📚 **Panel setup guide**: See [docs/development-tasks.md](docs/development-tasks.md#adding-panels)

## Markdown Editing

Superior markdown capabilities with Monaco Editor + live preview:
- **Compact Editor**: 13px font, 20px line-height, 8px padding, no minimap or rulers
- **Multi-File Tabs**: Each file gets unique panel with independent state
- **Formatting Toolbar**: 10 markdown buttons (bold, italic, code, links, images, headings, lists)
- **Document Statistics**: Real-time word count, character count, lines, reading time
- **Auto-Save**: Debounced auto-save (2s after last edit) with visual indicator
- **Claude Integration**: Right-click context menu in preview for AI-powered text operations
  - **Prompt Templates**: Dynamic templates with CSP-safe rendering (YAML frontmatter + Handlebars-style syntax)
  - **Auto-Execute**: Terminal prompts automatically press Enter after pasting (seamless Claude Code workflow)
  - **Modify Dialog**: Interactive input collection with React Portal overlay (2000 char limit, keyboard shortcuts)
  - **Centralized Execution**: Single `executePromptTemplate()` function for consistent behavior across triggers
  - **Line Range Tracking**: Accurate source mapping with data-line-start/end attributes for multi-line elements
  - **Source Reading**: Reads original markdown source (not rendered HTML) for precise text extraction
- **View Modes**: Editor only, split view with bidirectional scroll sync, preview only
- **Scroll Synchronization**: Editor ↔ preview scrolling in split view (line-to-pixel mapping, 50ms debounce)
- **Mermaid Diagrams**: 22 diagram types (flowcharts, sequence, class, state, Gantt, ER, timelines, and more)
- **Professional Compact Preview**: Charter serif font, 15px, compact spacing, 860px max width, GitHub-inspired typography

📚 **Markdown features**: See [docs/markdown-editing.md](docs/markdown-editing.md) | [docs/prompt-templates.md](docs/prompt-templates.md)

## Auto-Refresh

Automatic file system change detection via chokidar:

**File Watching**: Auto-reload on external changes (conflict UI if unsaved edits), 300ms debounce, pause during save
**Directory Watching**: Auto-refresh project tree (preserves expanded folders), 1000ms debounce, pause during CRUD ops

**Use cases**: Git ops, NPM installs, external edits → Auto-refresh

📚 **Full documentation**: [docs/file-watching.md](docs/file-watching.md)

## UI & Keyboard Shortcuts

**Activity Bars**: Dual vertical activity bars (VS Code-style) on left and right edges with Lucide icon toggle buttons.
- **Left Activity Bar**: Project toggle
- **Right Activity Bar**: Copilot toggle (top position), Git and Terminal toggles (separate panels, mutually exclusive)

**Control Panels**: Collapsible panels with chevron toggle (Copilot: session stats + tool approval; Project: file filtering)

**Project Panel**:
- **Control Panel**: File filtering (All Files | Markdown Only) with persistence
- **Visual Indicators**: Sensitive files (amber + warning icon), hidden files (70% opacity, italic)
- **Context Menu**: Right-click for New File, New Folder, Rename, Delete with validation
- **Recursive Filtering**: Markdown mode shows only .md files + folders containing them

**Editor Tab Styling**:
- Hover effects on tabs (lighter background)
- Blue bottom border on active tab (2px #007acc)
- Auto-focus ensures active indicator shows immediately
- 12px horizontal padding, 41px height

**Global Keyboard Shortcuts** (work anywhere in app):
- `Cmd/Ctrl+B` - Toggle left sidebar (Project)
- `Cmd/Ctrl+J` - Toggle right panel (Terminal)
- `Ctrl+Shift+G` - Toggle right panel (Git)
- `Cmd/Ctrl+Shift+A` - Toggle right panel (Copilot)
- `Cmd/Ctrl+,` - Open Claude Code settings (when Copilot active)

**Panel Behavior**:
- Right sidebar: Git and Terminal are separate splitview panels (mutually exclusive)
- Toggles hide/show entire panels (not individual tabs)
- Preserves panel dimensions when toggling (working resize handles)
- State persisted via Zustand store (sidebar widths, active panels)

**Project Persistence**: Auto-loads last opened project on startup.

**⚠️ Note**: Global shortcuts override editor shortcuts. When Cmd/Ctrl+B is pressed, it toggles the sidebar rather than triggering Monaco's bold action.

📚 **UI components & panel system**: See [docs/ui-components.md](docs/ui-components.md)

## Security

**Critical security rules:**
- Context isolation ALWAYS enabled (`contextIsolation: true`)
- Node integration ALWAYS disabled (`nodeIntegration: false`)
- Validate ALL inputs in main process IPC handlers
- Use contextBridge for all renderer ↔ main communication

📚 **Security guidelines**: See [docs/security.md](docs/security.md)

## Known Issues

**Active Issues:**
- **node-pty**: Build fails on Python 3.13 - use Python 3.12 or earlier for terminal functionality
- **Dockview CSS**: Use `dockview/dist/styles/dockview.css` path
- **electron-store**: ES Module requiring dynamic `import()` - all SettingsService methods are async
- **Network file systems**: May require `usePolling: true` for file watching (future config option)

**Resolved Issues:**
- **Panel Resizing**: ✅ RESOLVED - Hybrid SplitviewReact + DockviewReact architecture fixed resize functionality
- **Monaco CSP**: ✅ RESOLVED - Monaco now uses local bundling instead of CDN
- **Scroll Synchronization**: ✅ RESOLVED - Fixed react-markdown v10 API compatibility + React ref re-render issues

📚 **All known issues**: See [docs/known-issues.md](docs/known-issues.md)

## Common Tasks

### Adding New IPC Channel
1. Define in `src/preload/index.ts` with types
2. Create handler in `src/main/ipc/*-handlers.ts` with validation
3. Register in `src/main/index.ts`
4. Call from renderer via `window.api.*`

### Adding New Panel

**Splitview Panel** (for sidebars):
1. Create panel component with `ISplitviewPanelProps`
2. Register in `splitviewComponents` in `AppDockLayout.tsx`
3. Add via `splitviewApi.addPanel()` with size constraints

**Dockview Panel** (for editor tabs):
1. Create panel component with `IDockviewPanelProps`
2. Register in `editorComponents` inside `EditorAreaSplitPanel`
3. Open via `dockviewApi.addPanel()` with file params

### Debugging
- **Main Process**: Terminal output (`console.log`)
- **Renderer**: Chrome DevTools (F12)
- **IPC**: Log both sides to trace calls

📚 **Detailed development tasks**: See [docs/development-tasks.md](docs/development-tasks.md)

## Testing & Visual Verification

Use **Circuit Electron MCP** to visually test Erfana:
1. Build: `npm run build`
2. Launch app, take screenshots, interact with UI
3. **IMPORTANT**: Save screenshots to `/temp/` folder

📚 **Complete guide**: [docs/testing/README.md](docs/testing/README.md) | [Quick Start](docs/testing/quickstart.md) | [MCP Tools](docs/testing/circuit-electron-guide.md) | [Scenarios](docs/testing/ui-scenarios.md)

## Claude Code Integration

**Status**: ✅ FULLY IMPLEMENTED - Persistent session with tool approval and conversation preservation

**Quick Facts**:
- **Requirement**: Claude CLI via MAX subscription (`brew install claude`)
- **Architecture**: Persistent JSONL session (process runs from project open to close)
- **Location**: Right sidebar Copilot panel (Cmd/Ctrl+Shift+A)
- **Tool Policy**: All 17 Claude Code tools enabled by default (opinionated for consultants)
- **Conversation Preservation**: `--continue` flag preserves history across tool approvals and planning mode toggles

**Key Features**:
- **Tool Approval System**: Settings modal (Cmd/Ctrl+,) for per-tool configuration
- **Planning Mode**: Toggle for safe exploration (restricts to 9 read-only tools)
- **Control Panel**: Session stats (messages, tools used, duration) + color-coded tool status
- **Auto-Retry**: Seamless tool approval flow with session restart + conversation preservation

**Enabled Tools** (17 total):
- File: Read, Write, Edit, MultiEdit, Glob, Grep, LS
- System: Bash
- AI/Web: WebSearch, WebFetch, Task
- Workflow: TodoRead, TodoWrite, SlashCommand, ExitPlanMode
- Notebooks: NotebookRead, NotebookEdit

**Planning Mode Tools** (9 safe tools):
Read, LS, Glob, Grep, Task, WebSearch, TodoRead, TodoWrite, NotebookRead

📚 **Complete documentation**: [Claude Code Index](docs/claude-code/README.md) | [Tool Approval](docs/claude-code/tool-approval-core.md) | [Conversation Preservation](docs/claude-code/conversation-preservation.md) | [UI Features](docs/claude-code/ui-features.md) | [API Reference](docs/api-reference.md#claudecliservice)

## Agent Delegation

**Location**: `.claude/agents/` - 10 specialized subagents

**Mandatory**: code-reviewer (code changes), typescript-pro (TS files), test-automator (features), documentation-engineer (APIs), qa-expert (releases), error-detective (errors)

**Proactive**: architect-reviewer (design), refactoring-specialist (quality), business-analyst (requirements), cli-developer (tools)

**Syntax**: "Use the [agent-name] subagent to [task description]"

**Example**: "Use the code-reviewer subagent to review authentication module for security"

📚 **Complete guide**: [docs/agent-delegation.md](docs/agent-delegation.md) - Detailed descriptions, decision framework, examples

## Documentation

### Core Documentation

- [Architecture](docs/architecture.md) - Three-process model, hybrid layout, tech stack
- [IPC Patterns](docs/ipc-patterns.md) - Secure communication patterns
- [API Reference](docs/api-reference.md) - Service class APIs (ClaudeCliService, TerminalService, etc.)
- [Keyboard Shortcuts](docs/keyboard-shortcuts.md) - Complete shortcut reference
- [Troubleshooting](docs/troubleshooting.md) - Common issues and solutions

### Features & Integration

- [File Watching](docs/file-watching.md) - Auto-refresh systems
- [UI Components](docs/ui-components.md) - Activity bars, panels, keyboard shortcuts
- [Terminal](docs/terminal.md) - Terminal emulator with xterm.js + node-pty
- [Markdown Editing](docs/markdown-editing.md) - Editor features, preview, Mermaid diagrams
- [Prompt Templates](docs/prompt-templates.md) - AI prompt template system
- [Project Panel](docs/project-panel.md) - File tree, filtering, context menu

### Development & Quality

- [Security](docs/security.md) - Security guidelines, CSP
- [Known Issues](docs/known-issues.md) - Current and resolved issues
- [Development Tasks](docs/development-tasks.md) - Common patterns
- [Agent Delegation](docs/agent-delegation.md) - Specialized agent usage guide

### Claude Code Integration

- [Index](docs/claude-code/README.md) - Overview and quick reference
- [Tool Approval Core](docs/claude-code/tool-approval-core.md) - Tool approval system fundamentals
- [Tool Approval Advanced](docs/claude-code/tool-approval-advanced.md) - IPC, testing, debugging
- [Conversation Preservation](docs/claude-code/conversation-preservation.md) - Session management with --continue
- [UI Features](docs/claude-code/ui-features.md) - Copilot panel, control panel, dialogs

### Testing

- [Index](docs/testing/README.md) - Testing documentation overview
- [Quick Start](docs/testing/quickstart.md) - Fast testing patterns
- [Circuit Electron Guide](docs/testing/circuit-electron-guide.md) - MCP tool reference
- [UI Scenarios](docs/testing/ui-scenarios.md) | [Interaction Scenarios](docs/testing/interaction-scenarios.md) - Test scenarios

## Useful Resources

[Electron Docs](https://www.electronjs.org/docs/latest/) | [electron-vite](https://electron-vite.org/) | [Dockview](https://dockview.dev/) | [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/index.html)