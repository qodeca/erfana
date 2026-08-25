// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * rendererCrashHandlers.test.ts
 *
 * Coverage (design-issue-60 §5, "Main handlers" row):
 * - registerAppCrashLogging registers `render-process-gone` + `child-process-gone`
 *   on `app`, exactly once each, and nothing else
 * - logged payload carries `reason` + `exitCode` only (no `killed` field —
 *   `killed` is a reason *value*)
 * - child-process-gone adds `type`, and `serviceName` / `name` only when present
 * - registerWindowResponsiveness registers `unresponsive` / `responsive`
 * - registerWindowErrorSignals registers `console-message` / `preload-error` on
 *   the window's webContents, logs error-level console output only, and logs
 *   preload failures (the entry-module blind spot)
 * - the per-window rate cap: an error loop is bounded to 20 records per 10s and
 *   summarised in one line, and a later distinct error is still logged
 * - registerAppCrashLogging is idempotent (a second call registers nothing)
 * - no export reloads, destroys, quits or relaunches anything
 *
 * `registerAppCrashLogging` keeps its "already registered" state in a
 * module-level flag, so every test runs against a freshly imported copy of the
 * module (`vi.resetModules()` in `beforeEach`) — otherwise the first test would
 * consume the registration and every later one would assert against a no-op.
 * The `electron` / logger mocks are built inside `vi.hoisted` and returned by
 * reference, so a re-imported module still sees the SAME spies these tests
 * assert on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'

type Listener = (...args: unknown[]) => void

const { appListeners, appMock, loggerMock } = vi.hoisted(() => {
  const appListeners = new Map<string, Listener[]>()
  return {
    appListeners,
    appMock: {
      on: vi.fn((event: string, listener: Listener) => {
        const existing = appListeners.get(event) ?? []
        existing.push(listener)
        appListeners.set(event, existing)
      }),
      quit: vi.fn(),
      exit: vi.fn(),
      relaunch: vi.fn()
    },
    loggerMock: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn()
    }
  }
})

vi.mock('electron', () => ({ app: appMock }))

vi.mock('../services/LoggingService', () => ({ logger: loggerMock }))

import { app } from 'electron'
import { logger } from '../services/LoggingService'

const WINDOW_ID = 7

/** The module under test, re-imported per test so its install flag is clean. */
let handlers: typeof import('./rendererCrashHandlers')

/** Fires every listener registered on `app` for `event`. */
function emitApp(event: string, ...args: unknown[]): void {
  const listeners = appListeners.get(event) ?? []
  expect(listeners.length).toBeGreaterThan(0)
  for (const listener of listeners) listener(...args)
}

interface FakeWindow {
  window: BrowserWindow
  emit: (event: string, ...args: unknown[]) => void
  emitWebContents: (event: string, ...args: unknown[]) => void
  listenerCount: (event: string) => number
  webContentsListenerCount: (event: string) => number
  spies: {
    reload: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    webContentsReload: ReturnType<typeof vi.fn>
    webContentsForcefullyCrashRenderer: ReturnType<typeof vi.fn>
    webContentsOn: ReturnType<typeof vi.fn>
  }
}

/** Fires every listener recorded in `listeners` for `event`. */
function emitFrom(listeners: Map<string, Listener[]>, event: string, args: unknown[]): void {
  const registered = listeners.get(event) ?? []
  expect(registered.length).toBeGreaterThan(0)
  for (const listener of registered) listener(...args)
}

/** Minimal BrowserWindow stand-in: records listeners, spies on every mutator. */
function createFakeWindow(): FakeWindow {
  const listeners = new Map<string, Listener[]>()
  const webContentsListeners = new Map<string, Listener[]>()
  const spies = {
    reload: vi.fn(),
    destroy: vi.fn(),
    close: vi.fn(),
    webContentsReload: vi.fn(),
    webContentsForcefullyCrashRenderer: vi.fn(),
    webContentsOn: vi.fn((event: string, listener: Listener) => {
      const existing = webContentsListeners.get(event) ?? []
      existing.push(listener)
      webContentsListeners.set(event, existing)
    })
  }

  const window = {
    id: WINDOW_ID,
    on: vi.fn((event: string, listener: Listener) => {
      const existing = listeners.get(event) ?? []
      existing.push(listener)
      listeners.set(event, existing)
    }),
    reload: spies.reload,
    destroy: spies.destroy,
    close: spies.close,
    isDestroyed: vi.fn(() => false),
    webContents: {
      id: 42,
      on: spies.webContentsOn,
      reload: spies.webContentsReload,
      forcefullyCrashRenderer: spies.webContentsForcefullyCrashRenderer
    }
  } as unknown as BrowserWindow

  return {
    window,
    emit: (event, ...args) => emitFrom(listeners, event, args),
    emitWebContents: (event, ...args) => emitFrom(webContentsListeners, event, args),
    listenerCount: (event) => (listeners.get(event) ?? []).length,
    webContentsListenerCount: (event) => (webContentsListeners.get(event) ?? []).length,
    spies
  }
}

