# BRS-010: Notes

## Constraints

### Technical constraints

| Constraint | Impact | Mitigation |
|------------|--------|------------|
| C1: Electron process isolation | Each instance is fully independent | File-based locking for coordination |
| C2: No shared memory | Cannot use mutex/semaphore | File-based signals with polling |
| C3: Cross-platform file locking | `flock()` not portable | Application-level lock files |
| C4: Process check limitations | `kill(pid, 0)` may fail across users | Combine with timeout fallback |
| C5: Network drive latency | File operations may be slow | Timeout + graceful degradation |
| C6: Clock skew | Timestamps may differ across machines | 60-minute buffer for staleness |

### Business constraints

| Constraint | Impact | Mitigation |
|------------|--------|------------|
| C7: Backward compatibility | Cannot break existing users | No settings migration required |
| C8: No external dependencies | Electron + Node.js only | Pure file-based solution |
| C9: Minimal UI interruption | VS Code-like seamless UX | No error dialogs for duplicates |

## Assumptions

### Environment assumptions

| ID | Assumption | Consequence if false |
|----|------------|---------------------|
| A1 | `~/.erfana/` directory writable | Lock mechanism fails gracefully |
| A2 | File system supports atomic rename | Partial lock files possible |
| A3 | `fs.realpath()` resolves symlinks | Symlink bypass possible |
| A4 | Process PIDs are unique per machine | False stale detection |
| A5 | Hostname is stable per machine | Network lock misidentification |

### User behavior assumptions

| ID | Assumption | Consequence if false |
|----|------------|---------------------|
| A6 | Users work on <50 projects concurrently | Lock directory could grow large |
| A7 | Projects have unique canonical paths | Hash collisions (extremely unlikely) |
| A8 | Users don't manually edit lock files | Corruption handled gracefully |

## Dependencies

### Internal dependencies

| Dependency | Version | Usage |
|------------|---------|-------|
| electron-store | ^8.x | Settings sharing (existing) |
| quit-handlers | - | Lock release on quit |
| FileService | - | Path resolution |
| SettingsService | - | Recent projects |

### External dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| Node.js `fs` | Built-in | File operations |
| Node.js `crypto` | Built-in | SHA-256 hashing |
| Node.js `os` | Built-in | Hostname |
| Electron `BrowserWindow` | Runtime | Window focusing |
| Electron `app` | Runtime | Lifecycle events |

### Platform dependencies

| Platform | API | Notes |
|----------|-----|-------|
| macOS | `app.dock.bounce()` | Attention for minimized windows |
| Windows | `BrowserWindow.focus()` | May need `setAlwaysOnTop` trick |
| Linux | `BrowserWindow.focus()` | X11/Wayland compatibility varies |

## Implementation notes

### Lock service design

```typescript
// src/main/services/ProjectLockService.ts
interface LockInfo {
  instanceId: string;
  pid: number;
  timestamp: string;
  hostname: string;
  path: string;
  focus_request?: boolean;
}

class ProjectLockService {
  private readonly locksDir: string;
  private currentLock: string | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;

  // Core operations
  async acquireLock(projectPath: string): Promise<LockResult>;
  async releaseLock(): Promise<void>;
  async checkLock(projectPath: string): Promise<LockStatus>;

  // Stale detection
  async cleanupStaleLocks(): Promise<CleanupResult>;
  private isLockStale(lock: LockInfo): Promise<boolean>;
  private isProcessAlive(pid: number): boolean;

  // Focus coordination
  startPolling(): void;
  stopPolling(): void;
  private handleFocusRequest(): void;
}
```

### Hash computation

```typescript
import { createHash } from 'crypto';
import { realpath } from 'fs/promises';

async function computeLockHash(projectPath: string): Promise<string> {
  const canonical = await realpath(projectPath);
  const normalized = canonical.toLowerCase(); // Case-insensitive on Windows
  return createHash('sha256')
    .update(normalized, 'utf8')
    .digest('hex')
    .substring(0, 32); // 32 hex chars = 128 bits, sufficient
}
```

### Process liveness check

```typescript
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check existence
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      return false; // No such process
    }
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      return true; // Process exists but no permission
    }
    return false; // Unknown error, assume dead
  }
}
```

### Window focusing (cross-platform)

```typescript
function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore();
  }

  if (process.platform === 'darwin') {
    app.dock.bounce('informational');
  }

  window.show();
  window.focus();

  // Windows workaround for focus stealing prevention
  if (process.platform === 'win32') {
    window.setAlwaysOnTop(true);
    window.setAlwaysOnTop(false);
  }
}
```

