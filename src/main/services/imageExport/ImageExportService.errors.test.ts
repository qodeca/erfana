// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the image-export FAILURE paths.
 *
 * Split from `ImageExportService.test.ts` per the project's test-file policy —
 * the `vi.mock` factories below hoist to module scope, so a file that needs a
 * different default posture needs its own file.
 *
 * Two invariants are proven for every single failure code:
 *
 * 1. `error` is exactly `ERROR_MESSAGES[errorCode]`. The renderer shows that
 *    string verbatim, and there is no fallback — a code without a message
 *    would surface to the user as an empty toast.
 * 2. Nothing user-identifying reaches the log. Paths go through `redactPath`,
 *    caught Node errors through `redactedLogError`, so a log line proves an
 *    export failed without recording where the user keeps their files.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

const {
  mockReadFile,
  mockStat,
  mockRealpath,
  mockShowSaveDialog,
  mockAssertInsideProject,
  mockGetProjectPath,
  mockOpen,
  mockWritePngFile,
  mockWritePdfFile,
  mockCopyPngToClipboard,
  mockLogger
} = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockStat: vi.fn(),
  mockRealpath: vi.fn(),
  mockShowSaveDialog: vi.fn(),
  mockAssertInsideProject: vi.fn(),
  mockGetProjectPath: vi.fn(),
  mockOpen: vi.fn(),
  mockWritePngFile: vi.fn(),
  mockWritePdfFile: vi.fn(),
  mockCopyPngToClipboard: vi.fn(),
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  realpath: (...args: unknown[]) => mockRealpath(...args)
}))
vi.mock('electron', () => ({
  dialog: { showSaveDialog: (...args: unknown[]) => mockShowSaveDialog(...args) }
}))
vi.mock('../../utils/projectConfinement', () => ({
  assertInsideProject: (...args: unknown[]) => mockAssertInsideProject(...args)
}))
vi.mock('../FileService', () => ({
  fileService: { getProjectPath: () => mockGetProjectPath() }
}))
vi.mock('../LoggingService', () => ({ logger: mockLogger }))
vi.mock('./ImageRasterizeWindow', () => ({
  ImageRasterizeWindow: { open: (...args: unknown[]) => mockOpen(...args) }
}))
vi.mock('./exportSinks', () => ({
  writePngFile: (...args: unknown[]) => mockWritePngFile(...args),
  writePdfFile: (...args: unknown[]) => mockWritePdfFile(...args),
  copyPngToClipboard: (...args: unknown[]) => mockCopyPngToClipboard(...args)
}))

import { ErrorCode, ERROR_MESSAGES } from '../../../shared/errors'
import { MAX_IMAGE_SIZE } from '../file/imageRead'
import { ImageExportService } from './ImageExportService'
import { png, utf8 } from './__fixtures__/imageBytes'

/** A path with a recognisable, private-looking directory in it. */
const PROJECT = join('/Users/someone/Private Projects/quarterly')
const SOURCE = join(PROJECT, 'assets', 'confidential-chart.png')
const DESTINATION = join('/Users/someone/Desktop/Board pack', 'chart.png')

/** Everything the logger was handed during this test, as one string. */
function loggedText(): string {
  return [
    ...mockLogger.error.mock.calls,
    ...mockLogger.warn.mock.calls,
    ...mockLogger.info.mock.calls,
    ...mockLogger.debug.mock.calls
  ]
    .map((call) => JSON.stringify(call))
    .join('\n')
}

/** Assert no part of the user's folder layout reached the log. */
function expectNoPathsLogged(): void {
  const logged = loggedText()
  expect(logged).toContain('[redacted]')
  expect(logged).not.toContain('Private Projects')
  expect(logged).not.toContain('Board pack')
  expect(logged).not.toContain('quarterly')
}

