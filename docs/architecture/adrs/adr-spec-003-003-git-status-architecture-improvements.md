---
spec_id: 3
document_type: technical_adr
sequence: 3
---

# ADR-Spec003-003: Git status architecture improvements

**Date:** 2025-12 | **Status:** Proposed

## Context

Following the Issue #74 implementation of real-time git status with polling fallback, a code review identified several architectural improvements to enhance maintainability, type safety, and observability.

The current implementation has:
- Magic numbers scattered across multiple files
- String literals for IPC channel names (prone to typos)
- Inconsistent IPC response structures
- No unified health monitoring endpoint
- Missing correlation IDs for end-to-end tracing

## Options

### Option A: Full refactoring (chosen, partially implemented)
Consolidate constants, add typed channels, unified result types, correlation IDs, and health endpoint.

| Pros | Cons |
|------|------|
| Single source of truth for timing | Requires updating all consumers |
| Type-safe channel names | May break existing tests |
| Consistent IPC responses | Medium implementation effort |
| Easier debugging with correlation IDs | |

### Option B: Documentation only
Document the magic numbers and patterns without code changes.

| Pros | Cons |
|------|------|
| No breaking changes | Technical debt remains |
| Immediate | Scattered constants |

### Option C: Incremental migration
Add new patterns alongside existing code, migrate gradually.

| Pros | Cons |
|------|------|
| Lower risk | Longer timeline |
| Easier testing | Dual code paths |

## Decision

Implement Option A with the following components:

### 1. Constants Consolidation

**File:** `src/shared/config/git-status-config.ts`

```typescript
// Coalescing
export const GIT_COALESCE_WINDOW_MS = 150
export const GIT_COALESCER_MAX_ERRORS = 5

// Watcher recovery
export const GIT_WATCHER_MAX_RESTART_ATTEMPTS = 3
export const GIT_WATCHER_RESTART_BASE_DELAY_MS = 800

// Polling
export const GIT_POLLING_DEFAULT_INTERVAL_MS = 5000
export const GIT_POLLING_MIN_INTERVAL_MS = 1000
export const GIT_POLLING_MAX_INTERVAL_MS = 60000
export const GIT_POLLING_WATCHER_ACTIVE_THRESHOLD_MS = 2000

// UI debouncing
export const GIT_STATUS_DEBOUNCE_DELAY_MS = 250
export const GIT_STATUS_COOLDOWN_DURATION_MS = 500

// Health monitoring
export const GIT_STATUS_HEALTH_LOG_INTERVAL_MS = 300000 // 5 minutes
export const GIT_STATUS_HIGH_POLLING_THRESHOLD = 80
```

### 2. Typed Channel Names

**File:** `src/shared/ipc/git-watcher-channels.ts`

```typescript
export const GitWatcherChannels = {
  START: 'git-watcher:start',
  STOP: 'git-watcher:stop',
  STATUS: 'git-watcher:status',
  HEALTH: 'git-status:health'
} as const

export const GitWatcherEvents = {
  STATE_CHANGED: 'git:state-changed',
  POLL_TRIGGERED: 'git:poll-triggered'
} as const

export const GitPollingChannels = {
  START: 'git-polling:start',
  STOP: 'git-polling:stop',
  SET_INTERVAL: 'git-polling:set-interval',
  SET_ENABLED: 'git-polling:set-enabled'
} as const
```

### 3. Unified Result Type

**Addition to:** `src/shared/ipc/git-watcher-schema.ts`

```typescript
export interface GitIpcResult<T = void> {
  success: boolean
  data?: T
  error?: string
  meta?: Record<string, unknown>
}
```

### 4. Correlation ID Propagation

Add `correlationId` field to `GitPollTriggeredEvent`:

```typescript
export const GitPollTriggeredEventSchema = z.object({
  projectPath: z.string(),
  timestamp: z.number(),
  reason: z.enum(['index_changed', 'no_watcher']),
  correlationId: z.string().optional()
})
```

