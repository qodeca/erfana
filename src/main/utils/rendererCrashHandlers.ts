// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer / child-process death and window-hang logging (issue #60).
 *
 * When the renderer dies outright the window goes blank at the OS level and no
 * renderer-side error boundary can intercept it — the only record left is what
 * the main process writes here. These handlers exist purely to leave that trail.
 *
 * Deliberately log-only: no auto-reload, no dialog, no relaunch. A crash caused
 * by the restored state would re-crash on reload, so any automated recovery is
 * a boot loop waiting to happen (design-issue-60 §2.6).
 *
 * Two scopes:
 * - app-scope — {@link registerAppCrashLogging}, once per process
 * - window-scope — {@link registerWindowResponsiveness} (hangs) and
 *   {@link registerWindowErrorSignals} (entry-module failures), once per window
 *
 * @see docs/design/design-issue-60.md §2.6 — instrumentation placement
 */
import { app } from 'electron'
import type {
  BrowserWindow,
  Details as ChildProcessGoneDetails,
  RenderProcessGoneDetails
} from 'electron'
import { logger } from '../services/LoggingService'

/**
 * Greppable message tags. Support asks users for log excerpts, so these strings
 * are the search keys — keep them stable.
 */
const RENDER_PROCESS_GONE_TAG = '[crash] render-process-gone'
const CHILD_PROCESS_GONE_TAG = '[crash] child-process-gone'
const WINDOW_UNRESPONSIVE_TAG = '[hang] window-unresponsive'
const WINDOW_RESPONSIVE_TAG = '[hang] window-responsive'
const RENDERER_CONSOLE_ERROR_TAG = '[crash] renderer-console-error'
const RENDERER_CONSOLE_ERROR_SUPPRESSED_TAG = '[crash] renderer-console-error suppressed'
const PRELOAD_ERROR_TAG = '[crash] preload-error'

/**
 * Upper bound on any renderer-supplied string copied into a log record.
 *
 * Console text, source URLs and preload-error messages are attacker-influenced
 * content (a rendered document can log whatever it likes), and the log file is
 * read by support. Truncation bounds the SIZE of one record and nothing else —
 * how MANY records a console-error loop can write is a separate problem, capped
 * by {@link createConsoleErrorRateCap}.
 */
const MAX_UNTRUSTED_TEXT_LENGTH = 1_000

/** How many console-error records one window may write per rate-cap window. */
const MAX_CONSOLE_ERRORS_PER_WINDOW = 20

/** Length of the rate-cap window, in milliseconds. */
const CONSOLE_ERROR_WINDOW_MS = 10_000

/**
 * Bounds an untrusted, renderer-supplied string for logging.
 *
 * @param value - Any value Electron handed us; non-strings become `''`
 * @returns A string no longer than {@link MAX_UNTRUSTED_TEXT_LENGTH} plus a marker
 */
function boundUntrustedText(value: unknown): string {
  if (typeof value !== 'string') return ''
  if (value.length <= MAX_UNTRUSTED_TEXT_LENGTH) return value
  return `${value.slice(0, MAX_UNTRUSTED_TEXT_LENGTH)}[truncated]`
}

/**
 * Builds the per-window rate cap over renderer console errors.
 *
 * A renderer stuck in an error loop emits `console.error` thousands of times a
 * second. Copied one-for-one into the log file, that loop pushes the crash that
 * STARTED it out of the rotation window — it destroys the evidence these
 * handlers exist to preserve. So at most {@link MAX_CONSOLE_ERRORS_PER_WINDOW}
 * records are written per {@link CONSOLE_ERROR_WINDOW_MS}.
 *
 * A fixed window, not a token bucket: the window opens on the first console
 * error and closes {@link CONSOLE_ERROR_WINDOW_MS} later, at which point one
 * summary line reports how many records were dropped and the counters reset.
 * Deliberately timer-driven rather than flushed lazily on the next event — a
 * loop that stops right after the cap is hit must still leave the "N records
 * dropped" line behind, or the log reads as if nothing was lost.
 * The timer is `unref`'d so a pending window can never hold a quitting app open.
 *
 * The summary is logged at `error`, matching the records it stands in for: at
 * any level that shows the records, the fact that some are missing must show too.
 *
 * @param windowId - Window the cap belongs to; each window gets its own counters
 * @returns A predicate: `true` when the caller may write this record
 */
function createConsoleErrorRateCap(windowId: number): () => boolean {
  let logged = 0
  let suppressed = 0
  let windowTimer: ReturnType<typeof setTimeout> | undefined

  const closeWindow = (): void => {
    windowTimer = undefined
    if (suppressed > 0) {
      logger.error(RENDERER_CONSOLE_ERROR_SUPPRESSED_TAG, undefined, {
        windowId,
        suppressed,
        windowMs: CONSOLE_ERROR_WINDOW_MS
      })
    }
    logged = 0
    suppressed = 0
  }

  return () => {
    if (windowTimer === undefined) {
      windowTimer = setTimeout(closeWindow, CONSOLE_ERROR_WINDOW_MS)
      windowTimer.unref()
    }

    if (logged < MAX_CONSOLE_ERRORS_PER_WINDOW) {
      logged += 1
      return true
    }

    suppressed += 1
    return false
  }
}

