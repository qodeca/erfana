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

- **Settings file**: Edit `~/.erfana/settings.json` → `{ "logging": { "level": "debug" } }` while Erfana is closed; the file is read only at start. An edit made while Erfana runs is ignored and is overwritten by the next change made in Settings.
- **Settings UI**: Gear icon → Logging section → dropdown. Applied immediately.
- **Programmatically**: `globalSettingsService.setSetting('logging', { level: 'debug' })` (`GlobalSettingsService.setSetting` – there is no `updateSetting`)

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
- **File operations**: `FileService: readDirectory completed` with `durationMs`, `fileCount` (info level); since #208 one of five `readDirectory` lines for tree walks, all carrying `pathDigest`, and a `readId` (`behindReadId` on the joined line) – see [Tree reads and memory](#tree-reads-and-memory-208)
- **Project switch**: Per-stage logging with `durationMs` for failure identification
- **Watcher health**: `DirectoryWatcherService` logs a health snapshot every 120s – `info` level since #208 (`warn` when the watcher is stressed), so it reaches `main.log` at the default level, and it now carries process memory; see [Tree reads and memory](#tree-reads-and-memory-208). Since #211 it also carries the path-filter and Windows-backend counters – see [Large projects on Windows](#large-projects-on-windows-211)
- **Buffer pressure**: `ThrottledWorker` logs at 80% and 50% buffer capacity (warn/info level)
- **Rate-limited errors**: `RateLimitedLogger` (`src/main/utils/RateLimitedLogger.ts`) prevents log spam during cascading EMFILE errors (10s default cooldown)

### Renderer console-error rate cap (#60)

A **second, unrelated** limiter, in `src/main/utils/rendererCrashHandlers.ts` — it does not use `RateLimitedLogger`, and the two never interact.

- **Cap**: `MAX_CONSOLE_ERRORS_PER_WINDOW` (20) `[crash] renderer-console-error` records per `CONSOLE_ERROR_WINDOW_MS` (10 s), counted **per window** (each window gets its own counters)
- **Fixed window, not a token bucket**: the window opens on the first console error and is closed by a `setTimeout` that is `unref`'d, so a pending window can never hold a quitting app open
- **Summary on close**: the timer emits exactly one `[crash] renderer-console-error suppressed` line — at `error` level, matching the records it stands in for — and **only if something was dropped**. It is timer-driven rather than flushed lazily on the next event so that a loop which stops right after the cap is hit still leaves the "N records dropped" evidence behind
- **Length bound**: renderer-supplied strings (console `message`, `sourceId`, preload-error text) are untrusted — a rendered document can log whatever it likes — so each is truncated at `MAX_UNTRUSTED_TEXT_LENGTH` (1000 chars) with a `[truncated]` marker and passed as structured context, never interpolated into the message
- **Why**: a renderer stuck in an error loop emits thousands of `console.error` calls a second. Copied one-for-one, that loop pushes the crash that *started* it out of the rotation window — it destroys the evidence the handlers exist to preserve. Length bounds the size of one record; the cap bounds how many

### Preview bounds-drop reporter (#124)

A **third** limiter, `createDropReporter()` in `src/shared/dropReporter.ts`. It is pure (clock and sink injected, no logger import), so the renderer's bounds hook and main's preview handlers and services share it. Every point that throws away an HTML-preview bounds update reports through one, so a page left over Erfana's own chrome leaves a trail naming the step that dropped the update.

- **Message**: every line is `Preview bounds update dropped`; `source` (`renderer` / `main`) and `reason` travel as structured context
- **First drop always logged**: the first drop of each reason is emitted; later drops of that reason are emitted at most once per `PREVIEW_LIMITS.BOUNDS_DROP_LOG_WINDOW_MS` (5 s), and that line carries `suppressed` – how many were swallowed since the previous one
- **Bounded slots**: at most `BOUNDS_DROP_MAX_REASONS` (16) reasons get their own slot; any further reason shares one overflow slot under the same rule
- **No path**: a line carries `stablePathDigest` of the panel id (never the id, which spells the file path), sequence numbers and a rect rounded to whole pixels

### Tree reads and memory (#208)

