# Project Panel

## Overview

**Location**: `src/renderer/src/components/Panels/ProjectPanel.tsx`

Project panel displays hierarchical file tree with filtering, visual indicators, and context menu operations. Wrapper architecture separates header/controls from tree logic.

## Architecture

### Wrapper Pattern

**ProjectPanel.tsx** - Outer wrapper with header and controls
**ProjectTree.tsx** - Inner tree component with file operations

**Benefits**: Separation of concerns, reusable tree, consistent panel header, centralized filter state.

```
<ProjectPanel>
  <Header> FolderOpen icon + Label + Chevron toggle </Header>
  <ControlPanel> FilterButtons </ControlPanel>
  <ProjectTree />
</ProjectPanel>
```

### Responsibilities

**ProjectPanel**: Header, control panel visibility, filter mode state & persistence
**ProjectTree**: Tree rendering, expansion/collapse, context menu, file opening, recursive filtering

## Toolbar

### Refresh Button

Manual refresh button in the toolbar (rightmost position) triggers both tree content and git status refresh in parallel.

**Keyboard Shortcut**: Cmd+Alt+R (macOS) / Ctrl+Alt+R (Windows/Linux)
**Visual Feedback**: Icon spins during refresh (CSS animation)
**Accessibility**: Tooltip with shortcut, ARIA label, focus state

**Use Cases**:
- Force refresh after external file changes
- Sync git status after operations in external tools
- Verify file system state

## Control Panel

Collapsible panel with chevron toggle (common pattern across panels).

### Toggle Behavior

**Chevron**: ChevronDown (visible) / ChevronLeft (collapsed), 8px spacing, 150ms rotation
**State**: Local component state (`showControlPanel`)

### Filter Options

Two mutually exclusive radio buttons:
- **All Files** - Show all
- **Markdown Only** - Show only .md files + folders containing them

