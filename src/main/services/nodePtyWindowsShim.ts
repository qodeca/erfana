// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Windows-only: stop node-pty's kill from forking a helper process (#296).
 *
 * node-pty 1.1.0 `WindowsPtyAgent.kill()` calls `_getConsoleProcessList()`,
 * which runs `child_process.fork('conpty_console_list_agent')` inside a
 * `new Promise` executor. Erfana's `scripts/fuses.js` turns the `RunAsNode`
 * fuse off, and with that fuse off Electron's `child_process.fork` throws
 * ("use utilityProcess.fork() instead", see the fuses page of the Electron
 * docs). The throw becomes an unhandled promise rejection, which Electron shows
 * as a modal "A JavaScript error occurred in the main process" box on every
 * terminal restart or kill.
 *
 * The replacement returns only the shell's own pid, which is exactly what
 * node-pty falls back to when its helper fails or times out. It is installed
 * always on Windows, not only when the fuse is off, so dev and packaged builds
 * behave the same. Nothing is lost: the list was only used to kill every
 * process of the console, and on quit and window close `terminalTreeKill.ts`
 * ends the whole tree. One tab closed or restarted ends the shell, as intended.
 * The helper also failed with "AttachConsole failed" in most cases, because it
 * runs after the console is already gone (upstream: microsoft/node-pty #886,
 * open, only wraps that failure in try/catch).
 *
 * node-pty is not patched: the method is replaced on the loaded prototype, and
 * nothing happens if the method or the module is not what 1.1.0 has.
 */
import { createRequire } from 'module'
import { logger } from './LoggingService'

interface WindowsPtyAgentLike {
  prototype?: { _getConsoleProcessList?: unknown } & Record<string, unknown>
}

/** Marks the replaced method so a second install does nothing. */
const SHIM_MARK = '__erfanaNoForkConsoleList'

let reported = false
function reportOnce(message: string, detail?: Record<string, unknown>): void {
  if (reported) return
  reported = true
  // error level: if this fails, terminal kills show the error box again
  logger.error(message, undefined, detail)
}

/**
 * Loads node-pty's Windows agent module with `require`, synchronously.
 *
 * The main bundle is CommonJS. A dynamic import of that deep path
 * is left as a native ESM import there, which needs the file extension and fails
 * with ERR_MODULE_NOT_FOUND. `require` resolves the package the way node-pty's
 * own code does and returns the module from the same cache, so the prototype
 * that is patched is the one in use. The app ships with `asar: false`
 * (electron-builder.yml), so the path is the plain node_modules one.
 */
export function loadWindowsPtyAgent(): unknown {
  return createRequire(__filename)('node-pty/lib/windowsPtyAgent')
}

/**
 * @param load - Returns node-pty's `lib/windowsPtyAgent` module (injected in some tests)
 * @returns true when the replacement is in place
 */
export function installNoForkConsoleList(load: () => unknown = loadWindowsPtyAgent): boolean {
  try {
    const mod = load() as { WindowsPtyAgent?: WindowsPtyAgentLike } | undefined
    const proto = mod?.WindowsPtyAgent?.prototype
    if (!proto || typeof proto._getConsoleProcessList !== 'function') {
      reportOnce('node-pty has no WindowsPtyAgent._getConsoleProcessList; leaving its kill as is')
      return false
    }
    if ((proto._getConsoleProcessList as unknown as Record<string, unknown>)[SHIM_MARK]) return true

    const replacement = function (this: { _innerPid?: number }): Promise<number[]> {
      return Promise.resolve(typeof this._innerPid === 'number' && this._innerPid > 0 ? [this._innerPid] : [])
    }
    ;(replacement as unknown as Record<string, unknown>)[SHIM_MARK] = true
    proto._getConsoleProcessList = replacement
    return true
  } catch (error) {
    reportOnce('Could not adjust node-pty\'s Windows kill; leaving it as is', {
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

/** Test hook: lets a test see the once-only warning again. */
export function resetShimWarningForTests(): void {
  reported = false
}
