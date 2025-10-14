# Project Panel

## Overview

**Location**: `src/renderer/src/components/Panels/ProjectPanel.tsx`

Project panel displays hierarchical file tree with filtering, visual indicators, and context menu operations. Wrapper architecture separates header/controls from tree logic.

## Architecture

### Wrapper Pattern

**ProjectPanel.tsx** - Outer wrapper with header and controls
**ProjectTree.tsx** - Inner tree component with file operations

**Benefits**:
- Separation of concerns (UI chrome vs tree logic)
- Reusable tree component
- Consistent panel header pattern across app
- Centralized filter state management

```typescript
<ProjectPanel>
  <Header>
    <FolderOpen icon />
    <Label />
    <Chevron toggle />
  </Header>
  <ControlPanel>
    <FilterButtons />
  </ControlPanel>
  <ProjectTree />
</ProjectPanel>
```

### Component Responsibilities

**ProjectPanel** (wrapper):
- Panel header with icon and chevron toggle
- Control panel visibility state
- Filter mode state (All Files | Markdown Only)
- Filter persistence via electron-store
- Props passing to ProjectTree

**ProjectTree** (tree logic):
- File tree rendering
- Node expansion/collapse
- Context menu operations
- File opening in editor
- Recursive filtering logic

## Control Panel

Collapsible panel with chevron toggle in header (matches CopilotPanel pattern).

### Toggle Behavior

**Chevron Icon**:
- ChevronDown - Control panel visible
- ChevronLeft - Control panel collapsed
- 8px spacing after "Project" label
- Smooth rotation transition (150ms)

**State**: Local component state (`showControlPanel`)

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

### Filter Options

Two mutually exclusive radio buttons:
- **All Files** - Show all files and folders
- **Markdown Only** - Show only .md files and folders containing them

