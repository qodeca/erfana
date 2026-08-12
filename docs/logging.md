# Logging layer

Comprehensive logging system for Erfana with file-based persistence and configurable log levels.

## Overview

The logging layer provides centralized, structured logging across both Electron processes (main and renderer). All logs are persisted to files with automatic rotation and retention policies.

### Architecture

```
+---------------------------+   +---------------------------+
|  Editor window (renderer) |   | Overlay window (renderer) |
|                           |   | (screenshot area-select)  |
|  +---------------------+  |   |  +---------------------+  |
|  | RendererLogger      |  |   |  | RendererLogger      |  |
|  | (logger.ts)         |  |   |  | (logger.ts)         |  |
|  +----------+----------+  |   |  +----------+----------+  |
|             | LogEntry    |   |             | LogEntry    |
|  window.api.logging.log   |   |   window.overlayApi.log   |
+-------------+-------------+   +-------------+-------------+
              |                               |
              |       IPC: logging:log        |
              +---------------+---------------+
                              |
                              v
                 +--------------------------+
                 |      Main process        |
                 |  logging-handlers.ts     |
                 |  LogEntrySchema (zod)    |
                 +------------+-------------+
                              |
                              v
                 +--------------------------+
                 |     LoggingService       |
                 |     (singleton)          |
                 +------------+-------------+
                              |
                              v
                 +--------------------------+
                 |      electron-log        |
                 |      (file transport)    |
                 +------------+-------------+
                              |
                              v
                 +--------------------------+
                 |  ~/.erfana/logs/         |
                 |  - combined.log          |
                 |  - main.log              |
                 |  - renderer.log          |
                 +--------------------------+
```

