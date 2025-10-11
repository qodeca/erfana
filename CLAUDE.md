# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Erfana** is an Electron desktop IDE specifically designed for managing consulting and research projects with Claude Code integration. It provides a multi-panel workspace with markdown editing, git integration, and direct Claude AI assistance.

## Development Commands

### Running the App
```bash
npm run dev          # Start development server with hot reload
npm start            # Start app in production mode
```

### Building
```bash
npm run build        # Build for production
npm run build:mac    # Build macOS app
npm run build:win    # Build Windows app
npm run build:linux  # Build Linux app
```

### Code Quality
```bash
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run typecheck    # Type-check all TypeScript files
```

## Architecture

### Three-Process Model
Erfana follows Electron's standard architecture:

1. **Main Process** (`src/main/`): Node.js environment
   - Window lifecycle management
   - File system operations
   - Native OS integration
   - IPC request handlers

2. **Preload Script** (`src/preload/`): Secure bridge
   - Exposes safe APIs via `contextBridge`
   - Type-safe IPC channels
   - NO direct Node.js access in renderer

3. **Renderer Process** (`src/renderer/`): React UI
   - All UI components
   - Dockview panel system
   - No Node.js integration (security)

### Key Technologies

- **electron-vite**: Build tool optimized for Electron + Vite
- **Dockview**: Panel docking system (VS Code-like)
- **Monaco Editor**: Code editor (VS Code's engine)
- **@xterm/xterm**: Terminal emulator
- **@anthropic-ai/claude-agent-sdk**: Claude AI integration
- **simple-git**: Git operations
- **electron-store**: Persistent settings

## Project Structure

```
src/
├── main/
│   ├── index.ts              # Main process entry point
│   ├── services/             # Business logic classes (OOP)
│   │   ├── ClaudeService.ts  # Claude Agent SDK wrapper
│   │   ├── GitService.ts     # Git operations
│   │   ├── ProjectService.ts # Project/workspace management
│   │   └── FileWatchService.ts # File watching with chokidar
│   └── ipc/                  # IPC handlers organized by domain
│       ├── claude-handlers.ts
│       ├── file-handlers.ts
│       └── git-handlers.ts
│
├── preload/
│   ├── index.ts              # contextBridge setup
│   └── index.d.ts            # Type definitions for window.api
│
└── renderer/
    ├── index.html
    └── src/
        ├── components/
        │   ├── DockLayout/       # Dockview setup
        │   ├── Panels/           # Panel implementations
        │   ├── Editor/           # Monaco Editor wrapper
        │   ├── Terminal/         # xterm.js wrapper
        │   ├── FileTree/         # Project file explorer
        │   └── Git/              # Git UI components
        ├── hooks/                # React hooks
        ├── stores/               # Zustand state stores
        ├── types/                # TypeScript type definitions
        ├── App.tsx               # Root component
        └── main.tsx              # React entry point
```

## Important Patterns

### IPC Communication

**Secure Pattern (ALWAYS use this):**

1. Define IPC channel in preload:
```typescript
// src/preload/index.ts
const api = {
  openProject: (path: string) => ipcRenderer.invoke('project:open', path)
}
contextBridge.exposeInMainWorld('api', api)
```

2. Handle in main process:
```typescript
// src/main/ipc/file-handlers.ts
ipcMain.handle('project:open', async (_event, path: string) => {
  // Validate input!
  if (!isValidPath(path)) throw new Error('Invalid path')
  return await projectService.open(path)
})
```

3. Call from renderer:
```typescript
// src/renderer/src/components/...
const result = await window.api.openProject('/path/to/project')
```

### Service Classes (OOP)

Services encapsulate business logic:

```typescript
// src/main/services/GitService.ts
export class GitService {
  private git: SimpleGit

  constructor(private projectPath: string) {
    this.git = simpleGit(projectPath)
  }

  async getStatus(): Promise<StatusResult> {
    return await this.git.status()
  }

  async commit(message: string): Promise<void> {
    await this.git.commit(message)
  }
}
```

### Dockview Panels

Add new panels by:

1. Create component:
```typescript
// src/renderer/src/components/Panels/MyPanel.tsx
export const MyPanel = (props: IDockviewPanelProps) => {
  return <div>Content</div>
}
```

2. Register in DockLayout:
```typescript
// src/renderer/src/components/DockLayout/AppDockLayout.tsx
const components = {
  myPanel: MyPanel,
  // ... other panels
}
```

3. Add panel programmatically:
```typescript
event.api.addPanel({
  id: 'myPanel',
  component: 'myPanel',
  title: 'My Panel'
})
```

## Known Issues & Workarounds

### node-pty Build Issue
- **Problem**: node-pty fails to build on Python 3.13 (missing `distutils`)
- **Workaround**: Terminal feature is deferred. Use Claude Agent SDK directly for now.
- **Solution**: Switch to Python 3.12 or wait for node-pty update

### Monaco Editor in Electron
- **Loading**: Monaco loads from CDN by default. For offline use, configure local loading:
```typescript
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

self.MonacoEnvironment = {
  getWorker: () => new editorWorker()
}
```

### Dockview Styling
- Import CSS: `import 'dockview/dist/styles.css'`
- Use dark theme class: `dockview-theme-dark`
- Custom CSS variables for colors (see `AppDockLayout.css`)

## Security Considerations

### Context Isolation
- **ALWAYS ENABLED**: `contextIsolation: true` in BrowserWindow
- Never disable for convenience
- Use contextBridge for all IPC

### IPC Validation
- **Validate all inputs** in main process handlers
- Check file paths, sanitize strings
- Never trust renderer input

### CSP Headers
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self';
               style-src 'self' 'unsafe-inline';
               font-src 'self' data:" />
```

### No Node Integration
- `nodeIntegration: false` in renderer
- Use preload script for Node.js features

## Testing Strategy

### Unit Tests
- Service classes in `src/main/services/`
- React components with React Testing Library
- IPC handlers (mock ipcMain/ipcRenderer)

### Integration Tests
- Full IPC flow (main ↔ renderer)
- File operations end-to-end
- Git operations

### Manual Testing
```bash
npm run dev
# Test:
# 1. Open project folder
# 2. Navigate file tree
# 3. Open markdown file
# 4. Run Claude prompt
# 5. Check git status
```

## Common Development Tasks

### Adding a New IPC Channel
1. Add to preload API with types
2. Create handler in main process
3. Call from renderer component
4. Test with dev tools

### Adding a New Panel
1. Create panel component
2. Register in DockLayout
3. Add panel in layout setup
4. Style with CSS

### Integrating a New Library
1. `npm install library-name`
2. If main process: Import in service
3. If renderer: Import in component
4. Update types if needed

### Debugging
- **Main Process**: `console.log()` appears in terminal
- **Renderer**: Use Chrome DevTools (F12)
- **IPC**: Log both sides to trace communication
- **Electron DevTools**: Automatically opens in dev mode

## Claude Code Integration

### Using Claude Agent SDK
```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

for await (const message of query(prompt, {
  tools: ['Edit', 'Read'],
  permissionMode: 'acceptEdits',
  workingDirectory: projectPath
})) {
  // Stream messages to renderer via IPC
  mainWindow.webContents.send('claude:message', message)
}
```

### Terminal Integration (Future)
When node-pty is working:
```typescript
// Spawn Claude Code CLI
const pty = spawn('claude', ['-p', prompt], {
  name: 'xterm-color',
  cols: 80,
  rows: 30
})

// Stream to xterm.js in renderer
pty.on('data', (data) => {
  terminal.write(data)
})
```

## Performance Tips

- **Monaco**: Use single editor instance, switch models for files
- **Dockview**: Lazy-load panel content when possible
- **File Watching**: Debounce file change events
- **Git**: Cache status, only refresh on user action
- **IPC**: Batch updates instead of individual messages

## Build & Release

### Development Build
```bash
npm run build        # Creates out/ directory
```

### Production Build
```bash
npm run build:mac    # Creates release/0.1.0/
```

### Auto-Update (Future)
- Configure `publish` in electron-builder.yml
- Set up release server
- Sign apps (macOS requires signing)

## Contributing

When adding features:
1. Follow existing patterns (Service classes, IPC, etc.)
2. Add TypeScript types
3. Validate IPC inputs
4. Update this CLAUDE.md if architecture changes
5. Test with `npm run dev`

## Useful Resources

- [Electron Docs](https://www.electronjs.org/docs/latest/)
- [electron-vite Docs](https://electron-vite.org/)
- [Dockview Docs](https://dockview.dev/)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/index.html)
- [Claude Agent SDK](https://github.com/anthropics/claude-code)
- [xterm.js Docs](https://xtermjs.org/)
