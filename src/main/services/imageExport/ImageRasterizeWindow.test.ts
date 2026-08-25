// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the hidden rasterize window's request/response round trip.
 *
 * `BrowserWindow` is a stub here, so what is being proven is ORCHESTRATION, not
 * pixels: the ready handshake, the token on every send, the sender-frame gate
 * applied before the payload is parsed, the guaranteed destroy, and the timeout
 * paths. Real decoding is covered by e2e and the manual checklist.
 *
 * The timeout cases matter more than they look: a raced promise without a
 * handler turns "the export took too long" into an unhandled rejection, which
 * the main-process crash handlers report as a crash.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const FIXED_TOKEN = '11111111-2222-4333-8444-555555555555'
const HARNESS_URL = 'file:///app/out/renderer/imageExport.html'

const { windows, mockBrowserWindow, mockExistsSync, mockIs, mockLogger, mockPrepareSession } =
  vi.hoisted(() => ({
    windows: [] as ReturnType<typeof buildWindowStub>[],
    mockBrowserWindow: vi.fn(),
    mockExistsSync: vi.fn(() => true),
    mockIs: { dev: false },
    mockLogger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn()
    },
    mockPrepareSession: vi.fn()
  }))

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: unknown) {
      return mockBrowserWindow(options)
    }
  }
}))
vi.mock('fs', () => ({ existsSync: (...args: unknown[]) => mockExistsSync(...args) }))
vi.mock('crypto', () => ({ randomUUID: () => FIXED_TOKEN }))
vi.mock('@electron-toolkit/utils', () => ({ is: mockIs }))
vi.mock('../LoggingService', () => ({ logger: mockLogger }))
vi.mock('./rasterizeSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rasterizeSession')>()
  return { ...actual, prepareRasterizeSession: mockPrepareSession }
})

import { IMAGE_EXPORT_CHANNELS } from '../../../shared/ipc/image-export-channels'
import { IMAGE_EXPORT, type HarnessRender } from '../../../shared/ipc/image-export-schema'
import { HARNESS_PDF_OPTIONS, ImageRasterizeWindow } from './ImageRasterizeWindow'

type FrameListener = (event: unknown, payload?: unknown) => void

/** A BrowserWindow stub that records frame-scoped listeners and sends. */
function buildWindowStub() {
  const frameListeners: Record<string, FrameListener[]> = {}
  const sent: Array<{ channel: string; payload: unknown }> = []
  const stub = {
    sent,
    destroyed: false,
    loadResult: Promise.resolve(),
    /** What `webContents.getURL()` reports right now — a navigation moves it. */
    currentUrl: HARNESS_URL,
    webContents: {
      mainFrame: {
        ipc: {
          on: vi.fn((channel: string, listener: FrameListener) => {
            ;(frameListeners[channel] ??= []).push(listener)
          })
        }
      },
      getURL: () => stub.currentUrl,
      send: vi.fn((channel: string, payload: unknown) => sent.push({ channel, payload })),
      printToPDF: vi.fn(async () => Buffer.from('%PDF-1.7')),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    },
    loadFile: vi.fn(() => stub.loadResult),
    loadURL: vi.fn(() => stub.loadResult),
    isDestroyed: () => stub.destroyed,
    destroy: vi.fn(() => {
      stub.destroyed = true
    }),
    /** Fire a frame-scoped message as the harness would. */
    emit(channel: string, payload: unknown, senderUrl: string = HARNESS_URL): void {
      for (const listener of frameListeners[channel] ?? []) {
        listener({ senderFrame: { url: senderUrl } }, payload)
      }
    }
  }
  return stub
}

/** Open a harness whose page answers `ready` as soon as it is asked to load. */
async function openReadyHarness(): Promise<{
  harness: ImageRasterizeWindow
  win: ReturnType<typeof buildWindowStub>
}> {
  const win = buildWindowStub()
  windows.push(win)
  mockBrowserWindow.mockReturnValue(win)
  win.loadFile.mockImplementation(() => {
    queueMicrotask(() => win.emit(IMAGE_EXPORT_CHANNELS.HARNESS_READY, { token: FIXED_TOKEN }))
    return Promise.resolve()
  })
  const harness = await ImageRasterizeWindow.open()
  return { harness, win }
}

