# Design: Git File Status Integration

## Context

Adding git status indicators to the Project Tree is a common IDE feature that improves developer workflow by providing visual feedback about file changes. However, research shows that git status operations can be performance-intensive and cause UI freezes if not implemented carefully.

### Research Findings

**VS Code Implementation:**
- Uses libgit2 (native C library with Node.js bindings)
- libgit2 is 2.5-5x slower than git CLI
- Most expensive operation: stat() calls on every tracked file
- Performance degrades significantly with large repositories (Chromium: 18x improvement possible)

**Atom Implementation:**
- Simple color coding: orange (modified), green (new), red (deleted)
- Had performance issues with git status updates
- Now sunset in favor of Zed editor

**Key Performance Risks:**
1. **Full repository scans**: Checking status of thousands of files blocks UI
2. **Frequent polling**: Aggressive refresh rates (< 500ms) cause CPU spikes
3. **Blocking operations**: Synchronous git operations freeze the UI thread
4. **Memory overhead**: Caching status for 10,000+ files consumes memory
5. **Cascading updates**: File watchers trigger git checks which trigger UI updates

### Constraints

**Technical:**
- Electron main process (Node.js): Can run blocking operations
- Electron renderer process (Chromium): Must remain responsive (60fps)
- IPC overhead: Each IPC call adds ~1-5ms latency
- File watcher integration: Already detecting file changes

**User Expectations:**
- Git status should appear within 1 second of opening project
- Status updates should reflect file changes within 2 seconds
- UI should never freeze or lag during git operations
- Works for repositories with 1,000+ files

**Business:**
- No external dependencies required (pure JavaScript fallback)
- Graceful degradation for non-git projects
- Works offline (no network operations)

## Goals / Non-Goals

### Goals
- ✅ Display git status indicators (M, U, A, D, C) in Project Tree
- ✅ Update status incrementally without blocking UI
- ✅ Support repositories with 1,000-5,000 files smoothly
- ✅ Use git CLI if available for performance (simple-git)
- ✅ Fallback to pure JavaScript (isomorphic-git) if git CLI unavailable
- ✅ Cache status to minimize redundant git operations
- ✅ Integrate with existing file watcher system

### Non-Goals
- ❌ Implement full git client (commit, push, pull, branch management)
- ❌ Display diff content in UI (future enhancement)
- ❌ Support git operations in UI (stage/unstage only, no commit/push)
- ❌ Support repositories with 10,000+ files initially (optimization later)
- ❌ Real-time status updates (<100ms latency)

## Decisions

### Decision 1: Dual Library Strategy (simple-git + isomorphic-git)

**Choice:** Use simple-git as primary with isomorphic-git as fallback

**Rationale:**
- simple-git wraps git CLI which is ~5x faster than libgit2 for status
- Most developers have git CLI installed (100+ million users)
- isomorphic-git provides zero-dependency fallback (pure JavaScript)
- Dual strategy maximizes performance while ensuring portability

**Implementation:**
```typescript
class GitService {
  private strategy: 'simple-git' | 'isomorphic-git' | 'disabled'

  async initialize() {
    if (await this.hasGitCli()) {
      this.strategy = 'simple-git'
    } else {
      this.strategy = 'isomorphic-git'
    }
  }
}
```

**Alternatives Considered:**
- nodegit (native bindings): Rejected due to Electron compatibility issues
- isomorphic-git only: Rejected due to performance concerns for large repos
- git CLI only: Rejected due to dependency requirement

### Decision 2: Incremental Status Updates with Smart Caching

**Choice:** Only check status for files that changed, cache everything else

**Rationale:**
- Full repository scans on every change are too expensive (stat() every file)
- File watchers already detect which files changed
- 90%+ of files remain unchanged between updates
- Cache hit rate is very high (reduces git operations by 90%+)

**Implementation:**
```typescript
class GitStatusCache {
  private cache: Map<string, GitStatus> = new Map()
  private dirtyFiles: Set<string> = new Set()

  markDirty(filePath: string) {
    this.dirtyFiles.add(filePath)
  }

  async getStatus(filePath: string): Promise<GitStatus> {
    if (this.dirtyFiles.has(filePath) || !this.cache.has(filePath)) {
      const status = await this.gitService.getFileStatus(filePath)
      this.cache.set(filePath, status)
      this.dirtyFiles.delete(filePath)
    }
    return this.cache.get(filePath)
  }
}
```

**Alternatives Considered:**
- Full scan on every change: Rejected due to performance
- Time-based expiration: Rejected due to complexity and inaccuracy
- LRU cache: Rejected as overkill for this use case

