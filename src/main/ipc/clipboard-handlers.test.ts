// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Clipboard IPC Handlers (main)
 *
 * Covers: handler registration, success path, sender validation (untrusted →
 * safe value + logger.warn), Zod rejection of non-string / oversize payloads,
 * and electron-clipboard throw → safe value + logger.error.
 *
 * @see Issue #203 - Central text-clipboard service
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { IpcMainInvokeEvent } from 'electron'
import { CLIPBOARD_CHANNELS } from '../../shared/ipc/clipboard-channels'
import { CLIPBOARD_MAX_TEXT_LENGTH } from '../../shared/ipc/clipboard-schema'

// =============================================================================
// Mock electron (clipboard + ipcMain.handle capture)
// =============================================================================

const mockIpcMainHandle = vi.fn()
const mockClipboardReadText = vi.fn()
const mockClipboardWriteText = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle
  },
  clipboard: {
    readText: () => mockClipboardReadText(),
    writeText: (text: string) => mockClipboardWriteText(text)
  }
}))

// =============================================================================
// Mock @electron-toolkit/utils (controllable `is.dev`, mirroring index.ts)
// =============================================================================

const mockIs = { dev: false }
vi.mock('@electron-toolkit/utils', () => ({
  is: mockIs
}))

// The handler pins production trust to the exact bundled renderer file URL,
// derived the same way index.ts loads it (relative to the main __dirname).
const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href

// =============================================================================
// Mock LoggingService
// =============================================================================

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}

vi.mock('../services/LoggingService', () => ({
  logger: mockLogger
}))

// =============================================================================
// Helpers
// =============================================================================

/** Build a mock invoke event with a given sender frame shape. */
function makeEvent(frame: { url: string; parent: unknown } | null): IpcMainInvokeEvent {
  return { senderFrame: frame } as unknown as IpcMainInvokeEvent
}

const TRUSTED_FRAME = { url: RENDERER_FILE_URL, parent: null }

/** Register handlers and return the captured handler fn for a channel. */
async function getHandler(channel: string): Promise<(...args: unknown[]) => Promise<unknown>> {
  const { registerClipboardHandlers } = await import('./clipboard-handlers')
  registerClipboardHandlers()
  const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === channel)?.[1]
  expect(handler).toBeDefined()
  return handler as (...args: unknown[]) => Promise<unknown>
}

// =============================================================================
// Tests
// =============================================================================

