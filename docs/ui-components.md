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

- **Copilot icon**: Toggle Copilot panel (top position)
  - Keyboard: `Cmd/Ctrl+Shift+A`
- **Git icon**: Toggle Git panel
  - Keyboard: `Ctrl+Shift+G`
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
- **Icons**: Lucide React (`Folder`, `GitBranch`, `Terminal`)
- **Active indicator**: 2px blue vertical bar on active item
- **Hover effect**: Icon color changes to white
- **Size**: 48x48px click target per item

## Copilot Panel & Claude Code UI

**See**: [Claude Code UI Features](./claude-code/ui-features.md) for complete documentation.

**Quick Reference**:
- **Panel Label**: "Copilot" with status indicator dot (left of icon)
- **Location**: Right sidebar, top position in activity bar
- **Keyboard**: `Cmd/Ctrl+Shift+A`
- **Status Indicators**: Color-coded dot (🟢 green=ready, 🟡 yellow=starting, 🔴 red=error)
- **Features**: Installation check, OAuth authentication, persistent CLI session, chat interface, planning mode toggle, control panel
- **Components**:
  - `CopilotPanel.tsx` - Session management and state indicators
  - `CopilotChat.tsx` - Chat interface with Control Panel
  - `TerminalMessage.tsx` - Message rendering
  - `ToolApprovalDialog.tsx` - Tool approval modal

**Control Panel**: Shows session stats (messages, tools used, duration) and all 17 Claude Code tools with color-coded approval status (blue=approved, gray=not approved).

**Planning Mode**: Toggle between full access and read-only mode (restricts to Read, LS, Grep, Task, WebSearch, TodoWrite).

For complete documentation including session lifecycle, UI states, tool approval system, and planning mode, see [Claude Code UI Features](./claude-code/ui-features.md).

## Context Menu (Project Tree)

**Location**: `src/renderer/src/components/ProjectTree/ProjectTree.tsx`, `src/renderer/src/components/ContextMenu/ContextMenu.tsx`

Right-click context menu for files and folders in the project tree.

### Menu Items

**For Files**:
- Rename
- --- (separator)
- Delete

**For Folders**:
- New File
- New Folder
- Rename
- --- (separator)
- Delete

### Features

- Icons from Lucide React (`FilePlus`, `FolderPlus`, `Edit`, `Trash`)
- Separator isolates destructive actions (Delete)
- Danger styling for Delete action (red text on hover)
- Rename dialog with validation and error handling
- Delete confirmation dialogs

### Rename Functionality

- Pre-fills current name
- Validates for empty names and duplicates
- Sanitizes input (removes path separators)
- Prevents renaming project root
- Shows inline error messages
- Supports Enter to confirm, Escape to cancel

**IPC Channel**: `file:rename`

### Files

- `ProjectTree.tsx` - Context menu logic and handlers
- `ContextMenu.tsx` - Reusable context menu component
- `ContextMenu.css` - VS Code-style dark theme

## Global Keyboard Shortcuts

These work **anywhere in the application**:

| Shortcut | Action | Panel |
|----------|--------|-------|
| `Cmd/Ctrl+B` | Toggle left sidebar | Project |
| `Cmd/Ctrl+J` | Toggle right panel | Terminal |
| `Ctrl+Shift+G` | Toggle right panel | Git |
| `Cmd/Ctrl+Shift+A` | Toggle right panel | Copilot |

**Platform Detection**: Uses `metaKey` on macOS, `ctrlKey` on Windows/Linux

**Implementation**: `AppDockLayout.tsx` useEffect hook with keydown listener

**⚠️ NOTE**: These override Monaco Editor shortcuts with same keys. Monaco's built-in shortcuts only work when editor is focused.

See: [Markdown Editing](./markdown-editing.md) for editor-specific shortcuts

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
- Right sidebar: `GitSplitPanel` and `TerminalSplitPanel` (mutually exclusive)

**Toggle Mechanism**:
```typescript
const panel = splitviewApiRef.current.getPanel(splitviewPanelId)
panel.api.setVisible(shouldShow)
```

**State Storage**: `useActivityBarStore` (Zustand with persist)
```typescript
{
  leftActivePanel: 'project' | null,
  rightActivePanel: 'git' | 'terminal' | null,
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

Home icon tab and welcome screen in center editor.

### Welcome Tab (Tab Handle)

**Specifications**:
- Dimensions: 41px × 41px (perfect square)
- Icon: `Home` from Lucide React (16px, strokeWidth 2)
- Non-draggable: `draggable={false}` + drag event handlers
- Locked: `welcomePanel.group.locked = true`

**CSS Override** (removes Dockview padding):
```css
.dockview-theme-dark .dv-default-tab:has(.welcome-tab) {
  padding: 0 !important;
  width: 41px !important;
  min-width: 41px !important;
  max-width: 41px !important;
}

.dockview-theme-dark .dv-tab:has(.welcome-tab) {
  padding: 0 !important;
}
```

**Tab content styling**:
```css
.welcome-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 41px;
  height: 41px;
  color: #cccccc;
  cursor: pointer;
}
```

**Prevent dragging**:
```typescript
const handleDragStart = (e: React.DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
}

<div
  className="welcome-tab"
  draggable={false}
  onDragStart={handleDragStart}
  onDrag={handleDragStart}
>
  <Home size={16} strokeWidth={2} />
</div>
```

### Welcome Panel (Content Area)

**Layout structure** (fills entire center area):
```tsx
<div className="panel-content" tabIndex={0}>
  <div className="welcome-panel">
    <div className="welcome-content">
      {/* Icon, title, description */}
    </div>
  </div>
</div>
```

**CSS for full-width**:
```css
.panel-content {
  display: flex;
  flex-direction: column;
}

.welcome-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  width: 100%;
  height: 100%;
}
```

**Key pattern**: Nested flex containers where inner div has `flex: 1` to expand.

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
- [Markdown Editing](./markdown-editing.md) - Editor-specific shortcuts
- [Development Tasks](./development-tasks.md) - Adding panels and components
- [Known Issues](./known-issues.md) - Current issues and workarounds