const INSTRUCTION: Omit<HarnessRender, 'token'> = {
  mimeType: 'image/png',
  bytes: Uint8Array.from([1, 2, 3]),
  mode: 'bitmap',
  targetSize: null,
  background: 'transparent',
  deliver: 'bytes',
  maxPixels: IMAGE_EXPORT.MAX_OUTPUT_PIXELS
}

beforeEach(() => {
  windows.length = 0
  vi.clearAllMocks()
  mockExistsSync.mockReturnValue(true)
  mockIs.dev = false
  delete process.env['ELECTRON_RENDERER_URL']
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ImageRasterizeWindow.open', () => {
  it('hardens the session BEFORE constructing the window', async () => {
    const order: string[] = []
    mockPrepareSession.mockImplementation(() => order.push('session'))
    const win = buildWindowStub()
    mockBrowserWindow.mockImplementation(() => {
      order.push('window')
      return win
    })
    win.loadFile.mockImplementation(() => {
      queueMicrotask(() => win.emit(IMAGE_EXPORT_CHANNELS.HARNESS_READY, { token: FIXED_TOKEN }))
      return Promise.resolve()
    })

    const harness = await ImageRasterizeWindow.open()
    expect(order).toEqual(['session', 'window'])
    harness.destroy()
  })

  it('refuses to open when the harness preload is missing from the build', async () => {
    mockExistsSync.mockReturnValue(false)
    await expect(ImageRasterizeWindow.open()).rejects.toThrow(/preload is missing/)
    expect(mockBrowserWindow).not.toHaveBeenCalled()
  })

  it('creates the window hidden', async () => {
    const { harness } = await openReadyHarness()
    expect(mockBrowserWindow.mock.calls[0][0]).toMatchObject({ show: false })
    harness.destroy()
  })

  it('loads the packaged page in production', async () => {
    const { harness, win } = await openReadyHarness()
    expect(win.loadFile).toHaveBeenCalled()
    expect(win.loadURL).not.toHaveBeenCalled()
    harness.destroy()
  })

  it('destroys the window when the page fails to load', async () => {
    const win = buildWindowStub()
    mockBrowserWindow.mockReturnValue(win)
    win.loadFile.mockRejectedValue(new Error('ERR_FILE_NOT_FOUND'))
    await expect(ImageRasterizeWindow.open()).rejects.toThrow('ERR_FILE_NOT_FOUND')
    expect(win.destroy).toHaveBeenCalled()
  })

  it('ignores a ready signal carrying the wrong token', async () => {
    vi.useFakeTimers()
    const win = buildWindowStub()
    mockBrowserWindow.mockReturnValue(win)
    win.loadFile.mockImplementation(() => {
      queueMicrotask(() =>
        win.emit(IMAGE_EXPORT_CHANNELS.HARNESS_READY, {
          token: '99999999-9999-4999-8999-999999999999'
        })
      )
      return Promise.resolve()
    })

    const opening = ImageRasterizeWindow.open()
    const assertion = expect(opening).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(IMAGE_EXPORT.WINDOW_LOAD_TIMEOUT_MS + 1)
    await assertion
  })
})

