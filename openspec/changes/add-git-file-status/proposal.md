# Change: Add Git File Status Indicators to Project Tree

## Why

Users working with git repositories need visual feedback about file changes without switching to external tools or the terminal. Currently, ERFANA shows file types (markdown, sensitive, symlink) but lacks git status awareness, forcing users to run `git status` manually or use external tools like VS Code to understand which files have uncommitted changes.

Visual git status indicators in the Project Tree will:
- **Reduce context switching**: Users can see modified/untracked files at a glance
- **Improve workflow efficiency**: Quick identification of changes before committing
- **Match IDE expectations**: VS Code, JetBrains IDEs, and Atom all provide this feature
- **Support AI workflows**: When using prompt templates, users can easily identify which files contain uncommitted work

## What Changes

- Add git status indicators (modified, added, untracked, deleted, conflicted) to file tree nodes
- Implement GitService in main process using isomorphic-git (pure JavaScript, no native dependencies)
- Add git status field to FileNode interface with optional git status metadata
- Display color-coded indicators and icons for different git statuses in ProjectTreeNode
- Add settings toggle to enable/disable git status display
- Implement incremental status updates (watch for git changes without blocking UI)
- Add fallback to simple-git if git CLI is available (performance optimization)

**Non-Breaking Changes:**
- FileNode interface extension (gitStatus field is optional)
- Backward compatible with non-git projects (graceful degradation)
- No changes to existing file operations or watchers

## Impact

### Affected specs
- **git-status** (NEW): Git repository integration and status tracking
- **project-tree** (NEW): Project tree UI component and file display

### Affected code
- `src/preload/index.ts` - Add gitStatus field to FileNode interface
- `src/preload/index.d.ts` - Update type definitions
- `src/main/services/GitService.ts` (NEW) - Git operations service
- `src/main/ipc/git-handlers.ts` (NEW) - Git IPC handlers
- `src/renderer/src/components/ProjectTree/ProjectTreeNode.tsx` - Display git status indicators
- `src/renderer/src/components/ProjectTree/ProjectTree.css` - Git status styling
- `src/main/services/FileService.ts` - Integrate git status in readDirectory

### Dependencies
- `isomorphic-git` (primary): Pure JavaScript git implementation, ~2MB bundle
- `simple-git` (optional fallback): CLI wrapper for users with git installed

### Settings
- New setting: `git.enabled` (default: true) - Enable/disable git status
- New setting: `git.refreshInterval` (default: 2000ms) - Status refresh rate

### Performance Considerations
- Initial git status check: ~50-200ms for typical projects (<1000 files)
- Incremental updates: ~10-50ms per change detection
- No blocking operations: All git operations run async in main process
- Caching: Status cached per file, invalidated on file changes
