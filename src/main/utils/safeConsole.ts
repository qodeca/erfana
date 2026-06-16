// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Safe Console Logging Utility
 *
 * Prevents EPIPE errors by wrapping console methods with error handling.
 * EPIPE (Broken Pipe) errors occur when writing to stdout/stderr after
 * the stream has been closed (e.g., during app shutdown, process cleanup).
 *
 * This utility silently catches and suppresses EPIPE errors to prevent
 * application crashes during normal cleanup operations.
 */

type ConsoleMethod = 'log' | 'error' | 'warn' | 'info' | 'debug'

/**
 * Safe wrapper for console methods that handles EPIPE errors
 */
function safeConsoleWrite(method: ConsoleMethod, ...args: unknown[]): void {
  try {
    // Attempt to write to console
    console[method](...args)
  } catch (error) {
    // Silently suppress EPIPE errors (broken pipe)
    // These occur naturally during cleanup when stdout/stderr are closed
    const code = (error as { code?: unknown }).code
    if (code === 'EPIPE') {
      // Do nothing - this is expected during shutdown
      return
    }

    // For other errors, attempt to write to stderr if available
    // This is a last resort for unexpected console errors
    try {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr?.write(`[Console Error] ${message}\n`)
    } catch {
      // If even stderr is unavailable, fail silently
    }
  }
}

/**
 * Safe console logger that prevents EPIPE crashes
 * Drop-in replacement for console.log, console.error, etc.
 */
export const safeConsole = {
  log: (...args: unknown[]) => safeConsoleWrite('log', ...args),
  error: (...args: unknown[]) => safeConsoleWrite('error', ...args),
  warn: (...args: unknown[]) => safeConsoleWrite('warn', ...args),
  info: (...args: unknown[]) => safeConsoleWrite('info', ...args),
  debug: (...args: unknown[]) => safeConsoleWrite('debug', ...args)
}

/**
 * Install global console override to prevent EPIPE errors app-wide
 * Call this early in main process initialization
 */
export function installSafeConsole(): void {
  // Override console methods with safe versions
  console.log = safeConsole.log
  console.error = safeConsole.error
  console.warn = safeConsole.warn
  console.info = safeConsole.info
  console.debug = safeConsole.debug

  // Log installation (using safe method)
  safeConsole.log('Safe console installed - EPIPE errors will be suppressed')
}
