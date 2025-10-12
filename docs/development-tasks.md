# Common Development Tasks

## Adding New IPC Channel

1. Define in `src/preload/index.ts`:
   ```typescript
   const api = {
     myFeature: {
       doSomething: (arg: string) => ipcRenderer.invoke('my:action', arg)
     }
   }
   ```

2. Add handler in `src/main/ipc/my-handlers.ts`:
   ```typescript
   export function registerMyHandlers() {
     ipcMain.handle('my:action', async (_event, arg: string) => {
       // Validate arg
       return result
     })
   }
   ```

3. Register in `src/main/index.ts`:
   ```typescript
   import { registerMyHandlers } from './ipc/my-handlers'

   app.whenReady().then(() => {
     registerMyHandlers()
   })
   ```

4. Call from renderer:
   ```typescript
   await window.api.myFeature.doSomething('value')
   ```

## Adding Panels

### Adding Splitview Panel (Sidebar)

For fixed sidebars (Explorer, Git, Terminal) that don't need tabbing:

1. Create splitview panel component:
   ```typescript
   const MySidebarPanel = (props: ISplitviewPanelProps) => {
     return <div className="panel-content">My Sidebar Content</div>
   }
   ```

2. Register in `splitviewComponents` in `AppDockLayout.tsx`:
   ```typescript
   const splitviewComponents = {
     mySidebar: MySidebarPanel
   }
   ```

3. Add to splitview layout in `onSplitviewReady`:
   ```typescript
   event.api.addPanel({
     id: 'my-sidebar',
     component: 'mySidebar',
     minimumSize: 170,
     maximumSize: 600
   })
   ```

### Adding Dockview Panel (Editor Tab)

For editor tabs that should appear in the center area:

1. Create panel component:
   ```typescript
   const MyEditorPanel = (props: IDockviewPanelProps) => {
     return <div>My Editor Content</div>
   }
   ```

2. Register in `editorComponents` inside `EditorAreaSplitPanel`:
   ```typescript
   const editorComponents = {
     myEditor: MyEditorPanel
   }
   ```

3. Open programmatically via DockviewApi:
   ```typescript
   dockviewApi.addPanel({
     id: 'my-editor-1',
     component: 'myEditor',
     title: 'My File',
     params: { filePath: '/path/to/file' }
   })
   ```

**Note**: The center `EditorAreaSplitPanel` contains the DockviewReact instance. File opening happens via `dockviewApi` passed through params.

