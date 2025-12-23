---
brs_id: 3
document_type: technical_adr
sequence: 2
---

# ADR-BRS003-002: Git status logging strategy

**Date:** 2025-12 | **Status:** Proposed

## Context

Issue #74 implemented a complex real-time git status system with multiple components:

1. **GitWatcherService** - Watches .git directory for state changes
2. **GitPollingService** - Hybrid polling fallback
3. **GitEventCoalescer** - Event coalescing with circuit breaker
4. **useGitStatus hook** - React hook with debounce/cooldown
5. **IPC handlers** - Bridge between main and renderer

Currently, the logging is inconsistent and insufficient for:
- **Debugging**: Cannot trace a single git refresh through the system
- **Performance monitoring**: No latency measurements or bottleneck identification
- **Error investigation**: Errors lack context for root cause analysis
- **Health monitoring**: No periodic summaries or degraded state detection

### Current logging state

| Component | Current Logging | Gap |
|-----------|-----------------|-----|
| GitWatcherService | info/debug for start/stop, error with stack | No event correlation, no file path logging |
| GitPollingService | info/debug for start/stop/refresh | No timing, no coordination logging |
| GitEventCoalescer | error on callback failure | No event flow, no coalescing stats |
| useGitStatus | info on state change, warn on failures | No timing, no stale response debugging |
| IPC handlers | debug on completion, error on failure | No path details, no timing |

## Decision drivers

1. **Actionable logs**: Every log should help diagnose a specific problem
2. **Performance-conscious**: Debug/trace logs must not impact info-level performance
3. **Correlation**: Ability to trace a single refresh through all components
4. **Consistency**: Follow existing LoggingService patterns
5. **Metrics integration**: Leverage existing WatcherMetrics for periodic summaries

## Decision

Implement a structured logging strategy with:
1. **Correlation IDs** for tracing refreshes across components
2. **Level-appropriate logging** taxonomy
3. **Periodic health summaries** at info level
4. **Performance timing** at debug/trace levels

## Logging taxonomy

### Level guidelines

| Level | Use Case | Performance Impact | Example |
|-------|----------|-------------------|---------|
| **trace** | Function entry/exit, detailed flow | High | `handleFileChange: index event queued` |
| **debug** | State transitions, timing, decisions | Medium | `Coalescer flushed 3 events in 150ms` |
| **info** | Lifecycle events, user-visible actions | Low | `GitWatcher started for /project` |
| **warn** | Degraded states, recoverable issues | Minimal | `Restart attempt 2/3` |
| **error** | Failures requiring investigation | Minimal | `Watcher crashed: EMFILE` |

### Component-specific taxonomy

#### GitWatcherService (main process)

| Event | Level | Message Template | Context |
|-------|-------|------------------|---------|
| Start watching | info | `GitWatcher: Started` | `{ projectPath, watchedPaths: number }` |
| Stop watching | info | `GitWatcher: Stopped` | `{ projectPath, sessionDuration }` |
| File change detected | trace | `GitWatcher: File change` | `{ path, eventType, gitEventType }` |
| Coalesced event emitted | debug | `GitWatcher: State changed` | `{ projectPath, eventTypes[], latencyMs }` |
| Stale event ignored | trace | `GitWatcher: Stale event` | `{ path, expectedVersion, actualVersion }` |
| Error - transient | warn | `GitWatcher: Transient error` | `{ errorType, projectPath }` |
| Error - fatal | error | `GitWatcher: Fatal error` | `{ error, projectPath, stack }` |
| Restart scheduled | info | `GitWatcher: Scheduling restart` | `{ attempt, maxAttempts, delayMs }` |
| Restart success | info | `GitWatcher: Restart succeeded` | `{ attempts }` |
| Restart exhausted | error | `GitWatcher: Restart exhausted` | `{ attempts, lastError }` |

#### GitPollingService (main process)

| Event | Level | Message Template | Context |
|-------|-------|------------------|---------|
| Start polling | info | `GitPolling: Started` | `{ projectPath, intervalMs, enabled }` |
| Stop polling | info | `GitPolling: Stopped` | `{ refreshCount, skippedCount }` |
| Poll triggered refresh | debug | `GitPolling: Refresh triggered` | `{ reason, latencyMs }` |
| Poll skipped - watcher active | trace | `GitPolling: Skipped (watcher active)` | `{ lastWatcherEventMs }` |
| Poll skipped - no change | trace | `GitPolling: Skipped (unchanged)` | `{ indexMtime, indexSize }` |
| Interval changed | debug | `GitPolling: Interval updated` | `{ oldMs, newMs }` |
| Enabled state changed | debug | `GitPolling: Enabled changed` | `{ enabled }` |
| Coordination configured | trace | `GitPolling: Watcher coordination set` | `{}` |

