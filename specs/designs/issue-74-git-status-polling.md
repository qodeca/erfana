# Issue #74: Real-time Git Status Refresh with Polling Fallback

## Design Document

**Issue:** #74
**BRS Reference:** BRS-003 Real-time Git Status Refresh
**Created:** 2025-12-22
**Status:** Proposed

---

## 1. Overview

This design document specifies the implementation approach for Issue #74, which adds a hybrid polling fallback mechanism to the existing git status refresh system. The implementation enhances the current `.git/index` watching to include additional git state files and introduces a configurable polling mechanism as a reliability safety net.

### 1.1 Design Goals

1. **Multi-path `.git/` watching** - Extend beyond `.git/index` to watch HEAD, refs/heads, FETCH_HEAD, stash
2. **Hybrid polling** - Continuous polling that skips refresh when watchers are active
3. **User-configurable settings** - Toggle and interval exposed in Settings overlay
4. **Reduced latency** - Debounce 500ms to 250ms, cooldown 1500ms to 500ms
5. **Metrics extension** - Track polling stats in WatcherMetrics

---

## 2. Component Architecture

### 2.1 Data Flow Diagram

```
                              MAIN PROCESS
    +--------------------------------------------------------------------+
    |                                                                     |
    |  +---------------------+      +-----------------------------+      |
    |  | DirectoryWatcherSvc |      |    GitWatcherService (NEW)  |      |
    |  |                     |      |                             |      |
    |  | - Project dir watch |      | - .git/index (existing)     |      |
    |  | - VS Code patterns  |      | - .git/HEAD (new)           |      |
    |  +----------+----------+      | - .git/refs/heads/ (new)    |      |
    |             |                 | - .git/FETCH_HEAD (new)     |      |
    |             |                 | - .git/stash (new)          |      |
    |             |                 +------------+----------------+      |
    |             |                              |                        |
    |             |        +---------------------+                        |
    |             |        |                                              |
    |             |        v                                              |
    |             |   +--------------------+                              |
    |             |   | GitEventCoalescer  |  150ms window                |
    |             |   +--------------------+                              |
    |             |        |                                              |
    |             |        v                                              |
    |             |   +-----------------------------------------+         |
    |             +-->| IPC: git:state-changed (consolidated)   |<--------+
    |                 +-----------------------------------------+         |
    |                              |                                      |
    |  +---------------------------+---------------------------+          |
    |  |                                                       |          |
    |  |   GitPollingService (NEW)                            |          |
    |  |   - 5s default interval (configurable 3-10s)         |          |
    |  |   - Differential stat check (.git/index mtime+size)  |          |
    |  |   - Skips refresh if watcher triggered recently      |          |
    |  |   - Triggers git:state-changed on change detected    |          |
    |  +-------------------------------------------------------+          |
    |                                                                     |
    +--------------------------------------------------------------------+
                              |
                              v
                        RENDERER PROCESS
    +--------------------------------------------------------------------+
    |                                                                     |
    |  +--------------------------------+                                 |
    |  | useGitStatus Hook (OPTIMIZED)  |                                |
    |  |                                |                                 |
    |  | - Debounce: 250ms (was 500ms)  |                                |
    |  | - Cooldown: 500ms (was 1500ms) |                                |
    |  | - Subscribes to git:state-changed                               |
    |  | - Cooldown bypass for git events                                |
    |  +--------------------------------+                                 |
    |                   |                                                 |
    |                   v                                                 |
    |  +--------------------------------+                                 |
    |  | useGitStore (unchanged)        |                                 |
    |  +--------------------------------+                                 |
    |                   |                                                 |
    |                   v                                                 |
    |  +--------------------------------+                                 |
    |  | ProjectTree UI                 |                                 |
    |  | - Status icons (M, U, D, A, !) |                                |
    |  +--------------------------------+                                 |
    |                                                                     |
    +--------------------------------------------------------------------+
```

### 2.2 Sequence: Git Operation Detection (< 1s target)

```
T+0ms      git add executed, .git/index modified
T+50ms     GitWatcherService FSWatcher event
T+200ms    Coalescing window closes (150ms)
T+200ms    IPC: git:state-changed emitted
T+450ms    useGitStatus debounce completes (250ms)
T+450ms    IPC: git:getStatus called
T+500ms    GitStatusService response, UI update

Target: ~500ms end-to-end (worst case with cooldown: ~1000ms)
```

