# Erfana

**Claude-Powered Project IDE for Consulting and Research Work**

Erfana is an Electron desktop application that provides an integrated development environment specifically designed for managing consulting and research projects with Claude Code integration.

## Features

- 🎨 **Multi-Panel IDE Layout**: Drag-and-drop, resizable panels powered by Dockview
- 📝 **Markdown Editor**: Monaco Editor with live preview and split view support
- 🤖 **Claude Code Integration**: Direct integration with Claude Agent SDK for AI-powered editing
- 📁 **Project Management**: Project tree explorer with markdown file focus
- 🔄 **Git Integration**: Visual git status, diff viewer, and commit management
- 💻 **Integrated Terminal**: xterm.js terminal for running Claude Code CLI commands
- ⚡ **Text Selection Prompts**: Select text and prompt Claude to edit in place

## Tech Stack

- **Electron** + **electron-vite**: Modern Electron development
- **React** + **TypeScript**: UI framework with full type safety
- **Dockview**: VS Code-like docking panel system
- **Monaco Editor**: VS Code's editor engine for code editing
- **xterm.js**: Terminal emulator for Claude Code CLI
- **Claude Agent SDK**: Official TypeScript SDK for Claude integration
- **simple-git**: Git operations
- **electron-store**: Settings persistence

## Development

### Prerequisites

- Node.js 18+ (with npm or pnpm)
- Git
- Claude Code CLI (for AI features)

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
│   │   └── services/      # Business logic (Git, Claude, etc.)
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
│       │   │   └── Git/             # Git integration
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
- File system operations
- Git integration via simple-git
- Claude Agent SDK wrapper
- IPC handlers

### Preload
- Secure contextBridge API
- Type-safe IPC channels

### Renderer
- React-based UI
- Dockview panel system
- Monaco Editor for markdown
- xterm.js terminal
- State management with Zustand

## Key Workflows

### 1. Edit Selection with Copilot
1. Open a markdown file
2. Select text
3. Right-click and choose "Ask Copilot..." action
4. Enter prompt (e.g., "make this more concise")
5. Copilot streams changes in real-time
6. Review and iterate

### 2. Terminal-Driven Development
1. Use integrated terminal
2. Run `claude -p "your prompt"`
3. Watch streaming responses
4. Changes appear in editor
5. Git shows modifications

### 3. Project Management
1. Open project folder
2. Browse file tree
3. Open multiple files in tabs
4. Split editor for source/preview
5. Git integration for version control

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