**Two renderer senders, one channel.** The editor window reaches main through `window.api.logging.log` (`src/preload/index.ts`); the screenshot-overlay window has no `window.api` at all, so its dedicated preload exposes a one-way `window.overlayApi.log` over the **same** `logging:log` channel (#60). `resolveLogSink()` in `src/renderer/src/utils/logger.ts` picks the transport in that order — `api` → `overlayApi` → `console.error` — **per call, never cached**: a record can be emitted before the bridge is attached, and a cached miss would silence that window for the rest of its life. Main validates both senders identically (`LogEntrySchema`).

**Key components:**

| Component | Location | Purpose |
|-----------|----------|---------|
| `LoggingService` | `src/main/services/LoggingService.ts` | Main process singleton, manages file transports |
| `RendererLogger` | `src/renderer/src/utils/logger.ts` | Renderer facade, resolves a sink and sends logs via IPC |
| `screenshotOverlay.ts` | `src/preload/screenshotOverlay.ts` | Overlay-window preload; exposes `overlayApi.log`, the overlay's only evidence trail (#60) |
| `logging-schema.ts` | `src/shared/ipc/logging-schema.ts` | Shared types and validation |
| `logging-handlers.ts` | `src/main/ipc/logging-handlers.ts` | IPC handlers |
| `rendererCrashHandlers.ts` | `src/main/utils/rendererCrashHandlers.ts` | Main-side crash / hang trail for renderer + child processes (#60) |
| `installGlobalErrorTrail.ts` | `src/renderer/src/utils/installGlobalErrorTrail.ts` | Renderer-side trail for uncaught errors and unhandled rejections (#60) |

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

The `~/.erfana/logs` literal above is correct, but the single source of truth is `LOGS_DIR_RELATIVE` (`.erfana/logs`) in `src/shared/constants.ts` — `LoggingService.getLogsDir()` joins it with `homedir()`, and the crash screen's degraded mode renders the same constant as prose when the logging bridge is unreachable. **Move the logs by editing that constant, not `LoggingService`.**

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

### Crash and hang tags (#60)

Support asks users for log excerpts, so the crash and hang records carry stable, greppable message tags. Grep `combined.log` for `[crash]`, `[hang]` or `[GlobalErrorTrail]` to find every record of this class.

| Tag | Level | Written by | Meaning |
|-----|-------|------------|---------|
| `[crash] render-process-gone` | error | main, app-scope | A renderer process died. Context: `reason`, `exitCode` |
| `[crash] child-process-gone` | error | main, app-scope | A child process died (GPU, utility, the DOCX `utilityProcess`, the PDF/DOCX render window). Context: `type`, `reason`, `exitCode`, plus `serviceName` / `name` when Electron supplies them |
| `[crash] renderer-console-error` | error | main, per window | A renderer `console.error`. Context: `windowId`, `message`, `line`, `sourceId` — the renderer-supplied fields are bounded, see [Diagnostic logging](#diagnostic-logging-v090) |
| `[crash] renderer-console-error suppressed` | error | main, per window | Console-error records dropped by the rate cap in the window that just closed. Context: `windowId`, `suppressed`, `windowMs` |
| `[crash] preload-error` | error | main, per window | A preload script threw. Context: `windowId`, `preloadPath`, `error` |
| `[hang] window-unresponsive` | warn | main, per window | The renderer event loop is blocked (beachball / "not responding"). Context: `windowId` |
| `[hang] window-responsive` | info | main, per window | The same window recovered. Context: `windowId` |
| `[GlobalErrorTrail] uncaught error` | fatal | renderer | An uncaught error reached `window`. Context: `filename`, `lineno`, `colno`, plus `componentStack`, `appVersion`, `errorName`, `stackTruncated` |
| `[GlobalErrorTrail] unhandled rejection` | fatal | renderer | An unhandled promise rejection. Same context shape, minus the source coordinates |

Reading notes:

- A `[hang] window-unresponsive` **followed by** `[hang] window-responsive` is a recoverable freeze, not a death. `render-process-gone` with no `responsive` line after it is the renderer actually going away.
- The main-process records land in `main.log` (and `combined.log`) even though they describe renderer failures — they are written by main. The `[GlobalErrorTrail]` records come from the renderer and are prefixed `[RENDERER]`.
- The handlers are deliberately **log-only**: no auto-reload, no dialog, no relaunch. A crash caused by restored state would re-crash on reload, so automated recovery would be a boot loop.
- `[crash] app crash logging already registered` (debug) means a duplicated bootstrap tried to register the app-scope listeners twice; registration is idempotent, so crash records are not doubled.

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

- **Single-sourced path**: the directory comes from `LOGS_DIR_RELATIVE` in `src/shared/constants.ts`, consumed by both `LoggingService` and the crash screen's degraded mode — edit the constant, never a hard-coded literal, or the symlink check and the crash screen can drift onto different directories
- **Symlink protection**: `~/.erfana/logs/` validated as real directory (not symlink) on initialize
- **Disk space checks**: Cleanup skipped below 100MB free
- **Input validation**: Renderer log entries validated via Zod schema (`LogEntrySchema` in `logging-schema.ts`). Invalid entries rejected.
- **Sensitive data**: Never log passwords, API keys, file contents, PII, or session tokens. Log paths and sizes instead.

## Implementation details

- **Library**: [electron-log](https://github.com/megahertz/electron-log) with custom logrotate-style archive function
- **Transports**: Separate logger instances for combined, main, renderer. Console disabled in production.
- **Level mapping**: `trace` → `verbose`, `fatal` → `error` (electron-log lacks these)
- **Global error handlers**: TWO independent installations, both in the renderer. `RendererLogger.installErrorHandlers()` (run from `initialize()`) registers `error` / `unhandledrejection` listeners at **error** level ("Uncaught error" / "Unhandled promise rejection"); `installGlobalErrorTrail()` (`src/renderer/src/utils/installGlobalErrorTrail.ts`, called from `main.tsx` before the route branch so the overlay window is covered too) registers its own pair at **fatal** level. Both fire, so **one uncaught error currently produces two records** — one `fatal` `[GlobalErrorTrail] …` line and one `error` line from the logger. This is a known, accepted duplicate, documented in that module's docblock: suppressing the logger's pair would require `stopImmediatePropagation()`, which would silently kill every `error` listener registered after it, and collapsing the two belongs in `logger.ts`. **When reading a log, two records do not mean two crashes.** React's development build additionally re-throws a boundary-caught error to `window`, so in dev a single crash can appear twice again; production does not do this
- **Safe console**: `safeConsole` utility (`src/main/utils/safeConsole.ts`) wraps console to suppress EPIPE errors during shutdown. Installed globally on app startup via `installSafeConsole()`. See [EPIPE error handling](./epipe-error-handling.md).

## Diagnostic logging (v0.9.0)

Performance instrumentation added for large-project debugging (#151):

- **Timing**: `GitStatus: completed` with `strategy`, `durationMs`, `fileCount`, `truncated` (info level)
- **File operations**: `FileService: readDirectory completed` with `durationMs`, `fileCount` (info level)
- **Project switch**: Per-stage logging with `durationMs` for failure identification
- **Watcher health**: `DirectoryWatcherService` logs health snapshot every 120s (debug level)
- **Buffer pressure**: `ThrottledWorker` logs at 80% and 50% buffer capacity (warn/info level)
- **Rate-limited errors**: `RateLimitedLogger` (`src/main/utils/RateLimitedLogger.ts`) prevents log spam during cascading EMFILE errors (10s default cooldown)

### Renderer console-error rate cap (#60)

A **second, unrelated** limiter, in `src/main/utils/rendererCrashHandlers.ts` — it does not use `RateLimitedLogger`, and the two never interact.

- **Cap**: `MAX_CONSOLE_ERRORS_PER_WINDOW` (20) `[crash] renderer-console-error` records per `CONSOLE_ERROR_WINDOW_MS` (10 s), counted **per window** (each window gets its own counters)
- **Fixed window, not a token bucket**: the window opens on the first console error and is closed by a `setTimeout` that is `unref`'d, so a pending window can never hold a quitting app open
- **Summary on close**: the timer emits exactly one `[crash] renderer-console-error suppressed` line — at `error` level, matching the records it stands in for — and **only if something was dropped**. It is timer-driven rather than flushed lazily on the next event so that a loop which stops right after the cap is hit still leaves the "N records dropped" evidence behind
- **Length bound**: renderer-supplied strings (console `message`, `sourceId`, preload-error text) are untrusted — a rendered document can log whatever it likes — so each is truncated at `MAX_UNTRUSTED_TEXT_LENGTH` (1000 chars) with a `[truncated]` marker and passed as structured context, never interpolated into the message
- **Why**: a renderer stuck in an error loop emits thousands of `console.error` calls a second. Copied one-for-one, that loop pushes the crash that *started* it out of the rotation window — it destroys the evidence the handlers exist to preserve. Length bounds the size of one record; the cap bounds how many

## Related documentation

- [IPC patterns](./ipc-patterns.md) – IPC communication patterns
- [Architecture](./architecture.md) – System design overview
- [EPIPE error handling](./epipe-error-handling.md) – EPIPE error details