describe('ImageRasterizeWindow.render', () => {
  it('sends the instruction with the per-export token attached', async () => {
    const { harness, win } = await openReadyHarness()
    const pending = harness.render(INSTRUCTION)
    expect(win.sent[0].channel).toBe(IMAGE_EXPORT_CHANNELS.HARNESS_RENDER)
    expect(win.sent[0].payload).toMatchObject({ token: FIXED_TOKEN, mode: 'bitmap' })

    win.emit(IMAGE_EXPORT_CHANNELS.HARNESS_RESULT, {
      ok: true,
      token: FIXED_TOKEN,
      width: 10,
      height: 20
    })
    await expect(pending).resolves.toMatchObject({ ok: true, width: 10, height: 20 })
    harness.destroy()
  })

  it('carries the token on a SECOND instruction too', async () => {
    const { harness, win } = await openReadyHarness()
    const first = harness.render(INSTRUCTION)
    win.emit(IMAGE_EXPORT_CHANNELS.HARNESS_RESULT, {
      ok: true,
      token: FIXED_TOKEN,
      width: 1,
      height: 1
    })
    await first

    const second = harness.render(INSTRUCTION)
    expect(win.sent[1].payload).toMatchObject({ token: FIXED_TOKEN })
    win.emit(IMAGE_EXPORT_CHANNELS.HARNESS_RESULT, {
      ok: true,
      token: FIXED_TOKEN,
      width: 2,
      height: 2
    })
    await second
    harness.destroy()
  })

  it('rejects a result whose sender frame is not the loaded page', async () => {
    vi.useFakeTimers()
    const { harness, win } = await openReadyHarness()
    const pending = harness.render(INSTRUCTION)
    const assertion = expect(pending).rejects.toThrow(/timed out/)

    win.emit(
      IMAGE_EXPORT_CHANNELS.HARNESS_RESULT,
      { ok: true, token: FIXED_TOKEN, width: 10, height: 20 },
      'https://evil.example.com/'
    )
    await vi.advanceTimersByTimeAsync(IMAGE_EXPORT.RENDER_TIMEOUT_MS + 1)
    await assertion
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('sender frame mismatch'),
      expect.anything()
    )
    harness.destroy()
  })

  it('keeps the expectation on the page that loaded, even after a navigation', async () => {
    vi.useFakeTimers()
    const { harness, win } = await openReadyHarness()
    const pending = harness.render(INSTRUCTION)
    const assertion = expect(pending).rejects.toThrow(/timed out/)

    // A navigation that SUCCEEDED would move a live `getURL()` read with it,
    // and the gate would then accept the page it was meant to refuse.
    win.currentUrl = 'https://evil.example.com/'
    win.emit(
      IMAGE_EXPORT_CHANNELS.HARNESS_RESULT,
      { ok: true, token: FIXED_TOKEN, width: 10, height: 20 },
      'https://evil.example.com/'
    )

    await vi.advanceTimersByTimeAsync(IMAGE_EXPORT.RENDER_TIMEOUT_MS + 1)
    await assertion
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('sender frame mismatch'),
      expect.anything()
    )
    harness.destroy()
  })

  it('rejects a result carrying a different token', async () => {
    vi.useFakeTimers()
    const { harness, win } = await openReadyHarness()
    const pending = harness.render(INSTRUCTION)
    const assertion = expect(pending).rejects.toThrow(/timed out/)

    win.emit(IMAGE_EXPORT_CHANNELS.HARNESS_RESULT, {
      ok: true,
      token: '99999999-9999-4999-8999-999999999999',
      width: 10,
      height: 20
    })
    await vi.advanceTimersByTimeAsync(IMAGE_EXPORT.RENDER_TIMEOUT_MS + 1)
    await assertion
    harness.destroy()
  })

  it('rejects a malformed result before it can reach a sink', async () => {
    vi.useFakeTimers()
    const { harness, win } = await openReadyHarness()
    const pending = harness.render(INSTRUCTION)
    const assertion = expect(pending).rejects.toThrow(/timed out/)

    win.emit(IMAGE_EXPORT_CHANNELS.HARNESS_RESULT, {
      ok: true,
      token: FIXED_TOKEN,
      width: -5,
      height: 0
    })
    await vi.advanceTimersByTimeAsync(IMAGE_EXPORT.RENDER_TIMEOUT_MS + 1)
    await assertion
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('malformed result'),
      expect.anything()
    )
    harness.destroy()
  })

  it('passes a harness failure through unchanged', async () => {
    const { harness, win } = await openReadyHarness()
    const pending = harness.render(INSTRUCTION)
    win.emit(IMAGE_EXPORT_CHANNELS.HARNESS_RESULT, {
      ok: false,
      token: FIXED_TOKEN,
      reason: 'too-large'
    })
    await expect(pending).resolves.toEqual({ ok: false, token: FIXED_TOKEN, reason: 'too-large' })
    harness.destroy()
  })

  it('a render timeout followed by destroy leaves NO unhandled rejection', async () => {
    vi.useFakeTimers()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const { harness } = await openReadyHarness()
      const pending = harness.render(INSTRUCTION)
      const assertion = expect(pending).rejects.toThrow(/timed out/)
      await vi.advanceTimersByTimeAsync(IMAGE_EXPORT.RENDER_TIMEOUT_MS + 1)
      await assertion
      harness.destroy()
      await vi.advanceTimersByTimeAsync(10)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})

