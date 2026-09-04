// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the image-export IPC handler.
 *
 * The gate order is the whole point of this file: an untrusted sender must be
 * refused BEFORE the payload is parsed and before the service is reached, so a
 * rejected request can never open a save dialog, read a file or touch the
 * clipboard. The parent-window resolution is pinned too — it comes from
 * `event.sender`, never from the renderer.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { IpcMainInvokeEvent } from 'electron'
import { ErrorCode, ERROR_MESSAGES } from '../../shared/errors'
import { IMAGE_EXPORT_CHANNELS } from '../../shared/ipc/image-export-channels'

const mockIpcMainHandle = vi.fn()
const mockFromWebContents = vi.fn()
// This suite exercises the REAL sender predicates: it asserts that an untrusted
// frame is refused, which is the whole point of the file. `setupTests.main.ts`
// stubs them true by default so the other handler suites can drive their
// channels with a stand-in event; opt out here.
vi.unmock('./senderValidation')

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mockIpcMainHandle(...args) },
  BrowserWindow: { fromWebContents: (...args: unknown[]) => mockFromWebContents(...args) }
}))

const mockIs = { dev: false }
vi.mock('@electron-toolkit/utils', () => ({ is: mockIs }))

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}
vi.mock('../services/LoggingService', () => ({ logger: mockLogger }))

const mockRun = vi.fn()
vi.mock('../services/imageExport/ImageExportService', () => ({
  imageExportService: { run: (...args: unknown[]) => mockRun(...args) }
}))

/** Same derivation `senderValidation.ts` uses for the production trust pin. */
const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href
const TRUSTED_FRAME = { url: RENDERER_FILE_URL, parent: null }
const SENDER = { id: 7 }

function makeEvent(frame: { url: string; parent: unknown } | null): IpcMainInvokeEvent {
  return { senderFrame: frame, sender: SENDER } as unknown as IpcMainInvokeEvent
}

/** Register the handlers and return the captured `image-export:run` handler. */
async function getHandler(): Promise<(...args: unknown[]) => Promise<unknown>> {
  const { registerImageExportHandlers } = await import('./image-export-handlers')
  registerImageExportHandlers()
  const entry = mockIpcMainHandle.mock.calls.find(
    (call) => call[0] === IMAGE_EXPORT_CHANNELS.RUN
  )
  return entry![1]
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mockIs.dev = false
  mockRun.mockResolvedValue({ success: true, target: 'png', output: { width: 1, height: 1 } })
})

/**
 * Two gates now stand in front of this handler, and the OUTER one fires first.
 *
 * `src/main/ipc/registry.ts` checks the sender for every global channel and
 * THROWS on refusal, so the renderer's `invoke` promise rejects rather than
 * resolving with a structured error. That is a deliberate behaviour change from
 * the era when only this handler's own `isTrustedSender` call stood here: an
 * untrusted caller now gets nothing back to parse.
 *
 * The handler's own check is kept as defence in depth and is exercised below by
 * driving the inner function directly.
 */