/** A `console-message` payload in the Electron 39 single-object shape. */
function consoleMessage(
  level: 'debug' | 'info' | 'warning' | 'error',
  overrides: Partial<{ message: string; lineNumber: number; sourceId: string }> = {}
): Record<string, unknown> {
  return {
    level,
    message: 'boom',
    lineNumber: 12,
    sourceId: 'file:///app/renderer/index.js',
    ...overrides
  }
}

beforeEach(async () => {
  appListeners.clear()
  vi.clearAllMocks()
  vi.resetModules()
  handlers = await import('./rendererCrashHandlers')
})

describe('registerAppCrashLogging', () => {
  it('registers render-process-gone and child-process-gone on app, once each', () => {
    handlers.registerAppCrashLogging()

    expect(appListeners.get('render-process-gone')).toHaveLength(1)
    expect(appListeners.get('child-process-gone')).toHaveLength(1)
  })

  it('registers no other app listeners', () => {
    handlers.registerAppCrashLogging()

    const events = vi.mocked(app.on).mock.calls.map(([event]) => event)
    expect(events).toEqual(['render-process-gone', 'child-process-gone'])
  })

  it('logs render-process-gone at error level with reason and exitCode only', () => {
    handlers.registerAppCrashLogging()

    emitApp('render-process-gone', {}, { id: 1 }, { reason: 'crashed', exitCode: 133 })

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('render-process-gone'),
      undefined,
      { reason: 'crashed', exitCode: 133 }
    )
  })

  it('treats "killed" as a reason value, not a separate field', () => {
    handlers.registerAppCrashLogging()

    emitApp('render-process-gone', {}, { id: 1 }, { reason: 'killed', exitCode: 9 })

    const context = vi.mocked(logger.error).mock.calls[0][2]
    expect(context).toEqual({ reason: 'killed', exitCode: 9 })
    expect(context).not.toHaveProperty('killed')
  })

  it('logs oom crashes — the large-project failure mode #60 was reported as', () => {
    handlers.registerAppCrashLogging()

    emitApp('render-process-gone', {}, { id: 1 }, { reason: 'oom', exitCode: 0 })

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('render-process-gone'),
      undefined,
      { reason: 'oom', exitCode: 0 }
    )
  })

  it('logs child-process-gone with type, serviceName and name when present', () => {
    handlers.registerAppCrashLogging()

    emitApp('child-process-gone', {}, {
      type: 'Utility',
      reason: 'crashed',
      exitCode: 11,
      serviceName: 'node.mojom.NodeService',
      name: 'Node Utility Process'
    })

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('child-process-gone'),
      undefined,
      {
        type: 'Utility',
        reason: 'crashed',
        exitCode: 11,
        serviceName: 'node.mojom.NodeService',
        name: 'Node Utility Process'
      }
    )
  })

  it('omits serviceName and name when Electron does not supply them', () => {
    handlers.registerAppCrashLogging()

    emitApp('child-process-gone', {}, { type: 'GPU', reason: 'abnormal-exit', exitCode: 1 })

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('child-process-gone'),
      undefined,
      { type: 'GPU', reason: 'abnormal-exit', exitCode: 1 }
    )
  })

  it('uses distinct greppable tags for the two events', () => {
    handlers.registerAppCrashLogging()

    emitApp('render-process-gone', {}, { id: 1 }, { reason: 'crashed', exitCode: 133 })
    emitApp('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1 })

    const [rendererTag] = vi.mocked(logger.error).mock.calls[0]
    const [childTag] = vi.mocked(logger.error).mock.calls[1]
    expect(rendererTag).not.toBe(childTag)
  })

  it('does not quit, exit or relaunch the app on a crash (boot-loop safety)', () => {
    handlers.registerAppCrashLogging()

    emitApp('render-process-gone', {}, { id: 1 }, { reason: 'crashed', exitCode: 133 })
    emitApp('child-process-gone', {}, { type: 'Utility', reason: 'killed', exitCode: 9 })

    expect(app.quit).not.toHaveBeenCalled()
    expect(app.exit).not.toHaveBeenCalled()
    expect(app.relaunch).not.toHaveBeenCalled()
  })

  describe('idempotence', () => {
    it('registers nothing on a second call', () => {
      handlers.registerAppCrashLogging()
      handlers.registerAppCrashLogging()

      expect(vi.mocked(app.on)).toHaveBeenCalledTimes(2)
      expect(appListeners.get('render-process-gone')).toHaveLength(1)
      expect(appListeners.get('child-process-gone')).toHaveLength(1)
    })

    it('logs a debug line instead of registering again', () => {
      handlers.registerAppCrashLogging()
      handlers.registerAppCrashLogging()

      expect(logger.debug).toHaveBeenCalledTimes(1)
    })

    it('writes one crash record per event after repeated calls', () => {
      // The point of the flag: a duplicated bootstrap must not double every
      // line a support log is read from.
      handlers.registerAppCrashLogging()
      handlers.registerAppCrashLogging()

      emitApp('render-process-gone', {}, { id: 1 }, { reason: 'crashed', exitCode: 133 })

      expect(logger.error).toHaveBeenCalledTimes(1)
    })
  })
})

