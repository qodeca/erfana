# UI Components & Behavior

## Toolbar

**Location**: `src/renderer/src/components/Toolbar/`

VS Code-inspired toolbar at top of application window.

### Features
- Application title ("Erfana") on left
- Icon-only toggle buttons on right (Explorer, Terminal, Git panels)
- Active state indicators (highlighted when panel visible)
- Hover effects with semi-transparent background

### Design
- Height: 40px
- Background: `#2d2d30` (VS Code dark theme)
- Button size: 28x28px square
- SVG icons matching VS Code style
- Tooltips show keyboard shortcuts

### Files
- `Toolbar.tsx` - React component (57 lines)
- `Toolbar.css` - Styles matching VS Code aesthetics

## Global Keyboard Shortcuts

These work **anywhere in the application**:

| Shortcut | Action | Panel |
|----------|--------|-------|
| `Cmd/Ctrl+B` | Toggle left sidebar | Explorer |
| `Cmd/Ctrl+J` | Toggle bottom panel | Terminal |
| `Cmd/Ctrl+Alt+B` | Toggle right sidebar | Git |

**Platform Detection**: Uses `metaKey` on macOS, `ctrlKey` on Windows/Linux

**Implementation**: `AppDockLayout.tsx` lines 312-338

**⚠️ NOTE**: These override any Monaco Editor shortcuts with same keys. Monaco's built-in shortcuts (Cmd+B for bold) only work when editor is focused AND these global shortcuts are not active.

See: [Markdown Editing](./markdown-editing.md) for editor-specific shortcuts

## Panel Toggle System

### Behavior

Matches VS Code panel toggle behavior:
- **Toggles entire sidebar area**, not individual tabs
- **Preserves panel dimensions** when hiding/showing
- **Persists state** across app restarts via localStorage
- **Works after drag/drop** panel reorganization

### State Schema (localStorage)

Key: `erfana-sidebar-state`

```json
{
  "leftSidebar": {
    "visible": true,
    "width": 300
  },
  "bottomPanel": {
    "visible": true,
    "height": 250
  },
  "rightSidebar": {
    "visible": true,
    "width": 250
  }
}
```

### Size Constraints

**Minimum sizes** (enforced by `Math.max()` validation):
- Left sidebar: 170px
- Bottom panel: 100px
- Right sidebar: 170px

**Default sizes** (first launch):
- Left sidebar: 300px
- Bottom panel: 250px
- Right sidebar: 250px

### Implementation Details

**File**: `src/renderer/src/components/DockLayout/AppDockLayout.tsx`

**Key patterns**:

1. **Dynamic panel lookup** (lines 133-137):
   ```typescript
   const getGroupByPanelId = (panelId: string) => {
     const panel = apiRef.current.getPanel(panelId)
     return panel ? panel.group : null
   }
   ```
   Prevents stale references when panels move between groups.

2. **Toggle with size preservation** (lines 234-291):
   - Save current size before hiding
   - Set size BEFORE showing (prevents flicker)
   - Update localStorage on every change

3. **Resize listeners** (lines 270-278):
   ```typescript
   panel.api.onDidDimensionsChange(() => {
     const width = Math.max(panel.api.width, MIN_SIZES.leftSidebar)
     updateSidebarState('leftSidebar', { width })
   })
   ```
   Keeps localStorage in sync with manual resizing.

## Panel Protection

**Goal**: Prevent closing Explorer, Terminal, Git tabs (system panels).

### Why Needed

System panels should always be present. Users can hide them with toggle buttons, but not close them entirely.

### Implementation Layers

**Layer 1: Click Interception** (lines 195-226)
- Document-wide click listener in **capture phase**
- Intercepts clicks on `.dv-default-tab-action` (close button container)
- Checks tab title via `.dv-default-tab-content` element
- Calls `preventDefault()` to block close event

**Layer 2: Fallback Restore** (lines 229-260)
- Listens to `onDidRemovePanel` event
- If protected panel removed, immediately re-adds it
- Restores with correct size from localStorage state

### Dockview DOM Structure

Understanding dockview's actual DOM is critical for CSS selectors:

```html
<div class="dv-default-tab">
  <div class="dv-default-tab-content">Explorer</div>  <!-- Title text -->
  <div class="dv-default-tab-action">                <!-- Close button -->
    <svg><!-- close icon --></svg>
  </div>
</div>
```

**Common mistake**: Using wrong selectors like `.tab-label` or `.tab-actions-container` (these don't exist in dockview).

### Close Button Event Flow

1. User clicks X button
2. Click bubbles up (default browser behavior)
3. **Our capture-phase listener catches it FIRST** (before dockview)
4. We call `preventDefault()` if tab is protected
5. Dockview's handler checks `ev.defaultPrevented`
6. If true, dockview's handler returns early (doesn't close)

**Source**: `node_modules/dockview-core/dist/esm/dockview/components/tab/defaultTab.js` lines 26-34

## Development Patterns

### Adding New Protected Panel

1. Add panel ID to `protectedPanels` array (line 196)
2. Add panel title to `protectedTitles` array (line 197)
3. That's it - protection is automatic

### Debugging Panel State

```typescript
// Check current state
console.log(localStorage.getItem('erfana-sidebar-state'))

// Clear state (force defaults on next load)
localStorage.removeItem('erfana-sidebar-state')
```

### Testing Panel Toggle

1. Toggle panel with keyboard shortcut or toolbar button
2. Resize panel manually
3. Toggle again - should restore exact size
4. Restart app - should restore visibility and size

## Known Issues

**CSS :has() Selector Browser Compatibility**

Current CSS uses `:has()` for hiding close buttons:
```css
.dv-default-tab:has(.dv-default-tab-content)
```

**Support**: Chrome 105+, Firefox 121+, Safari 15.4+

**Impact**: If browser doesn't support :has(), close buttons won't be hidden by CSS (but JavaScript capture-phase listener still prevents closing).

**Status**: Acceptable - Electron uses recent Chromium (supports :has()).

See: [Known Issues](./known-issues.md)

## Related Documentation

- [Architecture](./architecture.md) - Dockview panel system overview
- [Markdown Editing](./markdown-editing.md) - Editor-specific shortcuts
- [Development Tasks](./development-tasks.md) - Working with panels
- [Known Issues](./known-issues.md) - Browser compatibility notes