#### GitEventCoalescer (main process)

| Event | Level | Message Template | Context |
|-------|-------|------------------|---------|
| Event queued | trace | `GitCoalescer: Event queued` | `{ eventType, pendingCount }` |
| Window flushed | debug | `GitCoalescer: Flushed` | `{ eventTypes[], durationMs }` |
| Callback error | error | `GitCoalescer: Callback error` | `{ error, errorCount, eventTypes[] }` |
| Circuit breaker tripped | error | `GitCoalescer: Circuit breaker` | `{ errorCount }` |
| Disposed | trace | `GitCoalescer: Disposed` | `{ hadPending }` |

#### useGitStatus hook (renderer process)

| Event | Level | Message Template | Context |
|-------|-------|------------------|---------|
| Initial load | debug | `[useGitStatus] Initial load` | `{ projectPath }` |
| Watcher event received | trace | `[useGitStatus] Watcher event` | `{ eventTypes[] }` |
| Poll event received | trace | `[useGitStatus] Poll event` | `{ timestamp }` |
| Refresh started | trace | `[useGitStatus] Refresh start` | `{ projectPath, bypassCooldown }` |
| Refresh completed | debug | `[useGitStatus] Refresh done` | `{ isGitRepo, latencyMs, fileCount }` |
| Stale response ignored | info | `[useGitStatus] Stale response` | `{ staleProject, currentProject }` |
| Cooldown blocked | trace | `[useGitStatus] Cooldown active` | `{ remainingMs }` |
| Error | error | `[useGitStatus] Error` | `{ error, projectPath }` |
| Visibility changed | trace | `[useGitStatus] Visibility` | `{ visible }` |

#### IPC handlers (main process)

| Event | Level | Message Template | Context |
|-------|-------|------------------|---------|
| Handler invoked | trace | `git-watcher:start invoked` | `{ projectPath }` |
| Handler completed | debug | `git-watcher:start done` | `{ success, latencyMs }` |
| Path validation failed | warn | `git-watcher:start rejected` | `{ reason }` |
| Handler error | error | `git-watcher:start error` | `{ error }` |

## Correlation strategy

### Correlation ID generation

Generate a unique ID for each git refresh cycle that flows through the system:

```typescript
// In GitWatcherService - when coalesced event fires
const correlationId = `git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Include in IPC payload
const payload: GitStateChangeEvent = {
  projectPath,
  eventTypes,
  timestamp,
  correlationId  // NEW: Add to schema
}
```

### Correlation flow

```
[GitWatcher] trace: File change {path, eventType, correlationId: null}
     |
     v
[GitCoalescer] debug: Flushed {eventTypes, correlationId: git-1703270400000-abc123}
     |
     v
[IPC Broadcast] trace: git:state-changed {correlationId}
     |
     v
[useGitStatus] trace: Watcher event {correlationId}
     |
     v