Generate in `GitPollingService.poll()`:
```typescript
private generateCorrelationId(): string {
  return `poll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
```

Log consistently in `useGitStatus`:
```typescript
logger.debug('[useGitStatus] Git poll triggered', {
  timestamp: event.timestamp,
  reason: event.reason,
  correlationId: event.correlationId
})
```

### 5. Health Check Endpoint

**Handler:** `git-status:health`

```typescript
interface GitStatusHealthResponse {
  watcher: {
    active: boolean
    path: string | null
    lastEvent: number | null
  }
  polling: {
    active: boolean
    enabled: boolean
    interval: number
  }
  metrics: {
    watcherEvents: number
    pollingRefreshes: number
    pollingSkipped: number
    efficiency: number
  }
  errors: Record<string, number>
}
```

### 6. Metrics Separation Decision

After evaluation, the `WatcherMetrics` class should remain unified because:

1. **Single source of truth** - Both watcher and polling contribute to the same overall efficiency metrics
2. **Cross-component metrics** - Polling efficiency depends on comparing to watcher events
3. **Health logging** - The 5-minute health summary needs data from both components
4. **Simple access pattern** - The singleton pattern works well for shared state

However, adding clear section comments within `WatcherMetrics` improves readability:

```typescript
// === Directory Watcher Metrics ===
private eventsReceived = 0
private eventsEmitted = 0

// === Git Watcher Metrics ===
private gitWatcherEventCount = 0
private lastGitWatcherEvent: number | null = null

// === Git Polling Metrics ===
private pollingRefreshCount = 0
private pollingSkippedCount = 0
```

## Files to Modify

**New files:**
- `src/shared/config/git-status-config.ts`
- `src/shared/ipc/git-watcher-channels.ts`

**Modified files:**
- `src/shared/ipc/git-watcher-schema.ts` (GitIpcResult, correlationId, GitStatusHealthResponse)
- `src/main/services/GitWatcherService.ts` (import shared config, use GitWatcherEvents)
- `src/main/services/GitPollingService.ts` (import shared config, use GitWatcherEvents, add correlationId)
- `src/main/services/watcher/GitEventCoalescer.ts` (import shared config)
- `src/main/ipc/git-watcher-handlers.ts` (use typed channels, add health handler)
- `src/renderer/src/hooks/useGitStatus.ts` (log correlationId)
- `src/renderer/src/components/ProjectTree/constants.ts` (import from shared config)
- `src/preload/index.ts` (use typed channels, add health endpoint)

**Test updates required:**
- `src/main/services/GitWatcherService.test.ts` (import watcherMetrics, update constants)
- `src/main/services/GitPollingService.test.ts` (mock shared config if needed)
- `src/main/ipc/git-watcher-handlers.test.ts` (use typed channels, add WatcherMetrics mock)

## Consequences

### Positive
- Single source of truth for all git status timing constants
- Type-safe channel names prevent typos and enable IDE refactoring
- Consistent IPC response structure across all handlers
- Correlation IDs enable end-to-end request tracing
- Health endpoint provides unified monitoring for debugging

### Negative
- Breaking change for tests that use hardcoded channel strings
- Slightly more imports needed in each consuming file
- Need to update documentation to reference new locations

### Migration Path

1. Create new files with constants and types
2. Update imports in main process files
3. Update imports in renderer files
4. Update preload with typed channels
5. Update test files to use typed channels and mock shared config
6. Run full test suite to verify

## Implementation Notes

Initial implementation attempt revealed:

1. **Test compatibility** - Tests using `vi.mock()` with hardcoded channel strings need updates to use typed constants
2. **Mock isolation** - The `WatcherMetrics` mock needs to be added to handler tests
3. **Timer-based tests** - Tests using `vi.runAllTimersAsync()` may trigger infinite loops with polling; use `vi.advanceTimersByTimeAsync()` instead

## Enforcement

- TypeScript compilation will catch incorrect channel names
- ESLint rule can be added to prevent magic numbers in git-status related files
- Code review checklist item: "Uses constants from shared config"
