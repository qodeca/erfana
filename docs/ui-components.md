# UI Components & Behavior

## Activity Bars

**Location**: `src/renderer/src/components/ActivityBar/`

Dual vertical activity bars on left and right edges (VS Code-style).

### Left & Right Bars

**Left**: Project icon (Cmd/Ctrl+B) toggles project tree
**Right**: Terminal icon (Cmd/Ctrl+J) toggles terminal panel
**Dimensions**: 48px fixed width, 48x48px click targets

### Components

- `ActivityBar.tsx` - Main container
- `ActivityBarItem.tsx` - Individual item with icon
- `ActivityBarBadge.tsx` - Badge notifications
- `activityBarConfig.ts` - Configuration mapping

### State Management

**Zustand Store**: `useActivityBarStore.ts` manages active panels, sidebar widths (persisted to localStorage)

### Design

- Background: `#333333`
- Icons: Lucide React (`Folder`, `Terminal`)
- Active indicator: 2px blue vertical bar
- Hover: Icon changes to white

## Global Toasts

Lightweight toast notifications in bottom-left corner.

**Location**: `src/renderer/src/components/Toast/`
**API**: `showGlobalToast()` via event bus, rendered by `ToastProvider`
**Types**: info, success, warning, error

## Control Panels

Collapsible panels with chevron toggle (VS Code pattern).

### Pattern

Header with ChevronDown/ChevronLeft icon (8px spacing). Click toggles visibility with 150ms rotation transition.

**Implementation**:
```typescript
const [show, setShow] = useState(true)

<ChevronDown
  className={`chevron-toggle ${show ? '' : 'collapsed'}`}
  onClick={() => setShow(!show)}
/>
{show && <div className="control-panel">{/* Controls */}</div>}
```

**CSS**: `.chevron-toggle.collapsed { transform: rotate(-90deg); transition: transform 0.15s; }`

**Example**: ProjectPanel file filtering - see [Project Panel](./project-panel.md#control-panel)

## Project Panel

**Location**: Left sidebar via activity bar

Hierarchical file tree with filtering, visual indicators, context menu operations.

**Features**:
- File filtering (All Files | Markdown Only) with recursive logic
- Sensitive file detection (credentials, keys, configs)
- Hidden file styling (dotfiles, 70% opacity)
- Context menu (New, Rename, Delete)
- Auto-refresh via directory watching

📚 **Full docs**: [Project Panel](./project-panel.md)

### Visual Indicators

**Sensitive** (amber + warning icon): `.env*`, `.npmrc`, `*.pem`, `.aws/`, `.ssh/`, `credentials*`, `config.json`
**Hidden** (70% opacity, italic): Files starting with `.` (`.git/`, `.gitignore`)

## Terminal Panel

**Location**: Right sidebar via activity bar

Integrated terminal with xterm.js + node-pty.

**Access**: Terminal icon (right sidebar) or Cmd/Ctrl+J
**Restart**: X in header kills/restarts session

**Features**:
- Native PTY (zsh/bash)
- WebGL rendering (canvas fallback)
- Auto-resize, bold fonts
- High contrast theme (white on black)
- "Send Selection to Terminal" from preview context menu

**Theme**: 12px SF Mono, #000 bg, #fff fg, #4fc1ff cursor

**Tech**: xterm.js v5.5.0, node-pty v1.0.0, WebglAddon, FitAddon, WebLinksAddon

📚 **Full docs**: [Terminal](./terminal.md)

## Context Menu

**Location**: `src/renderer/src/components/ContextMenu/ContextMenu.tsx`

Reusable menu for Project Panel file/folder operations (Rename, Delete, New File/Folder).

📚 **Full docs**: [Project Panel](./project-panel.md#context-menu-operations)

## Global Keyboard Shortcuts

Work **anywhere** in app:

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+B` | Toggle left sidebar (Project) |
| `Cmd/Ctrl+J` | Toggle right panel (Terminal) |

**Implementation**: `AppDockLayout.tsx` keydown listener
**Note**: Overrides Monaco shortcuts with same keys

## Panel Toggle System

### Behavior

VS Code-style: Toggles entire splitview panel, preserves dimensions, persists state.

**Panels**:
- Left: `ProjectPanelWrapper`
- Center: `EditorAreaSplitPanel` (always visible)
- Right: `TerminalSplitPanel`

**Toggle**: `splitviewApi.getPanel(id).api.setVisible(bool)`
**State**: `useActivityBarStore` (Zustand + localStorage)

### Size Constraints

**Min**: 170px sidebars, 400px center
**Max**: 600px sidebars, unlimited center
**Default**: 300px left, 250px right

### Resize

SplitviewReact handles resize between panels with `onDidSizeChange` events.

```typescript
leftPanel.api.onDidSizeChange(() => {
  setSidebarWidth(leftPanel.api.width, 'left')
})
```

## Panel Communication

**Pattern**: Pass DockviewApi through splitview params.

**Flow**:
1. `EditorAreaSplitPanel` creates DockviewReact → gets `dockviewApi`
2. Calls `setDockviewApi` callback → updates parent ref
3. Parent passes to `ProjectPanelWrapper` via params
4. ProjectTree calls `dockviewApi.addPanel()` to open files

## Tab Styling

**Location**: `AppDockLayout.css`, `AppDockLayout.tsx`

VS Code-style hover and active indicators.

### Hover

**Inactive**: `#3a3d41` background
**Active**: `#2d2d30` with 0.9 opacity

### Active Indicator

2px blue bottom border (`#007acc`) via `::after` pseudo-element, matches activity bar.

### Focus

Auto-focus on tab change ensures active indicator shows immediately. Panels need `tabIndex={0}` and `outline: none`.

## Welcome Tab & Panel

**Location**: `WelcomePanel.tsx`, `WelcomeTab.tsx`

Home icon tab (41px square, non-draggable) and centered welcome screen.

## Development Patterns

### Add Activity Bar Item

1. Update `activityBarConfig.ts`: `{ id, icon, label, shortcut }`
2. Map ID in `AppDockLayout.tsx`
3. Create splitview panel component

### Toggle Panel

```typescript
// Via store
useActivityBarStore().togglePanel('project', 'left')

// Direct
splitviewApiRef.current.getPanel('left-sidebar').api.setVisible(false)
```

### Read State

```typescript
const { leftActivePanel, leftWidth } = useActivityBarStore()
console.log('Visible:', leftActivePanel === 'project')
```

## Related Documentation

- [Architecture](./architecture.md) - Hybrid layout system
- [Editor](./editor/README.md) - Editor features
- [Development Tasks](./development-tasks.md) - Adding components
- [Known Issues](./known-issues.md) - Workarounds
