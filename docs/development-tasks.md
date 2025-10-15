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

For fixed sidebars (Project, Git, Terminal) that don't need tabbing:

**Wrapper Pattern** (recommended for panels with headers/controls):

1. Create wrapper component with header + controls:
   ```typescript
   const MyPanel = (props: ISplitviewPanelProps) => {
     const [showControl, setShowControl] = useState(true)

     return (
       <div className="my-panel">
         <div className="panel-header">
           <MyIcon />
           <span>Panel Label</span>
           <ChevronDown onClick={() => setShowControl(!showControl)} />
         </div>
         {showControl && <div className="control-panel">{/* Controls */}</div>}
         <MyContentComponent {...props} />
       </div>
     )
   }
   ```

2. Register in `splitviewComponents` in `AppDockLayout.tsx`:
   ```typescript
   const splitviewComponents = {
     myPanel: MyPanel
   }
   ```

3. Add to splitview layout in `onSplitviewReady`:
   ```typescript
   event.api.addPanel({
     id: 'my-panel',
     component: 'myPanel',
     minimumSize: 170,
     maximumSize: 600
   })
   ```

**Example**: See `ProjectPanel.tsx` (wrapper) + `ProjectTree.tsx` (content)

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
   const protectedPanels = ['project', 'terminal', 'git', 'myNewPanel']
   ```

2. Add panel title to `protectedTitles` array:
   ```typescript
   const protectedTitles = ['Project', 'Terminal', 'Git', 'My New Panel']
   ```

Protection is automatic - click interception and auto-restore work immediately.

See: [UI Components](./ui-components.md#panel-protection)

## Creating Prompt Templates

Add new AI-powered prompts for markdown preview context menu.

### 1. Create Template File

Create `src/renderer/src/prompts/templates/your-template.md`:

```markdown
---
area: markdown-preview
subArea: context-menu
name: Summarize
icon: list
targetPanel: terminal
sendDirectly: false
---
{{#if fileRef}}{{fileRef}}

{{/if}}Summarize this text in 2-3 sentences:

---
{{selectedText}}
---
```

### 2. Validate Schema

Template automatically validates against Zod schema:
- `area` (required): Context area (e.g., "markdown-preview")
- `subArea` (required): Specific location (e.g., "context-menu")
- `name` (required): Display name in UI
- `icon` (required): Lucide icon name (e.g., "list", "sparkles", "maximize2")
- `targetPanel` (optional): "claude" or "terminal" (default: "claude")
- `sendDirectly` (optional): Send immediately without review (default: false)

### 3. Use Template Variables

Available variables:
- `{{selectedText}}` - Selected text from markdown source
- `{{filePath}}` - File path
- `{{startLine}}`, `{{endLine}}` - Line numbers
- `{{fileRef}}` - File reference: `@/path/file.md:10-20`
- `{{lineRange}}` - Formatted: "line 10" or "lines 10-20"

### 4. Use Conditionals & Helpers

```handlebars
{{#if fileRef}}
  Content shown only if fileRef exists
{{/if}}

{{formatLineRange startLine endLine}}  # "line 42" or "lines 42-58"
{{basename filePath}}                   # Filename only
{{truncate selectedText 100}}           # First 100 chars
```

### 5. Test Template

1. HMR will auto-reload template in dev mode
2. Right-click markdown selection in preview
3. Verify new template appears in context menu
4. Test prompt rendering with various selections

See: [Prompt Templates](./prompt-templates.md) for detailed documentation

## Testing with Circuit Electron MCP

Circuit Electron MCP allows visual inspection and testing of Erfana UI.

```bash
# Build first
npm run build
```

**Workflow:**
1. Launch app: `app_launch({ app: "/path/to/erfana/out/main/index.js" })`
2. Interact: `click_by_text()`, `keyboard_press()`, `wait_for_selector()`
3. Verify: `screenshot()`, `evaluate()`
4. Close: `close({ sessionId })`

**Common Selectors:** `.app-dock-layout`, `.project-tree`, `.monaco-editor`, `.preview-pane`, `[title="Project"]`, `[title="Terminal"]`

See: [Testing Index](./testing/README.md) | [Circuit Electron Guide](./testing/circuit-electron-guide.md) | [Quick Start](./testing/quickstart.md) | [UI Scenarios](./testing/ui-scenarios.md)

## Testing Auto-Refresh Functionality

### File Content Auto-Refresh

Test that files automatically reload when modified externally:

```bash
# 1. Open a markdown file in Erfana
# 2. Modify it externally (e.g., with VS Code or echo)
echo "# External Change" >> /path/to/project/test.md

# Expected: File reloads automatically in Erfana
# Toolbar shows: "Reloaded from disk" (1 second)
```

Test conflict detection:

```bash
# 1. Open file in Erfana
# 2. Make unsaved changes in Erfana
# 3. Modify file externally
echo "# Conflict" >> /path/to/project/test.md

# Expected: Orange conflict bar appears
# Options: "Reload from Disk", "Keep My Version", "Dismiss"
```

Test file deletion:

```bash
# 1. Open file in Erfana
# 2. Delete file externally
rm /path/to/project/test.md

# Expected: Red warning banner appears
# Message: "This file has been deleted externally"
```

### Directory Tree Auto-Refresh

Test file creation:

```bash
# 1. Erfana project is open
# 2. Create file externally
echo "# New File" > /path/to/project/new-file.md

# Expected: File appears in tree automatically (within 1 second)
```

Test folder operations:

```bash
# 1. Expand some folders in Erfana file tree
# 2. Create folder externally
mkdir /path/to/project/new-folder

# Expected: Folder appears, expanded folders remain expanded
```

Test bulk operations (git):

```bash
# 1. Erfana project is open
# 2. Git checkout different branch
git checkout feature-branch

# Expected: Tree refreshes once after all changes settle (~1 second)
# Expanded folders remain expanded
```

Test internal CRUD operations:

```typescript
// 1. Create file via Erfana UI
// 2. Check console logs
// Expected logs:
// "⏸️  Paused directory watch"
// "▶️  Resumed directory watch"
// No "📁 Directory changed" message (watcher was paused)
```

### Testing Pause/Resume Pattern

Verify no double-refresh during internal operations:

```typescript
// Add debug logging to ProjectTree.tsx
const handleCreateFile = async () => {
  console.log('1. Starting create file')
  isInternalOperation.current = true
  await window.api.directoryWatch.pause(projectPath)

  console.log('2. Creating file')
  await window.api.file.createFile(targetPath, fileName)

  console.log('3. Refreshing tree')
  await refreshFileTree()

  console.log('4. Resuming watch')
  await window.api.directoryWatch.resume(projectPath)
  isInternalOperation.current = false
}

// Expected console output (no duplicate refresh):
// 1. Starting create file
// 2. Creating file
// 3. Refreshing tree
// 4. Resuming watch
```

See: [File Watching](./file-watching.md) | [Testing Index](./testing/README.md)

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