### Decision 3: Async-Only Operations with Worker Thread Pattern

**Choice:** All git operations run async in main process, never block renderer

**Rationale:**
- Git operations can take 50-500ms for large repos
- Blocking renderer process freezes UI (unacceptable UX)
- Main process can handle blocking operations without affecting UI
- IPC is async by default, enforces non-blocking pattern

**Implementation:**
```typescript
// Main process - GitService
async getStatus(repoPath: string): Promise<Map<string, GitStatus>> {
  // Runs async in main process, doesn't block renderer
  return await this.gitStrategy.getStatus(repoPath)
}

// IPC Handler
ipcMain.handle('git:getStatus', async (_event, repoPath: string) => {
  return await gitService.getStatus(repoPath)
})

// Renderer - Hook
const { status, loading } = useGitStatus()
// UI shows loading state, never freezes
```

**Alternatives Considered:**
- Worker threads: Rejected as main process is already separate from renderer
- Web Workers: Rejected as can't access Node.js APIs (git libraries)
- Synchronous operations: Rejected due to UI freeze risk

### Decision 4: Debounced Batch Updates

**Choice:** Batch multiple file changes into single git status check (500ms debounce)

**Rationale:**
- Bulk operations (git checkout, npm install) change hundreds of files
- Individual status checks for each file cause 100+ IPC calls
- Debouncing reduces 100 status checks to 1 batch check
- 500ms delay is imperceptible to users but saves 90%+ operations

**Implementation:**
```typescript
class GitStatusDebouncer {
  private pendingFiles: Set<string> = new Set()
  private timeoutId: NodeJS.Timeout | null = null

  scheduleUpdate(filePath: string) {
    this.pendingFiles.add(filePath)

    if (this.timeoutId) clearTimeout(this.timeoutId)

    this.timeoutId = setTimeout(() => {
      this.processBatch()
    }, 500)
  }

  private async processBatch() {
    const files = Array.from(this.pendingFiles)
    const statuses = await this.gitService.getBatchStatus(files)
    this.emitStatusUpdate(statuses)
    this.pendingFiles.clear()
  }
}
```

**Alternatives Considered:**
- No debouncing: Rejected due to excessive operations
- Fixed 2s interval: Rejected as too slow for single file changes
- Adaptive debouncing: Considered for future enhancement

### Decision 5: Parallel Status Checks with Concurrency Limit

**Choice:** Check status for multiple files in parallel, max 5 concurrent operations

**Rationale:**
- Git operations are I/O bound (disk reads)
- Multi-core CPUs can handle parallel operations efficiently
- Limit prevents overwhelming git library or disk I/O
- 5 concurrent operations is safe based on testing

**Implementation:**
```typescript
class GitService {
  private readonly MAX_CONCURRENT = 5
  private semaphore: Semaphore = new Semaphore(this.MAX_CONCURRENT)

  async getBatchStatus(files: string[]): Promise<Map<string, GitStatus>> {
    const promises = files.map(file =>
      this.semaphore.acquire().then(async (release) => {
        try {
          return await this.getFileStatus(file)
        } finally {
          release()
        }
      })
    )
    return await Promise.all(promises)
  }
}
```

**Alternatives Considered:**
- Sequential processing: Rejected due to slow performance
- Unlimited concurrency: Rejected due to resource exhaustion risk
- Single batch operation: Rejected due to all-or-nothing failure mode

### Decision 6: Graceful Degradation Strategy

**Choice:** Git errors don't affect core file operations, just hide indicators

**Rationale:**
- Git repository corruption should not break file tree
- Missing git CLI should not show errors to users
- Git performance issues should not freeze UI
- Users should still be able to work without git status

**Implementation:**
```typescript
class GitService {
  async initialize(repoPath: string): Promise<void> {
    try {
      await this.detectGitRepo(repoPath)
      this.enabled = true
    } catch (error) {
      console.warn('Git not available:', error)
      this.enabled = false
      // No user-visible error, just disable git status
    }
  }

  async getStatus(filePath: string): Promise<GitStatus | null> {
    if (!this.enabled) return null

    try {
      return await this.gitStrategy.getFileStatus(filePath)
    } catch (error) {
      console.warn('Git status failed:', error)
      return null // Return null instead of throwing
    }
  }
}
```

**Alternatives Considered:**
- Throw errors to user: Rejected due to poor UX
- Retry indefinitely: Rejected due to performance impact
- Disable git permanently: Rejected as temporary issues should recover

## Risks / Trade-offs