See: [Architecture](./architecture.md#hybrid-layout-architecture) | [UI Components](./ui-components.md#panel-communication-pattern)

## Adding Service Class

1. Create `src/main/services/MyService.ts`:
   ```typescript
   export class MyService {
     constructor(private config: Config) {}

     async doWork(): Promise<Result> {
       // Implementation
     }
   }

   export const myService = new MyService(config)
   ```

2. Use in IPC handler or main process

## Using SettingsService

SettingsService provides persistent storage using electron-store.

**Pattern**: All methods are async due to dynamic ES Module import.

```typescript
// In IPC handler
import { settingsService } from '../services/SettingsService'

ipcMain.handle('file:openProject', async () => {
  const projectPath = result.filePaths[0]

  // Save to settings (async)
  await settingsService.setLastProjectPath(projectPath)

  return projectPath
})

ipcMain.handle('file:getLastProjectPath', async () => {
  // Retrieve from settings (async)
  const lastPath = await settingsService.getLastProjectPath()

  if (lastPath) {
    // Verify folder still exists
    const stats = await stat(lastPath)
    if (stats.isDirectory()) {
      return lastPath
    } else {
      // Clean up invalid path
      await settingsService.clearLastProjectPath()
    }
  }

  return null
})
```

**Why Dynamic Import**: electron-store v11+ is an ES Module. See [Known Issues](./known-issues.md#electron-store-es-module-import).

## Working with Panel State

### Reading Panel State

```typescript
// Get current state from localStorage
const state = localStorage.getItem('erfana-sidebar-state')
const parsed = JSON.parse(state)

console.log(parsed.leftSidebar.visible)  // boolean
console.log(parsed.leftSidebar.width)    // number (px)
```

### Updating Panel State

```typescript
// Update state programmatically
const updateSidebarState = (sidebarId: string, updates: any) => {
  setSidebarStates((prev) => {
    const newState = {
      ...prev,
      [sidebarId]: { ...prev[sidebarId], ...updates }
    }
    localStorage.setItem('erfana-sidebar-state', JSON.stringify(newState))
    return newState
  })
}
```

### Resetting Panel State

```typescript
// Clear state to force defaults on next load
localStorage.removeItem('erfana-sidebar-state')
```

### Adding New Protected Panel

1. Add panel ID to `protectedPanels` array:
   ```typescript
   const protectedPanels = ['fileExplorer', 'terminal', 'git', 'myNewPanel']
   ```

2. Add panel title to `protectedTitles` array:
   ```typescript
   const protectedTitles = ['Explorer', 'Terminal', 'Git', 'My New Panel']
   ```

Protection is automatic - click interception and auto-restore work immediately.

See: [UI Components](./ui-components.md#panel-protection)

## Testing with Circuit Electron MCP

Circuit Electron MCP allows Claude Code to visually inspect and test Erfana UI.

### Quick Test After Code Changes

```bash
# 1. Build first
npm run build

# 2. Use Circuit Electron MCP
```

```typescript
// Launch and screenshot
const s = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/out/main/index.js",
  compressScreenshots: true
})

mcp__circuit-electron__screenshot({ sessionId: s.sessionId })
mcp__circuit-electron__close({ sessionId: s.sessionId })
```

### Testing New Feature

```typescript
// 1. Launch app
const s = mcp__circuit-electron__app_launch({ app: "..." })

// 2. Navigate to feature
mcp__circuit-electron__click_by_text({ sessionId: s.sessionId, text: "Feature Name" })
mcp__circuit-electron__wait_for_selector({ sessionId: s.sessionId, selector: ".feature-element" })

// 3. Screenshot
mcp__circuit-electron__screenshot({ sessionId: s.sessionId })

// 4. Verify
const works = mcp__circuit-electron__evaluate({
  sessionId: s.sessionId,
  expression: "document.querySelector('.expected-result') !== null"
})

// 5. Close
mcp__circuit-electron__close({ sessionId: s.sessionId })
```

### Testing Keyboard Shortcut

```typescript
const s = mcp__circuit-electron__app_launch({ app: "..." })

// Press shortcut (e.g., Cmd+B)
mcp__circuit-electron__keyboard_press({
  sessionId: s.sessionId,
  key: "b",
  modifiers: ["Meta"]
})

// Verify result
mcp__circuit-electron__screenshot({ sessionId: s.sessionId })
const hidden = mcp__circuit-electron__evaluate({
  sessionId: s.sessionId,
  expression: "!document.querySelector('[title=\"Explorer\"]')?.parentElement.offsetParent"
})

mcp__circuit-electron__close({ sessionId: s.sessionId })
```

### Verifying UI Changes

```typescript
// Before changes - baseline screenshot
const s = mcp__circuit-electron__app_launch({ app: "..." })
mcp__circuit-electron__screenshot({ sessionId: s.sessionId })

// Make code changes, rebuild, relaunch
const s2 = mcp__circuit-electron__app_launch({ app: "..." })
mcp__circuit-electron__screenshot({ sessionId: s2.sessionId })

// Compare visually or programmatically
const newState = mcp__circuit-electron__evaluate({
  sessionId: s2.sessionId,
  expression: "/* check new behavior */"
})
```

### Common Test Selectors

| Element | Selector |
|---------|----------|
| Main layout | `.app-dock-layout` |
| File tree | `.file-tree` |
| Monaco editor | `.monaco-editor` |
| Preview pane | `.preview-pane` |
| Save button | `button.save-btn` |
| Modified indicator | `.modified-indicator` |
| Explorer panel | `[title="Explorer"]` |
| Terminal panel | `[title="Terminal"]` |

### Available MCP Tools

- `app_launch` - Start Erfana
- `screenshot` - Capture compressed screenshot
- `click`, `click_by_text`, `click_by_role` - UI interaction
- `keyboard_type`, `keyboard_press` - Input simulation
- `evaluate` - Run JavaScript in app
- `wait_for_selector` - Wait for element
- `snapshot` - Get accessibility tree
- `close` - End session

See: [Testing Index](./testing/README.md) | [Circuit Electron Guide](./testing/circuit-electron-guide.md) | [Quick Start](./testing/quickstart.md) | [UI Scenarios](./testing/ui-scenarios.md) | [Interaction Scenarios](./testing/interaction-scenarios.md)

## Debugging

- **Main Process**: Terminal output (`console.log`)
- **Renderer**: Chrome DevTools (F12 in app)
- **IPC**: Log both sides to trace calls
- **Hot Reload**: Save file → automatic reload

## Integrating New NPM Package

1. `npm install package-name`
2. Import where needed:
   - Main/Preload: Direct import
   - Renderer: Standard React import
3. Add types if needed: `npm install -D @types/package-name`

See: [Architecture](./architecture.md) | [IPC Patterns](./ipc-patterns.md) | [UI Components](./ui-components.md)
