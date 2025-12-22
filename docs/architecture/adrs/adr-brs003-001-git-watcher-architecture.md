---
brs_id: 3
document_type: technical_adr
sequence: 1
---

# ADR-BRS003-001: Git watcher architecture

**Date:** 2025-12 | **Status:** Proposed

## Context

Erfana requires real-time git status updates in the Project panel with < 1 second latency. The current implementation has detection gaps and high latency (~2 seconds) due to:

1. Only `.git/index` is watched (misses branch switches, stash, fetch)
2. Combined debounce (500ms) + cooldown (1500ms) creates 2000ms worst-case latency
3. No fallback mechanism for unreliable file system events

### Current architecture

- **DirectoryWatcherService**: Has `startGitIndexWatcher()` for `.git/index` only
- **useGitStatus hook**: 500ms debounce + 1500ms cooldown
- **Detection gaps**: Branch switches, fetch, stash, branch operations

### Requirements from BRS-003

- FR-001 to FR-010: Watch all critical git files, detect all change scenarios
- NFR-001: < 1 second latency
- NFR-002: 100% detection rate
- NFR-003: < 1% CPU with polling active
- NFR-004: Auto-restart with exponential backoff
- NFR-005: Works on network and cloud drives

## Decision drivers

1. **SOLID principles**: Single Responsibility - separate git watching from directory watching
2. **Reliability**: Polling fallback ensures eventual consistency
3. **Performance**: Minimal CPU overhead, optimized timing
4. **Existing patterns**: Leverage `DirectoryWatcherService` error handling, `WatcherMetrics`

## Considered options

### Option 1: Extend DirectoryWatcherService

| Pros | Cons |
|------|------|
| Single service to maintain | Violates Single Responsibility |
| Shared infrastructure | Different lifecycle (project vs webContents) |
| Less code | More complex error handling |
| | Harder to test git logic in isolation |

### Option 2: Dedicated GitWatcherService

| Pros | Cons |
|------|------|
| Clear separation of concerns | Two services to coordinate |
| Independent lifecycle | Some shared patterns (duplicated) |
| Easier testing | More files |
| Can evolve git watching independently | |

### Option 3: Use git's built-in fsmonitor

| Pros | Cons |
|------|------|
| Native git integration | Requires git 2.37+ |
| Optimized performance | Not all users have recent git |
| | Complex IPC with git daemon |
| | Less control over event handling |

## Decision outcome

**Chosen option: Option 2 - Dedicated GitWatcherService**

This option provides the best balance of maintainability, testability, and alignment with SOLID principles while meeting all functional requirements.

## Architecture design

### Component structure

```
Main Process
├── GitWatcherService (NEW)
│   ├── Watches: .git/index, .git/HEAD, .git/refs/heads/, .git/FETCH_HEAD, .git/stash
│   ├── GitEventCoalescer (150ms window)
│   └── Auto-restart with exponential backoff
├── GitPollingService (NEW)
│   ├── Differential polling (stat-based, 7s default)
│   └── Adaptive intervals (aggressive when watchers fail)
├── DirectoryWatcherService (modified)
│   └── Removes git index watching (delegated)
└── GitStatusService (unchanged)
    └── isomorphic-git status retrieval
```

### Timing optimization

| Metric | Current | Target |
|--------|---------|--------|
| Main process coalescing | 300ms | 150ms |
| Renderer debounce | 500ms | 150ms |
| Cooldown | 1500ms | 500ms (bypassed for git events) |
| **Total latency** | **~2000ms** | **~400ms** |

### Watch targets

| Path | Priority | Purpose |
|------|----------|---------|
| `.git/index` | High | Staging changes |
| `.git/HEAD` | High | Branch switches |
| `.git/refs/heads/` | Medium | Branch create/delete |
| `.git/FETCH_HEAD` | Medium | Fetch operations |
| `.git/refs/stash` | Medium | Stash operations |
| `.git/stash` | Medium | Legacy stash |

### Polling fallback

- Default interval: 7 seconds
- Adaptive: 3s aggressive (on watcher failure), 10s relaxed (healthy)
- Differential: Only stats `.git/index` and `.git/HEAD` mtime/size
- CPU overhead: < 0.02% at 7s interval

## Consequences

### Positive

- Clear separation of git watching from directory watching
- Testable git-specific logic in isolation
- Polling fallback ensures 100% detection rate
- < 1 second latency achieved (target: 400ms)
- Compatible with network and cloud drives

### Negative

- Two services to coordinate (GitWatcherService + GitPollingService)
- Some pattern duplication with DirectoryWatcherService (auto-restart)
- More files to maintain

### Neutral

- Breaking change: `git:index-changed` IPC deprecated in favor of `git:state-changed`
- Timing constants change (documented in changelog)

## Implementation phases

1. **Phase 1**: GitWatcherService foundation (index + HEAD watching)
2. **Phase 2**: Extended watching (refs, stash, FETCH_HEAD)
3. **Phase 3**: Latency optimization (timing constants)
4. **Phase 4**: Polling fallback
5. **Phase 5**: Error recovery and hardening
6. **Phase 6**: Cloud/network drive testing

## Migration considerations

- `git:index-changed` IPC event deprecated, kept for one version
- `GIT_STATUS.DEBOUNCE_DELAY`: 500ms -> 150ms
- `GIT_STATUS.COOLDOWN_DURATION`: 1500ms -> 500ms
- Tests updated for new timing

## Enforcement

- **Code review**: Ensure git watching uses GitWatcherService, not DirectoryWatcherService
- **Testing**: Unit tests for each watcher type, integration tests for IPC flow
- **Metrics**: WatcherMetrics tracks git watcher health alongside directory watchers

## References

- [BRS-003 Architecture Document](/specs/business-reqs/brs003-realtime-git-status/architecture.md) - Full architecture specification
- [Chokidar](https://github.com/paulmillr/chokidar) - File watching library
- [VS Code File Watcher Issues](https://github.com/microsoft/vscode/wiki/File-Watcher-Issues) - Known limitations
- [ADR-BRS001-001](/docs/architecture/adrs/adr-brs001-001-unified-search.md) - Provider pattern reference
