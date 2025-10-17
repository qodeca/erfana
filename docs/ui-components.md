# UI Components & Behavior

## Activity Bars

**Location**: `src/renderer/src/components/ActivityBar/`

Dual vertical activity bars on left and right edges (VS Code-style).

### Left Activity Bar

- **Project icon**: Toggle project tree sidebar
- **Keyboard**: `Cmd/Ctrl+B`
- **Width**: 48px fixed
- **Position**: Left edge of window

### Right Activity Bar

- **Terminal icon**: Toggle Terminal panel
  - Keyboard: `Cmd/Ctrl+J`
- **Width**: 48px fixed
- **Position**: Right edge of window

### Components

- `ActivityBar.tsx` - Main container, renders items vertically
- `ActivityBarItem.tsx` - Individual clickable item with icon
- `ActivityBarBadge.tsx` - Badge system for notifications (e.g., file count)
- `activityBarConfig.ts` - Configuration mapping (panel IDs, icons, shortcuts)

### State Management

**Zustand Store**: `src/renderer/src/stores/useActivityBarStore.ts`

Manages:
- Active panel per side (left/right)
- Sidebar widths (persisted)
- Toggle logic

**Persisted via**: Zustand persist middleware (localStorage)

### Design

- **Background**: `#333333`
- **Icons**: Lucide React (`Folder`, `Terminal`, `Bot`)
- **Active indicator**: 2px blue vertical bar on active item
- **Hover effect**: Icon color changes to white
- **Size**: 48x48px click target per item

## Copilot Panel

Removed.

## Global Toasts

Lightweight, centralized toast notifications displayed in the bottom-left corner.

- Location: `src/renderer/src/components/Toast/`
- API: global event bus via `showGlobalToast()`; React components subscribe through `ToastProvider`
- Usage: Components dispatch global toasts; a single `ToastNotification` renders them
- Position: bottom-left; types: info, success, warning, error

## Control Panels

Collapsible panels within main panels using chevron toggle pattern (matches VS Code behavior).

### Pattern

**Header with chevron toggle**:
- Panel label + ChevronDown/ChevronLeft icon (8px spacing)
- Click chevron to show/hide control panel
- Smooth 150ms rotation transition

**Implementation**:
```typescript
const [showControlPanel, setShowControlPanel] = useState(true)

<div className="panel-header">
  <PanelIcon />
  <span>Panel Label</span>
  <ChevronDown
    className={`chevron-toggle ${showControlPanel ? '' : 'collapsed'}`}
    onClick={() => setShowControlPanel(!showControlPanel)}
  />
</div>

{showControlPanel && (
  <div className="control-panel">
    {/* Controls */}
  </div>
)}
```

**CSS**:
```css
.chevron-toggle {
  cursor: pointer;
  transition: transform 0.15s ease;
}

.chevron-toggle.collapsed {
  transform: rotate(-90deg);
}
```

### Examples

**ProjectPanel**: File filtering (All Files | Markdown Only)

