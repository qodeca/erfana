// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the process-wide IPC sender gate (sd-074b §7, phase 0).
 *
 * Covers: install-once, all four registration verbs wrapped, trusted sender
 * reaches the listener, untrusted sender is rejected (invoke throws, send is
 * dropped), the screenshot-overlay route hash is accepted, sub-frames are
 * rejected, and uninstall restores the originals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

// =============================================================================
// Mock electron — a minimal ipcMain whose four verbs capture their listener
// =============================================================================

// `vi.hoisted` is required here: this suite imports `ipcMain` itself, so the
// static import runs before plain top-level consts would be initialised.
const { captured, mockIpcMain, mockIs, mockLogger } = vi.hoisted(() => {
  const capturedListeners = new Map<string, (...args: never[]) => unknown>()
  const makeVerb =
    () =>
    (channel: string, listener: (...args: never[]) => unknown): undefined => {
      capturedListeners.set(channel, listener)
      return undefined
    }

  return {
    captured: capturedListeners,
    mockIpcMain: {
      handle: makeVerb(),
      handleOnce: makeVerb(),
      on: makeVerb(),
      once: makeVerb()
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

import { ipcMain } from 'electron'
import { installIpcSenderGate, uninstallIpcSenderGate } from './ipcSenderGate'

/** The exact URL the production window loads, derived as index.ts derives it. */
const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href

/** Build an event whose top-level frame reports `url`. */
function eventFrom(url: string): IpcMainInvokeEvent & IpcMainEvent {
  return {
    senderFrame: { url, parent: null }
  } as unknown as IpcMainInvokeEvent & IpcMainEvent
}

/** Build an event coming from a sub-frame (never trusted). */
function subFrameEvent(url: string): IpcMainInvokeEvent & IpcMainEvent {
  return {
    senderFrame: { url, parent: { url } }
  } as unknown as IpcMainInvokeEvent & IpcMainEvent
}

describe('ipcSenderGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.clear()
    mockIs.dev = false
  })

  afterEach(() => {
    uninstallIpcSenderGate()
  })

  describe('installation', () => {
    it('wraps all four registration verbs', () => {
      const before = {
        handle: ipcMain.handle,
        handleOnce: ipcMain.handleOnce,
        on: ipcMain.on,
        once: ipcMain.once
      }

      installIpcSenderGate()

      expect(ipcMain.handle).not.toBe(before.handle)
      expect(ipcMain.handleOnce).not.toBe(before.handleOnce)
      expect(ipcMain.on).not.toBe(before.on)
      expect(ipcMain.once).not.toBe(before.once)
    })

    it('is idempotent — a second install does not double-wrap', () => {
      installIpcSenderGate()
      const afterFirst = ipcMain.handle

      installIpcSenderGate()

      expect(ipcMain.handle).toBe(afterFirst)
    })

    it('restores the originals on uninstall', () => {
      const original = ipcMain.handle

      installIpcSenderGate()
      uninstallIpcSenderGate()

      expect(ipcMain.handle).toBe(original)
    })
  })

  describe('invoke channels (ipcMain.handle)', () => {
    it('passes a trusted sender through to the listener', async () => {
      installIpcSenderGate()
      const listener = vi.fn().mockReturnValue('ok')
      ipcMain.handle('test:channel', listener)

      const wrapped = captured.get('test:channel')!
      const result = await (wrapped as (e: unknown, ...a: unknown[]) => unknown)(
        eventFrom(RENDERER_FILE_URL),
        'arg'
      )

      expect(result).toBe('ok')
      expect(listener).toHaveBeenCalledWith(expect.anything(), 'arg')
    })

    it('throws for an untrusted sender and never calls the listener', () => {
      installIpcSenderGate()
      const listener = vi.fn()
      ipcMain.handle('test:channel', listener)

      const wrapped = captured.get('test:channel')! as (e: unknown) => unknown

      expect(() => wrapped(eventFrom('erfana-preview://abc/page.html'))).toThrow(
        /Untrusted sender for IPC channel "test:channel"/
      )
      expect(listener).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rejected IPC from untrusted sender',
        expect.objectContaining({ channel: 'test:channel' })
      )
    })

    it('rejects a sub-frame even at the renderer URL', () => {
      installIpcSenderGate()
      const listener = vi.fn()
      ipcMain.handle('test:channel', listener)

      const wrapped = captured.get('test:channel')! as (e: unknown) => unknown

      expect(() => wrapped(subFrameEvent(RENDERER_FILE_URL))).toThrow()
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('send channels (ipcMain.on)', () => {
    it('passes a trusted sender through', () => {
      installIpcSenderGate()
      const listener = vi.fn()
      ipcMain.on('test:send', listener)

      const wrapped = captured.get('test:send')! as (e: unknown, ...a: unknown[]) => void
      wrapped(eventFrom(RENDERER_FILE_URL), 'payload')

      expect(listener).toHaveBeenCalledWith(expect.anything(), 'payload')
    })

    it('drops an untrusted sender silently — no throw, no listener call', () => {
      installIpcSenderGate()
      const listener = vi.fn()
      ipcMain.on('test:send', listener)

      const wrapped = captured.get('test:send')! as (e: unknown) => void

      expect(() => wrapped(eventFrom('file:///tmp/evil.html'))).not.toThrow()
      expect(listener).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('accepts the screenshot-overlay route hash on the same bundled entry', () => {
      // ScreenshotOverlayWindow loads index.html with a route hash and its
      // preload sends `logging:log` over the GLOBAL channel. Exact-URL equality
      // would silently drop every overlay log line.
      installIpcSenderGate()
      const listener = vi.fn()
      ipcMain.on('logging:log', listener)

      const wrapped = captured.get('logging:log')! as (e: unknown) => void
      wrapped(eventFrom(`${RENDERER_FILE_URL}#/screenshot-overlay?display=1`))

      expect(listener).toHaveBeenCalled()
    })
  })

  describe('development mode', () => {
    it('accepts the dev server origin and rejects any other origin', () => {
      mockIs.dev = true
      process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
      installIpcSenderGate()
      const listener = vi.fn()
      ipcMain.on('test:send', listener)

      const wrapped = captured.get('test:send')! as (e: unknown) => void
      wrapped(eventFrom('http://localhost:5173/index.html'))
      expect(listener).toHaveBeenCalledTimes(1)

      wrapped(eventFrom('http://evil.example/index.html'))
      expect(listener).toHaveBeenCalledTimes(1)

      delete process.env['ELECTRON_RENDERER_URL']
    })
  })
})
