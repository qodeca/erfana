// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The global IPC registration gate (sd-074b §7, revised).
 *
 * This is where the sender check is actually proven. Every other handler suite
 * runs with `isTrustedAppSender` stubbed true by `setupTests.main.ts`, so that
 * they can drive their channels with a stand-in event; this file opts out and
 * drives the real predicate.
 *
 * The three defects that killed the previous monkey-patch approach each have a
 * test here, so the replacement cannot quietly reacquire them:
 *
 *  - removal by identity actually removes (F6)
 *  - every registration verb is gated, with none reachable by an alias (F7)
 *  - a rejected one-shot message does not consume the registration
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

// The gate is the subject; use the genuine predicates, not the global stub.
vi.unmock('./senderValidation')

/**
 * All mock state lives in `vi.hoisted` because `vi.mock` factories are hoisted
 * above every module-level `const` — referencing one from a factory throws
 * "Cannot access before initialization".
 *
 * The stand-in keeps REAL reference-equality removal semantics, which is the
 * property the wrapped-singleton approach silently broke.
 */
const { handlers, listeners, mockIpcMain, mockIs, mockLogger } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  return {
    handlers,
    listeners,
    mockIpcMain: {
      handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      }),
      on: vi.fn((channel: string, fn: (...args: unknown[]) => void) => {
        const list = listeners.get(channel) ?? []
        list.push(fn)
        listeners.set(channel, list)
      }),
      removeListener: vi.fn((channel: string, fn: (...args: unknown[]) => void) => {
        const list = listeners.get(channel) ?? []
        const index = list.indexOf(fn)
        if (index !== -1) list.splice(index, 1)
        listeners.set(channel, list)
      })
    },
    mockIs: { dev: false },
    mockLogger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn()
    }
  }
})

vi.mock('electron', () => ({ ipcMain: mockIpcMain }))
vi.mock('@electron-toolkit/utils', () => ({ is: mockIs }))
vi.mock('../services/LoggingService', () => ({ logger: mockLogger }))

import {
  registerHandle,
  registerHandleOnce,
  registerOn,
  registerOnce,
  unregisterHandle,
  unregisterOn
} from './registry'

/** Same derivation `senderValidation.ts` uses for the production trust pin. */
const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href

function event(frame: { url: string; parent: unknown } | null): IpcMainInvokeEvent & IpcMainEvent {
  return { senderFrame: frame } as unknown as IpcMainInvokeEvent & IpcMainEvent
}

const TRUSTED = event({ url: RENDERER_FILE_URL, parent: null })
const FOREIGN = event({ url: 'https://evil.example/', parent: null })
const SUB_FRAME = event({ url: RENDERER_FILE_URL, parent: {} })
const NO_FRAME = event(null)
/** Our own entry on a route hash — the screenshot overlay's real shape. */
const HASHED = event({ url: `${RENDERER_FILE_URL}#/overlay`, parent: null })

/** Drive the single listener registered on a `send` channel. */
function send(channel: string, evt: IpcMainEvent, ...args: unknown[]): void {
  for (const fn of listeners.get(channel) ?? []) fn(evt, ...args)
}

beforeEach(() => {
  handlers.clear()
  listeners.clear()
  vi.clearAllMocks()
  mockIs.dev = false
})