describe('clipboard-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    delete process.env['ELECTRON_RENDERER_URL']
    mockIs.dev = false
    mockClipboardReadText.mockReturnValue('clipboard text')
    mockClipboardWriteText.mockReturnValue(undefined)
  })

  describe('registration', () => {
    it('registers both clipboard handlers and logs the registration', async () => {
      const { registerClipboardHandlers } = await import('./clipboard-handlers')
      registerClipboardHandlers()

      expect(mockIpcMainHandle).toHaveBeenCalledWith(
        CLIPBOARD_CHANNELS.readText,
        expect.any(Function)
      )
      expect(mockIpcMainHandle).toHaveBeenCalledWith(
        CLIPBOARD_CHANNELS.writeText,
        expect.any(Function)
      )
      expect(mockLogger.info).toHaveBeenCalledWith('✅ Clipboard IPC handlers registered')
    })
  })

  describe('readText', () => {
    it('returns clipboard text for a trusted sender', async () => {
      const handler = await getHandler(CLIPBOARD_CHANNELS.readText)

      const result = await handler(makeEvent(TRUSTED_FRAME))

      expect(result).toBe('clipboard text')
      expect(mockClipboardReadText).toHaveBeenCalledTimes(1)
    })

    it('accepts the dev renderer origin only when is.dev && ELECTRON_RENDERER_URL', async () => {
      mockIs.dev = true
      process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
      const handler = await getHandler(CLIPBOARD_CHANNELS.readText)

      const result = await handler(
        makeEvent({ url: 'http://localhost:5173/index.html', parent: null })
      )

      expect(result).toBe('clipboard text')
    })

    it("rejects the dev origin when ELECTRON_RENDERER_URL is set but is.dev is false", async () => {
      // Mirrors index.ts: a production build never loads the dev URL even if the
      // env var leaks in, so the dev trust branch must be unreachable there.
      mockIs.dev = false
      process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
      const handler = await getHandler(CLIPBOARD_CHANNELS.readText)

      const result = await handler(
        makeEvent({ url: 'http://localhost:5173/index.html', parent: null })
      )

      expect(result).toBe('')
      expect(mockClipboardReadText).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)
      // Assert the read-branch identifier so the read/write rejection branches
      // cannot collapse into one in a future refactor.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rejected clipboard:readText from untrusted sender',
        expect.objectContaining({ url: 'http://localhost:5173/index.html' })
      )
    })

    it("returns '' and warns for an untrusted (sub-frame) sender", async () => {
      const handler = await getHandler(CLIPBOARD_CHANNELS.readText)

      const result = await handler(makeEvent({ url: RENDERER_FILE_URL, parent: {} }))

      expect(result).toBe('')
      expect(mockClipboardReadText).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rejected clipboard:readText from untrusted sender',
        expect.objectContaining({ url: RENDERER_FILE_URL })
      )
    })

    it("returns '' and warns for a foreign origin sender", async () => {
      const handler = await getHandler(CLIPBOARD_CHANNELS.readText)

      const result = await handler(makeEvent({ url: 'https://evil.example/', parent: null }))

      expect(result).toBe('')
      expect(mockClipboardReadText).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rejected clipboard:readText from untrusted sender',
        expect.objectContaining({ url: 'https://evil.example/' })
      )
    })

    it("returns '' and warns for a non-bundled file:// URL (unanchored file path)", async () => {
      // Any other file:// origin (e.g. a foreign local HTML file) is rejected;
      // only the exact bundled renderer URL is trusted.
      const handler = await getHandler(CLIPBOARD_CHANNELS.readText)

      const result = await handler(
        makeEvent({ url: 'file:///tmp/evil/index.html', parent: null })
      )

      expect(result).toBe('')
      expect(mockClipboardReadText).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rejected clipboard:readText from untrusted sender',
        expect.objectContaining({ url: 'file:///tmp/evil/index.html' })
      )
    })

    it('truncates an oversize clipboard read to the max length', async () => {
      mockClipboardReadText.mockReturnValue('y'.repeat(CLIPBOARD_MAX_TEXT_LENGTH + 100))
      const handler = await getHandler(CLIPBOARD_CHANNELS.readText)

      const result = (await handler(makeEvent(TRUSTED_FRAME))) as string

      expect(result.length).toBe(CLIPBOARD_MAX_TEXT_LENGTH)
    })

    it("returns '' and logs error when clipboard.readText throws", async () => {
      mockClipboardReadText.mockImplementation(() => {
        throw new Error('clipboard locked')
      })
      const handler = await getHandler(CLIPBOARD_CHANNELS.readText)

      const result = await handler(makeEvent(TRUSTED_FRAME))

      expect(result).toBe('')
      expect(mockLogger.error).toHaveBeenCalledTimes(1)
    })
  })

  describe('writeText', () => {
    it('writes and returns true for a valid payload from a trusted sender', async () => {
      const handler = await getHandler(CLIPBOARD_CHANNELS.writeText)

      const result = await handler(makeEvent(TRUSTED_FRAME), 'hello')

      expect(result).toBe(true)
      expect(mockClipboardWriteText).toHaveBeenCalledWith('hello')
    })

    it('returns false and warns for an untrusted sender (no clipboard write)', async () => {
      const handler = await getHandler(CLIPBOARD_CHANNELS.writeText)

      const result = await handler(makeEvent({ url: 'https://evil.example/', parent: null }), 'x')

      expect(result).toBe(false)
      expect(mockClipboardWriteText).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)
      // Distinct write-branch identifier (vs the invalid-payload branch below).
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rejected clipboard:writeText from untrusted sender',
        expect.objectContaining({ url: 'https://evil.example/' })
      )
    })

    it('returns false and warns when payload is not a string', async () => {
      const handler = await getHandler(CLIPBOARD_CHANNELS.writeText)

      const result = await handler(makeEvent(TRUSTED_FRAME), 12345)

      expect(result).toBe(false)
      expect(mockClipboardWriteText).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)
      // The invalid-payload branch is distinct from the untrusted-sender branch.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rejected clipboard:writeText with invalid payload',
        expect.objectContaining({ error: expect.any(String) })
      )
    })

    it('returns false and warns when payload exceeds the max length', async () => {
      const handler = await getHandler(CLIPBOARD_CHANNELS.writeText)
      const oversize = 'a'.repeat(CLIPBOARD_MAX_TEXT_LENGTH + 1)

      const result = await handler(makeEvent(TRUSTED_FRAME), oversize)

      expect(result).toBe(false)
      expect(mockClipboardWriteText).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rejected clipboard:writeText with invalid payload',
        expect.objectContaining({ error: expect.any(String) })
      )
    })

    it('returns false and logs error when clipboard.writeText throws', async () => {
      mockClipboardWriteText.mockImplementation(() => {
        throw new Error('clipboard locked')
      })
      const handler = await getHandler(CLIPBOARD_CHANNELS.writeText)

      const result = await handler(makeEvent(TRUSTED_FRAME), 'hello')

      expect(result).toBe(false)
      expect(mockLogger.error).toHaveBeenCalledTimes(1)
    })
  })
})