**Visual**: Radio with checkmark icons, gray text (blue when active #007acc), 12px spacing
**Persistence**: electron-store, survives restarts

See: [IPC Patterns](./ipc-patterns.md) for filter persistence channels

### Watching

- Symlink indicator: small chain icon (watchers don't follow symlinks)
- Depth: config via `directoryWatchDepth` (not exposed in UI)

## Unsaved Changes Prompt

When switching projects (Open/Close), detects dirty editor tabs and shows confirmation dialog.

**Options**: Discard (proceed, clear tabs) | Cancel (abort)
**Timing**: Appears before OS folder dialog to avoid half-switched states

## File Filtering

### Filter Modes

**Type**: `FilterMode = 'all' | 'markdown'`
**Location**: `src/renderer/src/types/filters.ts`
**IPC**: `settings:getProjectFilterMode`, `settings:setProjectFilterMode`

### Recursive Algorithm

**Goal**: Show only .md files and folders containing them

**Implementation**: Depth-first traversal with memoization

```typescript
const filterTree = useMemo(() => {
  if (filterMode === 'all') return fileTree

  const shouldInclude = (entry: FileEntry): boolean => {
    if (entry.type === 'file') return isMarkdownFile(entry.name)
    return entry.children?.some(shouldInclude) ?? false
  }

  const filterEntries = (entries: FileEntry[]): FileEntry[] =>
    entries.filter(shouldInclude).map(entry =>
      entry.type === 'folder' && entry.children
        ? { ...entry, children: filterEntries(entry.children) }
        : entry
    )

  return filterEntries(fileTree)
}, [fileTree, filterMode])
```

**Helper**: `isMarkdownFile()` checks `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx`

### Behavior

**Markdown Mode**: Only .md files + containing folders, empty folders hidden, expansion state preserved
**All Mode**: All files/folders visible, hidden files styled with reduced opacity

## Visual Indicators

### Git Status Indicators (v0.5.3)

VS Code-style git status badges on files and folders.

**File Badges**: Letter badges showing status
- **M** (Amber `#d97706`) - Modified
- **U** (Lime `#84cc16`) - Untracked
- **D** (Coral `#f87171`) - Deleted
- **A** (Violet `#a78bfa`) - Staged/Added
- **R** (Indigo `#818cf8`) - Renamed
- **!** (Magenta `#e879f9`) - Conflicted

**Folder Dots**: Colored dots showing child status (propagates from files)

**Status Bar**: Footer showing branch name + colored status counts

**Architecture**:
- `GitStatusService.ts` - isomorphic-git statusMatrix()
- `useGitStatus.ts` - Hook with 1s debounce, 2s cooldown
- `useGitStore.ts` - Zustand store for git state
- `GitStatusBadge.tsx` - File/folder badge component
- `GitStatusBar.tsx` - Branch + counts footer

**Auto-refresh**: On file changes, pauses when tab unfocused

**Known Limitation**: Global `.gitignore` not supported (isomorphic-git limitation)

See: [Known Issues](./known-issues.md#git-status-global-gitignore-not-supported)

### Sensitive Files

**5 Categories**:
1. Environment: `.env*`, `.npmrc`, `*.pem`, `*.key`
2. Cloud: `.aws/`, `.azure/`, `.gcloud/`
3. SSH: `.ssh/`, `id_rsa*`, `known_hosts`
4. Security: `credentials*`, `secrets*`, `*.keystore`, `*.jks`
5. Config: `config.json`, `settings.json`, `*.config.js`

**Visual**: Color `#d97706` (amber), icon ⚠️ (14px), ARIA label "Sensitive file"
**Detection**: `isSensitiveFile()` with regex patterns
**Location**: `ProjectTreeNode.tsx`

### Hidden Files

Files/folders starting with `.`

**Visual**: 70% opacity, italic font
**CSS**: Sensitive files override opacity (always 100% visible, keep italic)
**Examples**: `.git/`, `.env`, `.gitignore`, `.DS_Store`

### Icon System

**Files**: Blue FileText (markdown), Amber AlertTriangle (sensitive), Gray FileText (regular)
**Folders**: Blue FolderOpen (expanded), Gray Folder (collapsed), Amber + folder (sensitive)
**Size**: 14px

## Context Menu Operations

**v0.3.7**: Strategy + Command + Factory patterns for extensible, testable menus.

### Architecture

**Patterns**:
- **Strategy**: Node type-specific menus (FileStrategy, FolderStrategy)
- **Command**: Testable command objects (11 classes)
- **Factory**: Automatic strategy selection

**Structure**:
```
context-menu/
├── types.ts        # Interfaces
├── commands.tsx    # 11 command classes
├── strategies.tsx  # FileStrategy, FolderStrategy
└── factory.ts      # createContextMenu(context, nodeType)
```

### Menu Items

**Files**: Rename, ---, Delete
**Folders**: New File, New Folder, Rename, ---, Delete
**Separator**: Visual separator before destructive actions

### Command Classes

Each implements `IMenuCommand` interface:
```typescript
interface IMenuCommand {
  label: string
  icon?: LucideIcon
  onClick: () => void | Promise<void>
  danger?: boolean
  separator?: boolean
}
```

**Available**: NewFileCommand, NewFolderCommand, RenameFileCommand, RenameFolderCommand, DeleteFileCommand, DeleteFolderCommand, SeparatorCommand

### Extensibility

**Add Menu Item**:
1. Create command class in `commands.tsx`
2. Implement `IMenuCommand`
3. Add to strategy in `strategies.tsx`

**New Node Type**:
1. Create strategy in `strategies.tsx`
2. Implement `IMenuStrategy`
3. Update factory

### Benefits

Single Responsibility, Open/Closed, Testable (87 tests), Maintainable, Flexible

### Dialog Integration

**File System Dialogs** (v0.3.6+):
- `useDialog()` hook with promise-based API
- `showNewFile()`, `showNewFolder()`, `showRename()`, `showConfirm()`

**Validation** (utils/fileValidation.ts):
- Empty name, 255 char limit, invalid chars (`/\\?*:|\"<>`)
- Windows reserved (CON, PRN, AUX, COM1-9, LPT1-9)
- Case-insensitive duplicates
- Dotfile edge cases (`.CON` valid, `CON` reserved)

**Auto-Refresh**: Directory watcher detects changes, updates tree

See: [Architecture - ProjectTree](./architecture.md#projecttree-modularization) | [File Watching](./file-watching/README.md)

## Directory Watching

### Watch Lifecycle

**Start**: Project folder opened
**Stop**: Project closed/changed
**IPC**: `directory-watch:start`, `directory-watch:stop`, `directory-watch:changed`

### Pause/Resume Pattern

Prevents double-refresh during internal CRUD operations.

**Pattern**:
1. Set `isInternalOperation.current = true`
2. Pause: `window.api.directoryWatch.pause()`
3. Perform operation
4. Refresh tree manually
5. Resume: `window.api.directoryWatch.resume()`
6. Set `isInternalOperation.current = false`

**Race Prevention**: Debounced events during pause are ignored

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

**Expansion State**: Maintained via `expandedFolders` Set

**Logic**:
```typescript
const handleDirectoryChanged = async () => {
  if (isInternalOperation.current) return
  const previouslyExpanded = new Set(expandedFolders)
  await refreshFileTree()
  setExpandedFolders(previouslyExpanded)
}
```

**Benefits**: External changes (git, npm, IDE) don't collapse folders

See: [File Watching](./file-watching/README.md#directory-watching)

## File Opening

**Flow**:
1. User clicks file → receives `dockviewApi` via params
2. Check if already open (find by ID)
3. If open: activate panel
4. If closed: add panel with `dockviewApi.addPanel()`

**Panel ID**: Sanitized path (replace `/` with `_`)
**Tab Title**: Basename (e.g., `README.md`)
**Component**: `markdownEditor` - Monaco + preview

See: [UI Components](./ui-components.md#panel-communication-pattern)

## Keyboard Navigation

**Arrow Keys**: Navigate nodes
**Enter**: Open file
**Space**: Expand/collapse folder
**Cmd/Ctrl+Alt+R**: Refresh tree and git status
**Right-Click**: Context menu
**Accessibility**: ARIA labels, roles, focus indicators

## Development Patterns

### Add Control

1. Add to control panel div
2. Add state (local or props)
3. Add persistence if needed (electron-store)
4. Update ProjectTree to respect control

### Add File Operation

1. Add menu item to context menu config
2. Add handler in ProjectTree
3. Implement IPC channel in main
4. Add pause/resume around operation

### Add Visual Indicator

1. Add detection in ProjectTreeNode
2. Add CSS classes
3. Add ARIA labels
4. Add tooltip

## Related Documentation

- [Architecture](./architecture.md) - Hybrid layout, ProjectTree modularization
- [UI Components](./ui-components.md) - Activity bars, panel system
- [IPC Patterns](./ipc-patterns.md) - File operations, settings
- [File Watching](./file-watching/README.md) - Auto-refresh system
- [Development Tasks](./development-tasks.md) - Common patterns
