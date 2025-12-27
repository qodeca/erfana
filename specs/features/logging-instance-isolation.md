# Logging instance isolation

## Overview

Add instance identification to log entries so that logs from multiple concurrent Erfana instances can be distinguished and filtered.

### Purpose

When multiple Erfana instances run simultaneously (via "New Window" menu), all instances write to the same log files (`~/.erfana/logs/`). This makes it impossible to:
- Trace the complete history of a single instance
- Debug issues that occur in one instance but not another
- Correlate related log entries from the same session

### Scope

**In scope:**
- Generate unique instance ID at app startup
- Include instance ID in all log entries
- Short ID format for readability (8 characters)

**Out of scope:**
- Separate log files per instance
- Log aggregation or analysis tools
- Instance ID in renderer logs (uses same main process logger)

---

## Requirements

### Functional requirements

#### FR-001: Instance ID generation
LoggingService MUST generate a unique instance identifier at initialization:
- Use `randomUUID()` from `node:crypto` (same pattern as ProjectLockService)
- Generate once at service construction, not per log entry
- Store as private readonly field

#### FR-002: Short ID format
Instance ID MUST be truncated to 8 characters for readability:
- First 8 characters of UUID (e.g., `a1b2c3d4`)
- Sufficient uniqueness for typical concurrent usage (4.3 billion combinations)
- Compact enough to not dominate log line width

#### FR-003: Log format update
All log entries MUST include instance ID in the format string:
- Position: After timestamp, before level
- Format: `[{timestamp}] [{instanceId}] [{level}] {text}`
- Example: `[2025-12-26 18:44:29.123] [a1b2c3d4] [info] Logging service initialized`

#### FR-004: Startup log entry
LoggingService MUST log the full instance ID at startup:
- Message: "Instance started" with full UUID in context
- Allows correlation between short ID and full UUID if needed
- Example: `[info] Instance started {"instanceId": "a1b2c3d4-e5f6-..."}`

### Non-functional requirements

#### NFR-001: Zero performance overhead
Instance ID generation MUST NOT impact logging performance:
- UUID generated once at startup (not per log entry)
- No cryptographic operations during logging
- String concatenation is negligible overhead

#### NFR-002: Backwards compatibility
Log format change MUST NOT break existing log consumers:
- electron-log format string syntax unchanged
- Log level position shifts but remains parseable
- No changes to log file names or rotation

#### NFR-003: Test isolation
Tests MUST NOT depend on specific instance IDs:
- Mock or stub UUID generation in tests
- Verify format includes placeholder, not specific value

---

## Acceptance criteria

### AC-001: Instance ID in logs
- [ ] All log entries include 8-character instance ID
- [ ] ID appears between timestamp and level: `[timestamp] [id] [level]`
- [ ] Same ID used for entire application lifecycle

### AC-002: Multi-instance verification
- [ ] Launch two instances via "New Window"
- [ ] Verify different instance IDs in combined.log
- [ ] Can grep/filter logs by instance ID

### AC-003: Startup identification
- [ ] First log entry includes full UUID
- [ ] Short ID correlates to full UUID

### AC-004: Test coverage
- [ ] Unit tests for ID generation
- [ ] Format string tests verify ID position
- [ ] Existing tests still pass

---

## Implementation guidance

### Files to modify

| File | Changes |
|------|---------|
| `src/main/services/LoggingService.ts` | Add instanceId field, update format |
| `src/main/services/LoggingService.test.ts` | Add tests for instance ID |
| `docs/logging.md` | Document new log format |

### Code changes

**LoggingService.ts:**
```typescript
import { randomUUID } from 'node:crypto'

export class LoggingService {
  private currentLevel: LogLevel = 'info'
  private readonly instanceId: string = randomUUID().slice(0, 8)
  // ...

  private configureLogger(logger, filePath, enableConsole): void {
    // Update format to include instanceId
    logger.transports.file.format =
      `[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [${this.instanceId}] [{level}] {text}`
    // ...
  }

  async initialize(): Promise<void> {
    // ... existing init ...

    // Log full instance ID at startup
    this.info('Instance started', {
      instanceId: this.instanceId,
      fullId: randomUUID() // or store full UUID separately
    })
  }
}
```

### Log format comparison

**Before:**
```
[2025-12-26 18:44:29.123] [info] Logging service initialized
[2025-12-26 18:44:29.456] [info] Project opened {"path": "/foo"}
```

**After:**
```
[2025-12-26 18:44:29.123] [a1b2c3d4] [info] Instance started {"instanceId": "a1b2c3d4", "fullId": "a1b2c3d4-e5f6-..."}
[2025-12-26 18:44:29.456] [a1b2c3d4] [info] Logging service initialized
[2025-12-26 18:44:29.789] [a1b2c3d4] [info] Project opened {"path": "/foo"}
```

### Filtering logs by instance

```bash
# View all logs from instance a1b2c3d4
grep '\[a1b2c3d4\]' ~/.erfana/logs/combined.log

# Compare two instances
grep '\[a1b2c3d4\]' combined.log > instance1.log
grep '\[b5c6d7e8\]' combined.log > instance2.log
```

---

## Definition of done

1. LoggingService generates 8-character instance ID at startup
2. All log entries include instance ID in format
3. Full UUID logged at startup for correlation
4. Unit tests cover ID generation and format
5. docs/logging.md updated with new format
6. Manual verification with two concurrent instances