### Risk 1: Performance Degradation on Large Repositories (>5,000 files)

**Risk:** Git status checks may take >1s for very large repositories

**Mitigation:**
- Use simple-git (git CLI) which is optimized for large repos
- Implement virtual scrolling in file tree (only check visible files)
- Add setting to disable git status for performance-sensitive users
- Consider sampling strategy (check subset of files, estimate rest)

**Trade-off:** Initial implementation prioritizes correctness over extreme performance

### Risk 2: Memory Overhead from Status Cache

**Risk:** Caching status for 10,000 files = ~1-2MB memory

**Mitigation:**
- Use WeakMap for cache (allows garbage collection)
- Implement LRU eviction if memory exceeds threshold (future)
- Only cache files currently in tree (not all repository files)

**Trade-off:** 1-2MB memory is acceptable for modern systems (8GB+ RAM typical)

### Risk 3: Race Conditions Between File Operations and Git Status

**Risk:** User modifies file → file watcher fires → git status updates → UI flickers

**Mitigation:**
- Reuse existing watcher pause mechanism (withWatcherPause HOC)
- Pause git status updates during file operations
- Resume after operation completes
- Use session tokens to discard stale status updates

**Trade-off:** Brief delay (500ms) in status updates during operations is acceptable

### Risk 4: Git CLI Version Compatibility

**Risk:** simple-git may not work with very old git versions (<2.0)

**Mitigation:**
- Check git version on initialization
- Fallback to isomorphic-git if version check fails
- Document minimum git version requirement (2.0+)

**Trade-off:** Git 2.0+ released in 2014, 99%+ of users have newer versions

## Migration Plan

### Phase 1: Core Implementation (v1.0 - Week 1-2)
1. Implement GitService with simple-git + isomorphic-git
2. Add gitStatus field to FileNode interface
3. Update FileService to include git status in readDirectory
4. Display basic indicators (M, U, A, D) in ProjectTreeNode
5. Add enable/disable setting

**Success Criteria:**
- Git status indicators appear for repositories
- No UI freezes with <1,000 file repositories
- Settings toggle works without restart

### Phase 2: Performance Optimization (v1.1 - Week 3)
1. Implement smart caching with file watcher integration
2. Add debouncing for batch updates
3. Implement parallel status checks
4. Add performance metrics logging

**Success Criteria:**
- Supports repositories with 1,000-5,000 files smoothly
- Status updates occur within 2 seconds of file changes
- Cache hit rate >90%

### Phase 3: Advanced Features (v1.2 - Week 4+)
1. Add context menu actions (Stage, Unstage)
2. Implement directory status aggregation
3. Add hover tooltips with detailed status
4. Implement conflict detection and indicators

**Success Criteria:**
- Context menu stage/unstage works
- Directory indicators show aggregated status
- Tooltips provide useful information

### Rollback Plan

If performance issues arise:
1. Disable git status by default (opt-in)
2. Add repository size check (warn if >5,000 files)
3. Implement aggressive caching with no refresh
4. Remove git integration entirely if necessary

**Rollback Triggers:**
- >10% of users report UI freezes
- Performance regression in file operations
- Critical bugs in git integration

## Open Questions

1. **Should we show git status for .gitignored files?**
   - Proposal: No, treat as if git is disabled
   - Rationale: Reduces noise, matches VS Code behavior

2. **How should we handle git submodules?**
   - Proposal: Track each submodule independently
   - Rationale: Each submodule is a separate repository

3. **Should we cache git status across application restarts?**
   - Proposal: No, always check on startup
   - Rationale: Stale cache can mislead users, startup check is fast

4. **What should the default refresh interval be?**
   - Proposal: 2000ms (2 seconds)
   - Rationale: Balance between responsiveness and performance

5. **Should we implement virtual scrolling for large trees?**
   - Proposal: Consider for v2.0 if performance issues arise
   - Rationale: Complex feature, premature optimization

## Performance Benchmarks (Target)

| Metric | Target | Acceptable | Unacceptable |
|--------|--------|------------|--------------|
| Initial status load (100 files) | <100ms | <500ms | >1s |
| Initial status load (1,000 files) | <500ms | <2s | >5s |
| Incremental update (single file) | <50ms | <200ms | >500ms |
| Incremental update (10 files) | <200ms | <500ms | >1s |
| Memory overhead (1,000 files) | <1MB | <5MB | >10MB |
| UI responsiveness | 60fps | 30fps | <20fps |
| Cache hit rate | >95% | >80% | <50% |

**Test Repository:** erfana project itself (~500 files, good test case)
