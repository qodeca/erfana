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

   > Note: panel content is non-selectable by default – dockview applies `user-select: none` to panel chrome and the rule cascades into your component. To make a data-bearing surface inside your panel selectable, add its selector to the grouped rule in `src/renderer/src/styles/utilities.css` and add a row to `src/renderer/src/styles/userSelect.audit.test.ts`. See [Text selection policy](./ui-style-guide.md#text-selection-policy) for the decision rules and the CSS-module exception (`.metadataItem` / `.errorMessage` in `ImageViewerPanel.module.css` stay in-place because build-time class-name hashing prevents the central selector from matching them).

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

## Adding import converters

The import pipeline uses `ConverterRegistry` to match file extensions to converters implementing `IConverter`. Built-in converters: `LiteParseConverter` (PDF/Office/image), `TextConverter`, `AudioConverter`, `VideoConverter`.

1. Create converter in `src/main/services/import/converters/MyConverter.ts` implementing `IConverter` (see `src/main/services/import/types.ts` for the interface)
2. Register in `registerBuiltInConverters()` in `src/main/services/import/ConverterRegistry.ts`
3. Export from `src/main/services/import/index.ts`

**Configurable converters**: If your converter needs per-import options, implement `IConfigurableConverter` and the `createConfigured(options)` method. `ImportService` detects this via the `isConfigurableConverter()` type guard – no `instanceof` checks needed.

**Dynamic extensions**: If extensions depend on runtime tool availability, use `ConverterRegistry.updateConverterExtensions(category, extensions)` after detection completes (see `DependencyDetector` pattern).

**Example**: See `LiteParseConverter.ts` (document import with OCR) or `AudioConverter.ts` (transcription).

See: [API Services – Features](./api-services-features.md) for service documentation

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
- `targetPanel` (optional): "terminal" (default: "terminal")
- `sendDirectly` (optional): Send immediately without review (default: false)
- `mutatesDocument` (optional, v0.10.0): Set to `true` if the template edits the source file in place; otherwise omit. When `true`, the canonical apply-to-document footer is composed onto the rendered prompt at the render funnel (`panelUtils.executePromptTemplate` → `withApplyFooter` from `prompts/applyFooter.ts`) — the body must NOT also say "return only the code block" / "no commentary" / "no explanation" or the competing instruction will re-introduce the non-determinism the footer exists to prevent. Also add `'filePath'` to the template's entry in `PROMPT_REQUIREMENTS` (`prompts/validation.ts`) so the footer's `{{fileRef}}` can never render empty. See [docs/prompts/README.md § Mutation prompts and the apply-to-document footer](./prompts/README.md#mutation-prompts-and-the-apply-to-document-footer).

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

See: [Prompt Templates](./prompts/README.md) for detailed documentation

## Executing Prompt Templates Programmatically

Use the centralized `executePromptTemplate()` function to trigger prompts from UI buttons, keyboard shortcuts, or event handlers.

### Basic Usage

```typescript
import { executePromptTemplate } from '../utils/panelUtils'
import type { PromptVariables } from '../prompts/types'

// Prepare template variables
const variables: PromptVariables = {
  selectedText: 'User selected text',
  filePath: '/path/to/file.md',
  startLine: 10,
  endLine: 20,
  lineRange: 'lines 10-20',
  fileRef: '@/path/to/file.md:10-20',
  userInput: 'Optional user input from dialog'
}

// Execute template by ID
const success = await executePromptTemplate('explain', variables)
```

### Example: Button Click Handler

```typescript
const handleExplainClick = async () => {
  const variables: PromptVariables = {
    selectedText: getCurrentSelection(),
    filePath: currentFile.path,
    startLine: selectionStart,
    endLine: selectionEnd,
    lineRange: formatLineRange(selectionStart, selectionEnd),
    fileRef: `@${currentFile.path}:${selectionStart}-${selectionEnd}`
  }

  await executePromptTemplate('explain', variables)
  // Prompt automatically sent to target panel (Terminal)
  // autoExecute, sendDirectly handled automatically
}
```

### With User Input Collection

For templates with `requiresInput: true` (like "modify"):

```typescript
const handleModifyClick = async () => {
  // Show input dialog first
  const userInput = await showUserInputDialog(selectedText)

  if (!userInput) return // User cancelled

  const variables: PromptVariables = {
    selectedText: getCurrentSelection(),
    filePath: currentFile.path,
    userInput,  // Pass user input to template
    // ... other variables
  }

  await executePromptTemplate('modify', variables)
}
```

### Benefits of Centralized Execution

- **Single Source of Truth**: All prompts use same execution logic
- **Automatic Handling**: `targetPanel`, `sendDirectly`, `autoExecute` handled automatically
- **Consistent Behavior**: Works same way from context menus, buttons, shortcuts
- **Easy Maintenance**: Update execution logic in one place

### Available Templates

Get template IDs dynamically:

```typescript
import { getAllPromptIds, getPromptsForArea } from '../prompts/registry'

// All templates
const allIds = getAllPromptIds()  // ['explain', 'modify', 'mermaid-bug-report']

// Templates for specific area
const contextMenuPrompts = getPromptsForArea('markdown-preview', 'context-menu')
```

**Implementation**: `panelUtils.ts:executePromptTemplate()`

See: [Prompt Templates](./prompts/README.md) for centralized prompt execution

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

See: [Testing Index](./testing/README.md) | [Test Scenarios](./testing/test-scenarios.md)

## Testing Auto-Refresh

File and directory watching with chokidar provides automatic refresh on external changes.

**Test Scenarios:**
- File content reload (300ms debounce) - modify file externally, expect auto-reload
- Conflict detection - unsaved changes + external modification shows conflict UI
- Directory tree refresh (75 ms collect + 200 ms throttle main side, 250 ms renderer debounce) - external file/folder create/delete/rename and in-place edits appear automatically; git badges update on edits via the chokidar `change` listener (#241)
- Pause/resume pattern - internal CRUD operations don't trigger duplicate refreshes

See: [File Watching](./file-watching/README.md) for detailed testing instructions

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
