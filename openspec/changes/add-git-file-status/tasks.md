# Implementation Tasks

## 1. Dependencies and Setup

- [ ] 1.1 Install isomorphic-git package (`npm install isomorphic-git`)
- [ ] 1.2 Install simple-git package (`npm install simple-git`)
- [ ] 1.3 Add git types to TypeScript definitions
- [ ] 1.4 Update package.json with correct versions

## 2. Core Git Service Implementation

- [ ] 2.1 Create `src/main/services/GitService.ts` with interface `IGitService`
- [ ] 2.2 Implement git repository detection (check for .git directory)
- [ ] 2.3 Implement git CLI detection (check if git is available on PATH)
- [ ] 2.4 Implement strategy pattern (SimpleGitStrategy + IsomorphicGitStrategy)
- [ ] 2.5 Implement `getFileStatus(filePath)` method
- [ ] 2.6 Implement `getBatchStatus(filePaths[])` method for multiple files
- [ ] 2.7 Implement error handling and graceful degradation
- [ ] 2.8 Add git service initialization in main process

## 3. Status Cache Implementation

- [ ] 3.1 Create `src/main/utils/GitStatusCache.ts`
- [ ] 3.2 Implement cache with Map<filePath, status>
- [ ] 3.3 Implement dirty file tracking (Set<filePath>)
- [ ] 3.4 Implement cache invalidation on file changes
- [ ] 3.5 Add cache statistics for debugging (hit rate, size)

## 4. Debouncing and Batch Updates

- [ ] 4.1 Create `src/main/utils/GitStatusDebouncer.ts`
- [ ] 4.2 Implement 500ms debounce for batch file changes
- [ ] 4.3 Integrate with file watcher events
- [ ] 4.4 Add concurrency limiter (max 5 parallel status checks)
- [ ] 4.5 Test with bulk operations (git checkout, npm install)

## 5. IPC Layer

- [ ] 5.1 Create `src/main/ipc/git-handlers.ts`
- [ ] 5.2 Implement `git:initialize` handler (detect repository)
- [ ] 5.3 Implement `git:getStatus` handler (batch status check)
- [ ] 5.4 Implement `git:getFileStatus` handler (single file)
- [ ] 5.5 Implement `git:stageFile` handler (git add)
- [ ] 5.6 Implement `git:unstageFile` handler (git reset)
- [ ] 5.7 Add git status change event emitter (`git:statusChanged`)
- [ ] 5.8 Register handlers in main process

## 6. Preload API Extension

- [ ] 6.1 Add `gitStatus` field to FileNode interface (optional)
- [ ] 6.2 Define GitStatus type (`'modified' | 'untracked' | 'staged' | 'deleted' | 'conflicted' | null`)
- [ ] 6.3 Add `api.git` namespace to window.api
- [ ] 6.4 Implement `api.git.initialize(repoPath)` method
- [ ] 6.5 Implement `api.git.getStatus(repoPath)` method
- [ ] 6.6 Implement `api.git.stageFile(filePath)` method
- [ ] 6.7 Implement `api.git.unstageFile(filePath)` method
- [ ] 6.8 Add `api.git.onStatusChanged` event listener
- [ ] 6.9 Update TypeScript definitions in preload/index.d.ts

## 7. FileService Integration

- [ ] 7.1 Inject GitService into FileService constructor
- [ ] 7.2 Update `readDirectory` to include git status for each file
- [ ] 7.3 Add optional parameter to enable/disable git status
- [ ] 7.4 Ensure git status doesn't block file operations
- [ ] 7.5 Handle git errors without affecting file tree

## 8. Settings Service Extension

- [ ] 8.1 Add `git.enabled` setting (default: true)
- [ ] 8.2 Add `git.refreshInterval` setting (default: 2000ms)
- [ ] 8.3 Implement setting getters in SettingsService
- [ ] 8.4 Implement setting setters with validation
- [ ] 8.5 Add settings migration for existing users
- [ ] 8.6 Add IPC handlers for git settings

## 9. UI: ProjectTreeNode Updates

- [ ] 9.1 Add git status indicator rendering logic
- [ ] 9.2 Implement status color mapping (modified=orange, untracked=green, etc.)
- [ ] 9.3 Position indicator before file name with proper spacing
- [ ] 9.4 Add hover tooltip with status description
- [ ] 9.5 Ensure indicators don't disrupt existing icons (symlink, sensitive)
- [ ] 9.6 Test with multiple file attributes (git + symlink + sensitive)

## 10. UI: CSS Styling

- [ ] 10.1 Add git status indicator styles to ProjectTree.css
- [ ] 10.2 Define color variables for each status type
- [ ] 10.3 Ensure WCAG AA contrast compliance
- [ ] 10.4 Add hover state styling
- [ ] 10.5 Test in light and dark themes (if applicable)
- [ ] 10.6 Ensure layout doesn't shift when status appears/disappears

## 11. UI: Context Menu Integration