A very large project that kept changing made Erfana exit on Windows with nothing in the log. Overlapping full-tree reads most likely ran the main process out of heap (inferred – see [#208](https://github.com/qodeca/erfana/issues/208)), and the health line that would have shown a memory climb logged at `debug`. Tree reads are now single-flight (see [File watching § Tree refresh is single-flight](./file-watching/technical-details.md#tree-refresh-is-single-flight-208)), and every walk leaves a trace.

**Main process** (`main.log`):

| Line | Level | When | Context |
|------|-------|------|---------|
| `FileService: readDirectory started` | info | A walk starts | `readId`, `pathDigest`, `followUp`, `callers` |
| `FileService: readDirectory completed` | info | A walk succeeded | `durationMs`, `fileCount`, `dirCount`, `hiddenPatternCount`, `maxDepth`, the #211 exclude counts (`excludePatternCount`, `excludedEntryCount`, `walkHintCount`, `matcherBudgetExceeded` – see [Large projects on Windows](#large-projects-on-windows-211)), plus `readId`, `pathDigest`, `followUp`, `callers` |
| `FileService: readDirectory failed` | warn | A walk rejected (only the root `readdir` can fail one; sub-folder errors are recovered) | `readId`, `pathDigest`, `durationMs` |
| `FileService: readDirectory still running` | warn | Once per walk, `READ_DIRECTORY_SLOW_WARN_MS` (60 s) after it started | `readId`, `pathDigest`, `elapsedMs` |
| `FileService: readDirectory joined follow-up read` | info | A call arrived while a walk of that path ran and was queued behind it | `pathDigest`, `behindReadId` |
| `DirectoryWatcher health` | info (warn when stressed) | Every 120 s while a directory watcher is active, i.e. while a project is open | Watcher metrics, plus `mainMemoryMb` and `processMemoryMb`, and `memoryError` when a source could not be read |

**Renderer** (`renderer.log`, prefixed `[RENDERER]`):

| Line | Level | When | Context |
|------|-------|------|---------|
| `[useProjectManagement] File tree refreshed` | info | A refresh read finished | `durationMs`, `itemCount`, `followUp`, `callers`, `applied` |
| `[useProjectManagement] File tree loaded` | info | The project-open load finished for the project still open | `durationMs`, `itemCount`, `applied` |
| `[useProjectManagement] Stale project load dropped` | info | A project-open load finished after a newer switch or close; no tree, no toast | `durationMs`, `itemCount` |

Field meanings:

- `readId` – a number that goes up by one with every walk. It pairs a walk's `started` line with its `completed`, `failed` or `still running` line.
- `pathDigest` – `stablePathDigest` of the resolved path: a 16-hex value, the same for every walk of one folder and different for another. None of the five `readDirectory` lines above carries a readable path. Two older lines still do, as before: the handler's own `file:readDirectory IPC completed` (info) logs `dirPath`, and `FileService: readDirectory error recovered` (warn, a sub-folder that could not be read) logs `path`.
- `followUp` / `callers` – `followUp: true` marks the one queued walk (or refresh read) that serves every call made while the previous one ran; `callers` is how many calls it serves (1 for a walk that started at once).
- `behindReadId` – the `readId` of the walk that call is waiting behind.
- `applied` – `false` means the result was older than the tree already shown, or belonged to a project that is no longer open, and was dropped.
- `mainMemoryMb` – main-process `rss`, `heapUsed`, `heapTotal`, `external` and `heapLimit` (V8's heap ceiling), in MB.
- `processMemoryMb` – one `{ type, pid, workingSet, peakWorkingSet }` per Electron process (from `app.getAppMetrics()`), in MB. `type` and `pid` tell the main process (`Browser`) from each renderer (`Tab`) and the helper processes.

**Checking that no two reads of a project overlapped** – pair lines by `readId`, group them by `pathDigest`:

```bash
grep -E 'readDirectory (started|completed|failed|still running|joined follow-up read)' ~/.erfana/logs/main.log
```

Within one `pathDigest`, every `started` must be closed by the `completed` or `failed` line with the same `readId` before the next `started`. Lines of different `pathDigest` values may interleave – different folders are not serialised against each other. A `still running` line with no closing line for its `readId` is a hung walk (for example an unreachable network drive): every later read of that folder waits behind it until it ends or Erfana restarts.

Reading notes:

- `heapUsed` climbing towards `heapLimit` over successive health lines is the heap-exhaustion trend this line exists to show.
- The health line adds about 30 `info` lines an hour while a project is open; rotation absorbs it.
- The handler's `file:readDirectory IPC completed` `durationMs` now includes time spent waiting behind a running walk of the same path, so it can be much larger than the walk's own `durationMs`.
- Debug-level companions, for a `debug` session: `File tree refresh skipped – project changed`, `File tree refresh skipped – stale caller`, `File tree refresh failed for a project no longer open` and `Stale project load failed; ignored`, all prefixed `[useProjectManagement]`.

### Large projects on Windows (#211)

The `files.exclude` list, the project path filter and the Windows native directory watcher ([File watching § Watch backends](./file-watching/README.md#watch-backends-211)). Every line below carries counts, durations, codes and fixed reason strings only – never a path, an exclude entry's text or a Node error message (which quotes absolute paths).

**New lines** (`main.log`):

| Line | Level | When | Context |
|------|-------|------|---------|
| `Project switch: files.exclude entries rejected` | warn | A project opens and a settings file has entries that break the rules; one line per source | `source` (`global` / `project`), `rejectedCount`, `rejected` – the first 64 `{ index, reason }` |
| `Exclude patterns disabled: match budget exceeded` | warn | Once per project session, when 100 pattern tests have run out of budget and pattern entries switch off | `budgetExceeded`, `patternEntryCount` |
| `Directory watcher backend selected` | info | Once, at the first directory watch | `backend` (`chokidar` / `native-recursive`) |
| `Directory watcher override ignored: unknown value` | warn | `ERFANA_DIRECTORY_WATCHER` is set to anything but `chokidar` | `variable`, `accepted` (the value itself is not logged) |
| `Native directory watcher ready` | info | Windows: the watcher's plan is complete | `recursiveWatches`, `splitFolders`, `walkHints`, `planCapped`, `elapsedMs` |
| `Directory watcher resync` | info | Windows: lost events were answered by a catch-up re-read (or counted into a pause) | `reason` (`overflow`, `backlog`, `watch-error`, `reopen`), `paused`, `suppressedCount` – at most one line per 10 s |
| `Directory watch failed to start, restart scheduled` | info | A watch could not be built and a restart was scheduled | `errorType` |
| `Native watcher: handle cap reached, folder left unwatched` | warn | The 512-handle cap was hit | `maxHandles` |
| `Native watcher: a watch failed to open` | warn | `fs.watch` refused a folder (other than as gone) | `code`, `recursive` |
| `Native watcher: listing a split folder failed, watching it recursively` | warn | A split folder could not be listed during the plan | `code` |
| `Native watcher: a watch reported an error` | warn | A handle emitted an `error`; it is closed and re-checked | `code`, `recursive` |
| `Native watcher: folder left unwatched after repeated re-opens` | warn | A path hit the 3-per-60 s re-open cap | `reopenLimit`, `windowMs`, `unwatched` |
| `Native watcher: resolving the root failed, watching it as given` | warn | `realpathSync.native` failed other than as gone | `code` |
| `Native watcher: closing a watch failed`, `Native watcher: error with no listener`, `Native watcher: background task failed`, `Native classifier: listener failed` | warn | Defensive paths | `code` |

Every `Native watcher: …` warning is rate-limited per kind to one line per 10 s and carries `suppressedCount`. `Native watcher: listing a folder failed` (`code`) is its debug-level companion.

**New fields on existing lines:**

- `FileService: readDirectory completed` – `excludePatternCount` (entries in the compiled list), `excludedEntryCount` (entries this walk skipped without reading), `walkHintCount` (hints a root walk stored for the Windows plan; 0 for any other walk), `matcherBudgetExceeded` (pattern tests in this walk that ran out of budget).
- `Project switch: settings loaded` (debug) – `excludePatternCount`.
- `DirectoryWatcher health` – `eventsFiltered` (events dropped as excluded, hidden, ignored or outside the project), `nativeOverflows` (Windows change-buffer overflows), `nativeResyncs` (catch-up re-reads the native backend asked for), `matcherBudgetExceeded`. The counters are cumulative. A growth in `nativeResyncs` since the previous health line now also counts as stress and logs the line at `warn`; a resync that happened before the previous line no longer does.

Reading notes:

- A burst of changes only inside excluded, hidden or ignored folders leaves no `📁 Directory changed` and no `FileService: readDirectory started` line; `eventsFiltered` grows instead.
- `planCapped: true` on the ready line, or a `handle cap reached` warning, means some dropped folder still sits inside a recursive watch; heavy churn there can cost a resync. Reopening the project re-plans with fresh walk hints.
- `RateLimitedLogger` measures its window from process start, so a resync line in roughly the first 10 s after Erfana starts is counted in the next line's `suppressedCount` instead of being written (pre-existing behaviour; the EMFILE line shares it).

## Related documentation

- [IPC patterns](./ipc-patterns.md) – IPC communication patterns
- [Architecture](./architecture.md) – System design overview
- [EPIPE error handling](./epipe-error-handling.md) – EPIPE error details