describe('registerWindowResponsiveness', () => {
  it('registers unresponsive and responsive on the window, once each', () => {
    const fake = createFakeWindow()

    handlers.registerWindowResponsiveness(fake.window)

    expect(fake.listenerCount('unresponsive')).toBe(1)
    expect(fake.listenerCount('responsive')).toBe(1)
  })

  it('registers no other window listeners', () => {
    const fake = createFakeWindow()

    handlers.registerWindowResponsiveness(fake.window)

    const events = vi.mocked(fake.window.on).mock.calls.map(([event]) => event)
    expect(events).toEqual(['unresponsive', 'responsive'])
  })

  it('logs a warning with the window id when the renderer hangs', () => {
    const fake = createFakeWindow()
    handlers.registerWindowResponsiveness(fake.window)

    fake.emit('unresponsive')

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unresponsive'), {
      windowId: WINDOW_ID
    })
  })

  it('logs recovery at info level so both edges of a hang appear in the log', () => {
    const fake = createFakeWindow()
    handlers.registerWindowResponsiveness(fake.window)

    fake.emit('unresponsive')
    fake.emit('responsive')

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('responsive'), {
      windowId: WINDOW_ID
    })
  })

  it('does not reload, destroy, close or crash the window (log-only)', () => {
    const fake = createFakeWindow()
    handlers.registerWindowResponsiveness(fake.window)

    fake.emit('unresponsive')
    fake.emit('responsive')

    expect(fake.spies.reload).not.toHaveBeenCalled()
    expect(fake.spies.destroy).not.toHaveBeenCalled()
    expect(fake.spies.close).not.toHaveBeenCalled()
    expect(fake.spies.webContentsReload).not.toHaveBeenCalled()
    expect(fake.spies.webContentsForcefullyCrashRenderer).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
    expect(app.relaunch).not.toHaveBeenCalled()
  })

  it('keeps per-window ids independent when two windows are observed', () => {
    const first = createFakeWindow()
    const second = createFakeWindow()
    ;(second.window as unknown as { id: number }).id = 99

    handlers.registerWindowResponsiveness(first.window)
    handlers.registerWindowResponsiveness(second.window)
    second.emit('unresponsive')

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { windowId: 99 })
  })
})

