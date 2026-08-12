// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the global error trail.
 *
 * The module keeps install state in a module-level flag, so every test starts
 * from `vi.resetModules()` + a fresh dynamic import. Asserting idempotence
 * against a module that was already installed by a previous test would prove
 * nothing.
 *
 * @see docs/design/design-issue-60.md §5 (`installGlobalErrorTrail` row)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from './logger'

vi.mock('./logger', () => ({
  logger: {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn()
  }
}))

/** Import a pristine copy of the module (install state reset). */
async function freshTrail(): Promise<typeof import('./installGlobalErrorTrail')> {
  vi.resetModules()
  return import('./installGlobalErrorTrail')
}

/**
 * Dispatch a `window` error event carrying a real Error.
 *
 * jsdom's ErrorEvent constructor supports `error`, `filename`, `lineno` and
 * `colno`, which is exactly the payload the handler reads.
 */
function dispatchErrorEvent(error: unknown): void {
  window.dispatchEvent(
    new ErrorEvent('error', {
      error,
      message: 'uncaught',
      filename: 'renderer.js',
      lineno: 12,
      colno: 34
    })
  )
}

/**
 * Dispatch an `unhandledrejection` event.
 *
 * jsdom does not implement `PromiseRejectionEvent`, so a plain `Event` with the
 * `reason` property attached is used — the handler only reads `event.reason`.
 */
function dispatchRejectionEvent(reason: unknown): void {
  const event = new Event('unhandledrejection') as Event & { reason: unknown }
  event.reason = reason
  window.dispatchEvent(event)
}

describe('installGlobalErrorTrail', () => {
  let installed: Array<() => void>
  /** The listeners the module registered, by event type. */
  let listeners: Map<string, (event: Event) => void>

  beforeEach(() => {
    vi.resetAllMocks()
    installed = []
    listeners = new Map()
  })

  afterEach(() => {
    for (const remove of installed) remove()
  })

  /** Install the trail, capture its listeners, and register their teardown. */
  async function install(): Promise<typeof import('./installGlobalErrorTrail')> {
    const module = await freshTrail()
    const addSpy = vi.spyOn(window, 'addEventListener')
    module.installGlobalErrorTrail()
    const registered = addSpy.mock.calls.map(
      ([type, listener]) => () => window.removeEventListener(type as string, listener as never)
    )
    for (const [type, listener] of addSpy.mock.calls) {
      if (typeof listener === 'function') {
        listeners.set(type as string, listener as (event: Event) => void)
      }
    }
    addSpy.mockRestore()
    installed.push(...registered)
    return module
  }

  describe('uncaught errors', () => {
    it('records a fatal line in the boundary payload shape', async () => {
      const { GLOBAL_ERROR_LOG_MESSAGE } = await install()

      dispatchErrorEvent(new TypeError('async boom'))

      expect(logger.fatal).toHaveBeenCalledTimes(1)
      expect(logger.fatal).toHaveBeenCalledWith(
        GLOBAL_ERROR_LOG_MESSAGE,
        expect.any(TypeError),
        expect.objectContaining({
          // Same keys the boundary logs, so one grep finds both.
          componentStack: '',
          appVersion: '0.0.0-test',
          errorName: 'TypeError',
          stackTruncated: false,
          filename: 'renderer.js',
          lineno: 12,
          colno: 34
        })
      )
    })

    it('survives an event with no Error object (cross-origin script)', async () => {
      await install()

      expect(() => dispatchErrorEvent(undefined)).not.toThrow()
      expect(logger.fatal).toHaveBeenCalledTimes(1)
    })

    it('does not rethrow when the logger itself fails', async () => {
      await install()
      vi.mocked(logger.fatal).mockImplementation(() => {
        throw new Error('logger exploded')
      })

      // The listener is invoked DIRECTLY, not via `dispatchEvent`: per the DOM
      // spec a listener's exception is reported, never propagated to the
      // dispatcher, so `expect(() => dispatch(…)).not.toThrow()` passes even
      // for a completely unguarded handler — it asserts nothing.
      const onError = listeners.get('error')
      expect(onError, 'the error listener was not captured').toBeTypeOf('function')

      // A throwing global handler becomes an uncaught error itself, which is
      // how a logging path turns into a crash loop.
      expect(() =>
        onError!(new ErrorEvent('error', { error: new Error('boom'), message: 'uncaught' }))
      ).not.toThrow()
      expect(logger.fatal).toHaveBeenCalledTimes(1)
    })
  })

  describe('unhandled rejections', () => {
    it('records a fatal line in the boundary payload shape', async () => {
      const { GLOBAL_REJECTION_LOG_MESSAGE } = await install()

      dispatchRejectionEvent(new RangeError('rejected'))

      expect(logger.fatal).toHaveBeenCalledTimes(1)
      expect(logger.fatal).toHaveBeenCalledWith(
        GLOBAL_REJECTION_LOG_MESSAGE,
        expect.any(RangeError),
        expect.objectContaining({
          componentStack: '',
          appVersion: '0.0.0-test',
          errorName: 'RangeError'
        })
      )
    })

    it('coerces a non-Error rejection reason', async () => {
      await install()

      dispatchRejectionEvent('string rejection')

      const [, error] = vi.mocked(logger.fatal).mock.calls[0]
      expect((error as Error).name).toBe('NonError')
      expect((error as Error).message).toBe('string rejection')
    })
  })

  describe('idempotence', () => {
    it('registers one listener per event type however often it is called', async () => {
      const module = await freshTrail()
      const addSpy = vi.spyOn(window, 'addEventListener')

      module.installGlobalErrorTrail()
      module.installGlobalErrorTrail()
      module.installGlobalErrorTrail()

      const types = addSpy.mock.calls.map(([type]) => type)
      expect(types).toEqual(['error', 'unhandledrejection'])

      installed.push(
        ...addSpy.mock.calls.map(
          ([type, listener]) => () => window.removeEventListener(type as string, listener as never)
        )
      )
      addSpy.mockRestore()
    })

    it('logs one record per event after repeated installs', async () => {
      const module = await install()
      module.installGlobalErrorTrail()

      dispatchErrorEvent(new Error('once'))

      expect(logger.fatal).toHaveBeenCalledTimes(1)
    })
  })

  describe('scope', () => {
    it('stays silent until an event actually reaches window', async () => {
      // A boundary-caught error never reaches `window` in a production build,
      // so the boundary's own record is not duplicated here.
      await install()
      expect(logger.fatal).not.toHaveBeenCalled()
    })
  })
})