**Visual Design**:
- Radio buttons with checkmark icons (blue when selected)
- Gray text, blue when active (#007acc)
- 12px spacing between options
- 16px padding horizontal/vertical

**Persistence**: Saved via electron-store, survives app restarts

See: [IPC Patterns](./ipc-patterns.md) for filter persistence channels

## File Filtering

### Filter Modes

**Type**: `FilterMode = 'all' | 'markdown'`

**Location**: `src/renderer/src/types/filters.ts`

**IPC Channels**:
- `settings:getProjectFilterMode` - Load preference
- `settings:setProjectFilterMode` - Save preference

### Recursive Filtering Algorithm

**Goal**: Show only .md files and folders containing them (directly or in descendants)

**Implementation**: Depth-first traversal with memoization

```typescript
const filterTree = useMemo(() => {
  if (filterMode === 'all') return fileTree

  const shouldInclude = (entry: FileEntry): boolean => {
    if (entry.type === 'file') {
      return isMarkdownFile(entry.name)
    }

    // Folder: check if any child (recursive) is markdown
    return entry.children?.some(shouldInclude) ?? false
  }

  const filterEntries = (entries: FileEntry[]): FileEntry[] => {
    return entries
      .filter(shouldInclude)
      .map(entry => {
        if (entry.type === 'folder' && entry.children) {
          return { ...entry, children: filterEntries(entry.children) }
        }
        return entry
      })
  }

  return filterEntries(fileTree)
}, [fileTree, filterMode])
```

**Performance**: `useMemo` prevents re-filtering on every render

**Helper**: `isMarkdownFile()` checks `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` extensions

### Filter Behavior

**Markdown Mode**:
- Files: Only .md files visible
- Folders: Only folders containing markdown (any depth)
- Empty folders: Hidden
- Expansion state: Preserved when toggling filters

**All Mode**:
- Files: All files visible (including dotfiles)
- Folders: All folders visible
- Hidden files: Styled with reduced opacity

## Visual Indicators

### Sensitive Files

**Categories** (5 total):

1. **Environment files**: `.env*`, `.npmrc`, `*.pem`, `*.key`
2. **Cloud credentials**: `.aws/`, `.azure/`, `.gcloud/`
3. **SSH keys**: `.ssh/`, `id_rsa*`, `known_hosts`
4. **Security files**: `credentials*`, `secrets*`, `*.keystore`, `*.jks`
5. **Config files**: `config.json`, `settings.json`, `*.config.js`

**Visual Treatment**:
- Color: `#d97706` (amber)
- Icon: `⚠️` Warning triangle (14px)
- ARIA label: "Sensitive file"
- Tooltip: "Contains sensitive information"

**Detection**: `isSensitiveFile()` function with regex pattern matching

**Location**: `src/renderer/src/components/ProjectTree/ProjectTreeNode.tsx`

### Hidden Files

Files/folders starting with `.` (dot):

**Visual Treatment**:
- Opacity: 70%
- Font style: italic
- Color: Inherited from parent
- Combined with sensitive styling if both apply

**CSS Specificity**:
```css
.tree-node-label.hidden-file {
  opacity: 0.7;
  font-style: italic;
}

.tree-node-label.sensitive-file.hidden-file {
  opacity: 1; /* Override - sensitive files always visible */
  font-style: italic; /* Keep italic */
}
```

**Examples**: `.git/`, `.env`, `.gitignore`, `.DS_Store`

### Icon System

**File Icons**:
- Markdown: Blue FileText icon
- Sensitive: Amber AlertTriangle icon
- Regular: Gray FileText icon

**Folder Icons**:
- Expanded: Blue FolderOpen icon
- Collapsed: Gray Folder icon
- Sensitive folders: Amber AlertTriangle + folder icon

**Size**: 14px (increased from 10px for better visibility)

## Context Menu Operations

Right-click context menu with validation and error handling.

### Menu Items

**For Files**:
- Rename
- Delete

**For Folders**:
- New File
- New Folder
- Rename
- Delete

**Separator**: Isolates destructive actions (Delete)

### Rename Functionality

**Dialog Features**:
- Pre-fills current name
- Input validation (non-empty, no duplicates)
- Path separator sanitization
- Inline error messages
- Keyboard: Enter to confirm, Escape to cancel

**IPC Channel**: `file:rename`

**Validation**:
```typescript
if (!newName.trim()) {
  setRenameError('Name cannot be empty')
  return
}

const sanitized = sanitizeFilePath(newName)
const targetPath = path.join(parentPath, sanitized)

if (fs.existsSync(targetPath)) {
  setRenameError('A file or folder with this name already exists')
  return
}
```

**Helper**: `sanitizeFilePath()` removes `/`, `\`, `..` from input

**Location**: `src/renderer/src/utils/fileUtils.ts`

### Delete Functionality

**Confirmation Dialog**:
- File deletion: "Are you sure you want to delete [filename]?"
- Folder deletion: "Are you sure you want to delete [foldername] and all its contents?"

**IPC Channels**:
- `file:deleteFile` - Delete single file
- `file:deleteFolder` - Delete folder recursively

**Safety**: Confirmation dialog prevents accidental deletion

### Create Operations

**New File**:
- Only available on folders
- Dialog with name input
- Validation prevents empty names, duplicates
- IPC: `file:createFile`

**New Folder**:
- Only available on folders
- Dialog with name input
- Validation prevents empty names, duplicates
- IPC: `file:createFolder`

**Auto-Refresh**: Directory watcher detects changes, updates tree automatically

See: [File Watching](./file-watching.md) for auto-refresh details

## Directory Watching Integration

### Watch Lifecycle

**Start**: When project folder opened
**Stop**: When project closed or changed

**IPC Channels**:
- `directory-watch:start` - Begin watching
- `directory-watch:stop` - End watching
- `directory-watch:changed` - Event: Changes detected

### Pause/Resume Pattern

Prevents double-refresh during internal CRUD operations.

**Pattern**:
1. Set `isInternalOperation.current = true`
2. Pause watcher: `window.api.directoryWatch.pause()`
3. Perform operation (create/rename/delete)
4. Refresh tree manually
5. Resume watcher: `window.api.directoryWatch.resume()`
6. Set `isInternalOperation.current = false`

**Race Prevention**: Debounced events arriving during pause are ignored

**Example**:
```typescript
const handleCreateFile = async () => {
  isInternalOperation.current = true
  await window.api.directoryWatch.pause(projectPath)

  await window.api.file.createFile(targetPath, fileName)
  await refreshFileTree()

  await window.api.directoryWatch.resume(projectPath)
  isInternalOperation.current = false
}
```

### Tree State Preservation

**Expansion State**: Maintained across refreshes via `expandedFolders` Set

**Logic**:
```typescript
const handleDirectoryChanged = async () => {
  if (isInternalOperation.current) return // Skip if we caused the change

  const previouslyExpanded = new Set(expandedFolders)
  await refreshFileTree() // Re-fetch tree
  setExpandedFolders(previouslyExpanded) // Restore expansion
}
```

**Benefits**: External changes (git, npm, IDE) don't collapse folders

See: [File Watching](./file-watching.md#directory-watching) for full details

## File Opening

**Flow**:
1. User clicks file in tree
2. ProjectTree receives `dockviewApi` via params
3. Checks if file already open (find by ID)
4. If open: activate existing panel
5. If closed: add new panel with `dockviewApi.addPanel()`

**Panel ID**: Sanitized file path (replace `/` with `_`)

**Tab Title**: File basename only (e.g., `README.md`)

**Component**: `markdownEditor` - Monaco editor with preview

See: [UI Components](./ui-components.md#panel-communication-pattern) for API passing details

## Keyboard Navigation

**Arrow Keys**: Navigate tree nodes
**Enter**: Open selected file
**Space**: Expand/collapse selected folder
**Right-Click**: Open context menu

**Accessibility**: ARIA labels, roles, keyboard focus indicators

## Development Patterns

### Adding New Control

1. Add control to control panel div
2. Add state management (local or via props)
3. Add persistence if needed (electron-store)
4. Update ProjectTree to respect new control

### Adding New File Operation

1. Add menu item to context menu config
2. Add handler function in ProjectTree
3. Implement IPC channel in main process
4. Add pause/resume around operation

### Adding New Visual Indicator

1. Add detection logic to ProjectTreeNode
2. Add CSS classes for styling
3. Add ARIA labels for accessibility
4. Add tooltip for context

## Related Documentation

- [Architecture](./architecture.md) - Hybrid layout system
- [UI Components](./ui-components.md) - Activity bars, panel system
- [IPC Patterns](./ipc-patterns.md) - File operations, settings
- [File Watching](./file-watching.md) - Auto-refresh system
- [Development Tasks](./development-tasks.md) - Common patterns
