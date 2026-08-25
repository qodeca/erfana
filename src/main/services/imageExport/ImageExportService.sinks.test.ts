// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for what the image export DOES with the finished pixels.
 *
 * The sinks, the save dialog, the export lock and the hidden-window lifecycle.
 * Split from `ImageExportService.test.ts` per the project's test-file policy:
 * the `vi.mock` factories below hoist to module scope, so each posture needs
 * its own file.
 *
 * Two cases here are worth more than they look:
 *
 * - the lock is NOT held while the user sits in a save dialog, so one open file
 *   picker cannot block every other image tab indefinitely;
 * - the hidden window is destroyed on every path, including the ones where the
 *   export failed.
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

import { ErrorCode } from '../../../shared/errors'
import { IMAGE_EXPORT } from '../../../shared/ipc/image-export-schema'
import { ImageExportService } from './ImageExportService'
import { png } from './__fixtures__/imageBytes'

const PROJECT = join('/project')
const SOURCE = join(PROJECT, 'assets', 'diagram.png')
const CHOSEN = join('/elsewhere', 'diagram.png')
const PARENT_WINDOW = { id: 1 } as never

/** A harness stub whose renders resolve with a chosen result, in order. */
function harnessStub(results: Array<Record<string, unknown>>) {
  const queue = [...results]
  return {
    render: vi.fn(async () => queue.shift() ?? { ok: false, reason: 'decode' }),
    printToPdf: vi.fn(async () => Buffer.from('%PDF')),
    destroy: vi.fn()
  }
}

/** The instruction passed to the nth render call. */
function instruction(harness: ReturnType<typeof harnessStub>, index = 0) {
  return harness.render.mock.calls[index][0] as Record<string, unknown>
}

function okResult(width: number, height: number) {
  return { ok: true, width, height, pngBytes: Uint8Array.from([1, 2, 3]) }
}

let service: ImageExportService

beforeEach(() => {
  vi.clearAllMocks()
  service = new ImageExportService()
  mockGetProjectPath.mockReturnValue(PROJECT)
  mockAssertInsideProject.mockResolvedValue(undefined)
  mockStat.mockResolvedValue({ size: 1024 })
  mockReadFile.mockResolvedValue(Buffer.from(png(137, 61)))
  mockRealpath.mockImplementation(async (path: string) => path)
  mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: CHOSEN })
  mockWritePngFile.mockResolvedValue({ ok: true })
  mockWritePdfFile.mockResolvedValue({ ok: true })
  mockCopyPngToClipboard.mockReturnValue({ ok: true })
  mockOpen.mockResolvedValue(harnessStub([okResult(137, 61)]))
})

describe('requirements 7 & 8 — background and sink per target', () => {
  it('keeps PNG transparent', async () => {
    const harness = harnessStub([okResult(137, 61)])
    mockOpen.mockResolvedValue(harness)
    await service.run({ filePath: SOURCE, target: 'png', parentWindow: PARENT_WINDOW })
    expect(instruction(harness)).toMatchObject({ background: 'transparent', deliver: 'bytes' })
    expect(mockWritePngFile).toHaveBeenCalledWith(CHOSEN, expect.any(Uint8Array))
  })

  it('flattens the clipboard image onto white and copies it', async () => {
    const harness = harnessStub([okResult(137, 61)])
    mockOpen.mockResolvedValue(harness)
    const response = await service.run({
      filePath: SOURCE,
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })

    expect(instruction(harness)).toMatchObject({ background: 'white', deliver: 'bytes' })
    expect(mockCopyPngToClipboard).toHaveBeenCalledTimes(1)
    expect(mockShowSaveDialog).not.toHaveBeenCalled()
    expect(response).not.toHaveProperty('filePath')
  })

  it('flattens the PDF onto white and delivers it as a page, not as bytes', async () => {
    const harness = harnessStub([{ ok: true, width: 137, height: 61 }])
    mockOpen.mockResolvedValue(harness)
    mockShowSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: join('/elsewhere', 'diagram.pdf')
    })
    await service.run({ filePath: SOURCE, target: 'pdf', parentWindow: PARENT_WINDOW })

    // No pngBytes are posted back for a PDF: the pixels stay in the page and
    // printToPDF reads them there.
    expect(instruction(harness)).toMatchObject({ background: 'white', deliver: 'page' })
    expect(mockWritePdfFile).toHaveBeenCalledWith(
      join('/elsewhere', 'diagram.pdf'),
      harness,
      137,
      61
    )
  })
})

