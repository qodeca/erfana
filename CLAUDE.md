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
    │   ├── ProjectTree/     # Project panel with context menu
    │   ├── ContextMenu/     # Right-click menu (project tree)
    │   ├── ConfirmDialog/   # Confirmation dialogs
    │   └── Toast/           # Toast notifications
    ├── contexts/            # React contexts (ToastContext)
    ├── stores/              # Zustand stores (useActivityBarStore)
    ├── hooks/               # React hooks
    └── App.tsx              # Root (wrapped with ToastProvider)
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
- `ClaudeCliService.ts` - Persistent Claude CLI session (long-running process, JSONL stdin/stdout)
- `GitService.ts` - Git operations (future)

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
- **View Modes**: Editor only, split view with bidirectional scroll sync, preview only
- **Scroll Synchronization**: Editor ↔ preview scrolling in split view (line-to-pixel mapping, 50ms debounce)
- **Mermaid Diagrams**: 22 diagram types (flowcharts, sequence, class, state, Gantt, ER, timelines, and more)
- **Medium.com Preview**: Charter serif font, 18px, compact spacing, 680px max width, professional typography

📚 **Markdown features**: See [docs/markdown-editing.md](docs/markdown-editing.md)

## Auto-Refresh

Automatic detection and refresh for external file system changes:

**File Content Watching** (FileWatcherService):
- Auto-reload files modified externally (if no unsaved changes)
- Conflict resolution UI when file has local modifications
- File deletion warning banner
- Debouncing (300ms) for rapid changes
- Pause/resume during save to prevent race conditions
- Toolbar indicator: "Reloaded from disk"

**Directory Tree Watching** (DirectoryWatcherService):
- Recursive watching of project folder
- Detects file/folder creation and deletion
- Preserves expanded folder state during refresh
- Intelligent debouncing (1000ms bulk, 300ms single)
- Ignored patterns: `.git`, `node_modules`, build outputs
- Pause/resume during internal CRUD operations
- Silent background operation (no notifications)

**Use Cases**:
- Git operations (checkout, pull, merge) → Auto-refresh
- NPM operations (install, update) → Auto-refresh
- External editor changes → Auto-reload or conflict detection
- File system operations → Tree updates immediately

**Security**: Project root validation, resource limits, proper cleanup

📚 **Full documentation**: See [docs/file-watching.md](docs/file-watching.md)

## UI & Keyboard Shortcuts

**Activity Bars**: Dual vertical activity bars (VS Code-style) on left and right edges with Lucide icon toggle buttons.
- **Left Activity Bar**: Project toggle
- **Right Activity Bar**: Copilot toggle (top position), Git and Terminal toggles (separate panels, mutually exclusive)

**Project Panel Context Menu**: Right-click files/folders for New File, New Folder, Rename, Delete actions with validation.

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
- **node-pty**: Build fails on Python 3.13 - terminal panel deferred
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

Claude Code can visually inspect and test Erfana using **Circuit Electron MCP** (already configured):

**Quick Test**: Build app (`npm run build`), launch with `mcp__circuit-electron__app_launch`, take screenshots, verify UI

**Capabilities**: Launch app, capture screenshots, UI interaction (click, type, shortcuts), JavaScript evaluation, element waiting

**Tools**: `app_launch`, `screenshot`, `click`, `type`, `keyboard_press`, `evaluate`, `wait_for_selector`, `close`

**IMPORTANT**: ALWAYS save screenshots to `/temp/` folder (create if needed)

📚 **Complete guide**: [docs/testing/README.md](docs/testing/README.md) | [Quick Start](docs/testing/quickstart.md) | [Circuit Electron Guide](docs/testing/circuit-electron-guide.md) | [Test Scenarios](docs/testing/ui-scenarios.md)

## Claude Code Integration

**Status**: ✅ FULLY IMPLEMENTED - Persistent session architecture with tool approval system