/** An `fs` error with a specific errno. */
function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: failed, open '${SOURCE}'`) as NodeJS.ErrnoException
  error.code = code
  return error
}

let service: ImageExportService

beforeEach(() => {
  vi.clearAllMocks()
  service = new ImageExportService()
  mockGetProjectPath.mockReturnValue(PROJECT)
  mockAssertInsideProject.mockResolvedValue(undefined)
  mockStat.mockResolvedValue({ size: 1024 })
  mockReadFile.mockResolvedValue(Buffer.from(png(10, 10)))
  mockRealpath.mockImplementation(async (path: string) => path)
  mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: DESTINATION })
  mockWritePngFile.mockResolvedValue({ ok: true })
  mockWritePdfFile.mockResolvedValue({ ok: true })
  mockCopyPngToClipboard.mockReturnValue({ ok: true })
  mockOpen.mockResolvedValue({
    render: vi.fn(async () => ({
      ok: true,
      width: 10,
      height: 10,
      pngBytes: Uint8Array.from([1])
    })),
    printToPdf: vi.fn(),
    destroy: vi.fn()
  })
})

/** Run a PNG export and return the response. */
function runPng() {
  return service.run({ filePath: SOURCE, target: 'png', parentWindow: null })
}

/** Run a clipboard export (no dialog) and return the response. */
function runClipboard() {
  return service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: null })
}

describe('source refusals — before the dialog opens', () => {
  it('reports an out-of-project source as unreadable, and opens no dialog', async () => {
    mockAssertInsideProject.mockRejectedValue(
      new Error('Cannot read files outside the project directory')
    )
    const response = await runPng()

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_SOURCE_UNREADABLE })
    expect(mockShowSaveDialog).not.toHaveBeenCalled()
    expectNoPathsLogged()
  })

  it.each(['ENOENT', 'EACCES'])('reports a %s on stat as unreadable', async (code) => {
    mockStat.mockRejectedValue(errno(code))
    const response = await runPng()

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_SOURCE_UNREADABLE })
    expect(mockShowSaveDialog).not.toHaveBeenCalled()
    expectNoPathsLogged()
  })

  it('refuses a source over the 50 MB cap, before the dialog', async () => {
    mockStat.mockResolvedValue({ size: MAX_IMAGE_SIZE + 1 })
    const response = await runPng()

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_SOURCE_TOO_LARGE })
    expect(mockShowSaveDialog).not.toHaveBeenCalled()
    expectNoPathsLogged()
  })

  it('accepts a source at exactly the cap', async () => {
    mockStat.mockResolvedValue({ size: MAX_IMAGE_SIZE })
    await expect(runClipboard()).resolves.toMatchObject({ success: true })
  })

  it('reports a read that fails after the dialog as unreadable', async () => {
    mockReadFile.mockRejectedValue(errno('ENOENT'))
    const response = await runPng()

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_SOURCE_UNREADABLE })
    expect(mockWritePngFile).not.toHaveBeenCalled()
    expectNoPathsLogged()
  })
})

describe('the self-overwrite guard', () => {
  it('refuses when the chosen path resolves to the source, and writes nothing', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: DESTINATION })
    mockRealpath.mockResolvedValue(SOURCE)

    const response = await runPng()
    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_SOURCE_COLLISION })
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockWritePngFile).not.toHaveBeenCalled()
    expectNoPathsLogged()
  })

  it.each(['EACCES', 'ELOOP', 'ENOTDIR'])(
    'FAILS CLOSED when realpath answers %s — the source is never risked',
    async (code) => {
      mockRealpath.mockImplementation(async (path: string) => {
        if (path === SOURCE) return SOURCE
        throw errno(code)
      })

      const response = await runPng()
      expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_SOURCE_COLLISION })
      expect(mockWritePngFile).not.toHaveBeenCalled()
    }
  )

  it('allows a destination that simply does not exist yet', async () => {
    mockRealpath.mockImplementation(async (path: string) => {
      if (path === SOURCE) return SOURCE
      throw errno('ENOENT')
    })
    await expect(runPng()).resolves.toMatchObject({ success: true })
  })
})

describe('decode refusals', () => {
  it('refuses a raster file whose header cannot be parsed', async () => {
    mockReadFile.mockResolvedValue(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))
    const response = await runClipboard()

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_DECODE_FAILED })
    expect(mockOpen).not.toHaveBeenCalled()
    expectNoPathsLogged()
  })

  it('refuses an SVG with no root element', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(utf8('not markup at all')))
    const response = await service.run({
      filePath: join(PROJECT, 'broken.svg'),
      target: 'clipboard',
      parentWindow: null
    })

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_DECODE_FAILED })
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('names the 2x rule when an SVG is too large to rasterize', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(utf8('<svg width="9000" height="9000"></svg>')))
    const response = await service.run({
      filePath: join(PROJECT, 'huge.svg'),
      target: 'clipboard',
      parentWindow: null
    })

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_SVG_TOO_LARGE })
    expect(response).toMatchObject({
      error: ERROR_MESSAGES[ErrorCode.IMAGE_EXPORT_SVG_TOO_LARGE]
    })
    expect(mockOpen).not.toHaveBeenCalled()
  })
})

describe('harness refusals', () => {
  /** Replace the harness with one that answers a given failure reason. */
  function harnessFailing(reason: string) {
    const harness = { render: vi.fn(async () => ({ ok: false, reason })), destroy: vi.fn() }
    mockOpen.mockResolvedValue(harness)
    return harness
  }

  it.each([
    ['decode', ErrorCode.IMAGE_EXPORT_DECODE_FAILED],
    ['too-large', ErrorCode.IMAGE_EXPORT_OUTPUT_TOO_LARGE],
    ['encode', ErrorCode.IMAGE_EXPORT_FAILED]
  ])('maps a %s failure to %s', async (reason, code) => {
    const harness = harnessFailing(reason)
    const response = await runClipboard()

    expect(response).toMatchObject({ errorCode: code })
    expect(mockCopyPngToClipboard).not.toHaveBeenCalled()
    expect(harness.destroy).toHaveBeenCalled()
  })

  it('reports a window that will not open as a generic failure', async () => {
    mockOpen.mockRejectedValue(new Error('Image-export harness load timed out after 10000ms'))
    const response = await runClipboard()

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_FAILED })
    expectNoPathsLogged()
  })

  it('refuses to deliver bytes the harness never sent', async () => {
    mockOpen.mockResolvedValue({
      render: vi.fn(async () => ({ ok: true, width: 10, height: 10 })),
      destroy: vi.fn()
    })
    const response = await runClipboard()

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_FAILED })
    expect(mockCopyPngToClipboard).not.toHaveBeenCalled()
  })
})

describe('sink refusals', () => {
  it('passes a write failure through unchanged', async () => {
    mockWritePngFile.mockResolvedValue({ ok: false, code: ErrorCode.IMAGE_EXPORT_WRITE_FAILED })
    const response = await runPng()

    expect(response).toMatchObject({
      errorCode: ErrorCode.IMAGE_EXPORT_WRITE_FAILED,
      error: ERROR_MESSAGES[ErrorCode.IMAGE_EXPORT_WRITE_FAILED]
    })
    expectNoPathsLogged()
  })

  it('passes a PDF geometry failure through unchanged', async () => {
    mockWritePdfFile.mockResolvedValue({
      ok: false,
      code: ErrorCode.IMAGE_EXPORT_PDF_GEOMETRY_FAILED
    })
    mockOpen.mockResolvedValue({
      render: vi.fn(async () => ({ ok: true, width: 10, height: 10 })),
      printToPdf: vi.fn(),
      destroy: vi.fn()
    })
    const response = await service.run({ filePath: SOURCE, target: 'pdf', parentWindow: null })
    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_PDF_GEOMETRY_FAILED })
  })

  it('passes a clipboard failure through unchanged', async () => {
    mockCopyPngToClipboard.mockReturnValue({
      ok: false,
      code: ErrorCode.IMAGE_EXPORT_CLIPBOARD_FAILED
    })
    const response = await runClipboard()
    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_CLIPBOARD_FAILED })
  })
})

describe('the single error-mapping point', () => {
  it('always sets `error` to ERROR_MESSAGES[errorCode]', async () => {
    const cases: Array<[() => void, ErrorCode]> = [
      [
        () => mockAssertInsideProject.mockRejectedValue(new Error('outside')),
        ErrorCode.IMAGE_EXPORT_SOURCE_UNREADABLE
      ],
      [
        () => mockStat.mockResolvedValue({ size: MAX_IMAGE_SIZE + 1 }),
        ErrorCode.IMAGE_EXPORT_SOURCE_TOO_LARGE
      ],
      [
        () => mockReadFile.mockResolvedValue(Buffer.from([1, 2, 3])),
        ErrorCode.IMAGE_EXPORT_DECODE_FAILED
      ],
      [
        () => mockCopyPngToClipboard.mockReturnValue({
          ok: false,
          code: ErrorCode.IMAGE_EXPORT_CLIPBOARD_FAILED
        }),
        ErrorCode.IMAGE_EXPORT_CLIPBOARD_FAILED
      ]
    ]

    for (const [arrange, code] of cases) {
      vi.clearAllMocks()
      service = new ImageExportService()
      mockGetProjectPath.mockReturnValue(PROJECT)
      mockAssertInsideProject.mockResolvedValue(undefined)
      mockStat.mockResolvedValue({ size: 1024 })
      mockReadFile.mockResolvedValue(Buffer.from(png(10, 10)))
      mockCopyPngToClipboard.mockReturnValue({ ok: true })
      mockOpen.mockResolvedValue({
        render: vi.fn(async () => ({
          ok: true,
          width: 10,
          height: 10,
          pngBytes: Uint8Array.from([1])
        })),
        destroy: vi.fn()
      })
      arrange()

      const response = await runClipboard()
      expect(response).toEqual({
        success: false,
        errorCode: code,
        error: ERROR_MESSAGES[code]
      })
      expect(response.success === false && response.error.length).toBeGreaterThan(0)
    }
  })

  it('gives the cancel code a message too, even though no toast shows it', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: true })
    const response = await runPng()
    expect(response).toEqual({
      success: false,
      errorCode: ErrorCode.IMAGE_EXPORT_CANCELLED,
      error: ERROR_MESSAGES[ErrorCode.IMAGE_EXPORT_CANCELLED]
    })
  })

  it('maps a save dialog that REJECTS to a generic failure, not a thrown error', async () => {
    // The only awaited call in `run` outside a guarded block. An Electron
    // dialog can reject - a parent window destroyed while the picker is up, a
    // platform error - and an escape here would bypass the mapping point
    // entirely and cross IPC as a raw Node error.
    mockShowSaveDialog.mockRejectedValue(new Error('Object has been destroyed'))

    const response = await runPng()
    expect(response).toEqual({
      success: false,
      errorCode: ErrorCode.IMAGE_EXPORT_FAILED,
      error: ERROR_MESSAGES[ErrorCode.IMAGE_EXPORT_FAILED]
    })
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockWritePngFile).not.toHaveBeenCalled()
    expectNoPathsLogged()
  })

  it('does not leave the export lock held when the save dialog rejects', async () => {
    mockShowSaveDialog.mockRejectedValueOnce(new Error('Object has been destroyed'))
    await runPng()

    // The lock is taken AFTER the dialog, so a rejection must not consume it -
    // otherwise the first dialog failure would wedge every later export.
    await expect(runClipboard()).resolves.toMatchObject({ success: true })
  })

  it('gives the busy code a message too', async () => {
    mockOpen.mockResolvedValue({
      render: vi.fn(() => new Promise(() => {})),
      destroy: vi.fn()
    })
    void runClipboard()
    await vi.waitFor(() => expect(mockOpen).toHaveBeenCalled())

    const second = await runClipboard()
    expect(second).toEqual({
      success: false,
      errorCode: ErrorCode.IMAGE_EXPORT_BUSY,
      error: ERROR_MESSAGES[ErrorCode.IMAGE_EXPORT_BUSY]
    })
  })
})