describe('ImageRasterizeWindow.printToPdf', () => {
  it('pins every printToPDF option that decides the geometry', async () => {
    const { harness, win } = await openReadyHarness()
    await harness.printToPdf()
    expect(win.webContents.printToPDF).toHaveBeenCalledWith(HARNESS_PDF_OPTIONS)
    harness.destroy()
  })

  it('asks for CSS page size, no margins, no scaling and a single page', () => {
    expect(HARNESS_PDF_OPTIONS).toEqual({
      preferCSSPageSize: true,
      printBackground: true,
      margins: { marginType: 'none' },
      scale: 1,
      pageRanges: '1-1'
    })
  })

  it('passes NO pageSize — the geometry comes from the @page rule', () => {
    expect(HARNESS_PDF_OPTIONS).not.toHaveProperty('pageSize')
  })

  it('times out rather than hanging on a wedged renderer', async () => {
    vi.useFakeTimers()
    const { harness, win } = await openReadyHarness()
    win.webContents.printToPDF.mockImplementation(() => new Promise(() => {}))
    const pending = harness.printToPdf()
    const assertion = expect(pending).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(IMAGE_EXPORT.PDF_TIMEOUT_MS + 1)
    await assertion
    harness.destroy()
  })

  /**
   * The only shape that can actually produce an unhandled rejection.
   *
   * A promise that never settles cannot, so the hung-renderer case above proves
   * nothing about it. Here `printToPDF` REJECTS on a later tick, after the race
   * has already been decided by the timer — the exact moment a losing promise
   * would reach the process-level `unhandledRejection` hook and be reported by
   * the main-process crash handlers as a crash.
   *
   * What this pins is the INVARIANT ("a timed-out export never crashes the main
   * process"), not one implementation of it. Measured while writing this:
   * removing the `.catch(() => {})` from `withTimeout` does NOT fail this test,
   * because `Promise.race` has already attached a rejection handler to the same
   * promise. The comment on that line says so now; a rewrite that dropped the
   * race for a wrapper attaching handlers a tick later WOULD fail here.
   */
  it('leaves NO unhandled rejection when the print rejects AFTER the timeout', async () => {
    vi.useFakeTimers()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const { harness, win } = await openReadyHarness()
      win.webContents.printToPDF.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(
              () => reject(new Error('render process gone')),
              IMAGE_EXPORT.PDF_TIMEOUT_MS * 2
            )
          })
      )

      const pending = harness.printToPdf()
      const assertion = expect(pending).rejects.toThrow(/timed out/)
      await vi.advanceTimersByTimeAsync(IMAGE_EXPORT.PDF_TIMEOUT_MS + 1)
      await assertion

      // Now let the loser reject, long after the race was settled.
      await vi.advanceTimersByTimeAsync(IMAGE_EXPORT.PDF_TIMEOUT_MS * 2)
      harness.destroy()

      // Node emits `unhandledRejection` from its own tick processing, which a
      // fake clock does not drive — the wait has to be a real one.
      vi.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})

describe('ImageRasterizeWindow.destroy', () => {
  it('destroys the window', async () => {
    const { harness, win } = await openReadyHarness()
    harness.destroy()
    expect(win.destroy).toHaveBeenCalledTimes(1)
  })

  it('is safe to call twice', async () => {
    const { harness, win } = await openReadyHarness()
    harness.destroy()
    harness.destroy()
    expect(win.destroy).toHaveBeenCalledTimes(1)
  })

  it('swallows a destroy that throws, so a `finally` cannot mask the real error', async () => {
    const { harness, win } = await openReadyHarness()
    win.destroy.mockImplementation(() => {
      throw new Error('already gone')
    })
    expect(() => harness.destroy()).not.toThrow()
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})