Erfana integrates Claude Code via persistent CLI session with security-first tool approval for AI-powered assistance within the IDE.

### Architecture

- **ClaudeCliService** (`src/main/services/ClaudeCliService.ts`): Spawns and manages long-running Claude CLI process
- **Persistent Session**: Process runs from project open to project close, maintains conversation context
- **JSONL Communication**: Bidirectional stdin/stdout streaming with `--input-format stream-json` and `--output-format stream-json`
- **Auto-Restart**: Exponential backoff recovery (max 3 attempts) on process crashes
- **Session States**: 'stopped' | 'starting' | 'ready' | 'error'

### UI

- **Copilot Panel**: Right sidebar, accessible via activity bar icon (labeled "Copilot")
- **Installation Check**: Detects Claude CLI, shows Homebrew install command if missing
- **Authentication**: OAuth token setup flow with visual feedback
- **Session Indicators**: Color-coded dots (green=ready, yellow=starting, red=error)
- **Chat Interface**: Message history (user/assistant/tool_use), stop generation button
- **Control Panel**: Collapsible panel showing session stats (messages, tools used, duration) and all 17 Claude Code tools with color-coded approval status
- **Planning Mode Toggle**: Switch between full access and read-only mode (restricts to safe exploration tools)

### Tool Approval System

Security-first approach with pre-approved common tools and user approval for complex operations:

- **Pre-Approved Tools** (10 total): Read, Write, Edit, Glob, Grep, Bash, LS, WebSearch, TodoWrite, Task (cover 95%+ of operations, transparent execution)
- **Tools Requiring Approval**: MultiEdit, WebFetch, SlashCommand, TodoRead, NotebookRead, NotebookEdit, ExitPlanMode (complex operations, higher security implications)
- **Modal Dialog**: ToolApprovalDialog shows tool name, description, parameters, "Remember this choice" option
- **Auto-Retry**: After approval, system automatically re-sends user prompt with updated permissions
- **Persistence**: Approved tools saved via electron-store, survive app restarts
- **Session Restart**: Uses `--resume` flag to preserve conversation context when adding tools
- **Merge Logic**: Pre-approved tools always included (ClaudeCliService.ts:148-153), even if not in settings

**Key Architecture Decision**: `--allowedTools` flag is immutable at runtime, requiring session restart to add new tools.

### Planning Mode

**Native Claude CLI feature** for safe exploration and planning without file modifications:

- **Activation**: Toggle button in chat interface, uses `--permission-mode plan` flag
- **Tool Restrictions**: Only read-only tools available (Read, LS, Grep, Task, WebSearch, TodoWrite)
- **Blocked Tools**: Write, Edit, Bash, and all other modification tools
- **Use Cases**: Code exploration, architecture planning, research, cost estimation before implementation
- **Session Restart**: Toggling mode restarts Claude CLI session with updated permissions
- **Visual Indicator**: System message in chat confirms mode change
- **Control Panel**: Shows restricted tool set when planning mode is active

**Planning Mode Tool Set** (6 tools): Read, LS, Grep, Task, WebSearch, TodoWrite