### Atomic file write

```typescript
import { writeFile, rename, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';

async function atomicWrite(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content, { mode: 0o600 });
    await rename(tempPath, path);
  } catch (err) {
    await unlink(tempPath).catch(() => {}); // Cleanup on failure
    throw err;
  }
}
```

## Architecture decisions

### Decision: File-based vs IPC-based coordination

**Chosen**: File-based locking with polling

**Rationale**:
- Works across independent Electron processes
- No external dependencies (named pipes, sockets)
- Cross-platform compatible
- Simple to implement and debug
- Graceful degradation on permission errors

**Alternatives considered**:
- Named pipes: Not portable to Windows
- Local socket: Complex lifecycle management
- Electron IPC: Only works within single process
- SQLite: Overkill for simple lock tracking

### Decision: Focus polling vs push notification

**Chosen**: Polling (500ms interval)

**Rationale**:
- Simple and reliable
- No additional infrastructure
- Low CPU overhead at 500ms
- Works across process boundaries

**Alternatives considered**:
- File system watchers: Too noisy for single file
- Named pipes: Platform-specific
- HTTP server: Heavyweight, port conflicts

### Decision: Stale detection strategy

**Chosen**: Hybrid (PID check + 60-minute timeout)

**Rationale**:
- PID check handles local crashes immediately
- Timeout handles network drives where PID meaningless
- 60 minutes balances false positives vs recovery time
- Hostname check prevents cross-machine confusion

## Risk analysis

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| R1: Lock race condition | Low | Medium | Atomic writes, acquire-before-render |
| R2: Stale lock blocks user | Low | High | 60-min timeout, manual override |
| R3: Focus fails silently | Medium | Low | Timeout with fallback notification |
| R4: Network drive slow | Medium | Low | Timeout, graceful degradation |
| R5: Permission errors | Low | Medium | Warning + allow open anyway |
| R6: Hash collision | Negligible | High | SHA-256 + 128 bits sufficient |

## Future considerations

### Potential enhancements (not in scope)

1. **Live settings sync**: Broadcast settings changes via file watcher
2. **CLI project opening**: `erfana /path` launches with specific project
3. **Duplicate-in-new-window**: Command to intentionally open same project
4. **Watcher coordination**: Deduplicate file watchers across instances
5. **Instance discovery**: List all running instances in menu

### Migration path

If future versions need lock file format changes:
1. Add `version` field to lock JSON
2. On read, check version and migrate if needed
3. Backward compatible: old format treated as v1

## Testing strategy

### Unit test focus areas

| Component | Key tests |
|-----------|-----------|
| `computeLockHash` | Symlink resolution, path normalization |
| `isProcessAlive` | Live process, dead process, no permission |
| `atomicWrite` | Success, crash-during-write, permission error |
| `isLockStale` | Same host live, same host dead, different host old, different host recent |

### Integration test scenarios

| Scenario | Setup | Assertion |
|----------|-------|-----------|
| Multi-instance | Launch 3 instances | All have different PIDs |
| Duplicate focus | Instance 1 open project, instance 2 open same | Instance 1 focused |
| Crash recovery | Kill -9 instance 1, launch instance 2 | Stale lock cleaned |
| Symlink | Instance 1 via link, instance 2 via real | Focus works |

### Manual test matrix

| Scenario | macOS | Windows | Linux |
|----------|-------|---------|-------|
| Launch multiple | - | - | - |
| Focus existing | - | - | - |
| Crash recovery | - | - | - |
| Network drive | - | - | - |
| Permission error | - | - | - |

## References

### Similar implementations

- **VS Code**: Uses `requestSingleInstanceLock()` + IPC for single-window, file locks for workspace
- **Atom**: Custom socket-based coordination
- **Sublime Text**: File-based project locking

### Electron documentation

- [app.requestSingleInstanceLock()](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelock) - Not used (allows multiple instances)
- [BrowserWindow.focus()](https://www.electronjs.org/docs/latest/api/browser-window#winfocus)
- [app.dock.bounce()](https://www.electronjs.org/docs/latest/api/app#appbounceonce-macos) - macOS only

### Node.js documentation

- [fs.realpath()](https://nodejs.org/api/fs.html#fsrealpathpath-options-callback) - Symlink resolution
- [process.kill()](https://nodejs.org/api/process.html#processkillpid-signal) - Process liveness check
- [crypto.createHash()](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options) - SHA-256 hashing
