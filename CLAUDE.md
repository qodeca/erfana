# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Erfana** is an Electron desktop IDE for managing consulting and research projects with Claude Code integration. Multi-panel workspace with superior markdown editing, git integration, and direct Claude AI assistance.

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
- @anthropic-ai/claude-agent-sdk (Claude AI)
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
    │   ├── FileTree/        # File explorer with context menu
    │   ├── ContextMenu/     # Right-click menu (file tree)
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
- `SettingsService.ts` - Persistent storage with electron-store (async, dynamic ES Module import)
- `GitService.ts` - Git operations (future)
- `ClaudeService.ts` - Claude SDK wrapper (future)

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
- **View Modes**: Editor only, split view (default), preview only
- **Medium.com Preview**: Charter serif font, 18px, compact spacing, 680px max width, professional typography

📚 **Markdown features**: See [docs/markdown-editing.md](docs/markdown-editing.md)

## UI & Keyboard Shortcuts

**Activity Bars**: Dual vertical activity bars (VS Code-style) on left and right edges with Lucide icon toggle buttons.
- **Left Activity Bar**: Explorer toggle
- **Right Activity Bar**: Git and Terminal toggles (separate panels, mutually exclusive)

**File Explorer Context Menu**: Right-click files/folders for New File, New Folder, Rename, Delete actions with validation.

**Editor Tab Styling**:
- Hover effects on tabs (lighter background)
- Blue bottom border on active tab (2px #007acc)
- Auto-focus ensures active indicator shows immediately
- 12px horizontal padding, 41px height

**Global Keyboard Shortcuts** (work anywhere in app):
- `Cmd/Ctrl+B` - Toggle left sidebar (Explorer)
- `Cmd/Ctrl+J` - Toggle right panel (Terminal)
- `Ctrl+Shift+G` - Toggle right panel (Git)

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

**Resolved Issues:**
- **Panel Resizing**: ✅ RESOLVED - Hybrid SplitviewReact + DockviewReact architecture fixed resize functionality
- **Monaco CSP**: ✅ RESOLVED - Monaco now uses local bundling instead of CDN

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

**Quick Test:**
```typescript
// 1. Build first
npm run build

// 2. Launch and screenshot
const session = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/out/main/index.js",
  compressScreenshots: true
})

mcp__circuit-electron__screenshot({ sessionId: session.sessionId })
mcp__circuit-electron__close({ sessionId: session.sessionId })
```

**Capabilities:**
- ✅ Launch Erfana and capture screenshots
- ✅ Interact with UI (click, type, keyboard shortcuts)
- ✅ Verify functionality with visual and programmatic checks
- ✅ Test after code changes without manual inspection
- ✅ Run pre-defined test scenarios
- ✅ AI-optimized screenshot compression

**Available Tools:**
- `app_launch` - Start the application
- `screenshot` - Capture compressed screenshots
- `click`, `click_by_text`, `click_by_role` - UI interaction
- `keyboard_type`, `keyboard_press` - Text input and shortcuts
- `evaluate` - Execute JavaScript in app context
- `wait_for_selector` - Wait for elements
- `snapshot` - Get accessibility tree
- `close` - End testing session

**Testing Workflow:**
1. Make code changes
2. Build: `npm run build`
3. Launch via Circuit Electron MCP
4. Take screenshots and verify visually
5. Test interactions and functionality
6. Report results

📚 **Testing index**: See [docs/testing/README.md](docs/testing/README.md) - Complete testing guide
📚 **Quick start**: See [docs/testing/quickstart.md](docs/testing/quickstart.md)
📚 **Reference**: See [docs/testing/circuit-electron-guide.md](docs/testing/circuit-electron-guide.md)
📚 **Test scenarios**: See [docs/testing/ui-scenarios.md](docs/testing/ui-scenarios.md) and [interaction-scenarios.md](docs/testing/interaction-scenarios.md)

## Claude Code Integration (Future)

Planned integration using Claude Agent SDK:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

for await (const message of query(prompt, {
  tools: ['Edit', 'Read'],
  permissionMode: 'acceptEdits',
  workingDirectory: projectPath
})) {
  mainWindow.webContents.send('claude:message', message)
}
```

**Roadmap:**
- [ ] ClaudeService implementation
- [ ] Text selection → prompt flow
- [ ] Streaming response UI
- [ ] Terminal integration (when node-pty fixed)

## Contributing

When adding features:
1. Follow existing patterns (Service classes, secure IPC, OOP)
2. Add TypeScript types for everything
3. Validate all IPC inputs in main process
4. Update relevant docs/ files
5. Test with `npm run dev`

## Documentation

- [Architecture](docs/architecture.md) - Three-process model, hybrid layout architecture, tech stack, design decisions
- [IPC Patterns](docs/ipc-patterns.md) - Secure communication patterns, current channels
- [UI Components](docs/ui-components.md) - Activity bars, panel toggle system, keyboard shortcuts, panel communication
- [Markdown Editing](docs/markdown-editing.md) - Editor features, shortcuts, preview
- [Security](docs/security.md) - Security guidelines, CSP, validation patterns
- [Known Issues](docs/known-issues.md) - Current issues, resolved issues, workarounds
- [Development Tasks](docs/development-tasks.md) - Common development patterns, adding panels
- **Testing:**
  - [Testing Index](docs/testing/README.md) - Complete testing documentation hub
  - [Quick Start](docs/testing/quickstart.md) - Fast testing setup
  - [Circuit Electron Guide](docs/testing/circuit-electron-guide.md) - Complete MCP reference
  - [UI Scenarios](docs/testing/ui-scenarios.md) - UI verification tests (Scenarios 1-5)
  - [Interaction Scenarios](docs/testing/interaction-scenarios.md) - User interaction tests (Scenarios 6-10)

## Useful Resources

- [Electron Docs](https://www.electronjs.org/docs/latest/)
- [electron-vite](https://electron-vite.org/)
- [Dockview](https://dockview.dev/)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/index.html)
- [Claude Agent SDK](https://github.com/anthropics/claude-code)