### 2.3 Sequence: Polling Fallback

```
T+0ms      Polling tick (every 5 seconds)
T+1ms      stat(.git/index) + stat(.git/HEAD)
T+2ms      Compare mtime/size with snapshot
           |
           +-- No change: Skip refresh, continue polling
           |
           +-- Change detected:
               T+2ms    Update snapshot
               T+3ms    Check if watcher triggered in last 2s
                        |
                        +-- Yes: Skip (watcher already handled it)
                        |
                        +-- No: Emit git:state-changed
```

---

## 3. Implementation Plan

### Step 1: Create GitWatcherService Foundation

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/main/services/GitWatcherService.ts`
- `/Users/marcinobel/Projects/erfana/src/main/services/watcher/GitEventCoalescer.ts`

**Rationale:** Centralizes all git-specific file watching with optimized coalescing.

**Dependencies:** None

### Step 2: Create Git Watcher IPC Schema

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/shared/ipc/git-watcher-schema.ts`

**Rationale:** Zod schemas for type-safe IPC communication.

**Dependencies:** Step 1

### Step 3: Create Git Watcher IPC Handlers

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/main/ipc/git-watcher-handlers.ts`

**Rationale:** IPC handlers for git watcher start/stop and event broadcasting.

**Dependencies:** Steps 1, 2

### Step 4: Create GitPollingService

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/main/services/GitPollingService.ts`

**Rationale:** Differential polling with hybrid mode (skips when watcher active).

**Dependencies:** Steps 1, 2

### Step 5: Extend Global Settings Schema

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/shared/ipc/global-settings-schema.ts`

**Changes:**
```typescript
// Add gitStatus settings section
export const GitStatusSettingsSchema = z.object({
  pollingEnabled: z.boolean().default(true),
  pollingInterval: z.number().min(3000).max(10000).default(5000)
})

// Extend GlobalSettingsSchema
export const GlobalSettingsSchema = z.object({
  // ... existing
  gitStatus: GitStatusSettingsSchema.default(() => ({
    pollingEnabled: true,
    pollingInterval: 5000
  }))
})
```

**Dependencies:** None (can be parallel with Steps 1-4)

### Step 6: Extend GlobalSettingsService

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/main/services/GlobalSettingsService.ts`

**Rationale:** No code changes needed - Zod schema handles defaults.

**Dependencies:** Step 5

### Step 7: Update useGlobalSettingsStore

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/stores/useGlobalSettingsStore.ts`

**Changes:** Add `updateGitStatusSettings` method following existing patterns.

**Dependencies:** Steps 5, 6

### Step 8: Update Settings Overlay UI

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/Settings/SettingsOverlay.tsx`
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/Settings/SettingsOverlay.css`

**Changes:**
- Add "Git status" section with:
  - Checkbox: "Enable background polling"
  - Dropdown: Polling interval (3s, 5s, 7s, 10s)

**Dependencies:** Step 7

### Step 9: Migrate from DirectoryWatcherService Git Index Watcher

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/main/services/DirectoryWatcherService.ts`

**Changes:**
- Remove `startGitIndexWatcher`, `stopGitIndexWatcher`, `gitIndexWatcher` field
- Remove `GIT_INDEX_DEBOUNCE_MS` constant
- Remove `gitIndexDebounceTimer` field
- These will be handled by GitWatcherService

**Dependencies:** Steps 1-4

### Step 10: Update Preload API

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/preload/index.ts`

**Changes:**
```typescript
// Replace gitIndexWatch with gitWatcher
gitWatcher: {
  start: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('git-watcher:start', projectPath),
  stop: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('git-watcher:stop'),
  onStateChanged: (callback: (data: GitStateChangeEvent) => void) => {
    const listener = (_event: unknown, data: GitStateChangeEvent) => callback(data)
    ipcRenderer.on('git:state-changed', listener)
    return () => ipcRenderer.removeListener('git:state-changed', listener)
  }
}
```

**Dependencies:** Steps 2, 3

### Step 11: Update Timing Constants

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/components/ProjectTree/constants.ts`