See: [Project Panel](./project-panel.md#control-panel)

## Project Panel

**Location**: Left sidebar, accessible via activity bar

Project panel displays hierarchical file tree with filtering, visual indicators, and context menu operations.

**Features**:
- Control panel with file filtering (All Files | Markdown Only)
- Recursive markdown filtering (shows only .md files + containing folders)
- Sensitive file detection (credentials, keys, environment files)
- Hidden file styling (dotfiles with reduced opacity)
- Context menu (New File, New Folder, Rename, Delete)
- Directory watching with auto-refresh

**Architecture**: Wrapper component (header + controls) + ProjectTree component (tree logic)

📚 **Complete documentation**: [Project Panel](./project-panel.md)

### File Visual Indicators

**Sensitive Files** (amber color + warning icon):
- Environment: `.env*`, `.npmrc`, `*.pem`, `*.key`
- Cloud: `.aws/`, `.azure/`, `.gcloud/`
- SSH: `.ssh/`, `id_rsa*`, `known_hosts`
- Secrets: `credentials*`, `secrets*`, `*.keystore`
- Config: `config.json`, `settings.json`

**Hidden Files** (70% opacity + italic):
- Files/folders starting with `.` (dot)
- Examples: `.git/`, `.gitignore`, `.DS_Store`

**Styling Priority**: Sensitive files override opacity reduction (always 100% visible)

See: [Project Panel](./project-panel.md#visual-indicators) for complete details

## Terminal Panel

**Location**: Right sidebar, accessible via activity bar

Integrated terminal emulator with native shell access using xterm.js and node-pty.

**Quick Access**:
- **Activity Bar**: Terminal icon in right sidebar (bottom position)
- **Keyboard**: `Cmd/Ctrl+J`
- **Restart Button**: X in panel header kills and restarts terminal session

**Key Features**:
- Native PTY process (zsh on macOS, bash on Linux)
- WebGL-accelerated rendering with canvas fallback
- Auto-resize on panel drag
- Bold font support
- High contrast theme (white on pure black)
- Traditional prompt format: `username directory $`
- "Send Selection to Terminal" from markdown preview context menu

**Theme**:
- Font size: 12px
- Font family: SF Mono, Monaco, Inconsolata, Courier New
- Background: #000000 (pure black)
- Foreground: #ffffff (bright white)
- Cursor: #4fc1ff (cyan)

**Technologies**:
- xterm.js v5.5.0 - Terminal emulator
- node-pty v1.0.0 - PTY backend
- WebglAddon - Hardware-accelerated rendering
- FitAddon - Auto-resize terminal to container
- WebLinksAddon - Clickable URLs

**Architecture**:
- `TerminalService.ts` - PTY management (main process)
- `terminal-handlers.ts` - IPC handlers
- `TerminalPanel.tsx` - React component with xterm.js
- `useTerminalStore.ts` - Zustand state management

**Context Menu Integration**:
Right-click selected text in markdown preview → "Send Selection to Terminal" opens terminal panel and sends text as command input.

📚 **Complete documentation**: [Terminal](./terminal.md)

## Context Menu

**Location**: `src/renderer/src/components/ContextMenu/ContextMenu.tsx`

Reusable context menu component used by Project Panel for file/folder operations.

**Features**: Rename, Delete, New File, New Folder with validation and confirmation dialogs

📚 **Complete documentation**: [Project Panel](./project-panel.md#context-menu-operations)

## Global Keyboard Shortcuts

These work **anywhere in the application**:

| Shortcut | Action | Panel |
|----------|--------|-------|
| `Cmd/Ctrl+B` | Toggle left sidebar | Project |
| `Cmd/Ctrl+J` | Toggle right panel | Terminal |

**Platform Detection**: Uses `metaKey` on macOS, `ctrlKey` on Windows/Linux

**Implementation**: `AppDockLayout.tsx` useEffect hook with keydown listener

**⚠️ NOTE**: These override Monaco Editor shortcuts with same keys. Monaco's built-in shortcuts only work when editor is focused.

See: [Editor Documentation](./editor/README.md) for editor-specific features

## Panel Toggle System

### Behavior

Matches VS Code panel toggle behavior:
- **Toggles entire splitview panel**, not individual tabs
- **Preserves panel dimensions** when hiding/showing
- **Persists state** across app restarts via Zustand
- **Resize handles work correctly** with SplitviewReact

### Implementation (New Architecture)

**Splitview Panels**:
- Left sidebar: `ProjectPanelWrapper`
- Center editor: `EditorAreaSplitPanel` (always visible)
- Right sidebar: `TerminalSplitPanel`

**Toggle Mechanism**:
```typescript
const panel = splitviewApiRef.current.getPanel(splitviewPanelId)
panel.api.setVisible(shouldShow)
```

**State Storage**: `useActivityBarStore` (Zustand with persist)
```typescript
{
  leftActivePanel: 'project' | null,
  rightActivePanel: 'terminal' | null,
  leftWidth: number,
  rightWidth: number
}
```

### Size Constraints

**Minimum sizes**:
- Left sidebar: 170px
- Right sidebar: 170px
- Center editor: 400px

**Maximum sizes**:
- Left sidebar: 600px
- Right sidebar: 600px
- Center editor: unlimited (flex-fills)

**Default sizes** (first launch):
- Left sidebar: 300px
- Right sidebar: 250px

### Resize Behavior

**SplitviewReact provides**:
- Working resize handles between panels ✅
- Proper flex-grow for center panel ✅
- Min/max constraint enforcement ✅
- Resize event listeners via `onDidSizeChange` ✅

**Implementation**: `AppDockLayout.tsx` lines 248-258

```typescript
leftPanel.api.onDidSizeChange(() => {
  const newWidth = leftPanel.api.width
  setSidebarWidth(newWidth, 'left')
})
```

## Panel Communication Pattern

**Problem**: ProjectTree needs to open files in center DockviewReact.

**Solution**: Pass DockviewApi through splitview panel params.

**Flow**:
1. `EditorAreaSplitPanel` creates DockviewReact, gets `dockviewApi`
2. Calls `setDockviewApi` callback in params → updates ref in parent
3. Parent passes `dockviewApi` to `ProjectPanelWrapper` via params
4. ProjectTree calls `dockviewApi.addPanel()` to open file tab

**Code**: `AppDockLayout.tsx` lines 208-222

## Tab Styling & Interactions

**Location**: `src/renderer/src/components/DockLayout/AppDockLayout.css`, `AppDockLayout.tsx`

Center editor tabs use VS Code-style hover effects and active indicators.

### Hover Effects

**Inactive tabs**:
```css
.dockview-theme-dark .dv-inactive-tab:hover .dv-default-tab {
  background-color: #3a3d41 !important;
}
```
- Lighter background on hover
- Color: `#3a3d41` (VS Code hover color)
- Applied to `.dv-default-tab` inside `.dv-inactive-tab`

**Active tabs**:
```css
.dockview-theme-dark .dv-active-tab:hover .dv-default-tab {
  background-color: #2d2d30 !important;
  opacity: 0.9;
}
```
- Subtle opacity change on hover
- Maintains active appearance

### Active Tab Indicator

Blue bottom border matching VS Code and activity bars:

```css
.dockview-theme-dark .dv-tab.dv-active-tab::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: #007acc !important;
  z-index: 100;
}
```

**Design**:
- 2px height
- Color: `#007acc` (matches activity bar indicator)
- Pseudo-element `::after` for layering
- Always visible (z-index: 100)

### Tab Layout

**Vertical centering**:
```css
.dockview-theme-dark .dv-default-tab {
  height: 41px;
  display: flex;
  align-items: center;
  padding-left: 12px;
  padding-right: 12px;
}
```

**Padding removal from wrappers**:
```css
.dockview-theme-dark .dv-tab.dv-inactive-tab,
.dockview-theme-dark .dv-tab.dv-active-tab {
  padding: 0;
}
```

### Focus Management

**Auto-focus on tab change** ensures the blue active indicator shows immediately:

```typescript
// Listen for active panel changes
event.api.onDidActivePanelChange((panel) => {
  if (panel) {
    // Focus the group
    panel.group.focus()

    // Focus panel content
    setTimeout(() => {
      const panelElement = panel.group.element.querySelector(
        '.panel-content, .markdown-editor-panel'
      )
      if (panelElement instanceof HTMLElement) {
        panelElement.focus()
      }
    }, 0)
  }
})
```

**Focusable panels**:
- `WelcomePanel`: Add `tabIndex={0}` to `.panel-content`
- `MarkdownEditorPanel`: Add `tabIndex={0}` to `.markdown-editor-panel`
- Remove focus outlines: `outline: none` in CSS

**Implementation**: `AppDockLayout.tsx` lines 86-100

## Welcome Tab & Panel

**Location**: `src/renderer/src/components/Panels/WelcomePanel.tsx`, `WelcomeTab.tsx`

Home icon tab (41px square) and welcome screen in center editor.

**Tab Features**:
- Non-draggable, locked
- Home icon (16px)
- CSS override removes Dockview padding

**Panel Layout**:
- Nested flex containers with `flex: 1` to fill center area
- Centered content with icon, title, description

## Development Patterns

### Adding New Activity Bar Item

1. Update `activityBarConfig.ts`:
   ```typescript
   export const LEFT_PANELS = [
     { id: 'project', icon: Folder, label: 'Project', shortcut: 'Cmd+B' },
     { id: 'myPanel', icon: MyIcon, label: 'My Panel', shortcut: 'Cmd+M' }
   ]
   ```

2. Add panel ID mapping in `AppDockLayout.tsx`

3. Create corresponding splitview panel component

### Toggling Panel Programmatically

```typescript
// Via Zustand store
const { togglePanel } = useActivityBarStore()
togglePanel('project', 'left')

// Via SplitviewApi directly
const panel = splitviewApiRef.current.getPanel('left-sidebar')
panel.api.setVisible(false)
```

### Reading Current State

```typescript
const { leftActivePanel, rightActivePanel, leftWidth, rightWidth }
  = useActivityBarStore()

console.log('Project panel visible:', leftActivePanel === 'project')
console.log('Project panel width:', leftWidth)
```

## Known Issues

**None** - Panel resizing now works correctly with SplitviewReact architecture.

Previous issue (DockviewReact panels not resizing) resolved in v0.1.0.

## Related Documentation

- [Architecture](./architecture.md) - Hybrid SplitviewReact + DockviewReact architecture
- [Editor Documentation](./editor/README.md) - Editor features and shortcuts
- [Development Tasks](./development-tasks.md) - Adding panels and components
- [Known Issues](./known-issues.md) - Current issues and workarounds
