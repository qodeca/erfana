# Logging layer

Comprehensive logging system for Erfana with file-based persistence and configurable log levels.

## Overview

The logging layer provides centralized, structured logging across both Electron processes (main and renderer). All logs are persisted to files with automatic rotation and retention policies.

### Architecture

```
+------------------------+     +------------------------+
|    Renderer Process    |     |     Main Process       |
|                        |     |                        |
|  +------------------+  |     |  +------------------+  |
|  | RendererLogger   |  |     |  | LoggingService   |  |
|  | (logger.ts)      |  |     |  | (singleton)      |  |
|  +--------+---------+  |     |  +--------+---------+  |
|           |            |     |           |            |
|           | LogEntry   |     |           |            |
+-----------+------------+     +-----------+------------+
            |                              |
            |    IPC: logging:log          |
            +----------------------------->|
                                           |
                                           v
                              +------------------------+
                              |    electron-log        |
                              |    (file transport)    |
                              +------------------------+
                                           |
                                           v
                              +------------------------+
                              |  ~/.erfana/logs/       |
                              |  - combined.log        |
                              |  - main.log            |
                              |  - renderer.log        |
                              +------------------------+
```

**Key components:**

| Component | Location | Purpose |
|-----------|----------|---------|
| `LoggingService` | `src/main/services/LoggingService.ts` | Main process singleton, manages file transports |
| `RendererLogger` | `src/renderer/src/utils/logger.ts` | Renderer facade, sends logs via IPC |
| `logging-schema.ts` | `src/shared/ipc/logging-schema.ts` | Shared types and validation |
| `logging-handlers.ts` | `src/main/ipc/logging-handlers.ts` | IPC handlers |

## Quick start

### Main process

```typescript
import { logger } from '../services/LoggingService'

// Simple messages
logger.info('Application started')
logger.debug('Processing file', { path: '/path/to/file.md' })

// Errors with stack traces
try {
  await riskyOperation()
} catch (error) {
  logger.error('Operation failed', error as Error, { context: 'startup' })
}
```

### Renderer process

```typescript
import { logger, initializeLogger } from '../utils/logger'

// Initialize once on app startup
await initializeLogger()

// Same API as main process
logger.info('Component mounted', { component: 'Editor' })
logger.warn('Deprecated API used', { api: 'oldMethod' })
```

### Log level examples

```typescript
// Trace - very verbose, function entry/exit
logger.trace('Entering parseMarkdown', { fileSize: 1024 })

// Debug - development debugging
logger.debug('Cache miss', { key: 'user-settings' })

// Info - normal operations (default level)
logger.info('File saved', { path: '/docs/readme.md' })

// Warn - potential issues
logger.warn('Large file detected', { size: '50MB', threshold: '10MB' })

// Error - errors and exceptions
logger.error('Failed to read file', new Error('ENOENT'), { path: '/missing.md' })

// Fatal - unrecoverable errors
logger.fatal('Database corruption detected', new Error('Checksum mismatch'))
```

## API reference

### MainLogger (main process)

```typescript
import { logger } from '../services/LoggingService'

// Standard log methods
logger.trace(message: string, context?: Record<string, unknown>): void
logger.debug(message: string, context?: Record<string, unknown>): void
logger.info(message: string, context?: Record<string, unknown>): void
logger.warn(message: string, context?: Record<string, unknown>): void

// Error methods (with optional Error object)
logger.error(message: string, error?: Error, context?: Record<string, unknown>): void
logger.fatal(message: string, error?: Error, context?: Record<string, unknown>): void
```

### RendererLogger (renderer process)

```typescript
import { logger, initializeLogger } from '../utils/logger'

// Initialize (call once on app startup)
await initializeLogger()

// Same API as MainLogger
logger.trace(message: string, context?: Record<string, unknown>): void
logger.debug(message: string, context?: Record<string, unknown>): void
logger.info(message: string, context?: Record<string, unknown>): void
logger.warn(message: string, context?: Record<string, unknown>): void
logger.error(message: string, error?: Error, context?: Record<string, unknown>): void
logger.fatal(message: string, error?: Error, context?: Record<string, unknown>): void
```

### LoggingService (advanced)

Direct access to the singleton for advanced use cases:

```typescript
import { loggingService } from '../services/LoggingService'

// Initialize (called automatically on app ready)
await loggingService.initialize()

// Get/set log level programmatically
const level = loggingService.getLevel() // 'info'
loggingService.setLevel('debug')

// Get instance identifiers (for multi-instance debugging)
const shortId = loggingService.getInstanceId()     // 'a1b2c3d4' (8 chars)
const fullId = loggingService.getFullInstanceId()  // 'a1b2c3d4-e5f6-...' (full UUID)

// Cleanup old log files (runs automatically, but can be triggered manually)
await loggingService.cleanupOldLogs()

// Dispose (unsubscribe from settings)
loggingService.dispose()
```

