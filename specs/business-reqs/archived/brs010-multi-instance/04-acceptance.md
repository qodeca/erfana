# BRS-010: Acceptance criteria

## Test categories

| Category | Count | Priority |
|----------|-------|----------|
| Multi-instance operation | 5 | P0 |
| Lock mechanism | 5 | P0 |
| Duplicate prevention | 4 | P0 |
| Stale lock detection | 4 | P0 |
| Cross-instance focus | 4 | P1 |
| Edge cases | 5 | P1 |
| Performance | 3 | P1 |
| Backward compatibility | 3 | P0 |
| **Total** | **33** | - |

## Multi-instance operation

### AC-001: Launch multiple independent instances

| Field | Value |
|-------|-------|
| ID | AC-001 |
| Requirement | FR-001, FR-002, FR-003 |
| Priority | P0 |

**Given**: Erfana is installed on the system
**When**: User launches Erfana 3 times from dock/start menu
**Then**:
- 3 separate Erfana processes are running
- 3 separate windows are visible
- Each window can open a different project
- Process IDs are all different

---

### AC-002: Settings shared across instances

| Field | Value |
|-------|-------|
| ID | AC-002 |
| Requirement | FR-004 |
| Priority | P1 |

**Given**: Two Erfana instances are running
**When**: User changes a setting in instance 1, then restarts instance 2
**Then**:
- Instance 2 shows the updated setting value
- No migration or sync required
- electron-store file contains latest value

---

### AC-003: Recent projects shared across instances

| Field | Value |
|-------|-------|
| ID | AC-003 |
| Requirement | FR-005 |
| Priority | P1 |

**Given**: Instance 1 opens project A
**When**: User relaunches instance 2
**Then**:
- Instance 2's Recent Projects shows project A
- Order reflects last-opened time
- No duplicate entries

---

### AC-004: Independent file watchers

| Field | Value |
|-------|-------|
| ID | AC-004 |
| Requirement | FR-006 |
| Priority | P0 |

**Given**: Instance 1 has project A, instance 2 has project B
**When**: File is created in project A
**Then**:
- Instance 1's project tree updates
- Instance 2's project tree is unchanged
- No cross-talk between instances

---

### AC-005: Independent terminal sessions

| Field | Value |
|-------|-------|
| ID | AC-005 |
| Requirement | FR-007 |
| Priority | P0 |

**Given**: Both instances have terminals open
**When**: Command run in instance 1's terminal
**Then**:
- Only instance 1's terminal shows output
- Instance 2's terminal is unaffected
- PTY processes are independent

## Lock mechanism

### AC-006: Lock created on project open

| Field | Value |
|-------|-------|
| ID | AC-006 |
| Requirement | FR-009, FR-010, FR-011 |
| Priority | P0 |

**Given**: User opens project at `/Users/dev/myproject`
**When**: Project tree is displayed
**Then**:
- Lock file exists at `~/.erfana/locks/{sha256-hash}.lock`
- Hash is SHA-256 of canonical path
- File has 0600 permissions

---

### AC-007: Lock content format

| Field | Value |
|-------|-------|
| ID | AC-007 |
| Requirement | FR-012 |
| Priority | P0 |

**Given**: Lock file created for project
**When**: Lock file content is read
**Then**: JSON contains:
```json
{
  "instanceId": "<uuid>",
  "pid": <number>,
  "timestamp": "<ISO8601>",
  "hostname": "<hostname>",
  "path": "<canonical-path>"
}
```

---

### AC-008: Symlink resolution

| Field | Value |
|-------|-------|
| ID | AC-008 |
| Requirement | FR-013 |
| Priority | P0 |

**Given**: `/Users/dev/link` is symlink to `/Users/dev/project`
**When**: Project opened via symlink path
**Then**:
- Lock hash uses canonical path `/Users/dev/project`
- Opening via real path detects same lock
- Opening via symlink in another instance focuses existing

---

### AC-009: Lock acquired before tree render

| Field | Value |
|-------|-------|
| ID | AC-009 |
| Requirement | FR-014 |
| Priority | P0 |

**Given**: User clicks to open project
**When**: Lock acquisition takes 40ms
**Then**:
- Project tree does not render until lock acquired
- No race condition with duplicate open attempt
- Lock exists before first file watcher event

---

### AC-010: Atomic lock file writes

| Field | Value |
|-------|-------|
| ID | AC-010 |
| Requirement | FR-046 |
| Priority | P1 |

**Given**: Lock is being written
**When**: Process crashes mid-write
**Then**:
- Either full lock or no lock exists (no partial)
- Implementation uses write-to-temp + rename

## Duplicate prevention

### AC-011: Duplicate project focuses existing window

| Field | Value |
|-------|-------|
| ID | AC-011 |
| Requirement | FR-016, FR-018 |
| Priority | P0 |

