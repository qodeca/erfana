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
  <PanelErrorBoundary key={projectPath ?? 'none'} componentName="Project tree">
    <ProjectTree />
  </PanelErrorBoundary>
</ProjectPanel>
```

### Responsibilities

**ProjectPanel**: Header, control panel visibility, filter mode state & persistence, panel-scoped error containment
**ProjectTree**: Tree rendering (virtualised), expansion/collapse, keyboard navigation, context menu, file opening, filtering, reading lazy folders on expand

### Error Containment (#60)

The tree is wrapped in `PanelErrorBoundary`, so a render failure degrades to a **"Project tree unavailable. The rest of Erfana still works."** message with a **Reload** button inside the sidebar, instead of blanking the window and taking unsaved Monaco buffers and a live terminal with it. Reload clears the error state and re-renders the tree in place; a second failure changes the copy to "Project tree is still unavailable." The boundary logs at `error` (`[PanelErrorBoundary] Project tree error`), not `fatal` — the window is still usable.

**The `key={projectPath ?? 'none'}` is load-bearing.** The error state survives every re-render and is cleared only by Reload or a remount, so keying by project path is what makes opening a different project remount the boundary. Without the key, a tree that crashed on project A still reads "unavailable" after the user switches to project B, and only Reload would clear it. The panel reads that path from `useProjectManagementContextSafe()` — the safe accessor, because the path is needed only for the key and is not worth making the panel unrenderable outside the provider.

See: [UI Components - Error containment](./ui-components.md#error-containment) for the two-tier root/panel design, and [Troubleshooting - Project tree unavailable](./troubleshooting.md#project-tree-unavailable) for the user-facing procedure.

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

**Visual**: Radio with checkmark icons, gray text (`var(--color-accent-drag)` when active), 12px spacing
**Persistence**: electron-store, survives restarts

See: [IPC Patterns](./ipc-patterns.md) for filter persistence channels

### Watching

- Symlink indicator: small chain icon (watchers don't follow symlinks)
- Depth: config via `directoryWatchDepth` (not exposed in UI)

## Unsaved Changes Prompt

Opening another project (from the picker or the recent list) or closing the project first **saves** every edited tab, then asks only about what could not be saved (`prepareProjectTransition` in `ProjectTree/switchHelpers.ts`, v0.22.0):

1. The UI is locked ("Saving open tabs…") and every tab's autosave is held, so nothing can be typed or saved into the project being left
2. Every dirty tab is saved; a tab whose file changed on disk (the conflict bar is showing) is left alone
3. Only if some tab is still unsaved – a conflict, a failed or timed-out write – does a prompt appear: "1 tab could not be saved. Discard and switch project?"

**Options**: Switch Anyway / Close Anyway (leave those tabs unsaved, with no late write) | Cancel (keep the project; autosave runs again)
**Busy terminal**: with nothing unsaved but recent terminal activity, the prompt reads "Terminal shows recent activity. Stop it and switch project?"
**Main side**: opens and closes run one at a time in `ProjectService`, so a quick double-click on two recent projects ends with the second one open

## File Filtering

### Filter Modes

**Type**: `FilterMode = 'all' | 'markdown'`
**Location**: `src/renderer/src/types/filters.ts`
**IPC**: `settings:getProjectFilterMode`, `settings:setProjectFilterMode`

### Recursive Algorithm

**Goal**: Show only .md files and folders containing them

**Implementation**: `filterMarkdownTree(nodes, loaded, status, base)` in `ProjectTree/markdownFilter.ts`, a depth-first walk over the merged tree (the base tree plus lazy folders read so far). A file is kept when `isMarkdownFileName()` says so; a folder is kept when anything below it is kept. Lazy folders are judged by what is known of them:

- read on expand – like any folder;
- read failed – kept, so its "Could not read this folder" line stays in view;
- never read, `capped` (left unread by a walk bound) – kept, because it may hold Markdown;
- never read, `ignored` (build and cache output) – hidden;
- never read, `linked` (its files show under the folder the link leads to) – hidden.

**Helper**: `isMarkdownFileName()` checks `.md` and `.markdown` only, any case. There are two more copies with the same rule – `isMarkdownFile()` in `src/renderer/src/utils/fileUtils.ts` and in `components/Panels/markdownEditorPanel.logic.ts` – so `.mdx`, `.mdown` and `.mkd` files are hidden in Markdown mode.

### Behavior

**Markdown Mode**: Only .md files + containing folders, empty folders hidden, expansion state preserved
**All Mode**: All files/folders visible, hidden files styled with reduced opacity

## Visual Indicators

### Git Status Indicators (v0.5.3)

VS Code-style git status badges on files and folders.

**File Badges**: Letter badges showing status. Colours are design tokens (`design-tokens.css`): the badge background is the `-light` variant, for example `var(--color-git-modified-light)`, and the base token maps to a brand colour
- **M** (amber, `--color-git-modified`) - Modified
- **U** (lime, `--color-git-untracked`) - Untracked
- **D** (coral, `--color-git-deleted`) - Deleted
- **A** (violet, `--color-git-staged`) - Staged/Added
- **R** (indigo, `--color-git-renamed`) - Renamed
- **!** (magenta, `--color-git-conflicted`) - Conflicted

**Folder Dots**: Colored dots showing child status (propagates from files)

**Status Bar**: Footer showing branch name + colored status counts

**Architecture**:
- `GitStatusService.ts` - runs git status in a worker thread (`workers/git-status.worker.ts`): native `git status` first, isomorphic-git `statusMatrix()` only when no git binary is found. Native git runs hardened (`src/main/utils/hardenedGit.ts`): from a neutral folder, with a short list of environment variables, and with hooks, fsmonitor and filter drivers turned off; a partial clone, or a config that cannot be inspected, uses isomorphic-git instead
- `useGitStatus.ts` - Hook with 250 ms debounce, 500 ms cooldown (`GIT_STATUS` in `ProjectTree/constants.ts`)
- `useGitStore.ts` - Zustand store for git state
- `GitStatusBadge.tsx` - File/folder badge component
- `GitStatusBar.tsx` - Branch + counts footer

**Auto-refresh**: On file changes, pauses when tab unfocused

**Known Limitation**: Global `.gitignore` not supported when the isomorphic-git fallback runs (no git binary found); the native path runs the user's own `git status`

See: [Known Issues](./known-issues.md#git-status-global-gitignore-not-supported)

### Sensitive Files

**5 Categories**:
1. Exact filename: `credentials`, `secrets`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`,
   `known_hosts`, `authorized_keys`
