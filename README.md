# Erfana

An Electron-based project workspace focused on markdown editing, a project tree, and an integrated terminal.

> **Version:** 0.9.2 ([changelog](docs/CHANGELOG.md)) · **Documentation:** [docs/](docs/README.md) · **Architecture:** [docs/architecture.md](docs/architecture.md)
>
> **Windows enablement:** Phases 0–2 landed on the [`windows` branch](https://github.com/qodeca/erfana/tree/windows) (2026-04-21). See [`docs/windows/README.md`](docs/windows/README.md) for status, and [Windows known issues](docs/known-issues.md#windows-specific-issues) for current gaps.

## Features

- 🎨 **Multi-Panel IDE Layout**: Hybrid SplitviewReact + DockviewReact with resizable panels
- 📝 **Superior Markdown Editing**: Monaco Editor with live preview, scroll sync, Mermaid diagrams, and formatting toolbar
- 📁 **Smart Project Management**: Project tree with markdown filtering, visual indicators, and context menu operations
- 🔄 **Auto-Refresh**: Automatic file and directory tree updates on external changes
- 💻 **Integrated Terminal**: Full-featured xterm.js terminal with WebGL rendering and traditional zsh prompt
 - ⚡ **AI-Powered Text Operations**: Right-click context menu with prompt templates for text elaboration, improvement, and more (send to Terminal)

## Tech Stack

- **Electron** + **electron-vite**: Modern Electron development
- **React** + **TypeScript**: UI framework with full type safety
- **SplitviewReact** + **DockviewReact**: Hybrid layout system matching VS Code architecture
- **Monaco Editor**: VS Code's editor engine for code editing
- **xterm.js** + **node-pty**: Full-featured terminal emulator with PTY support
- **electron-store**: Settings persistence
- **Mermaid.js**: Diagram rendering (22 diagram types)

## Development

### Prerequisites

- Node.js 24+ (Electron 39 bundles Node 22.20.0; build toolchain needs 24+)
- Python 3.12 (**not 3.13** — `node-pty` fails to build on 3.13)
- Git
- **On Windows**: VS 2022 Build Tools, Developer Mode enabled, Win32 long paths enabled. See [`docs/build/windows.md`](docs/build/windows.md) for full setup.

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Package for distribution
npm run build:mac   # macOS
npm run build:win   # Windows
npm run build:linux # Linux
```

### Project Structure

```
erfana/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # App entry point
│   │   └── services/      # Business logic (Terminal, File, Settings)
│   ├── preload/           # Secure IPC bridge
│   │   └── index.ts       # contextBridge API
│   └── renderer/          # React UI
│       ├── src/
│       │   ├── components/
│       │   │   ├── DockLayout/      # Dockview setup
│       │   │   ├── Panels/          # Panel components
│       │   │   ├── Editor/          # Monaco editor
│       │   │   ├── Terminal/        # xterm.js
│       │   │   ├── ProjectTree/     # Project explorer
│       │   │   └── Toolbar/         # Editor toolbar
│       │   ├── hooks/               # React hooks
│       │   ├── stores/              # State management
│       │   └── types/               # TypeScript types
│       └── index.html
├── resources/             # App icons and assets
└── electron-builder.yml  # Build configuration
```

## Architecture

### Main Process
- Window management
- File system operations (with auto-refresh via chokidar)
- Claude CLI session management (persistent process with JSONL I/O)
- Terminal PTY management (xterm.js + node-pty)
- IPC handlers (reduced after feature cleanup)

### Preload
- Secure contextBridge API
- Type-safe IPC channels

### Renderer
- React-based UI with hybrid SplitviewReact + DockviewReact layout
- Dual activity bars (left/right) for panel management
- Monaco Editor with formatting toolbar and document statistics
- Markdown preview with scroll sync and Mermaid diagram support
- xterm.js terminal with WebGL rendering
- Prompt template system (CSP-safe, YAML frontmatter + Handlebars-style syntax)
- State management with Zustand

## Key Workflows

### 1. AI-Powered Text Operations
1. Open a markdown file in split view (editor + preview)
2. Select text in the preview pane
3. Right-click and choose prompt template (Explain, Modify, Ask, Visualize, or custom)
4. Prompt is sent to the Terminal panel based on template configuration
5. Review AI response and iterate
6. File references include precise line numbers for context

### 2. Terminal Usage
Open the Terminal panel from the right activity bar to run shell commands in the project context. cmd.exe / PowerShell / pwsh 7 + POSIX shells supported (Phase 1 #154).

### 3. Markdown Editing
1. Open markdown files in Monaco editor
2. Use formatting toolbar for quick markdown syntax
3. Switch view modes: Editor only, Split view (with scroll sync), or Preview only
4. Preview renders Mermaid diagrams (22 types supported)
5. Auto-save after 2 seconds of inactivity
6. Document statistics displayed in bottom bar

### 4. Project Management
1. Open project folder (auto-loads last project on startup)
2. Browse file tree with markdown filtering
3. Visual indicators for sensitive files and hidden files
4. Context menu for New File, New Folder, Rename, Delete
5. Auto-refresh on external changes (git operations, npm installs, etc.)
6. Multiple files open in tabs with independent state

## Security

- Context isolation enabled
- No node integration in renderer
- Secure IPC via contextBridge
- Content Security Policy (CSP) headers
- Input validation on all IPC channels

## License

MIT

## Author

Marcin Obel
