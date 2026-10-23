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
/** node-pty version the replacement was written and checked against (major.minor). */
const CHECKED_NODE_PTY_SERIES = '1.1.'

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

/** Installing still goes ahead on another node-pty version, but the upgrade should get a re-check. */
function noteVersionOnce(version: string | undefined): void {
  if (versionNoted) return
  versionNoted = true
  if (version?.startsWith(CHECKED_NODE_PTY_SERIES)) return
  logger.warn(
    `node-pty ${version ?? '(unknown version)'} is not ${CHECKED_NODE_PTY_SERIES}x: the Windows kill shim was installed but must be re-verified`,
    { checkedSeries: `${CHECKED_NODE_PTY_SERIES}x` }
  )
}

/** node-pty's own version, read through the same `createRequire` as the module. */
export function readNodePtyVersion(): string | undefined {
  try {
    const pkg = createRequire(__filename)('node-pty/package.json') as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : undefined
  } catch {
    return undefined
  }
}

let versionNoted = false

/**
 * @param load - Returns node-pty's `lib/windowsPtyAgent` module (injected in some tests)
 * @returns true when the replacement is in place
 */
export function installNoForkConsoleList(
  load: () => unknown = loadWindowsPtyAgent,
  readVersion: () => string | undefined = readNodePtyVersion
): boolean {
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
    noteVersionOnce(readVersion())
    return true
  } catch (error) {
    reportOnce('Could not adjust node-pty\'s Windows kill; leaving it as is', {
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

/** Marks the wrapped exit method so a second install does nothing. */
const EXIT_MARK = '__erfanaExitTimeRecorder'

/** Property set on a WindowsPtyAgent when its native exit callback fires. */
const EXIT_AT = '__erfanaExitAtMs'

/**
 * Records WHEN node-pty's native exit callback fires for each Windows agent (#305).
 *
 * node-pty reports the exit to JavaScript only after the output is drained (up to about
 * a second later), so `onExit` is late. The quit helper must not treat a pid as the
 * shell's after the shell has ended (Windows may hand the pid to another process), so it
 * needs the earliest moment the shell was known to be gone. `_$onProcessExit` is the
 * method the native exit thread calls; the wrapper only notes `Date.now()` on the agent
 * and then calls the original. Nothing happens if the method is not what 1.1.0 has.
 *
 * @returns true when the wrapper is in place
 */
export function installExitTimeRecorder(load: () => unknown = loadWindowsPtyAgent): boolean {
  try {
    const mod = load() as { WindowsPtyAgent?: { prototype?: Record<string, unknown> } } | undefined
    const proto = mod?.WindowsPtyAgent?.prototype
    const original = proto?._$onProcessExit
    if (!proto || typeof original !== 'function') return false
    if ((original as unknown as Record<string, unknown>)[EXIT_MARK]) return true
    const wrapped = function (this: Record<string, unknown>, ...args: unknown[]): unknown {
      this[EXIT_AT] = Date.now()
      return (original as (...a: unknown[]) => unknown).apply(this, args)
    }
    ;(wrapped as unknown as Record<string, unknown>)[EXIT_MARK] = true
    proto._$onProcessExit = wrapped
    return true
  } catch {
    return false
  }
}

/**
 * When the native exit callback fired for a node-pty Windows terminal (`IPty`), or
 * `undefined` if it has not (or the terminal is not a Windows one).
 */
export function nativeExitAtMs(ptyProcess: unknown): number | undefined {
  const agent = (ptyProcess as { _agent?: Record<string, unknown> } | undefined)?._agent
  const at = agent?.[EXIT_AT]
  return typeof at === 'number' && Number.isFinite(at) ? at : undefined
}

/** Marks the wrapped clean-up method so a second install does nothing. */
const CLEANUP_MARK = '__erfanaConoutRelease'

/** Shape problems already logged, one line each (#305). */
const shapeReported = new Set<string>()

function reportShapeOnce(key: string, message: string): void {
  if (shapeReported.has(key)) return
  shapeReported.add(key)
  logger.warn(message)
}

/** Workers released and worker exits seen, for the quit log (counts only). */
const conoutStats = { released: 0, exited: 0 }

/** How many conout workers were released, and how many have reported their exit. */
export function conoutWorkerStats(): { released: number; exited: number } {
  return { ...conoutStats }
}

/**
 * Ends node-pty's conout worker thread on every Windows shell exit (#305; Windows:
 * 2 of 6 quits hung for about 17 s, both after a terminal had ended with `exit`).
 *
 * node-pty 1.1.0 starts one `worker_threads` Worker per terminal
 * (`ConoutConnection`, `lib/windowsConoutConnection.js`) that relays the console
 * output, and ends it only from `WindowsPtyAgent.kill()`. When a shell ends without
 * `kill()` – the user typed `exit` – nothing ends it, so it runs for the rest of the
 * session and the app's exit has to stop it during teardown, on the main thread. The
 * patch notes in `docs/windows/contributing.md` already record a quit hang from the
 * main thread joining a conout worker; this ends the worker while the app runs.
 *
 * The hook is `WindowsPtyAgent.prototype._cleanUpProcess`, which node-pty runs on
 * every native exit, about a second after the last output, when it destroys the
 * output socket: so no output is lost, and it runs whether or not the terminal's own
 * `exit` event is ever wired (that happens only after the data pipe is ready). It also
 * destroys the input socket, which node-pty leaves open (microsoft/node-pty#947).
 * Nothing happens if the method is not what 1.1.0 has; that is logged once.
 *
 * @returns true when the wrapper is in place
 */
export function installConoutWorkerRelease(
  load: () => unknown = loadWindowsPtyAgent,
  readVersion: () => string | undefined = readNodePtyVersion
): boolean {
  try {
    const mod = load() as { WindowsPtyAgent?: { prototype?: Record<string, unknown> } } | undefined
    const proto = mod?.WindowsPtyAgent?.prototype
    const original = proto?._cleanUpProcess
    if (!proto || typeof original !== 'function') {
      reportShapeOnce('cleanup', 'node-pty has no WindowsPtyAgent._cleanUpProcess; a conout worker is left running after its shell exits')
      noteVersionOnce(readVersion())
      return false
    }
    if ((original as unknown as Record<string, unknown>)[CLEANUP_MARK]) return true
    const wrapped = function (this: Record<string, unknown>, ...args: unknown[]): unknown {
      try {
        return (original as (...a: unknown[]) => unknown).apply(this, args)
      } finally {
        // node-pty's own clean-up does nothing in conpty.dll mode, and neither does this
        if (!this._useConptyDll) releaseAgentConoutWorker(this)
      }
    }
    ;(wrapped as unknown as Record<string, unknown>)[CLEANUP_MARK] = true
    proto._cleanUpProcess = wrapped
    noteVersionOnce(readVersion())
    return true
  } catch {
    reportShapeOnce('cleanup', 'Could not hook node-pty\'s Windows clean-up; a conout worker is left running after its shell exits')
    return false
  }
}

type ConoutConnectionLike = {
  _worker?: { terminate?: unknown; once?: unknown }
  _isDisposed?: boolean
  _drainTimeout?: ReturnType<typeof setTimeout>
}

/**
 * Terminates one agent's conout worker at once and marks the connection disposed, so
 * a later `kill()` does not start it again; also destroys the agent's input socket.
 * Logs counts and times only. Does nothing for other shapes (logged once).
 *
 * @returns true when a worker was asked to stop
 */
export function releaseAgentConoutWorker(agent: unknown): boolean {
  try {
    const a = agent as Record<string, unknown> | undefined
    const connection = a?._conoutSocketWorker as ConoutConnectionLike | undefined
    const worker = connection?._worker
    if (!connection || !worker || typeof worker.terminate !== 'function') {
      reportShapeOnce('release', 'node-pty conout worker not found on an exited Windows terminal; it is left running')
      noteVersionOnce(readNodePtyVersion())
      return false
    }
    const inSocket = a?._inSocket as { destroy?: unknown; destroyed?: boolean } | undefined
    if (inSocket && typeof inSocket.destroy === 'function' && !inSocket.destroyed) {
      try {
        ;(inSocket.destroy as () => void).call(inSocket)
      } catch {
        // already closed
      }
    }
    connection._isDisposed = true
    if (connection._drainTimeout) clearTimeout(connection._drainTimeout)
    const exitAt = a?.[EXIT_AT]
    const releasedAt = Date.now()
    if (typeof worker.once === 'function') {
      ;(worker.once as (e: string, cb: (code: number) => void) => void).call(worker, 'exit', (code: number) => {
        conoutStats.exited++
        logger.info('Conout worker exited', { exited: conoutStats.exited, code, releaseToExitMs: Date.now() - releasedAt })
      })
    }
    const stopping: unknown = (worker.terminate as () => unknown).call(worker)
    if (stopping && typeof (stopping as Promise<unknown>).catch === 'function') {
      void (stopping as Promise<unknown>).catch(() => {})
    }
    conoutStats.released++
    logger.info('Conout worker released', {
      released: conoutStats.released,
      exitToReleaseMs: typeof exitAt === 'number' ? releasedAt - exitAt : null
    })
    return true
  } catch {
    return false
  }
}

/** Test hook: lets a test see the once-only warning again. */
export function resetShimWarningForTests(): void {
  reported = false
  versionNoted = false
  shapeReported.clear()
  conoutStats.released = 0
  conoutStats.exited = 0
}