2. Dotfile prefix (exact, or followed by a dot): `.env`, `.npmrc`, `.netrc`, `.dockercfg`,
   `.pypirc` – so `.env.production` matches
3. Directory fragment: `.aws/`, `.ssh/`, `.gnupg/`
4. Extension: `.key`, `.pem`, `.p12`, `.pfx`, `.keystore`, `.jks`, `.crt`, `.cer`
5. Password/token files: a name containing `password` or `token` **and** ending `.txt` or `.json`

**Visual**: Color `var(--color-warning-bright)` (amber – a RETIRED token; new code should use `var(--color-warning)`), icon ⚠️ (14px), ARIA label "Sensitive file"
**Detection**: `isSensitiveFile()` in `ProjectTreeNode.tsx` – plain string comparison
(exact match, prefix, `includes`, `endsWith`), not regex
**Location**: `ProjectTreeNode.tsx`

**Two caveats.** `config.json`, `settings.json` and `*.config.js` are **not** flagged –
they were never in the implementation. And category 3 is effectively dead: the component
passes `node.name` (a bare filename) to `isSensitiveFile()`, so a path fragment such as
`.aws/` can never match. Files inside `.aws/` or `.ssh/` are flagged only when their own
name matches another category, as `credentials` and `known_hosts` do.

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
- **Strategy**: Node type-specific menus (`FileContextMenuStrategy`, `DirectoryContextMenuStrategy`)
- **Command**: Testable command objects (13 classes)
- **Factory**: Automatic strategy selection

**Structure**:
```
context-menu/
├── types.ts        # Interfaces
├── commands.tsx    # 13 command classes
├── strategies.tsx  # FileContextMenuStrategy, DirectoryContextMenuStrategy
└── factory.ts      # ContextMenuFactory.build(node, ctx)
```

### Menu Items

Built by `strategies.tsx` from the command classes in `commands.tsx`, in this order:

**Files**: Open as source, Open in default browser (HTML files only, each under its own gate), ---, Cut, Copy, ---, Rename, ---, Delete, ---, Reveal in Finder / Show in Explorer
**Folders**: Cut, Copy, Paste, ---, New File, New Folder, Rename, ---, Import..., ---, Delete,
---, Reveal in Finder / Show in Explorer
**Project root**: the root row is also a valid target; it cannot be moved
("Cannot move project root")

**Conditional items**: Paste appears only on directories and only when the internal
clipboard is non-empty. Import... appears only on directories and only when an import
handler is supplied; it gets its own separator. The Reveal label switches on `isMacOS()`.