**Changes:**
```typescript
export const GIT_STATUS = {
  DEBOUNCE_DELAY: 250,    // Was 500
  COOLDOWN_DURATION: 500  // Was 1500
} as const
```

**Dependencies:** None

### Step 12: Optimize useGitStatus Hook

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/renderer/src/hooks/useGitStatus.ts`

**Changes:**
1. Subscribe to `git:state-changed` instead of `git:index-changed`
2. Add cooldown bypass for git state events
3. Remove subscription to directory-watch:changed for git status (now handled by GitWatcherService)
4. Track last refresh source for debugging

**Dependencies:** Steps 10, 11

### Step 13: Extend WatcherMetrics

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/main/services/watcher/WatcherMetrics.ts`

**Changes:**
```typescript
// Add to WatcherMetricsSnapshot
pollingRefreshCount: number  // Refreshes triggered by polling
pollingSkippedCount: number  // Polls skipped (watcher handled)
gitWatcherEvents: number     // Events from git watchers
lastPollingTime: number | null

// Add methods
recordPollingRefresh(): void
recordPollingSkipped(): void
recordGitWatcherEvent(): void
setLastPollingTime(time: number): void
```

**Dependencies:** None

### Step 14: Initialize Services in Main Process

**Files to modify:**
- `/Users/marcinobel/Projects/erfana/src/main/index.ts`

**Changes:**
```typescript
import { gitWatcherService } from './services/GitWatcherService'
import { gitPollingService } from './services/GitPollingService'
import { registerGitWatcherHandlers } from './ipc/git-watcher-handlers'

// In app.whenReady()
registerGitWatcherHandlers()
```

**Dependencies:** Steps 1-4

### Step 15: Create Unit Tests

**Files to create:**
- `/Users/marcinobel/Projects/erfana/src/main/services/GitWatcherService.test.ts`
- `/Users/marcinobel/Projects/erfana/src/main/services/GitPollingService.test.ts`
- `/Users/marcinobel/Projects/erfana/src/main/services/watcher/GitEventCoalescer.test.ts`

**Dependencies:** Steps 1-4

---

## 4. File Changes Summary

### New Files (8)

| Path | Action | Description |
|------|--------|-------------|
| `src/main/services/GitWatcherService.ts` | create | Centralized git state watching service |
| `src/main/services/GitPollingService.ts` | create | Differential polling fallback service |
| `src/main/services/watcher/GitEventCoalescer.ts` | create | 150ms event coalescing logic |
| `src/shared/ipc/git-watcher-schema.ts` | create | Zod schemas for git watcher IPC |
| `src/main/ipc/git-watcher-handlers.ts` | create | IPC handlers for git watcher |
| `src/main/services/GitWatcherService.test.ts` | create | Unit tests for GitWatcherService |
| `src/main/services/GitPollingService.test.ts` | create | Unit tests for GitPollingService |
| `src/main/services/watcher/GitEventCoalescer.test.ts` | create | Unit tests for GitEventCoalescer |

### Modified Files (10)

| Path | Action | Description |
|------|--------|-------------|
| `src/shared/ipc/global-settings-schema.ts` | modify | Add gitStatus settings section |
| `src/renderer/src/stores/useGlobalSettingsStore.ts` | modify | Add updateGitStatusSettings method |
| `src/renderer/src/components/Settings/SettingsOverlay.tsx` | modify | Add Git status settings section |
| `src/renderer/src/components/Settings/SettingsOverlay.css` | modify | Styles for interval dropdown |
| `src/main/services/DirectoryWatcherService.ts` | modify | Remove git index watcher (migrate to GitWatcherService) |
| `src/preload/index.ts` | modify | Replace gitIndexWatch with gitWatcher API |
| `src/renderer/src/components/ProjectTree/constants.ts` | modify | Reduce debounce/cooldown timings |
| `src/renderer/src/hooks/useGitStatus.ts` | modify | Subscribe to git:state-changed, cooldown bypass |
| `src/main/services/watcher/WatcherMetrics.ts` | modify | Add polling and git watcher metrics |
| `src/main/index.ts` | modify | Initialize GitWatcherService, GitPollingService |

---

## 5. Test Strategy

### 5.1 Coverage Target

**Target:** 80% coverage

### 5.2 Test Types

- **Unit tests** - GitWatcherService, GitPollingService, GitEventCoalescer
- **Integration tests** - IPC flow, watcher + polling coordination

