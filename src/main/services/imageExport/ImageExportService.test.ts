// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the image-export orchestration — the paths that SUCCEED.
 *
 * This file covers what the export DECIDES about the source file. The sinks,
 * the save dialog, the lock and the window lifecycle are in
 * `ImageExportService.sinks.test.ts`, and failure mapping and redaction in
 * `ImageExportService.errors.test.ts` — the three-way split is the project's
 * test-file policy, because the `vi.mock` factories below hoist to module
 * scope and cannot be shared.
 *
 * The properties pinned here are the requirement-level promises that are
 * otherwise only assertable by looking at pixels:
 *
 * - the bytes are read FRESH from disk on every single run (requirement 2);
 * - a raster image is never resized (requirement 3);
 * - an SVG rasterizes at exactly 2x its intrinsic size (requirement 4);
 * - an ICO whose decode disagrees with its own directory FAILS rather than
 *   silently exporting the wrong size (requirement 5 / CR-1).
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
import { gif, ico, png, utf8 } from './__fixtures__/imageBytes'

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

describe('requirement 1 & 2 — a conversion of the file, read fresh every time', () => {
  it('reads the source path itself, and is never handed a data URL', async () => {
    await service.run({ filePath: SOURCE, target: 'png', parentWindow: PARENT_WINDOW })
    expect(mockReadFile).toHaveBeenCalledWith(SOURCE)
    expect(JSON.stringify(mockReadFile.mock.calls)).not.toContain('data:')
  })

  it('re-reads on EVERY run — two exports, two reads', async () => {
    mockOpen.mockResolvedValue(harnessStub([okResult(137, 61), okResult(137, 61)]))
    await service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: PARENT_WINDOW })
    await service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: PARENT_WINDOW })
    expect(mockReadFile).toHaveBeenCalledTimes(2)
  })

  it('sends the freshly-read bytes to the harness, not anything cached', async () => {
    const harness = harnessStub([okResult(137, 61)])
    mockOpen.mockResolvedValue(harness)
    const bytes = Buffer.from(png(10, 20))
    mockReadFile.mockResolvedValue(bytes)

    await service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: PARENT_WINDOW })
    expect(instruction(harness).bytes).toBe(bytes)
  })

  it('checks project confinement before reading anything', async () => {
    await service.run({ filePath: SOURCE, target: 'clipboard', parentWindow: PARENT_WINDOW })
    expect(mockAssertInsideProject).toHaveBeenCalledWith(SOURCE, PROJECT)
  })
})

describe('requirement 3 — never downscale', () => {
  it('sends no target size for a raster source, so the decoded size is used', async () => {
    const harness = harnessStub([okResult(137, 61)])
    mockOpen.mockResolvedValue(harness)
    await service.run({ filePath: SOURCE, target: 'png', parentWindow: PARENT_WINDOW })
    expect(instruction(harness).targetSize).toBeNull()
  })

  it('reports the dimensions the harness actually produced', async () => {
    mockOpen.mockResolvedValue(harnessStub([okResult(137, 61)]))
    const response = await service.run({
      filePath: SOURCE,
      target: 'png',
      parentWindow: PARENT_WINDOW
    })
    expect(response).toMatchObject({ success: true, output: { width: 137, height: 61 } })
  })

  it('refuses a declared-pixel bomb BEFORE the harness is ever opened', async () => {
    // 40 bytes of PNG header declaring 60000 x 60000.
    mockReadFile.mockResolvedValue(Buffer.from(png(60_000, 60_000)))
    const response = await service.run({
      filePath: SOURCE,
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })
    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_OUTPUT_TOO_LARGE })
    expect(mockOpen).not.toHaveBeenCalled()
  })
})

describe('requirement 4 — SVG rasterizes at 2x', () => {
  const svgSource = join(PROJECT, 'logo.svg')

  beforeEach(() => {
    mockReadFile.mockResolvedValue(Buffer.from(utf8('<svg viewBox="0 0 100 40"></svg>')))
  })

  it('doubles the intrinsic size and asks for the SVG decode path', async () => {
    const harness = harnessStub([okResult(200, 80)])
    mockOpen.mockResolvedValue(harness)
    await service.run({ filePath: svgSource, target: 'png', parentWindow: PARENT_WINDOW })

    expect(instruction(harness)).toMatchObject({
      mode: 'svg',
      mimeType: 'image/svg+xml',
      targetSize: { width: 200, height: 80 }
    })
  })

  it('reports the 2x scaling in the response so the toast can say so', async () => {
    mockOpen.mockResolvedValue(harnessStub([okResult(200, 80)]))
    const response = await service.run({
      filePath: svgSource,
      target: 'png',
      parentWindow: PARENT_WINDOW
    })
    expect(response).toMatchObject({
      selection: { kind: 'svg-scaled', scale: 2, width: 200, height: 80 }
    })
  })

  it('uses the 2x factor from the shared bounds, not a literal', () => {
    expect(IMAGE_EXPORT.SVG_RASTER_SCALE).toBe(2)
  })
})