## Log levels

| Level | Priority | Use case | Example |
|-------|----------|----------|---------|
| `trace` | 0 | Very verbose, function entry/exit | `Entering parseMarkdown()` |
| `debug` | 1 | Development debugging | `Cache hit for key: settings` |
| `info` | 2 | Normal operations **(default)** | `File saved: readme.md` |
| `warn` | 3 | Potential issues, recoverable | `Retrying connection (attempt 2/3)` |
| `error` | 4 | Errors and exceptions | `Failed to read file: ENOENT` |
| `fatal` | 5 | Unrecoverable errors, app may crash | `Database corruption detected` |

**Level filtering:**

Setting the log level filters out messages below that level:

| Current level | Logged | Filtered |
|---------------|--------|----------|
| `trace` | all | none |
| `debug` | debug, info, warn, error, fatal | trace |
| `info` | info, warn, error, fatal | trace, debug |
| `warn` | warn, error, fatal | trace, debug, info |
| `error` | error, fatal | trace, debug, info, warn |
| `fatal` | fatal | trace, debug, info, warn, error |

## Log files

### Location

All log files are stored in:

```
~/.erfana/logs/
├── combined.log      # All logs from both processes
├── main.log          # Main process logs only
├── renderer.log      # Renderer process logs only
├── combined.1.log    # Rotated (most recent)
├── combined.2.log    # Older
└── ...
```

### File types

| File | Content | Use case |
|------|---------|----------|
| `combined.log` | All logs from main + renderer | General debugging, full picture |
| `main.log` | Main process only | Backend issues (IPC, file system, terminal) |
| `renderer.log` | Renderer process only | UI issues (React, state, user actions) |

### Rotation

**Size-based rotation:**
- Maximum file size: **10MB**
- When exceeded, file is rotated using logrotate-style reverse numbering:
  - `main.log` -> `main.1.log` (most recent)
  - `main.1.log` -> `main.2.log`
  - ...
  - `main.100.log` is deleted (oldest)

**File limit:** 100 rotated files per type

**Retention:** Files older than **7 days** are automatically deleted

### Log format

```
[2025-12-21 14:32:15.123] [a1b2c3d4] [info] Instance started {"instanceId":"a1b2c3d4","fullInstanceId":"a1b2c3d4-..."}
[2025-12-21 14:32:15.456] [a1b2c3d4] [info] Application started {"version":"0.6.0"}
[2025-12-21 14:32:15.789] [a1b2c3d4] [debug] [RENDERER] Component mounted {"component":"Editor"}
[2025-12-21 14:32:16.012] [a1b2c3d4] [error] Failed to read file | Error: ENOENT | Stack: ... | {"path":"/missing.md"}
```

Format: `[timestamp] [instanceId] [level] message | Error: ... | Stack: ... | {context}`

- **Instance ID**: 8-character unique identifier for each Erfana instance
- Timestamp: ISO format with milliseconds
- Renderer logs prefixed with `[RENDERER]`
- Error messages include stack traces
- Context serialized as JSON

### Multi-instance support

When running multiple Erfana instances (via "New Window"), each instance generates a unique 8-character ID at startup. This allows filtering logs by instance:

```bash
# View logs from specific instance
grep '\[a1b2c3d4\]' ~/.erfana/logs/combined.log

# Compare two instances
grep '\[a1b2c3d4\]' ~/.erfana/logs/combined.log > instance1.log
grep '\[b5c6d7e8\]' ~/.erfana/logs/combined.log > instance2.log

# Find which instances have logged
grep 'Instance started' ~/.erfana/logs/combined.log
```

The full UUID is logged at startup for correlation:
```
[2025-12-21 14:32:15.123] [a1b2c3d4] [info] Instance started {"instanceId":"a1b2c3d4","fullInstanceId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890",...}
```

## Configuration

### Settings location

Global settings are stored in:

```
~/.erfana/settings.json
```

### Settings schema

```json
{
  "logging": {
    "level": "info"
  }
}
```

### Changing log level

**Via settings file:**

Edit `~/.erfana/settings.json`:

```json
{
  "logging": {
    "level": "debug"
  }
}
```

Changes are applied immediately (no restart required).

**Via settings UI:**

1. Click the gear icon in the bottom of the activity bar
2. In the Settings overlay, find the "Logging" section
3. Select the desired log level from the dropdown

Changes are applied immediately.

**Programmatically:**

```typescript
// Main process
import { globalSettingsService } from '../services/GlobalSettingsService'

await globalSettingsService.updateSetting('logging', { level: 'debug' })
```

### Default level

The default log level is `info`. This captures normal operations, warnings, and errors while filtering out verbose trace and debug messages.

**Recommendations:**

| Environment | Recommended level |
|-------------|-------------------|
| Production | `info` (default) |
| Development | `debug` |
| Debugging specific issue | `trace` |
| Quiet mode (errors only) | `error` |