describe('registerHandle', () => {
  it('runs the listener for the app renderer', () => {
    const listener = vi.fn(() => 'ok')
    registerHandle('c', listener)
    expect(handlers.get('c')!(TRUSTED, 1)).toBe('ok')
    expect(listener).toHaveBeenCalledWith(TRUSTED, 1)
  })

  it('accepts our own entry on a route hash', () => {
    const listener = vi.fn(() => 'ok')
    registerHandle('c', listener)
    expect(handlers.get('c')!(HASHED)).toBe('ok')
  })

  it.each([
    ['a foreign origin', () => FOREIGN],
    ['a sub-frame', () => SUB_FRAME],
    ['no sender frame', () => NO_FRAME]
  ])('throws for %s and never runs the listener', (_label, make) => {
    const listener = vi.fn()
    registerHandle('c', listener)
    expect(() => handlers.get('c')!(make())).toThrow(/Untrusted sender/)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('registerOn', () => {
  it('runs the listener for the app renderer', () => {
    const listener = vi.fn()
    registerOn('c', listener)
    send('c', TRUSTED, 'payload')
    expect(listener).toHaveBeenCalledWith(TRUSTED, 'payload')
  })

  it.each([
    ['a foreign origin', () => FOREIGN],
    ['a sub-frame', () => SUB_FRAME],
    ['no sender frame', () => NO_FRAME]
  ])('drops %s silently — a send channel has no reply path', (_label, make) => {
    const listener = vi.fn()
    registerOn('c', listener)
    expect(() => send('c', make())).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })
})

/**
 * F6. The previous approach registered a different closure than the caller
 * held, so `removeListener` matched nothing and removed nothing — silently,
 * because a missed removal on an EventEmitter is a no-op rather than an error.
 */
describe('unregisterOn', () => {
  it('actually removes the listener that was registered', () => {
    const listener = vi.fn()
    registerOn('c', listener)
    send('c', TRUSTED)
    expect(listener).toHaveBeenCalledTimes(1)

    unregisterOn('c', listener)
    send('c', TRUSTED)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listeners.get('c')).toHaveLength(0)
  })

  it('removes only the named listener, leaving siblings on the channel', () => {
    const a = vi.fn()
    const b = vi.fn()
    registerOn('c', a)
    registerOn('c', b)

    unregisterOn('c', a)
    send('c', TRUSTED)

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for a listener that was never registered', () => {
    expect(() => unregisterOn('c', vi.fn())).not.toThrow()
  })
})

/**
 * A rejected message must not consume a one-shot registration. Building these
 * on `handleOnce` / `once` would let a single untrusted message permanently
 * disable the channel for the legitimate caller.
 */
describe('one-shot registrations', () => {
  it('keeps the handler registered after a rejected invoke', () => {
    const listener = vi.fn(() => 'ok')
    registerHandleOnce('c', listener)

    expect(() => handlers.get('c')!(FOREIGN)).toThrow(/Untrusted sender/)
    expect(handlers.has('c')).toBe(true)

    expect(handlers.get('c')!(TRUSTED)).toBe('ok')
    expect(handlers.has('c')).toBe(false)
  })

  it('keeps the listener registered after a rejected send', () => {
    const listener = vi.fn()
    registerOnce('c', listener)

    send('c', FOREIGN)
    expect(listener).not.toHaveBeenCalled()
    expect(listeners.get('c')).toHaveLength(1)

    send('c', TRUSTED)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listeners.get('c')).toHaveLength(0)

    send('c', TRUSTED)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('unregisterHandle', () => {
  it('removes the handler', () => {
    registerHandle('c', vi.fn())
    unregisterHandle('c')
    expect(handlers.has('c')).toBe(false)
  })
})

describe('rejection logging', () => {
  it('records the sender origin only, never the path or query', () => {
    registerHandle('c', vi.fn())
    expect(() =>
      handlers.get('c')!(event({ url: 'https://evil.example/a/secret?token=abc', parent: null }))
    ).toThrow()

    const logged = JSON.stringify(mockLogger.warn.mock.calls)
    expect(logged).toContain('https://evil.example')
    expect(logged).not.toContain('secret')
    expect(logged).not.toContain('abc')
  })

  it('survives a sender whose URL does not parse', () => {
    registerHandle('c', vi.fn())
    expect(() => handlers.get('c')!(event({ url: 'not a url', parent: null }))).toThrow()
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('names the channel, so a rejection can be traced', () => {
    registerHandle('some:channel', vi.fn())
    expect(() => handlers.get('some:channel')!(FOREIGN)).toThrow()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ channel: 'some:channel' })
    )
  })
})
