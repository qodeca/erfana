# UI Components & Behavior

## Activity Bars

**Location**: `src/renderer/src/components/ActivityBar/`

Dual vertical activity bars on left and right edges (VS Code-style).

### Left Activity Bar

- **Explorer icon**: Toggle file tree sidebar
- **Keyboard**: `Cmd/Ctrl+B`
- **Width**: 48px fixed
- **Position**: Left edge of window

### Right Activity Bar

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

## Context Menu (File Explorer)

**Location**: `src/renderer/src/components/FileTree/FileTree.tsx`, `src/renderer/src/components/ContextMenu/ContextMenu.tsx`

Right-click context menu for files and folders in the file explorer.

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

- `FileTree.tsx` - Context menu logic and handlers
- `ContextMenu.tsx` - Reusable context menu component
- `ContextMenu.css` - VS Code-style dark theme

## Global Keyboard Shortcuts

These work **anywhere in the application**:

| Shortcut | Action | Panel |
|----------|--------|-------|
| `Cmd/Ctrl+B` | Toggle left sidebar | Explorer |
| `Cmd/Ctrl+J` | Toggle right panel | Terminal |
| `Ctrl+Shift+G` | Toggle right panel | Git |

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
- Left sidebar: `FileExplorerSplitPanel`
- Center editor: `EditorAreaSplitPanel` (always visible)
- Right sidebar: `RightSidebarSplitPanel`

**Toggle Mechanism**:
```typescript
const panel = splitviewApiRef.current.getPanel(splitviewPanelId)
panel.api.setVisible(shouldShow)
```

**State Storage**: `useActivityBarStore` (Zustand with persist)
```typescript
{
  leftActivePanel: 'explorer' | null,
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

**Problem**: FileTree needs to open files in center DockviewReact.

**Solution**: Pass DockviewApi through splitview panel params.

**Flow**:
1. `EditorAreaSplitPanel` creates DockviewReact, gets `dockviewApi`
2. Calls `setDockviewApi` callback in params → updates ref in parent
3. Parent passes `dockviewApi` to `FileExplorerSplitPanel` via params
4. FileTree calls `dockviewApi.addPanel()` to open file tab

**Code**: `AppDockLayout.tsx` lines 208-222

## Development Patterns

### Adding New Activity Bar Item

1. Update `activityBarConfig.ts`:
   ```typescript
   export const LEFT_PANELS = [
     { id: 'explorer', icon: Folder, label: 'Explorer', shortcut: 'Cmd+B' },
     { id: 'myPanel', icon: MyIcon, label: 'My Panel', shortcut: 'Cmd+M' }
   ]
   ```

2. Add panel ID mapping in `AppDockLayout.tsx`

3. Create corresponding splitview panel component

### Toggling Panel Programmatically

```typescript
// Via Zustand store
const { togglePanel } = useActivityBarStore()
togglePanel('explorer', 'left')

// Via SplitviewApi directly
const panel = splitviewApiRef.current.getPanel('left-sidebar')
panel.api.setVisible(false)
```

### Reading Current State

```typescript
const { leftActivePanel, rightActivePanel, leftWidth, rightWidth }
  = useActivityBarStore()

console.log('Explorer visible:', leftActivePanel === 'explorer')
console.log('Explorer width:', leftWidth)
```

## Known Issues

**None** - Panel resizing now works correctly with SplitviewReact architecture.

Previous issue (DockviewReact panels not resizing) resolved in v0.1.0.

## Related Documentation

- [Architecture](./architecture.md) - Hybrid SplitviewReact + DockviewReact architecture
- [Markdown Editing](./markdown-editing.md) - Editor-specific shortcuts
- [Development Tasks](./development-tasks.md) - Adding panels and components
- [Known Issues](./known-issues.md) - Current issues and workarounds