**Given**: Instance 1 has project A open
**When**: User opens project A from instance 2
**Then**:
- Instance 1's window comes to foreground
- Instance 2 exits silently
- No error dialog shown
- User sees their project in instance 1

---

### AC-012: No error dialog for duplicate

| Field | Value |
|-------|-------|
| ID | AC-012 |
| Requirement | FR-017 |
| Priority | P0 |

**Given**: Duplicate project attempt
**When**: Window focus succeeds
**Then**:
- No error dialog, warning dialog, or alert
- Transition is seamless
- Log entry created for debugging only

---

### AC-013: Silent exit after focus

| Field | Value |
|-------|-------|
| ID | AC-013 |
| Requirement | FR-019 |
| Priority | P1 |

**Given**: Instance 2 detected duplicate and focused instance 1
**When**: Focus confirmed successful
**Then**:
- Instance 2's process exits with code 0
- No orphan processes remain
- No window flicker in instance 2

---

### AC-014: Cross-platform focus behavior

| Field | Value |
|-------|-------|
| ID | AC-014 |
| Requirement | FR-020, FR-021 |
| Priority | P1 |

**Given**: Duplicate project attempt on each platform
**When**: Window focus is triggered
**Then**:
- macOS: Window focused, dock icon bounces if minimized
- Windows: Window restored from taskbar, brought to front
- Linux: Window focused (X11/Wayland compatible)

## Stale lock detection

### AC-015: Process liveness check

| Field | Value |
|-------|-------|
| ID | AC-015 |
| Requirement | FR-029, FR-030 |
| Priority | P0 |

**Given**: Lock file exists with PID 12345
**When**: System checks lock on same machine
**Then**:
- If PID 12345 running: Lock is valid
- If PID 12345 not running: Lock is stale, removed
- Check uses `process.kill(12345, 0)`

---

### AC-016: Stale lock cleanup at startup

| Field | Value |
|-------|-------|
| ID | AC-016 |
| Requirement | FR-034, FR-035 |
| Priority | P0 |

**Given**: Instance crashed, leaving lock behind
**When**: New instance starts
**Then**:
- Stale lock detected via process check
- Lock file removed before first project open
- Log entry: "Cleaned stale lock for /path/to/project"

---

### AC-017: 60-minute timeout for network locks

| Field | Value |
|-------|-------|
| ID | AC-017 |
| Requirement | FR-031, FR-032, FR-033 |
| Priority | P1 |

**Given**: Lock file with different hostname, timestamp 2 hours ago
**When**: System checks lock validity
**Then**:
- Lock considered stale (>60 min from different host)
- Lock removed, new lock acquired
- No process check (cross-machine PID meaningless)

---

### AC-018: Recent network lock preserved

| Field | Value |
|-------|-------|
| ID | AC-018 |
| Requirement | FR-031, FR-032 |
| Priority | P2 |

**Given**: Lock file with different hostname, timestamp 10 minutes ago
**When**: User attempts to open same project
**Then**:
- Warning shown: "Project may be open on {hostname}"
- User can override or cancel
- Override removes lock, opens project

## Cross-instance focus

### AC-019: Focus request mechanism

| Field | Value |
|-------|-------|
| ID | AC-019 |
| Requirement | FR-037, FR-039 |
| Priority | P1 |

**Given**: Lock owner is polling for focus requests
**When**: New instance writes `focus_request: true` to lock
**Then**:
- Lock owner detects within 500ms
- Lock owner calls `BrowserWindow.focus()`
- Focus request cleared after processing

---

### AC-020: Focus polling interval

| Field | Value |
|-------|-------|
| ID | AC-020 |
| Requirement | FR-040, NFR-005 |
| Priority | P2 |

**Given**: Instance has project open
**When**: Polling is active
**Then**:
- Lock file checked every 500ms (default)
- Interval configurable in settings
- Minimal CPU impact (<1% overhead)

---

### AC-021: Focus request timeout

| Field | Value |
|-------|-------|
| ID | AC-021 |
| Requirement | FR-037 |
| Priority | P2 |

**Given**: Focus request sent but not acknowledged
**When**: 5 seconds elapse
**Then**:
- Notification: "Could not focus existing window"
- User can choose to open anyway (override)
- Lock takeover with warning

---

### AC-022: Focus acknowledgment

| Field | Value |
|-------|-------|
| ID | AC-022 |
| Requirement | FR-041 |
| Priority | P2 |

**Given**: Focus request with requesting PID
**When**: Lock owner processes request
**Then**:
- Focus request cleared
- Acknowledgment written (optional: `focus_ack: true`)
- Requesting instance can exit cleanly

## Edge cases

### AC-023: Symlink duplicate detection

| Field | Value |
|-------|-------|
| ID | AC-023 |
| Requirement | FR-013 |
| Priority | P1 |