describe('registerWindowErrorSignals', () => {
  it('registers console-message and preload-error on the webContents, once each', () => {
    const fake = createFakeWindow()

    handlers.registerWindowErrorSignals(fake.window)

    expect(fake.webContentsListenerCount('console-message')).toBe(1)
    expect(fake.webContentsListenerCount('preload-error')).toBe(1)
  })

  it('registers no other webContents listeners and none on the window itself', () => {
    const fake = createFakeWindow()

    handlers.registerWindowErrorSignals(fake.window)

    const events = fake.spies.webContentsOn.mock.calls.map(([event]) => event)
    expect(events).toEqual(['console-message', 'preload-error'])
    expect(vi.mocked(fake.window.on)).not.toHaveBeenCalled()
  })

  it('logs an error-level console message with its untrusted fields as context', () => {
    const fake = createFakeWindow()
    handlers.registerWindowErrorSignals(fake.window)

    fake.emitWebContents(
      'console-message',
      consoleMessage('error', {
        message: "Uncaught SyntaxError: Unexpected token '<'",
        lineNumber: 1,
        sourceId: 'file:///app/renderer/assets/index-abc.js'
      })
    )

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('renderer-console-error'),
      undefined,
      {
        windowId: WINDOW_ID,
        message: "Uncaught SyntaxError: Unexpected token '<'",
        line: 1,
        sourceId: 'file:///app/renderer/assets/index-abc.js'
      }
    )
  })

  it('never interpolates renderer text into the log message', () => {
    const fake = createFakeWindow()
    handlers.registerWindowErrorSignals(fake.window)

    fake.emitWebContents('console-message', consoleMessage('error', { message: 'INJECTED' }))

    const [message] = vi.mocked(logger.error).mock.calls[0]
    expect(message).not.toContain('INJECTED')
  })

  it('bounds a hostile, oversized console message', () => {
    const fake = createFakeWindow()
    handlers.registerWindowErrorSignals(fake.window)

    fake.emitWebContents(
      'console-message',
      consoleMessage('error', { message: 'x'.repeat(50_000) })
    )

    const context = vi.mocked(logger.error).mock.calls[0][2] as { message: string }
    expect(context.message.length).toBeLessThan(1_100)
    expect(context.message.endsWith('[truncated]')).toBe(true)
  })

  it.each(['info', 'warning', 'debug'] as const)(
    'ignores %s-level console output (renderer chatter is not a crash trail)',
    (level) => {
      const fake = createFakeWindow()
      handlers.registerWindowErrorSignals(fake.window)

      fake.emitWebContents('console-message', consoleMessage(level))

      expect(logger.error).not.toHaveBeenCalled()
      expect(logger.warn).not.toHaveBeenCalled()
      expect(logger.info).not.toHaveBeenCalled()
      expect(logger.debug).not.toHaveBeenCalled()
    }
  )

  it('logs a preload failure with its path and error message', () => {
    const fake = createFakeWindow()
    handlers.registerWindowErrorSignals(fake.window)

    fake.emitWebContents(
      'preload-error',
      {},
      '/app/out/preload/index.js',
      new Error('Cannot find module electron-store')
    )

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('preload-error'),
      undefined,
      {
        windowId: WINDOW_ID,
        preloadPath: '/app/out/preload/index.js',
        error: 'Cannot find module electron-store'
      }
    )
  })

  it('survives a preload-error without an error object', () => {
    const fake = createFakeWindow()
    handlers.registerWindowErrorSignals(fake.window)

    expect(() =>
      fake.emitWebContents('preload-error', {}, '/app/out/preload/index.js', undefined)
    ).not.toThrow()
    const context = vi.mocked(logger.error).mock.calls[0][2] as { error: string }
    expect(context.error).toBe('')
  })

  it('uses distinct greppable tags for the two signals', () => {
    const fake = createFakeWindow()
    handlers.registerWindowErrorSignals(fake.window)

    fake.emitWebContents('console-message', consoleMessage('error'))
    fake.emitWebContents('preload-error', {}, '/app/out/preload/index.js', new Error('nope'))

    const [consoleTag] = vi.mocked(logger.error).mock.calls[0]
    const [preloadTag] = vi.mocked(logger.error).mock.calls[1]
    expect(consoleTag).not.toBe(preloadTag)
  })

  it('does not reload, destroy, close or crash anything (log-only)', () => {
    const fake = createFakeWindow()
    handlers.registerWindowErrorSignals(fake.window)

    fake.emitWebContents('console-message', consoleMessage('error'))
    fake.emitWebContents('preload-error', {}, '/app/out/preload/index.js', new Error('nope'))

    expect(fake.spies.reload).not.toHaveBeenCalled()
    expect(fake.spies.destroy).not.toHaveBeenCalled()
    expect(fake.spies.close).not.toHaveBeenCalled()
    expect(fake.spies.webContentsReload).not.toHaveBeenCalled()
    expect(fake.spies.webContentsForcefullyCrashRenderer).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
    expect(app.exit).not.toHaveBeenCalled()
    expect(app.relaunch).not.toHaveBeenCalled()
  })

  it('keeps per-window ids independent when two windows are observed', () => {
    const first = createFakeWindow()
    const second = createFakeWindow()
    ;(second.window as unknown as { id: number }).id = 99

    handlers.registerWindowErrorSignals(first.window)
    handlers.registerWindowErrorSignals(second.window)
    second.emitWebContents('console-message', consoleMessage('error'))

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.error).mock.calls[0][2]).toMatchObject({ windowId: 99 })
  })

  describe('console-error rate cap', () => {
    // Mirror the module's own constants; a change there should fail here loudly
    // rather than silently retune the assertions.
    const MAX_PER_WINDOW = 20
    const WINDOW_MS = 10_000
    const SUPPRESSED_TAG = '[crash] renderer-console-error suppressed'

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    /** Emits `count` error-level console messages on `fake`. */
    function burst(fake: FakeWindow, count: number, message = 'boom'): void {
      for (let index = 0; index < count; index += 1) {
        fake.emitWebContents('console-message', consoleMessage('error', { message }))
      }
    }

    /** Every `logger.error` call whose message is the suppression summary. */
    function summaryCalls(): unknown[][] {
      return vi.mocked(logger.error).mock.calls.filter(([message]) => message === SUPPRESSED_TAG)
    }

    it('stops an error loop from filling the log rotation', () => {
      const fake = createFakeWindow()
      handlers.registerWindowErrorSignals(fake.window)

      burst(fake, 500)

      expect(logger.error).toHaveBeenCalledTimes(MAX_PER_WINDOW)
    })

    it('reports the dropped records in exactly one summary line', () => {
      const fake = createFakeWindow()
      handlers.registerWindowErrorSignals(fake.window)

      burst(fake, 500)
      expect(summaryCalls()).toHaveLength(0)

      vi.advanceTimersByTime(WINDOW_MS)

      expect(summaryCalls()).toHaveLength(1)
      expect(summaryCalls()[0][2]).toEqual({
        windowId: WINDOW_ID,
        suppressed: 500 - MAX_PER_WINDOW,
        windowMs: WINDOW_MS
      })
    })

    it('writes no summary when the cap was never reached', () => {
      const fake = createFakeWindow()
      handlers.registerWindowErrorSignals(fake.window)

      burst(fake, 3)
      vi.advanceTimersByTime(WINDOW_MS)

      expect(logger.error).toHaveBeenCalledTimes(3)
    })

    it('logs a distinct later error once the window has drained', () => {
      // The cap must not be a permanent mute: the error AFTER the loop is
      // usually the one that explains it.
      const fake = createFakeWindow()
      handlers.registerWindowErrorSignals(fake.window)

      burst(fake, 500)
      vi.advanceTimersByTime(WINDOW_MS)
      vi.mocked(logger.error).mockClear()

      fake.emitWebContents('console-message', consoleMessage('error', { message: 'later boom' }))

      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(vi.mocked(logger.error).mock.calls[0][2]).toMatchObject({ message: 'later boom' })
    })

    it('counts each window separately', () => {
      const first = createFakeWindow()
      const second = createFakeWindow()
      ;(second.window as unknown as { id: number }).id = 99

      handlers.registerWindowErrorSignals(first.window)
      handlers.registerWindowErrorSignals(second.window)

      burst(first, 500)
      vi.mocked(logger.error).mockClear()
      second.emitWebContents('console-message', consoleMessage('error'))

      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(vi.mocked(logger.error).mock.calls[0][2]).toMatchObject({ windowId: 99 })
    })

    it('leaves the preload-error signal uncapped', () => {
      // A preload failure fires at most once per load; capping it would only
      // risk dropping the one record that explains a blank window.
      const fake = createFakeWindow()
      handlers.registerWindowErrorSignals(fake.window)

      burst(fake, 500)
      vi.mocked(logger.error).mockClear()
      fake.emitWebContents('preload-error', {}, '/app/out/preload/index.js', new Error('nope'))

      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(vi.mocked(logger.error).mock.calls[0][0]).toContain('preload-error')
    })
  })
})