**Gates for the HTML open group**: Open as source appears only when `ctx.openAsSource` is wired (the tree can reach the editor), and Open in default browser only when `ctx.openInBrowser` is wired (`MenuContext` in `context-menu/types.ts`). The separator follows the group only when it holds at least one item. `openInBrowser` raises its own toasts and never rejects.

**Separator**: Visual separator before destructive actions

### Command Classes

Each command's `toMenuItem()` produces an `IMenuItem`, and each strategy implements `IContextMenuStrategy` (`context-menu/types.ts`):
```typescript
interface IMenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  separator?: boolean
  execute: () => void | Promise<void>
}

interface IContextMenuStrategy {
  supports(node: FileNode): boolean
  build(node: FileNode, ctx: MenuContext): IMenuItem[]
}
```

**Available** (`commands.tsx`): CutCommand, CopyCommand, PasteIntoDirectoryCommand, OpenAsSourceCommand, OpenInBrowserCommand, RenameFileCommand, RenameDirectoryCommand, DeleteFileCommand, DeleteDirectoryCommand, NewFileInDirectoryCommand, NewFolderInDirectoryCommand, ImportCommand, RevealInFileManagerCommand

### Extensibility

**Add Menu Item** (including a new file operation):
1. Create a command class in `commands.tsx` that extends `CommandBase` (a `label`, optional `icon` / `danger`, and `execute()`)
2. Reach everything through the injected `MenuContext` (`this.ctx`), never through `window.api` or a store directly: `ctx.api` for file IPC, `ctx.dialogs` and `ctx.toast` for the UI. Wrap any filesystem change in `ctx.withWatcherPause(...)` (see [Pause/Resume Pattern](#pauseresume-pattern)), then call `ctx.refreshProjectTree()` inside it and `ctx.onGitRefresh?.()` after it
3. If the command needs something `MenuContext` does not carry yet, add an optional field in `context-menu/types.ts` and wire it in `buildMenuContext()` in `ProjectTree.tsx`
4. If it needs a new main-process operation, add the IPC channel first – see [Development Tasks](./development-tasks.md) and [IPC Patterns](./ipc-patterns.md)
5. Add it to the strategy in `strategies.tsx`

**New Node Type**:
1. Create strategy in `strategies.tsx`
2. Implement `IContextMenuStrategy` (`supports(node)` and `build(node, ctx)`)
3. Register it in the `ContextMenuFactory` constructor (`factory.ts`)

### Benefits

Single Responsibility, Open/Closed, Testable (`commands.test.tsx`, `strategies.test.tsx` and `factory.test.ts`), Maintainable, Flexible

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

**Pattern** – all of it lives in `withWatcherPause()` (`ProjectTree/withWatcherPause.ts`), which callers wrap their operation in:
1. Sets `isInternalOperationRef.current = true` and `setLoading(true)`
2. Pause: `directoryWatchGateway.pause(projectPath)`
3. Runs the operation (create, rename, delete, paste, import)
4. Resets `isInternalOperationRef.current = false` before resuming
5. Resume: `directoryWatchGateway.resume(projectPath)`
6. `setLoading(false)` in a `finally` block, even on error

**Race Prevention**: Debounced events during pause are ignored

**Example** (`hooks/useFileOperations.ts`):
```typescript
const createdFilePath = await withWatcherPause(
  projectPath,
  isInternalOperationRef,
  setLoading,
  async () => {
    const filePath = await api.file.createFile({ dirPath: targetPath!, name: fileName })
    await refreshProjectTree()
    return filePath
  }
)
```

### Tree State Preservation

**Expansion State**: `expandedFolders` (a `Set` of paths) is component state in `ProjectTree.tsx`. A refresh replaces only the base tree, so the set survives it and external changes (git, npm, an agent writing files) don't collapse folders. It is reset only when the project changes (`seedExpansion(newPath)`, root expanded). Lazy folders that were read are read again when next shown expanded, and keep their old children on screen until the new ones arrive (`useLazyFolderChildren`).

**Skip rule**: `useDirectoryWatcher` ignores a change while `isInternalOperationRef` is set, except a `catchUp` refresh, which reports changes dropped during a pause. A batch with `structural: false` (content edits only) refreshes git badges but not the tree.

See: [File Watching](./file-watching/README.md#directorywatcherservice-directory-watching)

## Large trees

Since v0.22.0 the tree stays fast on projects with tens of thousands of files:

- **Virtualised rows.** `buildVisibleRows` (`ProjectTree/visibleRows.ts`) flattens the expanded part of the tree into one list, and `@tanstack/react-virtual` draws only the rows on screen. A click or a git refresh redraws only the rows that changed. While dragging, the rows inside the target folder are tinted (`FolderDropHighlight.tsx`); a drop on a sibling or on the item's own folder does nothing, and auto-scroll follows the pointer. A cut item is dimmed until it is pasted
- **Lazy folders.** The main-process walk leaves folders on the watcher's ignore list (`dist`, `build`, `.venv`, `.next`, `coverage`, …) unread, and past 50,000 entries leaves the rest unread too; such rows arrive with `lazy` set and no children. Expanding one runs one shallow `file:readDirectory` of that folder (`useLazyFolderChildren`), and the result is kept in `useLazyFolderStore` so every consumer of the project's files sees it (`useMergedProjectFiles`)
- **Placeholder line.** While a lazy folder is read, a "Loading…" line sits under it (`TreePlaceholderRow.tsx`); "Could not read this folder" if the read fails. The line takes no focus and no drag, and a drop on it lands in the folder
- **Incomplete tree.** When some folders are unread, a file name clicked in the terminal is also searched for on disk (`file:findByName`, bounded in time and size), and the file chooser says its list may be incomplete

Measurement: [lazy tree walk](./performance/2026-10-22-lazy-tree-walk.md).

## File Opening

**Flow**:
1. User clicks file → `openFileInPanel()` with the editor-area `dockviewApi`
2. Decide the panel kind: images open in the image viewer; an eligible `.html` / `.htm` file opens as a running preview (the caller awaits `resolvePanelKind()` and passes `kind: 'preview'`); everything else opens in the Markdown editor
3. Check if already open: editor and image tabs by panel id; a preview tab by the page it shows now, via `findPreviewTabShowing()` (reads `params.filePath`), because a preview tab that moved to another page keeps its original id
4. If open: activate panel
5. If closed: add panel with `dockviewApi.addPanel()`

**Panel ID**: From `getFilePanelId()` / `openFileInPanel()` in `utils/openFileInPanel.ts` – never hand-built (an id past the length budget is a shortened head plus a digest, so a path cannot be read back out of it)
**Tab Title**: Basename (e.g., `README.md`)
**Component** (registry keys in `DockLayout/components/EditorAreaSplitPanel.tsx`): `editor` – `MarkdownEditorPanel` (Monaco + preview), id prefix `editor-`; `imageViewer`, id prefix `image-`; `htmlPreview`, id prefix `preview-`

See: [UI Components](./ui-components.md#panel-communication)

## Keyboard Navigation

Since v0.22.0 (#87, #88, #89) the tree is **one Tab stop** (roving `tabindex`), and the keys follow the WAI-ARIA tree pattern. The contract is data in `ProjectTree/treeKeyboard.ts` (`resolveTreeKey`, `findTypeAheadMatch`), decided by the design card `design/system/components/row/`:

| Key | Action |
|-----|--------|
| ↑ / ↓ | Previous / next row |
| Home / End | First / last row |
| → | Closed folder: open it. Open folder: move to its first child |
| ← | Open folder: close it. Otherwise: move to the parent |
| Enter | What a click does: open a file; on a folder, toggle it and make it the paste target |
| Letters | Type-ahead: jump to the next row whose name starts with what was typed |
| Shift+F10 / Menu key | Open the row's context menu under the row |
| Cmd/Ctrl+Alt+R | Refresh tree and git status |
| Cmd+C / X / V (macOS), Ctrl+C / X / V (elsewhere) | Copy, cut, paste – only while the tree has focus, only with the platform's own modifier and no Shift or Alt (`treeClipboardScope.ts`) |

Keys with Ctrl, Alt or Cmd held are left to app shortcuts. Placeholder lines ("Loading…") are stepped over. Each row states `aria-level`, `aria-posinset` and `aria-setsize`, because a virtualised tree does not have every row in the DOM for a screen reader to count. When the focused row disappears (deleted, renamed, filtered out), focus moves to the row with the same path, else its nearest ancestor, else the first row (`useTreeFocusRecovery.ts`); after New File, Rename or Delete from the menu, focus returns to the tree.

**Right-Click**: Context menu

## Development Patterns

### Add Control

1. Add to control panel div
2. Add state (local or props)
3. Add persistence if needed (electron-store)
4. Update ProjectTree to respect control

### Add File Operation

Follow **Add Menu Item** under [Context Menu Operations – Extensibility](#extensibility).

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