/** Logged when a second registration is skipped. Greppable. */
const DUPLICATE_REGISTRATION_TAG = '[crash] app crash logging already registered'

/** Set once the `app` listeners are attached; makes a second call a no-op. */
let appCrashLoggingRegistered = false

/**
 * Registers app-level crash logging for renderer and child processes.
 *
 * Call this inside `app.whenReady()`. Registration is app-scoped rather than
 * per-window on purpose: it also covers the screenshot overlay windows, the
 * PDF/DOCX render window and the DOCX `utilityProcess`, and it sidesteps the
 * question of whether the macOS `activate` path re-registers.
 *
 * IDEMPOTENT. A second call registers nothing and logs one debug line, so a
 * duplicated bootstrap cannot double every crash record in the support log.
 *
 * Logged fields are `details.reason` and `details.exitCode` only. `killed` is a
 * *value* of `reason`, not a separate field. `child-process-gone` additionally
 * carries the process `type`, plus `serviceName` / `name` when Electron
 * supplies them.
 */
export function registerAppCrashLogging(): void {
  if (appCrashLoggingRegistered) {
    logger.debug(DUPLICATE_REGISTRATION_TAG)
    return
  }
  appCrashLoggingRegistered = true

  app.on('render-process-gone', (_event, _webContents, details: RenderProcessGoneDetails) => {
    logger.error(RENDER_PROCESS_GONE_TAG, undefined, {
      reason: details.reason,
      exitCode: details.exitCode
    })
  })

  app.on('child-process-gone', (_event, details: ChildProcessGoneDetails) => {
    logger.error(CHILD_PROCESS_GONE_TAG, undefined, {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      ...(details.serviceName !== undefined ? { serviceName: details.serviceName } : {}),
      ...(details.name !== undefined ? { name: details.name } : {})
    })
  })
}

/**
 * Registers hang logging for a single window.
 *
 * `unresponsive` means the renderer's event loop is blocked (beachball / "not
 * responding"), which is recoverable — hence `warn` on the way in and `info`
 * when it recovers, so a support log shows both edges of the hang.
 *
 * The window id is captured at registration time: by the time `unresponsive`
 * fires, reading properties off the window is a needless risk.
 *
 * @param win - The window to observe. Not retained beyond the listeners.
 */
export function registerWindowResponsiveness(win: BrowserWindow): void {
  const windowId = win.id

  win.on('unresponsive', () => {
    logger.warn(WINDOW_UNRESPONSIVE_TAG, { windowId })
  })

  win.on('responsive', () => {
    logger.info(WINDOW_RESPONSIVE_TAG, { windowId })
  })
}

/**
 * Registers the window's entry-module error signals.
 *
 * Closes the blind spot left by the renderer-side trail: a failure in the entry
 * module (a bad import, a throw before `main.tsx` mounts, a preload that never
 * finished) happens before any React boundary or `window` listener exists, so
 * the renderer produces nothing and the process never dies — `render-process-gone`
 * stays silent while the window shows an empty page. What DOES survive is the
 * renderer's console output and Electron's preload-error event, both observable
 * only from main.
 *
 * A sibling of {@link registerWindowResponsiveness} rather than part of it: that
 * one observes hangs on the window, this one observes errors on its
 * `webContents`. Both are window-scope and both are called from `createWindow`.
 *
 * Only `error`-level console messages are recorded — `info` / `warning` / `debug`
 * are ordinary renderer chatter and would drown the crash trail (and, in dev,
 * echo Vite's own output into the support log).
 *
 * Every renderer-supplied value is treated as untrusted: it is passed as
 * structured context (never interpolated into the message), bounded in length
 * by {@link boundUntrustedText} and bounded in COUNT by the per-window rate cap
 * ({@link createConsoleErrorRateCap}), so an error loop cannot flush the crash
 * that caused it out of the log rotation.
 *
 * Log-only, like the rest of this module.
 *
 * @param win - The window to observe. Not retained beyond the listeners.
 */
export function registerWindowErrorSignals(win: BrowserWindow): void {
  const windowId = win.id
  const { webContents } = win
  const allowConsoleError = createConsoleErrorRateCap(windowId)

  webContents.on('console-message', (details) => {
    if (details.level !== 'error') return
    if (!allowConsoleError()) return
    logger.error(RENDERER_CONSOLE_ERROR_TAG, undefined, {
      windowId,
      message: boundUntrustedText(details.message),
      line: details.lineNumber,
      sourceId: boundUntrustedText(details.sourceId)
    })
  })

  webContents.on('preload-error', (_event, preloadPath, error) => {
    logger.error(PRELOAD_ERROR_TAG, undefined, {
      windowId,
      preloadPath: boundUntrustedText(preloadPath),
      error: boundUntrustedText(error?.message)
    })
  })
}