See: [Claude Code UI Features](docs/claude-code/ui-features.md#planning-mode-toggle) for UI documentation

### Implementation

**Files**:
- Service: `src/main/services/ClaudeCliService.ts` (~527 lines)
- IPC: `src/main/ipc/claude-code-handlers.ts` (~180 lines)
- Settings: `src/main/ipc/settings-handlers.ts` (tool approval persistence)
- UI: `src/renderer/src/components/Panels/CopilotPanel.tsx`
- Chat: `src/renderer/src/components/Copilot/CopilotChat.tsx`
- Dialog: `src/renderer/src/components/Dialogs/ToolApprovalDialog.tsx`

**Flags Used**:
```bash
claude -p \
  --session-id <uuid> \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --replay-user-messages \
  --allowedTools Read Write Edit Glob Grep Bash LS WebSearch TodoWrite Task  # 10 pre-approved + user-approved
  --resume <sessionId>  # Used when restarting with new tools
  --permission-mode plan  # Optional: Enable planning mode (read-only tools only)
```

📚 **Detailed docs**: [Claude Code Integration Index](docs/claude-code/README.md) | [Tool Approval System](docs/claude-code/tool-approval.md) | [UI Features](docs/claude-code/ui-features.md) | [IPC Patterns](docs/ipc-patterns.md)

## Agent Delegation Rules

**Location**: `.claude/agents/` - 10 specialized subagents with independent context windows

### When to Delegate

**Mandatory Agents** (MUST USE):
- **code-reviewer**: After ANY code changes, before commits/PRs
- **typescript-pro**: When modifying ANY TypeScript file
- **test-automator**: After new features, before deployment
- **documentation-engineer**: After API/feature changes
- **qa-expert**: Before ANY release or deployment
- **error-detective**: When ANY error occurs

**Proactive Agents** (USE WHEN APPLICABLE):
- **architect-reviewer**: Architecture/design decisions
- **refactoring-specialist**: Code complexity/smells
- **business-analyst**: Requirements/ROI analysis
- **cli-developer**: Automation/build tools

### Invocation Syntax

Use natural language: **"Use the [agent-name] subagent to [task description]"**

Examples:
- "Use the code-reviewer subagent to review authentication module for security vulnerabilities"
- "Use the typescript-pro subagent to add strict type definitions to API client"
- "Use the test-automator subagent to create tests for user service"

### Quick Decision Tree

**Code changed?** → code-reviewer (MANDATORY)
**TypeScript modified?** → typescript-pro (MANDATORY)
**New feature?** → test-automator + documentation-engineer (MANDATORY)
**Deployment?** → qa-expert (MANDATORY)
**Error?** → error-detective (MANDATORY)
**Architecture decision?** → architect-reviewer (PROACTIVE)
**Code quality issue?** → refactoring-specialist (PROACTIVE)

📚 **Agent Definitions**: See `.claude/agents/*.md` for detailed capabilities and tools

## Documentation

- [Architecture](docs/architecture.md) - Three-process model, hybrid layout architecture, tech stack, design decisions
- [IPC Patterns](docs/ipc-patterns.md) - Secure communication patterns, current channels
- [File Watching](docs/file-watching.md) - Auto-refresh systems, patterns, testing
- [UI Components](docs/ui-components.md) - Activity bars, panel toggle system, keyboard shortcuts, panel communication
- [Markdown Editing](docs/markdown-editing.md) - Editor features, shortcuts, preview
- [Security](docs/security.md) - Security guidelines, CSP, validation patterns
- [Known Issues](docs/known-issues.md) - Current issues, resolved issues, workarounds
- [Development Tasks](docs/development-tasks.md) - Common development patterns, adding panels
- **Claude Code Integration:**
  - [Integration Index](docs/claude-code/README.md) - Quick reference and navigation
  - [Tool Approval System](docs/claude-code/tool-approval.md) - Security model, approval flow, auto-retry
  - [UI Features](docs/claude-code/ui-features.md) - Copilot panel, Control Panel, Planning Mode, Tool Approval Dialog
- **Testing:**
  - [Testing Index](docs/testing/README.md) - Complete testing documentation hub
  - [Quick Start](docs/testing/quickstart.md) - Fast testing setup
  - [Circuit Electron Guide](docs/testing/circuit-electron-guide.md) - Complete MCP reference
  - [UI Scenarios](docs/testing/ui-scenarios.md) - UI verification tests (Scenarios 1-5)
  - [Interaction Scenarios](docs/testing/interaction-scenarios.md) - User interaction tests (Scenarios 6-10)

## Useful Resources

[Electron Docs](https://www.electronjs.org/docs/latest/) | [electron-vite](https://electron-vite.org/) | [Dockview](https://dockview.dev/) | [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/index.html)