describe('image-export:run — trust gate', () => {
  it('rejects an untrusted sender and NEVER calls the service', async () => {
    const handler = await getHandler()
    expect(() => handler(makeEvent({ url: 'https://evil.example.com', parent: null }), {
        filePath: '/p/a.png',
        target: 'png'
      })).toThrow(/Untrusted sender/)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('rejects a sub-frame', async () => {
    const handler = await getHandler()
    expect(() => handler(makeEvent({ url: RENDERER_FILE_URL, parent: {} }), {
        filePath: '/p/a.png',
        target: 'png'
      })).toThrow(/Untrusted sender/)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('rejects an event with no sender frame at all', async () => {
    const handler = await getHandler()
    expect(() => handler(makeEvent(null), { filePath: '/p/a.png', target: 'png' })).toThrow(/Untrusted sender/)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('runs the trust gate BEFORE the schema, so a bad sender never reaches Zod', async () => {
    const handler = await getHandler()
    // The payload is invalid too; the refusal must still be about the sender,
    // and the "invalid payload" warning must not have been logged.
    expect(() => handler(makeEvent({ url: 'https://evil.example.com', parent: null }), { nope: true })).toThrow(/Untrusted sender/)
    const warnings = mockLogger.warn.mock.calls.map((call) => String(call[0]))
    expect(warnings.some((line) => line.includes('invalid payload'))).toBe(false)
  })

  it('logs the refusal with the sender origin only, never the full URL', async () => {
    const handler = await getHandler()
    expect(() => handler(makeEvent({ url: 'https://evil.example.com/a/secret?t=1', parent: null }), {
        filePath: '/p/a.png',
        target: 'png'
      })).toThrow(/Untrusted sender/)

    const logged = JSON.stringify(mockLogger.warn.mock.calls)
    expect(logged).toContain('https://evil.example.com')
    expect(logged).not.toContain('secret')
  })
})

describe('image-export:run — payload validation', () => {
  it.each([
    ['a missing target', { filePath: '/p/a.png' }],
    ['an unknown target', { filePath: '/p/a.png', target: 'tiff' }],
    ['an unsupported extension', { filePath: '/p/notes.md', target: 'png' }],
    ['an empty path', { filePath: '', target: 'png' }],
    ['an extra key', { filePath: '/p/a.png', target: 'png', overwrite: true }],
    ['a non-object payload', 'just a string'],
    ['no payload', undefined]
  ])('rejects %s without calling the service', async (_label, payload) => {
    const handler = await getHandler()
    const response = await handler(makeEvent(TRUSTED_FRAME), payload)
    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_INVALID_REQUEST })
    expect(mockRun).not.toHaveBeenCalled()
  })

  it.each(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])(
    'accepts a %s source',
    async (extension) => {
      const handler = await getHandler()
      await handler(makeEvent(TRUSTED_FRAME), { filePath: `/p/a${extension}`, target: 'png' })
      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: `/p/a${extension}` })
      )
    }
  )

  it('accepts a Windows path', async () => {
    const handler = await getHandler()
    await handler(makeEvent(TRUSTED_FRAME), {
      filePath: 'C:\\Users\\a\\pictures\\shot.PNG',
      target: 'clipboard'
    })
    expect(mockRun).toHaveBeenCalled()
  })

  it('does not log the rejected path — the issue message describes the shape only', async () => {
    const handler = await getHandler()
    await handler(makeEvent(TRUSTED_FRAME), {
      filePath: '/Users/someone/Private Projects/secret.md',
      target: 'png'
    })
    const logged = JSON.stringify(mockLogger.warn.mock.calls)
    expect(logged).not.toContain('Private Projects')
  })
})

describe('image-export:run — delegation', () => {
  it('resolves the parent window from event.sender, never from the payload', async () => {
    const parentWindow = { id: 1 }
    mockFromWebContents.mockReturnValue(parentWindow)
    const handler = await getHandler()
    await handler(makeEvent(TRUSTED_FRAME), { filePath: '/p/a.png', target: 'pdf' })

    expect(mockFromWebContents).toHaveBeenCalledWith(SENDER)
    expect(mockRun).toHaveBeenCalledWith({
      filePath: '/p/a.png',
      target: 'pdf',
      parentWindow
    })
  })

  it('passes a null parent through rather than failing', async () => {
    mockFromWebContents.mockReturnValue(null)
    const handler = await getHandler()
    await handler(makeEvent(TRUSTED_FRAME), { filePath: '/p/a.png', target: 'png' })
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ parentWindow: null }))
  })

  it('returns the service response verbatim on success', async () => {
    const expected = {
      success: true,
      target: 'clipboard',
      output: { width: 32, height: 32 },
      selection: { kind: 'ico-size', width: 32, height: 32, sizeCount: 3 }
    }
    mockRun.mockResolvedValue(expected)
    const handler = await getHandler()
    expect(await handler(makeEvent(TRUSTED_FRAME), { filePath: '/p/a.ico', target: 'clipboard' }))
      .toEqual(expected)
  })

  it('never leaks a raw Node error when the service throws', async () => {
    mockRun.mockRejectedValue(
      new Error("EACCES: permission denied, open '/Users/someone/Private Projects/a.png'")
    )
    const handler = await getHandler()
    const response = await handler(makeEvent(TRUSTED_FRAME), {
      filePath: '/p/a.png',
      target: 'png'
    })

    expect(response).toEqual({
      success: false,
      errorCode: ErrorCode.IMAGE_EXPORT_FAILED,
      error: ERROR_MESSAGES[ErrorCode.IMAGE_EXPORT_FAILED]
    })
    expect(JSON.stringify(response)).not.toContain('Private Projects')
  })
})
