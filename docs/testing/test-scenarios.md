# Test Scenarios

Pre-defined test scenarios for Erfana using Circuit Electron MCP. For full MCP API, see docs/testing/README.md.

## Prerequisites

1. Build: `npm run build`
2. Verify: `ls -la out/main/index.js`
3. Circuit Electron MCP configured

## UI Scenarios

### 1. Application Launch

**Goal**: Verify Erfana launches with all core UI panels

**Verify**:
- Window opens
- Project panel (left)
- Terminal panel (right)
- Toolbar visible
- No errors

**MCP**: `app_launch` → `wait_for_selector(.app-dock-layout)` → `screenshot` → `evaluate` panel existence → `close`

### 2. File Tree Navigation

**Goal**: Test file tree interaction and markdown opening

**Verify**:
- Project tree renders
- Folders expand/collapse
- Clicking .md opens in center editor
- Tab shows filename

**MCP**: `app_launch` → `wait_for_selector(.project-tree)` → `click` folder → `click` file → `screenshot` → `evaluate` tab state

### 3. Markdown Formatting Toolbar

**Goal**: Verify toolbar buttons insert correct markdown

**Verify**:
- Toolbar visible in Editor/Split modes
- Bold button: `**text**`
- Italic: `*text*`
- Code: `` `text` ``
- Heading: `# text`

**MCP**: `app_launch` → `click_by_text("README.md")` → `click` toolbar buttons → `evaluate` editor content → `screenshot`

### 4. View Mode Switching

**Goal**: Test Editor/Split/Preview mode toggling

**Verify**:
- Buttons toggle correctly
- Editor Only: Monaco visible, preview hidden
- Split View: Both visible, scroll sync active
- Preview Only: Preview visible, Monaco hidden

**MCP**: `app_launch` → open file → `click` view buttons → `evaluate` panel visibility → `screenshot` each mode

### 5. Auto-Save

**Goal**: Verify auto-save with dirty indicator

**Verify**:
- Edit triggers dirty indicator
- Auto-save after 500ms
- Indicator clears
- File persisted on disk

**MCP**: `app_launch` → open file → `type` changes → wait 600ms → `evaluate` dirty state → `fs_read_file` verify content

## Interaction Scenarios

### 6. Keyboard Shortcuts

**Goal**: Test global shortcuts (Cmd/Ctrl+B, Cmd/Ctrl+J)

**Verify**:
- Cmd+B toggles left sidebar
- Cmd+J toggles right panel
- State persists

**MCP**: `app_launch` → `keyboard_press('b', ['ControlOrMeta'])` → `screenshot` → `evaluate` visibility

### 7. Context Menu Operations

**Goal**: Test file/folder operations via context menu

**Verify**:
- Right-click shows menu
- New File creates file
- Rename updates name
- Delete removes item

**MCP**: `app_launch` → navigate tree → `click` right → `click_by_text("New File")` → `type` name → confirm → `fs_read_file` verify

### 8. Multi-File Tabs

**Goal**: Test tab management

**Verify**:
- Multiple files open in tabs
- Clicking tab switches content
- Close button works
- Welcome tab persists

**MCP**: `app_launch` → open 3 files → `click` tabs → `evaluate` active panel → `click` close buttons

### 9. Document Statistics

**Goal**: Verify stats in header (word/char count)

**Verify**:
- Stats appear in editor header
- Update on typing
- Accurate counts

**MCP**: `app_launch` → open file → `type` text → `wait` debounce → `evaluate` stat values

### 10. Panel Protection

**Goal**: Verify protected panels can't close

**Verify**:
- Welcome tab has no close button
- Protected tabs non-draggable
- Activity bar toggles work

**MCP**: `app_launch` → `evaluate` Welcome tab attributes → try drag → `keyboard_press` shortcuts

## Tips

- Use `compressScreenshots: true, screenshotQuality: 75` for efficiency
- `wait_for_selector` with 5s timeout prevents flakes
- `snapshot()` for accessibility tree debugging
- Cleanup: Always call `close({ sessionId })` after tests

## Related

- [Testing README](./README.md) - Setup and commands
- [Circuit Electron MCP](https://github.com/Circuit-App/circuit-electron-mcp) - Full API docs
