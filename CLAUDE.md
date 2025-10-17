# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Tech Stack**: Electron 33, React 18, TypeScript 5.7, Monaco Editor, xterm.js
- **Architecture**: Hybrid SplitviewReact (layout) + DockviewReact (tabs)
- **Node Version**: 18+

## Key Commands
```bash
npm run dev          # Development server
npm run build        # Production build
npm run typecheck    # Type checking
npm run lint         # Linting
npm run build:mac    # macOS build

# Tests
npm run test         # Vitest workspace (one-shot)
npm run test:renderer
npm run test:main
npm run test:preload
```

## Project Structure
```
src/
├── main/           # Electron main process
│   ├── services/   # FileService, TerminalService, SettingsService
│   └── ipc/        # IPC handlers
├── preload/        # Context bridge API
└── renderer/       # React UI
    ├── components/ # UI components
    ├── stores/     # Zustand state
    └── prompts/    # Template system
```

## Core Features
1. **Markdown Editor** - Monaco with live preview, scroll sync, Mermaid diagrams
2. **Project Tree** - File explorer with markdown filtering, context menu
3. **Terminal** - xterm.js with PTY backend
4. **Prompt Templates** - AI text operations via context menu

## Documentation
See `docs/` folder for detailed documentation:
- [Architecture](docs/architecture.md) - System design
- [Editor Features](docs/editor/README.md) - Monaco editor, preview, scroll sync
- [Terminal](docs/terminal.md) - Terminal integration
- [Prompt Templates](docs/prompts/README.md) - Template system
- [Testing](docs/testing/README.md) - Automated and visual testing
- [Automated Testing Plan](docs/testing/automated-testing-plan.md) - Phased rollout and setup
- [Known Issues](docs/known-issues.md) - Current limitations

## Code Style & Conventions
- TypeScript strict mode enabled
- React functional components with hooks
- Zustand for state management
- IPC pattern: main/services → ipc/handlers → preload → renderer
- CSS modules for component styling
- Lucide React for icons

## Recent Changes
- Removed Copilot panel and Claude Code integration (simplified to Terminal only)
- Removed Git panel feature (unfinished)
- Improved scroll synchronization between editor and preview
- Fixed EPIPE errors during shutdown

## Working Areas
- `src/renderer/src/components/` - UI components
- `src/main/services/` - Backend services
- `docs/` - Documentation files

## Testing
- Unit/Integration: Vitest workspace across renderer, main, preload (see docs/testing/README.md).
- Visual/MCP Scenarios: See docs/testing/ui-scenarios.md and docs/testing/interaction-scenarios.md.

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12)
- electron-store requires dynamic import (ES module)
- CSP configured for security (no inline scripts)
- All dangerous HTML elements blocked in preview