describe('requirement 9 — the save dialog', () => {
  it('opens in the source folder, on the source base name, modal to the caller window', async () => {
    await service.run({ filePath: SOURCE, target: 'png', parentWindow: PARENT_WINDOW })
    expect(mockShowSaveDialog).toHaveBeenCalledWith(
      PARENT_WINDOW,
      expect.objectContaining({
        defaultPath: join(PROJECT, 'assets', 'diagram-export.png'),
        filters: [{ name: 'PNG Images', extensions: ['png'] }]
      })
    )
  })

  it('forces the target extension onto whatever the user typed', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: join('/elsewhere', 'out') })
    await service.run({ filePath: SOURCE, target: 'pdf', parentWindow: PARENT_WINDOW })
    expect(mockWritePdfFile).toHaveBeenCalledWith(
      join('/elsewhere', 'out.pdf'),
      expect.anything(),
      expect.any(Number),
      expect.any(Number)
    )
  })

  it('falls back to a parentless dialog rather than failing', async () => {
    await service.run({ filePath: SOURCE, target: 'png', parentWindow: null })
    expect(mockShowSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ buttonLabel: 'Export' }))
  })
})

describe('requirement 10 — cancelling writes nothing', () => {
  it('writes nothing, copies nothing, and reports the cancel code', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    const response = await service.run({
      filePath: SOURCE,
      target: 'png',
      parentWindow: PARENT_WINDOW
    })

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_CANCELLED })
    expect(mockWritePngFile).not.toHaveBeenCalled()
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('treats an empty chosen path as a cancel', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '' })
    const response = await service.run({
      filePath: SOURCE,
      target: 'png',
      parentWindow: PARENT_WINDOW
    })
    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_CANCELLED })
  })

  it('does not log a cancel as an error', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: true })
    await service.run({ filePath: SOURCE, target: 'png', parentWindow: PARENT_WINDOW })
    expect(mockLogger.error).not.toHaveBeenCalled()
  })
})

describe('the export lock', () => {
  it('refuses a second export while one is in flight', async () => {
    let releaseRender: (value: unknown) => void = () => {}
    mockOpen.mockResolvedValue({
      render: vi.fn(() => new Promise((resolve) => (releaseRender = resolve))),
      destroy: vi.fn()
    })

    const first = service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: null })
    await vi.waitFor(() => expect(mockOpen).toHaveBeenCalled())
    const second = await service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: null })

    expect(second).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_BUSY })
    releaseRender(okResult(1, 1))
    await first
  })

  it('is NOT held while the user sits in the save dialog', async () => {
    let openDialog: (value: unknown) => void = () => {}
    mockShowSaveDialog.mockImplementation(() => new Promise((resolve) => (openDialog = resolve)))
    mockOpen.mockResolvedValue(harnessStub([okResult(1, 1), okResult(1, 1)]))

    const pngRun = service.run({ filePath: SOURCE, target: 'png', parentWindow: PARENT_WINDOW })
    await vi.waitFor(() => expect(mockShowSaveDialog).toHaveBeenCalled())

    // A different tab exports to the clipboard while that dialog is still open.
    const clipboardRun = await service.run({
      filePath: SOURCE,
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })
    expect(clipboardRun).toMatchObject({ success: true })

    openDialog({ canceled: false, filePath: CHOSEN })
    await expect(pngRun).resolves.toMatchObject({ success: true })
  })

  it('releases the lock after a run, so the next export is allowed', async () => {
    mockOpen.mockResolvedValue(harnessStub([okResult(1, 1), okResult(1, 1)]))
    await service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: null })
    const second = await service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: null })
    expect(second).toMatchObject({ success: true })
  })
})

describe('harness lifecycle', () => {
  it('destroys the hidden window on success', async () => {
    const harness = harnessStub([okResult(1, 1)])
    mockOpen.mockResolvedValue(harness)
    await service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: null })
    expect(harness.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys the hidden window when the sink fails', async () => {
    const harness = harnessStub([okResult(1, 1)])
    mockOpen.mockResolvedValue(harness)
    mockCopyPngToClipboard.mockReturnValue({
      ok: false,
      code: ErrorCode.IMAGE_EXPORT_CLIPBOARD_FAILED
    })
    await service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: null })
    expect(harness.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys the hidden window when a render throws', async () => {
    const harness = {
      render: vi.fn(async () => {
        throw new Error('Image rasterize timed out')
      }),
      destroy: vi.fn()
    }
    mockOpen.mockResolvedValue(harness)
    const response = await service.run({
      filePath: SOURCE,
      target: 'clipboard',
      parentWindow: null
    })
    expect(harness.destroy).toHaveBeenCalledTimes(1)
    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_FAILED })
  })

  it('passes the pixel cap to the harness as defence in depth', async () => {
    const harness = harnessStub([okResult(1, 1)])
    mockOpen.mockResolvedValue(harness)
    await service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: null })
    expect(instruction(harness).maxPixels).toBe(IMAGE_EXPORT.MAX_OUTPUT_PIXELS)
  })
})