[useGitStatus] debug: Refresh done {correlationId, latencyMs: 450}
```

### Log search pattern

```bash
# Find all logs for a specific refresh
grep 'git-1703270400000-abc123' ~/.erfana/logs/combined.log
```

## Metrics logging

### Periodic health summary

Log a summary at **info** level every 5 minutes when watcher is active:

```typescript
// In GitWatcherService
private startHealthLogger(): void {
  this.healthLogInterval = setInterval(() => {
    const metrics = watcherMetrics.getSnapshot()

    logger.info('GitWatcher: Health summary', {
      uptimeMinutes: Math.round(metrics.uptimeMs / 60000),
      gitWatcherEvents: metrics.gitWatcherEventCount,
      pollingRefreshes: metrics.pollingRefreshCount,
      pollingSkipped: metrics.pollingSkippedCount,
      pollingEfficiency: `${metrics.pollingEfficiency}%`,
      errors: Object.keys(metrics.errorCounts).length > 0
        ? metrics.errorCounts
        : 'none',
      restartAttempts: metrics.restartScheduled
    })
  }, 5 * 60 * 1000) // 5 minutes
}
```

### Degraded state warnings

Log warnings for concerning patterns:

| Condition | Level | Message |
|-----------|-------|---------|
| Polling efficiency > 80% (watcher missing events) | warn | `GitWatcher: High polling dependency` |
| > 3 restarts in 10 minutes | warn | `GitWatcher: Frequent restarts` |
| Error rate > 10% | warn | `GitWatcher: Elevated error rate` |
| No watcher events in 10 minutes (when polling active) | warn | `GitWatcher: Watcher may be stalled` |

## Implementation recommendations

### 1. Add timing measurements

```typescript
// GitWatcherService.handleCoalescedEvent
private handleCoalescedEvent(
  projectPath: string,
  eventVersion: number,
  eventTypes: GitEventType[],
  queuedAt: number  // NEW: Pass timestamp from queueEvent
): void {
  const latencyMs = Date.now() - queuedAt

  logger.debug('GitWatcher: State changed', {
    projectPath,
    eventTypes,
    count: eventTypes.length,
    latencyMs
  })
}
```

### 2. Add correlation ID to schema

```typescript
// git-watcher-schema.ts
export const GitStateChangeEventSchema = z.object({
  projectPath: z.string(),
  eventTypes: z.array(GitEventTypeSchema),
  timestamp: z.number(),
  correlationId: z.string().optional()  // NEW
})
```

### 3. Enhance GitEventCoalescer logging

```typescript
// GitEventCoalescer.queueEvent
queueEvent(eventType: GitEventType): void {
  if (this.isDisposed) return

  this.pendingEvents.add(eventType)

  logger.trace('GitCoalescer: Event queued', {
    eventType,
    pendingCount: this.pendingEvents.size
  })

  // ... rest of method
}
```

### 4. Add health logger to GitWatcherService

```typescript
// Add to GitWatcherService class
private healthLogInterval: NodeJS.Timeout | null = null

// In start() after watcher ready
this.startHealthLogger()

// In stop()
this.stopHealthLogger()

private startHealthLogger(): void {
  // Implementation from "Periodic health summary" section
}

private stopHealthLogger(): void {
  if (this.healthLogInterval) {
    clearInterval(this.healthLogInterval)
    this.healthLogInterval = null
  }
}
```

### 5. Enhance useGitStatus timing

```typescript
// In executeRefresh
const startTime = performance.now()
try {
  setRefreshing(true)
  const response = await window.api.git.getStatus(requestProjectPath)

  logger.debug('[useGitStatus] Refresh done', {
    isGitRepo: response.isGitRepo,
    latencyMs: Math.round(performance.now() - startTime),
    fileCount: response.files?.length ?? 0
  })
  // ...
}
```

## Context guidelines

### What to include

| Context Type | Include When | Example |
|--------------|--------------|---------|
| `projectPath` | Always for project-scoped operations | `{ projectPath: '/Users/dev/project' }` |
| `latencyMs` | Performance-sensitive operations | `{ latencyMs: 145 }` |
| `count` / `size` | Batch operations | `{ eventTypes: ['index', 'head'], count: 2 }` |
| `reason` | Decision points | `{ reason: 'watcher_active' }` |
| `attempt` / `max` | Retry scenarios | `{ attempt: 2, maxAttempts: 3 }` |
| `correlationId` | Cross-component tracing | `{ correlationId: 'git-xxx-yyy' }` |

### What NOT to include

- File contents (use size instead)
- Full paths to temporary files (security)
- User-identifiable information
- Error stacks in context (use Error object parameter)

## Consequences

### Positive

- **Debuggability**: Correlation IDs enable end-to-end tracing
- **Performance visibility**: Latency measurements identify bottlenecks
- **Proactive monitoring**: Health summaries and degraded state warnings
- **Consistency**: Follows established LoggingService patterns
- **Actionable**: Each log type maps to specific investigation steps

### Negative

- **Log volume**: trace level will generate significant output
- **Performance overhead**: Timing measurements add ~1ms per operation
- **Schema change**: Adding correlationId requires IPC schema update
- **Maintenance**: More logging code to maintain

### Mitigations

- Trace level disabled by default (info is default)
- Timing uses `performance.now()` for minimal overhead
- correlationId is optional (backward compatible)
- Logging code follows consistent patterns (copy-paste friendly)

## Enforcement

- **Code review**: Verify new logging follows taxonomy
- **Testing**: Unit tests for health logger and degraded state detection
- **Documentation**: Update `docs/logging.md` with git-specific section
- **Linting**: Consider ESLint rule for `logger.` calls requiring context objects

## Related

- [ADR-BRS003-001](/docs/architecture/adrs/adr-brs003-001-git-watcher-architecture.md) - Git watcher architecture
- [docs/logging.md](/docs/logging.md) - Logging layer documentation
- [WatcherMetrics.ts](/src/main/services/watcher/WatcherMetrics.ts) - Metrics implementation