### 5.3 Test Files

| File | Focus |
|------|-------|
| `GitWatcherService.test.ts` | Watcher initialization, event coalescing, error recovery |
| `GitPollingService.test.ts` | Differential polling, hybrid mode, interval adjustment |
| `GitEventCoalescer.test.ts` | Event deduplication, window timing |
| `useGitStatus.test.ts` (existing) | Add tests for new event subscription, cooldown bypass |

### 5.4 Key Scenarios (Mapping to Acceptance Criteria)

| Scenario | Test Case | FR/NFR |
|----------|-----------|--------|
| Git staging via `git add` | TC-001 | FR-001 |
| Git unstaging via `git reset` | TC-002 | FR-001 |
| Branch switch via `git checkout` | TC-003 | FR-002 |
| Branch creation detection | TC-004 | FR-003 |
| Fetch operation detection | TC-005 | FR-004 |
| Stash operation detection | TC-006 | FR-005 |
| Internal file edit detection | TC-007 | FR-006 |
| External file edit detection | TC-008 | FR-007 |
| Git commit detection | TC-009 | FR-008 |
| Git reset --hard detection | TC-010 | FR-008 |
| Polling fallback verification | TC-011 | FR-009 |
| Latency under 1 second | TC-012 | FR-010, NFR-001 |
| CPU usage < 1% | TC-013 | NFR-003 |
| Watcher auto-recovery | TC-014 | NFR-004 |
| Cloud folder compatibility | TC-015 | NFR-005 |

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| FS events missed on cloud drives | High | Medium | Polling fallback ensures eventual consistency |
| Reduced debounce causes excessive refreshes | Medium | Medium | Test with rapid file saves, adjust if needed |
| Breaking existing git:index-changed subscribers | Low | High | Keep old IPC event for one version with deprecation warning |
| GitWatcherService and DirectoryWatcherService interaction issues | Medium | Medium | Clear separation of concerns, session tokens |
| Polling adds CPU overhead | Low | Low | Differential polling minimizes stat calls |

---

## 7. Verification Criteria

**Phase 8 (Implementation Verification) Checklist:**

- [ ] GitWatcherService detects `.git/index`, HEAD, refs/heads, FETCH_HEAD, stash changes
- [ ] GitPollingService polls at configured interval (default 5s)
- [ ] Polling skips refresh when watcher triggered in last 2 seconds
- [ ] Settings UI shows polling toggle and interval dropdown
- [ ] Settings persist to `~/.erfana/settings.json`
- [ ] Debounce reduced to 250ms, cooldown to 500ms
- [ ] End-to-end latency < 1 second for git operations
- [ ] CPU usage < 1% during idle polling
- [ ] WatcherMetrics includes polling stats
- [ ] All 15 acceptance test cases pass
- [ ] Unit test coverage > 80%
- [ ] No regression in existing git status functionality

---

## 8. Estimates

| Metric | Value |
|--------|-------|
| Complexity | Medium |
| Files affected | 18 (8 new, 10 modified) |
| New files | 8 |
| Test files | 3 new + existing modifications |
| Estimated effort | 5-7 days |

---

## 9. Patterns to Follow

From codebase exploration:

1. **Singleton services** - Use `export const service = new Service()` pattern (see `globalSettingsService`)
2. **Zod schemas** - All IPC types defined in `src/shared/ipc/` with Zod validation
3. **IPC handlers** - Follow `registerXxxHandlers()` pattern from `global-settings-handlers.ts`
4. **Settings store** - Follow optimistic update pattern from `useGlobalSettingsStore.ts`
5. **Watcher patterns** - Follow session tokens, error classification from `DirectoryWatcherService.ts`
6. **CSS design tokens** - All UI uses `var(--color-*)`, `var(--space-*)` from design-tokens.css
7. **Logger usage** - Use `logger` from LoggingService in main process

## 10. Patterns to Avoid

1. **Class components** - Use functional React with hooks
2. **Hardcoded CSS values** - Use design tokens only
3. **Direct console.log** - Use logger facades
4. **Polling without differential check** - Always compare stats before refreshing
5. **Recursive `.git/` watching** - Watch specific files only, not objects/logs

---

*Design document created following BRS-003 architecture specification and established codebase patterns.*
