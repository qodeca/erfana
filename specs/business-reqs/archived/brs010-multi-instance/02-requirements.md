# BRS-010: Requirements

## Functional requirements

### Multi-instance operation

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-001 | System SHALL allow launching multiple independent Erfana instances simultaneously | P0 | Core feature - each instance is a separate Electron process |
| FR-002 | Each instance SHALL be capable of opening and working on a different project | P0 | Core feature - parallel project work |
| FR-003 | Launching Erfana SHALL always create a new window (never focus existing unless duplicate project) | P0 | Matches VS Code behavior - predictable launch |
| FR-004 | Settings SHALL be shared across instances via electron-store | P1 | Already implemented - last-write-wins semantics |
| FR-005 | Recent projects list SHALL be shared across instances | P1 | Already implemented - updated on relaunch |
| FR-006 | Each instance SHALL have independent file watchers | P0 | Each watches its own project - no interference |
| FR-007 | Each instance SHALL have independent terminal sessions | P0 | Terminals are per-webContentsId |
| FR-008 | Each instance SHALL maintain independent editor state | P0 | Editor state is per-file |

### Project lock mechanism

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-009 | System SHALL create a lock file when opening a project | P0 | Prevents duplicate opening |
| FR-010 | Lock file SHALL be stored in `~/.erfana/locks/` directory | P0 | User data directory - consistent location |
| FR-011 | Lock filename SHALL be SHA-256 hash of canonical project path | P0 | Handles symlinks, avoids path escaping issues |
| FR-012 | Lock file SHALL contain JSON with instanceId, PID, timestamp, hostname | P0 | Enables stale detection and debugging |
| FR-013 | System SHALL use `fs.realpath()` to resolve symlinks before hashing | P0 | Prevents symlink bypass of locks |
| FR-014 | Lock SHALL be acquired before project tree is rendered | P0 | Prevents race conditions |
| FR-015 | Lock acquisition failure SHALL trigger window focus flow | P0 | Core duplicate prevention UX |

### Duplicate project handling

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-016 | Opening a project already open in another instance SHALL focus that instance's window | P0 | Core UX - matches VS Code |
| FR-017 | System SHALL NOT show error dialog for duplicate project attempts | P0 | Seamless UX - window focusing instead |
| FR-018 | Existing window SHALL be brought to foreground automatically | P0 | User sees their project immediately |
| FR-019 | New instance SHALL exit silently after focusing existing window | P1 | Clean exit - no orphan processes |
| FR-020 | Focus behavior SHALL work across all three platforms (macOS, Windows, Linux) | P1 | Cross-platform consistency |
| FR-021 | On macOS, focus SHALL use `app.dock.bounce()` if window minimized | P2 | Platform-native attention |
| FR-022 | Focus SHALL bring all windows of target instance to front (if multiple exist) | P2 | Complete focus transfer |

### Lock lifecycle management

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-023 | Lock SHALL be released when project is closed (File > Close Project) | P0 | Normal close path |
| FR-024 | Lock SHALL be released when switching to a different project | P0 | Project switch path |
| FR-025 | Lock SHALL be released on graceful app quit (Cmd+Q, window close) | P0 | Normal quit path |
| FR-026 | System SHALL release lock during `before-quit` event | P0 | Catch all quit paths |
| FR-027 | Lock release SHALL be synchronous to prevent race conditions | P1 | Reliable release |
| FR-028 | System SHALL handle lock release failure gracefully (log warning, continue) | P1 | Don't block quit on error |

### Stale lock detection and recovery

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-029 | System SHALL detect stale locks using process liveness check | P0 | Handles local crashes |
| FR-030 | Process liveness check SHALL use `process.kill(pid, 0)` signal test | P0 | Cross-platform process check |
| FR-031 | System SHALL implement 60-minute timeout for stale locks | P1 | Fallback for network drives where process check may fail |
| FR-032 | Stale lock detection SHALL verify hostname matches current machine | P1 | Network drive scenario |
| FR-033 | Lock from different hostname older than 60 minutes SHALL be considered stale | P1 | Network drive cleanup |
| FR-034 | System SHALL clean up stale locks on app startup | P0 | Recover from crashes |
| FR-035 | Stale lock cleanup SHALL run before first project open attempt | P0 | Clean state guarantee |
| FR-036 | System SHALL log stale lock cleanup for debugging | P2 | Observability |