**Given**: Instance 1 opened `/Users/dev/project`
**When**: Instance 2 opens symlink `/Users/dev/link` pointing to same dir
**Then**:
- Canonical paths match
- Instance 1 focused
- No error, seamless transition

---

### AC-024: Project switch releases old lock

| Field | Value |
|-------|-------|
| ID | AC-024 |
| Requirement | FR-024 |
| Priority | P0 |

**Given**: Instance has project A open
**When**: User opens project B in same instance
**Then**:
- Project A lock released first
- Project B lock acquired
- Other instances can now open project A

---

### AC-025: Permission error handling

| Field | Value |
|-------|-------|
| ID | AC-025 |
| Requirement | FR-042, FR-043 |
| Priority | P1 |

**Given**: `~/.erfana/locks/` has no write permission
**When**: User opens project
**Then**:
- Warning logged: "Cannot create lock: EACCES"
- Unobtrusive notification to user
- Project opens anyway (degraded mode)
- No duplicate protection in this case

---

### AC-026: Corrupted lock file handling

| Field | Value |
|-------|-------|
| ID | AC-026 |
| Requirement | FR-045 |
| Priority | P1 |

**Given**: Lock file contains invalid JSON
**When**: System reads lock
**Then**:
- Lock treated as corrupted/stale
- Lock file removed
- New lock created
- Warning logged

---

### AC-027: Lock directory auto-creation

| Field | Value |
|-------|-------|
| ID | AC-027 |
| Requirement | FR-003 |
| Priority | P1 |

**Given**: `~/.erfana/locks/` doesn't exist
**When**: First project is opened
**Then**:
- Directory created with 0700 permissions
- Lock file created inside
- No error to user

## Performance

### AC-028: Lock acquisition speed

| Field | Value |
|-------|-------|
| ID | AC-028 |
| Requirement | NFR-001 |
| Priority | P0 |

**Given**: Normal filesystem conditions
**When**: Lock acquisition is timed
**Then**:
- Completes in <50ms (p95)
- No noticeable delay in UI
- Measured with `performance.now()`

---

### AC-029: Stale detection speed

| Field | Value |
|-------|-------|
| ID | AC-029 |
| Requirement | NFR-002 |
| Priority | P0 |

**Given**: 10 lock files in locks directory
**When**: Startup stale detection runs
**Then**:
- Completes in <100ms total
- Does not block app ready event
- Runs async after window shown

---

### AC-030: Window focus speed

| Field | Value |
|-------|-------|
| ID | AC-030 |
| Requirement | NFR-003 |
| Priority | P1 |

**Given**: Duplicate project detected
**When**: Window focus sequence runs
**Then**:
- Existing window visible within 100ms
- Smooth transition (no flicker)
- New instance exits within 200ms

## Backward compatibility

### AC-031: Single-instance workflow unchanged

| Field | Value |
|-------|-------|
| ID | AC-031 |
| Requirement | NFR-019 |
| Priority | P0 |

**Given**: User only uses single Erfana instance
**When**: Normal workflow executed
**Then**:
- No behavior change
- No new dialogs or prompts
- Lock operations are invisible

---

### AC-032: Settings file unchanged

| Field | Value |
|-------|-------|
| ID | AC-032 |
| Requirement | NFR-020 |
| Priority | P0 |

**Given**: Existing Erfana installation
**When**: Updated to multi-instance version
**Then**:
- Settings file format unchanged
- No migration dialog
- All settings preserved

---

### AC-033: First-time lock directory creation

| Field | Value |
|-------|-------|
| ID | AC-033 |
| Requirement | NFR-019 |
| Priority | P0 |

**Given**: Fresh install, no locks directory
**When**: First project opened
**Then**:
- Locks directory created silently
- No user interaction required
- Proper permissions set

## Definition of done

### Feature complete when:

- [ ] All P0 acceptance criteria pass
- [ ] All P1 acceptance criteria pass
- [ ] Unit tests for lock service (>90% coverage)
- [ ] Integration tests for cross-instance focus
- [ ] Manual testing on macOS, Windows, Linux
- [ ] Performance benchmarks meet requirements
- [ ] Documentation updated (CLAUDE.md, docs/)
- [ ] No regressions in existing tests

### Test automation

| Test type | Location | Coverage target |
|-----------|----------|-----------------|
| Unit tests | `src/main/services/ProjectLockService.test.ts` | 90% |
| Integration | `tests/e2e/multi-instance.test.ts` | Key scenarios |
| Manual | `docs/testing/multi-instance-scenarios.md` | Platform-specific |

### Regression checklist

- [ ] Single project workflow unchanged
- [ ] Settings persist correctly
- [ ] Recent projects work
- [ ] File watching works
- [ ] Terminal sessions work
- [ ] Quit confirmation works
- [ ] Unsaved changes prompt works