- [ ] 11.1 Create StageFileCommand class in context-menu/commands.tsx
- [ ] 11.2 Create UnstageFileCommand class in context-menu/commands.tsx
- [ ] 11.3 Update context menu factory to include git commands
- [ ] 11.4 Show "Stage Changes" for modified/untracked files
- [ ] 11.5 Show "Unstage Changes" for staged files
- [ ] 11.6 Add disabled "Resolve Conflict" option for conflicted files
- [ ] 11.7 Update context menu tests

## 12. UI: Git Status Hook

- [ ] 12.1 Create `src/renderer/hooks/useGitStatus.ts`
- [ ] 12.2 Implement git status subscription (api.git.onStatusChanged)
- [ ] 12.3 Implement status state management (Map<filePath, status>)
- [ ] 12.4 Integrate with project lifecycle (initialize on project open)
- [ ] 12.5 Clean up on project close
- [ ] 12.6 Handle settings changes (enable/disable)

## 13. Watcher Integration

- [ ] 13.1 Integrate GitStatusDebouncer with DirectoryWatcherService
- [ ] 13.2 Mark files dirty in cache when watcher detects changes
- [ ] 13.3 Pause git updates during file operations (reuse withWatcherPause)
- [ ] 13.4 Implement session tokens to discard stale updates
- [ ] 13.5 Test with rapid file changes (save multiple files quickly)

## 14. Performance Optimization

- [ ] 14.1 Implement parallel status checks with concurrency limit (5)
- [ ] 14.2 Add performance logging (status check duration, cache hit rate)
- [ ] 14.3 Profile with 100, 1000, and 5000 file repositories
- [ ] 14.4 Optimize hot paths based on profiling results
- [ ] 14.5 Add memory usage tracking for cache

## 15. Error Handling

- [ ] 15.1 Handle .git directory not found (disable git gracefully)
- [ ] 15.2 Handle corrupt git repository (log warning, disable git)
- [ ] 15.3 Handle git CLI not found (fallback to isomorphic-git)
- [ ] 15.4 Handle git operation timeouts (5s max)
- [ ] 15.5 Handle git submodules (detect and track independently)
- [ ] 15.6 Handle git worktrees (edge case, log warning)

## 16. Testing: Unit Tests

- [ ] 16.1 Test GitService.ts (repository detection, status retrieval)
- [ ] 16.2 Test SimpleGitStrategy (CLI operations)
- [ ] 16.3 Test IsomorphicGitStrategy (pure JS operations)
- [ ] 16.4 Test GitStatusCache (cache hit/miss, invalidation)
- [ ] 16.5 Test GitStatusDebouncer (debouncing, batching)
- [ ] 16.6 Test git IPC handlers (mock git service)
- [ ] 16.7 Test context menu commands (StageFileCommand, UnstageFileCommand)
- [ ] 16.8 Target: 80%+ code coverage for new code

## 17. Testing: Integration Tests

- [ ] 17.1 Test git status display in ProjectTree with real git repository
- [ ] 17.2 Test status updates after file modifications
- [ ] 17.3 Test status updates after git operations (add, reset)
- [ ] 17.4 Test context menu stage/unstage operations
- [ ] 17.5 Test settings toggle (enable/disable git)
- [ ] 17.6 Test project switching with git repositories
- [ ] 17.7 Test performance with 1000-file test repository

## 18. Testing: Edge Cases

- [ ] 18.1 Test non-git project (no errors, no indicators)
- [ ] 18.2 Test empty git repository (no files)
- [ ] 18.3 Test git repository with submodules
- [ ] 18.4 Test git repository with .gitignore
- [ ] 18.5 Test git repository with merge conflicts
- [ ] 18.6 Test project switch during git operation
- [ ] 18.7 Test rapid file changes (debouncing effectiveness)

## 19. Documentation

- [ ] 19.1 Update CLAUDE.md with git status feature (Recent Changes)
- [ ] 19.2 Create docs/git-integration/README.md
- [ ] 19.3 Document GitService architecture and design decisions
- [ ] 19.4 Document performance characteristics and benchmarks
- [ ] 19.5 Document settings (git.enabled, git.refreshInterval)
- [ ] 19.6 Add troubleshooting guide for git issues
- [ ] 19.7 Update docs/known-issues.md with git limitations

## 20. Validation and Release

- [ ] 20.1 Run full test suite (npm run test)
- [ ] 20.2 Run typecheck (npm run typecheck)
- [ ] 20.3 Run lint (npm run lint)
- [ ] 20.4 Test with erfana project itself (dogfooding)
- [ ] 20.5 Test with large repository (1000+ files)
- [ ] 20.6 Measure performance metrics vs targets
- [ ] 20.7 Update version number (v0.3.9 or v0.4.0)
- [ ] 20.8 Create git tag with release notes
- [ ] 20.9 Build production DMG (npm run build:mac)
- [ ] 20.10 Smoke test production build