### Cross-instance communication

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-037 | System SHALL provide mechanism for instance-to-instance signaling | P0 | Required for window focusing |
| FR-038 | Signaling SHALL use file-based approach (lock file polling or named pipe) | P1 | Cross-platform, no dependencies |
| FR-039 | When duplicate detected, new instance SHALL write focus request to lock file | P1 | Signal existing instance |
| FR-040 | Existing instance SHALL poll for focus requests periodically (500ms) | P1 | Respond to focus requests |
| FR-041 | Focus request SHALL include requesting instance's PID for acknowledgment | P2 | Reliable handshake |

### Error handling

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-042 | Lock directory creation failure SHALL show user warning and continue | P1 | Don't block on permission errors |
| FR-043 | Lock acquisition permission error SHALL allow opening with warning | P1 | Graceful degradation |
| FR-044 | System SHALL log all lock-related errors at warning level | P1 | Debuggability |
| FR-045 | Invalid lock file content SHALL be treated as stale | P1 | Handle corruption |
| FR-046 | Lock operations SHALL use atomic file writes (write to temp, rename) | P1 | Prevent partial writes |

## Non-functional requirements

### Performance

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| NFR-001 | Lock acquisition SHALL complete in under 50ms | P0 | No noticeable delay on project open |
| NFR-002 | Stale lock detection SHALL complete in under 100ms | P0 | Fast startup |
| NFR-003 | Window focusing SHALL complete in under 100ms | P1 | Responsive UX |
| NFR-004 | Lock file size SHALL not exceed 1KB | P2 | Minimal disk usage |
| NFR-005 | Focus polling interval SHALL be configurable (default 500ms) | P2 | Balance responsiveness vs CPU |
| NFR-006 | Lock cleanup at startup SHALL not block app ready | P1 | Fast cold start |

### Reliability

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| NFR-007 | Lock mechanism SHALL survive app crashes without permanent lock | P0 | Crash resilience |
| NFR-008 | Lock mechanism SHALL work across power loss/system crash | P1 | System resilience |
| NFR-009 | Lock mechanism SHALL work correctly on network drives (NFS, SMB) | P1 | Enterprise scenarios |
| NFR-010 | Lock mechanism SHALL handle clock skew up to 5 minutes | P2 | Network time variance |

### Security

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| NFR-011 | Lock files SHALL have user-only permissions (0600) | P1 | Prevent tampering |
| NFR-012 | Lock directory SHALL have user-only permissions (0700) | P1 | Prevent listing by others |
| NFR-013 | Lock file path SHALL be sanitized to prevent directory traversal | P0 | Security hardening |
| NFR-014 | SHA-256 hash SHALL use stable encoding to prevent collisions | P0 | Reliable path hashing |

### Compatibility

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| NFR-015 | Feature SHALL work on macOS 12+ | P0 | Minimum supported OS |
| NFR-016 | Feature SHALL work on Windows 10+ | P0 | Minimum supported OS |
| NFR-017 | Feature SHALL work on Ubuntu 20.04+ | P1 | Linux support |
| NFR-018 | Feature SHALL not require additional dependencies | P1 | No external tools |
| NFR-019 | Existing single-instance workflow SHALL remain unchanged | P0 | Backward compatibility |
| NFR-020 | Settings file format SHALL not change | P0 | No migration needed |

### Usability

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| NFR-021 | Users SHALL NOT see error dialogs for duplicate project attempts | P0 | Seamless UX |
| NFR-022 | Window focus transition SHALL be smooth (no flicker) | P1 | Polished UX |
| NFR-023 | Lock-related errors SHALL be actionable (clear message, recovery path) | P1 | User can self-help |
| NFR-024 | System SHALL provide debug logging for lock operations | P2 | Support troubleshooting |

### Maintainability

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| NFR-025 | Lock service SHALL be implemented as isolated service (SOLID) | P1 | Testable, maintainable |
| NFR-026 | Lock operations SHALL have comprehensive unit tests | P0 | Quality assurance |
| NFR-027 | Cross-instance communication SHALL have integration tests | P1 | End-to-end validation |
| NFR-028 | Lock file schema SHALL be versioned for future changes | P2 | Forward compatibility |

## Requirements traceability

| Requirement | Source | Test case |
|-------------|--------|-----------|
| FR-001 | Issue #27 - Multi-instance operation | AC-001 |
| FR-009 | Issue #27 - Lock mechanism | AC-006 |
| FR-016 | Issue #27 - Duplicate prevention | AC-009 |
| FR-029 | Issue #27 - Crash recovery | AC-014 |
| NFR-001 | Issue #27 - Performance | AC-019 |
