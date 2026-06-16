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

**Main process** (`import { logger } from '../services/LoggingService'`):
```typescript
logger.info('Application started')
logger.error('Operation failed', error as Error, { context: 'startup' })
```

**Renderer process** (`import { logger, initializeLogger } from '../utils/logger'`):
```typescript
await initializeLogger()  // Call once on app startup
logger.info('Component mounted', { component: 'Editor' })
```

All loggers share the same API: `trace`, `debug`, `info`, `warn`, `error(msg, error?, ctx?)`, `fatal(msg, error?, ctx?)`.

## API reference

### Logger methods (same API for main and renderer)

| Method | Signature |
|--------|-----------|
| `trace/debug/info/warn` | `(message: string, context?: Record<string, unknown>): void` |
| `error/fatal` | `(message: string, error?: Error, context?: Record<string, unknown>): void` |

### LoggingService (advanced)

Singleton at `src/main/services/LoggingService.ts`:
- `getLogsDir()` – Resolved logs directory path (public since #137)
- `getLevel()` / `setLevel(level)` – get/set log level programmatically
- `getInstanceId()` – 8-char short ID for multi-instance filtering
- `getFullInstanceId()` – Full UUID for correlation
- `cleanupOldLogs()` – Manual trigger (runs automatically)
- `dispose()` – Unsubscribe from settings

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

Each instance generates a unique 8-char ID at startup. Filter logs by instance: `grep '\[a1b2c3d4\]' ~/.erfana/logs/combined.log`. Full UUID logged at startup for correlation.

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

- **Settings file**: Edit `~/.erfana/settings.json` → `{ "logging": { "level": "debug" } }`. Applied immediately (no restart).
- **Settings UI**: Gear icon → Logging section → dropdown. Applied immediately.
- **Programmatically**: `globalSettingsService.updateSetting('logging', { level: 'debug' })`

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

**Viewing logs**: `tail -f ~/.erfana/logs/combined.log` (or `main.log` / `renderer.log`). Filter: `| grep '\[error\]'`

**Logs not appearing**: Check log level (set to `debug`/`trace`), verify `~/.erfana/logs/` exists, check disk space.

**Symlink error**: Logging service refuses symlinked logs directory for security. Remove symlink: `rm ~/.erfana/logs && mkdir -p ~/.erfana/logs`

**Low disk space**: Log cleanup skipped below 100MB free. Free disk space to resume.

**IPC errors**: Check console for `Failed to send log to main process`. Verify preload script loads correctly.

**EPIPE errors**: Normal during shutdown. `safeConsole` wrapper suppresses these.

## Security

- **Symlink protection**: `~/.erfana/logs/` validated as real directory (not symlink) on initialize
- **Disk space checks**: Cleanup skipped below 100MB free
- **Input validation**: Renderer log entries validated via Zod schema (`LogEntrySchema` in `logging-schema.ts`). Invalid entries rejected.
- **Sensitive data**: Never log passwords, API keys, file contents, PII, or session tokens. Log paths and sizes instead.

## Implementation details

- **Library**: [electron-log](https://github.com/megahertz/electron-log) with custom logrotate-style archive function
- **Transports**: Separate logger instances for combined, main, renderer. Console disabled in production.
- **Level mapping**: `trace` → `verbose`, `fatal` → `error` (electron-log lacks these)
- **Global error handlers**: Renderer auto-captures `unhandledrejection` and `error` events
- **Safe console**: `safeConsole` utility (`src/main/utils/safeConsole.ts`) wraps console to suppress EPIPE errors during shutdown. Installed globally on app startup via `installSafeConsole()`. See [EPIPE error handling](./epipe-error-handling.md).

## Diagnostic logging (v0.9.0)

Performance instrumentation added for large-project debugging (#151):

- **Timing**: `GitStatus: completed` with `strategy`, `durationMs`, `fileCount`, `truncated` (info level)
- **File operations**: `FileService: readDirectory completed` with `durationMs`, `fileCount` (info level)
- **Project switch**: Per-stage logging with `durationMs` for failure identification
- **Watcher health**: `DirectoryWatcherService` logs health snapshot every 120s (debug level)
- **Buffer pressure**: `ThrottledWorker` logs at 80% and 50% buffer capacity (warn/info level)
- **Rate-limited errors**: `RateLimitedLogger` (`src/main/utils/RateLimitedLogger.ts`) prevents log spam during cascading EMFILE errors (10s default cooldown)

## Related documentation

- [IPC patterns](./ipc-patterns.md) – IPC communication patterns
- [Architecture](./architecture.md) – System design overview
- [EPIPE error handling](./epipe-error-handling.md) – EPIPE error details