describe('requirement 5 — GIF first frame and ICO largest size', () => {
  it('reports the frame count of an animated GIF', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(gif(16, 16, { frames: 12 })))
    mockOpen.mockResolvedValue(harnessStub([okResult(16, 16)]))
    const response = await service.run({
      filePath: join(PROJECT, 'loop.gif'),
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })
    expect(response).toMatchObject({ selection: { kind: 'gif-frame', frameCount: 12 } })
  })

  it('says nothing about frames for a single-frame GIF', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(gif(16, 16, { frames: 1 })))
    mockOpen.mockResolvedValue(harnessStub([okResult(16, 16)]))
    const response = await service.run({
      filePath: join(PROJECT, 'still.gif'),
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })
    expect(response).not.toHaveProperty('selection')
  })

  it('reports the exported size and the number of sizes for a multi-size ICO', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(ico([{ w: 16 }, { w: 32 }, { w: 0 }])))
    mockOpen.mockResolvedValue(harnessStub([okResult(256, 256)]))
    const response = await service.run({
      filePath: join(PROJECT, 'favicon.ico'),
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })
    expect(response).toMatchObject({
      selection: { kind: 'ico-size', width: 256, height: 256, sizeCount: 3 }
    })
  })

  it('says nothing about sizes for a single-size ICO', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(ico([{ w: 32 }])))
    mockOpen.mockResolvedValue(harnessStub([okResult(32, 32)]))
    const response = await service.run({
      filePath: join(PROJECT, 'one.ico'),
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })
    expect(response).not.toHaveProperty('selection')
  })

  it('FAILS rather than exporting the wrong ICO size when the payload is a BMP', async () => {
    mockReadFile.mockResolvedValue(
      Buffer.from(ico([{ w: 16, payload: 'bmp' }, { w: 0, payload: 'bmp' }]))
    )
    const harness = harnessStub([okResult(16, 16)])
    mockOpen.mockResolvedValue(harness)

    const response = await service.run({
      filePath: join(PROJECT, 'favicon.ico'),
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_ICO_SIZE_MISMATCH })
    expect(mockCopyPngToClipboard).not.toHaveBeenCalled()
    expect(harness.render).toHaveBeenCalledTimes(1)
  })

  it('re-renders the extracted PNG slice when the largest entry is PNG-signed', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(ico([{ w: 16 }, { w: 0 }])))
    const harness = harnessStub([okResult(16, 16), okResult(256, 256)])
    mockOpen.mockResolvedValue(harness)

    const response = await service.run({
      filePath: join(PROJECT, 'favicon.ico'),
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })

    expect(harness.render).toHaveBeenCalledTimes(2)
    expect(instruction(harness, 1).mimeType).toBe('image/png')
    expect(response).toMatchObject({ success: true, output: { width: 256, height: 256 } })
  })

  it('refuses an ICO whose PNG slice declares a bomb-sized image', async () => {
    // The directory entry says 256 x 256 — the largest an ICO byte can say —
    // while the PNG inside it declares 60000 x 60000. The outer preflight
    // reads the DIRECTORY, so it can never catch this; the slice has to be
    // checked on its own before it reaches a renderer.
    mockReadFile.mockResolvedValue(Buffer.from(ico([{ w: 16 }, { w: 0, payloadSize: 60_000 }])))
    const harness = harnessStub([okResult(16, 16), okResult(60_000, 60_000)])
    mockOpen.mockResolvedValue(harness)

    const response = await service.run({
      filePath: join(PROJECT, 'bomb.ico'),
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })

    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_OUTPUT_TOO_LARGE })
    // The retry never happened: the bytes did not reach Chromium at all.
    expect(harness.render).toHaveBeenCalledTimes(1)
    expect(mockCopyPngToClipboard).not.toHaveBeenCalled()
  })

  it('still fails when even the PNG slice comes back the wrong size', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(ico([{ w: 16 }, { w: 0 }])))
    mockOpen.mockResolvedValue(harnessStub([okResult(16, 16), okResult(16, 16)]))

    const response = await service.run({
      filePath: join(PROJECT, 'favicon.ico'),
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })
    expect(response).toMatchObject({ errorCode: ErrorCode.IMAGE_EXPORT_ICO_SIZE_MISMATCH })
    expect(mockCopyPngToClipboard).not.toHaveBeenCalled()
  })

  it('accepts a matching ICO decode without a second render', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(ico([{ w: 16 }, { w: 32 }])))
    const harness = harnessStub([okResult(32, 32)])
    mockOpen.mockResolvedValue(harness)

    const response = await service.run({
      filePath: join(PROJECT, 'favicon.ico'),
      target: 'clipboard',
      parentWindow: PARENT_WINDOW
    })
    expect(harness.render).toHaveBeenCalledTimes(1)
    expect(response).toMatchObject({ success: true })
  })
})
