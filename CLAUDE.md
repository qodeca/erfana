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
3. **Renderer Process** (`src/renderer/`): React UI with Dockview panels, no Node.js access

**Key Technologies:**
- electron-vite (build tool)
- Dockview (VS Code-like panels)
- Monaco Editor (markdown editing)
- react-markdown + remark-gfm (preview)
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
    │   ├── DockLayout/    # Panel system
    │   ├── Toolbar/       # Top toolbar with toggle buttons
    │   ├── Panels/        # Panel implementations
    │   ├── Editor/        # Monaco + Preview
    │   └── FileTree/      # File explorer
    ├── hooks/             # React hooks
    └── App.tsx            # Root component
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
- `FileService.ts` - File operations
- `GitService.ts` - Git operations (future)
- `ClaudeService.ts` - Claude SDK wrapper (future)

```typescript
export class MyService {
  constructor(private config: Config) {}
  async doWork(): Promise<Result> { /* ... */ }
}
export const myService = new MyService(config)
```

### Dockview Panels

Add panels by creating component, registering in `AppDockLayout.tsx`, and adding to layout.

📚 **Panel setup guide**: See [docs/development-tasks.md](docs/development-tasks.md#adding-dockview-panel)

## Markdown Editing

Superior markdown capabilities with Monaco Editor + live preview:
- **Editor**: Monaco with word wrap, standard text editing shortcuts
- **Preview**: GitHub-styled with GFM support, syntax highlighting
- **View Modes**: Editor only, split view (default), preview only

📚 **Markdown features**: See [docs/markdown-editing.md](docs/markdown-editing.md)

## UI & Keyboard Shortcuts

**Toolbar**: VS Code-style toolbar at top with icon-only toggle buttons for Explorer, Terminal, Git panels.

**Global Keyboard Shortcuts** (work anywhere in app):
- `Cmd/Ctrl+B` - Toggle left sidebar (Explorer)
- `Cmd/Ctrl+J` - Toggle bottom panel (Terminal)
- `Cmd/Ctrl+Alt+B` - Toggle right sidebar (Git)

**Panel Behavior**:
- Toggle hides/shows entire sidebar areas (not individual tabs)
- Preserves panel dimensions when toggling
- State persisted to localStorage

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

- **node-pty**: Build fails on Python 3.13 - terminal panel deferred
- **Dockview CSS**: Use `dockview/dist/styles/dockview.css` path
- **Monaco CDN**: Loads workers from CDN (offline mode future enhancement)

📚 **All known issues**: See [docs/known-issues.md](docs/known-issues.md)

## Common Tasks

### Adding New IPC Channel
1. Define in `src/preload/index.ts` with types
2. Create handler in `src/main/ipc/*-handlers.ts` with validation
3. Register in `src/main/index.ts`
4. Call from renderer via `window.api.*`

### Adding New Panel
1. Create `src/renderer/src/components/Panels/MyPanel.tsx`
2. Register in `AppDockLayout.tsx` components object
3. Add panel via `event.api.addPanel()` in layout

### Debugging
- **Main Process**: Terminal output (`console.log`)
- **Renderer**: Chrome DevTools (F12)
- **IPC**: Log both sides to trace calls

📚 **Detailed development tasks**: See [docs/development-tasks.md](docs/development-tasks.md)

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

- [Architecture](docs/architecture.md) - Three-process model, tech stack, design decisions
- [IPC Patterns](docs/ipc-patterns.md) - Secure communication patterns, current channels
- [UI Components](docs/ui-components.md) - Toolbar, panel toggle, keyboard shortcuts, panel protection
- [Markdown Editing](docs/markdown-editing.md) - Editor features, shortcuts, preview
- [Security](docs/security.md) - Security guidelines, CSP, validation patterns
- [Known Issues](docs/known-issues.md) - Current issues and workarounds
- [Development Tasks](docs/development-tasks.md) - Common development patterns

## Useful Resources

- [Electron Docs](https://www.electronjs.org/docs/latest/)
- [electron-vite](https://electron-vite.org/)
- [Dockview](https://dockview.dev/)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/index.html)
- [Claude Agent SDK](https://github.com/anthropics/claude-code)
