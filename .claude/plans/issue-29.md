# Implementation Plan: Issue #29 - Git Status Indicators in Project Tree

## Summary

Add VS Code-style git status visualization to the Project Tree, showing file/folder modification states and a status bar with branch and change counts (read-only, no git operations).

## Technical Approach

- **Library**: `isomorphic-git` - Pure JavaScript git implementation (NO git CLI required)
- **Main Process Service**: `GitStatusService` uses `isomorphic-git` to read status
- **IPC Pattern**: Main → preload → renderer (following existing FileWatcher pattern)
- **State Management**: Zustand store with file/folder status maps
- **Refresh Strategy**: 1s debounce on file changes, 5s cooldown between git calls
- **Performance**: 10k file cap, async processing, pause when unfocused

## Why isomorphic-git?

| Aspect | Value |
|--------|-------|
| Requires git CLI? | **No** - Pure JavaScript |
| Bundle size | ~200-300kb (tree-shakeable) |
| Electron compatible | ✅ Zero native modules, no build issues |
| Performance | `statusMatrix()` returns all file statuses efficiently |
| Maintenance | Active (v1.33.1, 535k npm downloads/week, 106 contributors) |
| Production use | Stoplight Studio (enterprise app) |

## Key API

```typescript
import * as git from 'isomorphic-git'
import fs from 'fs'

// Get branch name
const branch = await git.currentBranch({ fs, dir: repoPath })

// Get all file statuses efficiently (NOT status() which is slow)
const matrix = await git.statusMatrix({ fs, dir: repoPath })
// Returns: [filename, headStatus, workdirStatus, stageStatus]
// Example: ['README.md', 1, 2, 1] = modified in workdir, not staged
```

### statusMatrix Interpretation

| HEAD | WORKDIR | STAGE | Meaning |
|------|---------|-------|---------|
| 0 | 2 | 0 | Untracked (new file) |
| 1 | 2 | 1 | Modified (unstaged) |
| 1 | 2 | 2 | Modified (staged) |
| 1 | 2 | 3 | Modified (staged + more changes) |
| 1 | 0 | 0 | Deleted (unstaged) |
| 1 | 0 | 1 | Deleted (staged) |
| 1 | 1 | 1 | Unmodified |

## New Files (8)

| File | Purpose |
|------|---------|
| `src/shared/ipc/git-schema.ts` | Zod schemas and TypeScript types |
| `src/main/services/GitStatusService.ts` | Git operations using isomorphic-git |
| `src/main/ipc/git-handlers.ts` | IPC handlers for git operations |
| `src/renderer/src/stores/useGitStore.ts` | Zustand store for git status state |
| `src/renderer/src/hooks/useGitStatus.ts` | Hook for refresh logic and subscriptions |
| `src/renderer/src/utils/gitStatus.logic.ts` | Pure logic: parsing, folder propagation |
| `src/renderer/src/components/ProjectTree/GitStatusBadge.tsx` | Badge component (M, U, D, A, R, !) |
| `src/renderer/src/components/ProjectTree/GitStatusBar.tsx` | Footer status bar |

## Modified Files (7)

| File | Changes |
|------|---------|
| `src/preload/index.ts` | Add `git` API namespace |
| `src/preload/index.d.ts` | TypeScript definitions |
| `src/main/index.ts` | Register git-handlers |
| `src/renderer/src/components/ProjectTree/ProjectTree.tsx` | Integrate useGitStatus, render footer |
| `src/renderer/src/components/ProjectTree/ProjectTreeNode.tsx` | Add GitStatusBadge, data-git-status |
| `src/renderer/src/components/ProjectTree/ProjectTree.css` | Git status styles |
| `src/renderer/src/styles/design-tokens.css` | Git status color tokens |

## Implementation Phases

### Phase A: Install dependency + Types
- `npm install isomorphic-git`
- Create `git-schema.ts` with Zod schemas
- Export: `GitFileEntry`, `GitDisplayStatus`, `GitStatusResponse`

### Phase B: Main Process Service
- Implement `GitStatusService` using isomorphic-git
- Use `statusMatrix()` for efficient status reading
- Use `currentBranch()` for branch name
- 10k file cap with truncation flag
- Handle edge cases: not a git repo, errors

### Phase C: IPC Handlers and Preload
- Create `git-handlers.ts` with `git:getStatus` handler
- Add `git` namespace to preload API

### Phase D: Renderer Store and Hook
- Create Zustand store with file/folder status maps
- Implement folder status propagation (severity hierarchy)
- Create `useGitStatus` hook with debounce/cooldown

### Phase E: UI Components
- `GitStatusBadge`: Letter badge for files, dot for folders
- `GitStatusBar`: Branch name, counts, refresh button
- Add CSS styles and design tokens

### Phase F: Integration
- Integrate `useGitStatus` hook in ProjectTree
- Pass status to ProjectTreeNode
- Render footer

## Status Colors (Design Tokens)

| Status | Color | Badge |
|--------|-------|-------|
| Modified | `#e2a44c` (orange) | M |
| Untracked | `#3fb950` (green) | U |
| Deleted | `#f85149` (red) | D |
| Staged | `#3fb950` (green) | A |
| Renamed | `#a371f7` (purple) | R |
| Conflicted | `#f85149` (red) | ! |

## Folder Status Propagation

Folders show colored dot (not badge). Severity hierarchy:
1. Conflicted (highest)
2. Deleted
3. Modified
4. Untracked (lowest)

## Edge Cases Handled

- Non-git directories: Hide all git UI gracefully
- Large repos (10k+): Cap entries, show truncation warning
- Detached HEAD: Show commit SHA instead of branch name
- Window unfocused: Pause auto-refresh
- Errors: Graceful fallback, no crash

## Estimated Changes

- New dependency: `isomorphic-git` (~200kb tree-shaken)
- New files: ~600 lines
- Modified files: ~100 lines
- New tests: ~90 tests
- Complexity: Tier 2 (standard feature)

## Acceptance Criteria

**File/Folder Indicators:**
- [ ] Modified files show orange color + `M` badge
- [ ] Untracked files show green color + `U` badge
- [ ] Deleted files show red color + `D` badge
- [ ] Staged files show green color + `A` badge
- [ ] Folders show colored dot based on contents' status
- [ ] Status propagates up through nested folders

**Status Bar:**
- [ ] Shows current branch name in panel footer
- [ ] Shows count of modified, untracked, deleted, staged files
- [ ] Manual refresh button works
- [ ] Handles detached HEAD state

**Refresh Behavior:**
- [ ] Auto-refreshes on file changes with 1s debounce
- [ ] Respects 5s cooldown between refreshes
- [ ] Pauses when window loses focus
- [ ] Manual refresh bypasses cooldown

**Edge Cases:**
- [ ] Non-git directories handled gracefully (no indicators)
- [ ] Large repos don't freeze the app (10k cap)
- [ ] No git CLI required (uses isomorphic-git)