## Troubleshooting

### Viewing logs in real-time

```bash
# All logs
tail -f ~/.erfana/logs/combined.log

# Main process only
tail -f ~/.erfana/logs/main.log

# Renderer process only
tail -f ~/.erfana/logs/renderer.log

# Filter by level
tail -f ~/.erfana/logs/combined.log | grep '\[error\]'

# Search for specific text
grep 'FileService' ~/.erfana/logs/main.log
```

### Common issues

**Logs not appearing:**

1. Check log level - set to `debug` or `trace` for verbose output
2. Verify log directory exists: `ls -la ~/.erfana/logs/`
3. Check disk space: `df -h ~`

**Logs directory is a symlink (security error):**

The logging service refuses to write to a symlinked logs directory for security reasons. Remove the symlink and create a real directory:

```bash
rm ~/.erfana/logs
mkdir -p ~/.erfana/logs
```

**Low disk space warning:**

Log cleanup is skipped when disk space is below 100MB. Free up disk space to resume automatic cleanup.

**IPC logging errors:**

If renderer logs fail to reach main process:
- Check console for `Failed to send log to main process` errors
- Verify preload script is loaded correctly
- Ensure `window.api.logging` is available

**EPIPE errors:**

The logging system includes `safeConsole` wrapper that suppresses EPIPE errors during app shutdown. These are normal and not a cause for concern.

### Debug logging

To diagnose logging issues, enable trace level temporarily:

1. Edit `~/.erfana/settings.json`:
   ```json
   { "logging": { "level": "trace" } }
   ```

2. Check initialization logs:
   ```bash
   grep 'Instance started' ~/.erfana/logs/main.log
   ```

3. Look for level change logs:
   ```bash
   grep 'Log level changed' ~/.erfana/logs/main.log
   ```

## Security

### Symlink protection

The logging service validates that `~/.erfana/logs/` is not a symbolic link before writing. This prevents symlink attacks where an attacker could redirect logs to arbitrary locations (e.g., overwriting system files).

```typescript
// Validation runs on initialize()
private validateLogsDir(logsDir: string): void {
  const stats = lstatSync(logsDir)
  if (stats.isSymbolicLink()) {
    throw new Error('Logs directory is a symlink (security risk)')
  }
}
```

### Disk space checks

Before cleanup operations, available disk space is checked. Operations are skipped if free space is below 100MB to prevent issues during low-disk scenarios.

### Input validation

All log entries from renderer are validated using Zod schema before processing:

```typescript
const LogEntrySchema = z.object({
  level: LogLevelSchema,
  message: z.string(),
  timestamp: z.string(),
  source: z.enum(['main', 'renderer']),
  context: z.record(z.string(), z.unknown()).optional(),
  error: z.object({
    name: z.string(),
    message: z.string(),
    stack: z.string().optional()
  }).optional()
})
```

Invalid entries are rejected and logged to console.

### Sensitive data

**Never log:**
- Passwords or API keys
- Full file contents (use paths instead)
- Personal identifiable information (PII)
- Session tokens or authentication data

**Safe patterns:**

```typescript
// Good - log path, not content
logger.info('File saved', { path: filePath, size: content.length })

// Bad - logs sensitive content
logger.info('File saved', { content: fileContent })

// Good - redact sensitive fields
logger.debug('API response', { status: response.status, body: '[redacted]' })
```

## Implementation details

### Electron-log integration

The logging service uses [electron-log](https://github.com/megahertz/electron-log) with custom configuration:

- Custom archive function for logrotate-style rotation
- Separate logger instances for combined, main, and renderer logs
- Console transport disabled in production (only file transport)

### Log level mapping

Electron-log doesn't have `trace` or `fatal` levels, so they are mapped:

| Our level | Electron-log level |
|-----------|-------------------|
| `trace` | `verbose` |
| `debug` | `debug` |
| `info` | `info` |
| `warn` | `warn` |
| `error` | `error` |
| `fatal` | `error` |

### Global error handlers

The renderer logger automatically captures unhandled errors:

```typescript
// Unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  logger.error('Unhandled promise rejection', event.reason)
})

// Uncaught errors
window.addEventListener('error', (event) => {
  logger.error('Uncaught error', event.error, {
    filename: event.filename,
    lineno: event.lineno
  })
})
```

### Safe console wrapper

The `safeConsole` utility prevents EPIPE errors during app shutdown:

```typescript
import { safeConsole, installSafeConsole } from '../utils/safeConsole'

// Install globally (called on app startup)
installSafeConsole()

// Or use directly
safeConsole.log('Safe message')
safeConsole.error('Safe error')
```

## Related documentation

- [Global settings service](../CLAUDE.md#global-settings-service-dec-21-2025) - Settings persistence
- [IPC patterns](./ipc-patterns.md) - IPC communication patterns
- [Architecture](./architecture.md) - System design overview
