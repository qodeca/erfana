// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Real, decodable image fixtures for the export e2e suite (issue #73).
 *
 * The export pipeline is the one part of this feature that jsdom cannot see:
 * every assertion worth making is about bytes a real Chromium decoded. So the
 * fixtures have to be genuinely decodable images — not the header-only buffers
 * the parser unit tests use (`src/main/services/imageExport/__fixtures__`).
 *
 * **No binary file is committed.** Every fixture is either encoded here in pure
 * TypeScript (PNG, BMP, ICO, SVG) or carried as a short base64 constant (GIF,
 * WebP, JPEG — formats whose encoders are not worth writing). That keeps REUSE
 * satisfied without an SPDX-less binary, and avoids a licensing question over
 * third-party image bytes.
 *
 * The encoders are deliberately minimal and produce the simplest legal file for
 * the shape each test needs: an exact pixel size, a known first-frame colour, a
 * transparent corner, a known largest ICO entry.
 *
 * @module generateImageFixtures
 * @see temp/design-73.md § 12.3 Fixture strategy
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'

// =============================================================================
// Base64 constants — formats whose encoders are not worth hand-writing
// =============================================================================

/**
 * 24 x 18 GIF89a, three frames, palette-indexed.
 *
 * Frame 0 is red (200, 40, 40); frames 1 and 2 are green and blue. The export
 * must take frame 0, so the exported PNG's background pixel is the assertion
 * that Chromium did not hand back a later frame.
 */
const GIF_3_FRAME_BASE64 =
  'R0lGODlhGAASAIEAAMgoKP///wAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQADAAAACwAAAAAGAASAAAIOAABCBxIsKDBgw' +
  'gTKlzIsGHCABAjRnQIQKJFihYlYswIcSNHjxlBXnTIsSPJkhRTqlzJsqXLggEBACH5BAEMAAIALAAAAAAYABIAgSjIKP///wAA' +
  'AAAAAAg4AAEIHEiwoMGDCBMqXMiwYUIBECNGdAhAokWKFiVizAhxI0ePGUFedMixI8mSFFOqXMmypcuCAQEAIfkEAQwAAgAsAA' +
  'AAABgAEgCBKCjI////AAAAAAAACDgAAQgcSLCgwYMIEypcyLBhQgEQI0Z0CECiRYoWJWLMCHEjR48ZQV50yLEjyZIUU6pcybKl' +
  'y4IBAQA7'

/** 21 x 13 lossless WebP: a blue field with a yellow rectangle. */
const WEBP_BASE64 = 'UklGRjIAAABXRUJQVlA4TCYAAAAvFAADAA9wTu67wF/Bd/5jCWoaSYF4hODfId10BAkR/Q+G6X1xAQ=='

/** 33 x 22 baseline grayscale JPEG, quality 30. */
const JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1tdhbWGkJ' +
  '6jq62rZ4C8ybqmx5moq6T/wAALCAAWACEBAREA/8QAFwABAQEBAAAAAAAAAAAAAAAAAAQFBv/EACUQAAEDAgQHAQAAAAAAAAAA' +
  'AAABAgMEEQYSIjUFFlNhc7HRkv/aAAgBAQAAPwDIoKKSvmWKJzGuRubUq2tdPpdy5WdSD9L8J6/hM9BCksr43NV2XSq3vZe3Yg' +
  'Br4Y3CTxL7Q6cyMT7fH5U9KcwAAAf/2Q=='

// =============================================================================
// PNG encoding
// =============================================================================

/** CRC-32 table, built once (PNG chunk checksums). */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32 of a buffer, as PNG defines it. */
function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** One PNG chunk: length, type, payload, CRC. */
function pngChunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length, 0)

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed), 0)

  return Buffer.concat([length, typed, crc])
}

/** A colour to paint into an encoded fixture. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Options for {@link encodePng}. */
export interface EncodePngOptions {
  /** Fill colour for every pixel. */
  fill: Rgba
  /**
   * When set, pixel (0, 0) gets this colour instead of `fill`.
   *
   * Used to put a fully transparent corner into an otherwise opaque image, so
   * "PNG export preserved alpha" and "the clipboard copy flattened it onto
   * white" are both single-pixel assertions.
   */
  corner?: Rgba
}

/**
 * Encode a real, decodable 8-bit RGBA PNG.
 *
 * @param width - Pixel width
 * @param height - Pixel height
 * @param options - Fill colour and optional corner override
 * @returns The complete PNG file bytes
 */
export function encodePng(width: number, height: number, options: EncodePngOptions): Buffer {
  const { fill, corner } = options

  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(height * (1 + width * 4))
  let offset = 0
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0
    for (let x = 0; x < width; x++) {
      const colour = corner && x === 0 && y === 0 ? corner : fill
      raw[offset++] = colour.r
      raw[offset++] = colour.g
      raw[offset++] = colour.b
      raw[offset++] = colour.a
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: truecolour with alpha
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** What {@link readPngHeader} reports about an encoded PNG. */
export interface PngHeader {
  width: number
  height: number
  /** PNG colour type; 6 is truecolour-with-alpha, 2 is truecolour. */
  colourType: number
}

/**
 * Read width, height and colour type out of a PNG's IHDR.
 *
 * Deliberately a byte read rather than a decode: the assertion "the exported
 * file really is a PNG of exactly this size" must not depend on any decoder,
 * least of all the one under test.
 *
 * @param buffer - Bytes of a file claimed to be a PNG
 * @returns The header fields
 * @throws When the buffer is not a PNG whose first chunk is IHDR
 */
export function readPngHeader(buffer: Buffer): PngHeader {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error('not a PNG file (signature mismatch)')
  }
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('not a PNG file (first chunk is not IHDR)')
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colourType: buffer[25]
  }
}

// =============================================================================
// BMP and ICO encoding
// =============================================================================

/**
 * Encode a 24-bit uncompressed BMP.
 *
 * @param width - Pixel width
 * @param height - Pixel height
 * @param colour - Fill colour (alpha ignored; BI_RGB has none)
 * @returns The complete BMP file bytes
 */
export function encodeBmp(width: number, height: number, colour: Rgba): Buffer {
  const rowStride = Math.ceil((width * 3) / 4) * 4
  const pixels = Buffer.alloc(rowStride * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * rowStride + x * 3
      pixels[at] = colour.b
      pixels[at + 1] = colour.g
      pixels[at + 2] = colour.r
    }
  }

  const header = Buffer.alloc(54)
  header.write('BM', 0, 'ascii')
  header.writeUInt32LE(54 + pixels.length, 2)
  header.writeUInt32LE(54, 10) // pixel data offset
  header.writeUInt32LE(40, 14) // BITMAPINFOHEADER size
  header.writeInt32LE(width, 18)
  header.writeInt32LE(height, 22) // positive: bottom-up
  header.writeUInt16LE(1, 26) // planes
  header.writeUInt16LE(24, 28) // bits per pixel
  header.writeUInt32LE(0, 30) // BI_RGB
  header.writeUInt32LE(pixels.length, 34)

  return Buffer.concat([header, pixels])
}

/**
 * Encode a multi-size ICO whose entries are PNG payloads.
 *
 * A PNG payload is legal in ICO and is what modern tooling emits; it also keeps
 * the fixture honest about the CR-1 gate, which re-runs the harness on the
 * extracted PNG slice when Chromium hands back the wrong size.
 *
 * @param payloads - One encoded PNG per entry, any order
 * @returns The complete ICO file bytes
 */
export function encodeIco(payloads: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(payloads.length, 4)

  const directory = Buffer.alloc(16 * payloads.length)
  let offset = header.length + directory.length

  payloads.forEach((entry, index) => {
    const at = index * 16
    // 0 means 256 in the ICO directory; every fixture size here is < 256.
    directory[at] = entry.size % 256
    directory[at + 1] = entry.size % 256
    directory[at + 2] = 0 // palette size
    directory[at + 3] = 0 // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += entry.png.length
  })

  return Buffer.concat([header, directory, ...payloads.map((entry) => entry.png)])
}

// =============================================================================
// SVG
// =============================================================================

/**
 * An SVG with a `viewBox` and no `width`/`height`.
 *
 * That is the shape requirement 4 is about: the intrinsic size comes from the
 * viewBox, and the export must rasterize at exactly 2x it.
 *
 * @param width - viewBox width
 * @param height - viewBox height
 * @returns SVG source text
 */
export function svgSource(width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#1f1f1f"/>` +
    `<circle cx="${width / 2}" cy="${height / 2}" r="${height / 4}" fill="#c8ff00"/>` +
    `</svg>\n`
  )
}

// =============================================================================
// The fixture set
// =============================================================================

/** One seeded image and the facts the export assertions are held to. */
export interface ImageFixture {
  /** Basename as seeded into the project and shown in the tree. */
  fileName: string
  /** File bytes. */
  bytes: Buffer
  /** Pixel size the export must produce (2x the viewBox for the SVG). */
  expected: { width: number; height: number }
}

/** Solid mid-grey, used wherever the colour does not matter. */
const GREY: Rgba = { r: 90, g: 90, b: 90, a: 255 }

/** Fully transparent, for the alpha-corner fixture. */
const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 }

/** The transparent-cornered PNG: 137 x 61, opaque except pixel (0, 0). */
export const ALPHA_PNG_SIZE = { width: 137, height: 61 }

/** Size of the SVG's viewBox; the export must be exactly twice it. */
export const SVG_VIEWBOX = { width: 100, height: 40 }

/** Size `fresh.png` is seeded at, before the fresh-from-disk rewrite. */
export const FRESH_PNG_SIZE = { width: 60, height: 30 }

/** Size `fresh.png` is rewritten to, to prove the second export re-read it. */
export const FRESH_PNG_REWRITTEN_SIZE = { width: 90, height: 45 }

/** Frames in `loop.gif`; the toast qualifier states this number. */
export const GIF_FRAME_COUNT = 3

/** Sizes in `favicon.ico`; the export must take the largest. */
export const ICO_SIZES = [16, 40]

/**
 * Size of `grid-defect.png`, a PNG whose HEIGHT lands on the pixel grid
 * Chromium's `printToPDF` rounds rather than reproduces exactly.
 *
 * Measured, not guessed: for any dimension where `px % 8 === 6` the produced
 * MediaBox comes back 0.54 pt over the requested value. 22 is such a height;
 * the width is deliberately a benign one, so the fixture isolates a single
 * axis.
 *
 * The gate's tolerance is one CSS pixel (0.75 pt), so this size exports
 * normally — the fixture is the regression test that keeps it that way, since a
 * tighter tolerance would refuse roughly one pixel size in eight, per axis, in
 * every format. See `image-export.matrix.e2e.ts`.
 */
export const PDF_GRID_DEFECT_SIZE = { width: 60, height: 22 }

/** Frame 0 of `loop.gif` is red — the proof that a later frame was not taken. */
export const GIF_FIRST_FRAME_COLOUR: Rgba = { r: 200, g: 40, b: 40, a: 255 }

/**
 * Keys of {@link IMAGE_FIXTURES} that are NOT format rows.
 *
 * `fresh` is the fresh-from-disk fixture and `gridDefect` is a deliberately
 * awkward pixel size; both are seeded like any other image, but neither stands
 * for a supported extension, so every per-format matrix skips them.
 */
export const NON_FORMAT_FIXTURE_KEYS = ['fresh', 'gridDefect'] as const

/**
 * Every seeded image, keyed by the extension it exercises.
 *
 * All eight supported extensions are present, which is what makes the
 * "8 formats x PNG export" case a real matrix rather than a sample. The two
 * keys in {@link NON_FORMAT_FIXTURE_KEYS} are extra fixtures, not rows.
 */
export const IMAGE_FIXTURES: Record<string, ImageFixture> = {
  png: {
    fileName: 'alpha.png',
    bytes: encodePng(ALPHA_PNG_SIZE.width, ALPHA_PNG_SIZE.height, {
      fill: GREY,
      corner: TRANSPARENT
    }),
    expected: ALPHA_PNG_SIZE
  },
  jpg: {
    fileName: 'photo.jpg',
    bytes: Buffer.from(JPEG_BASE64, 'base64'),
    expected: { width: 33, height: 22 }
  },
  jpeg: {
    fileName: 'photo-copy.jpeg',
    bytes: Buffer.from(JPEG_BASE64, 'base64'),
    expected: { width: 33, height: 22 }
  },
  gif: {
    fileName: 'loop.gif',
    bytes: Buffer.from(GIF_3_FRAME_BASE64, 'base64'),
    expected: { width: 24, height: 18 }
  },
  webp: {
    fileName: 'mark.webp',
    bytes: Buffer.from(WEBP_BASE64, 'base64'),
    expected: { width: 21, height: 13 }
  },
  svg: {
    fileName: 'chart.svg',
    bytes: Buffer.from(svgSource(SVG_VIEWBOX.width, SVG_VIEWBOX.height), 'utf-8'),
    expected: { width: SVG_VIEWBOX.width * 2, height: SVG_VIEWBOX.height * 2 }
  },
  bmp: {
    fileName: 'tile.bmp',
    bytes: encodeBmp(26, 14, GREY),
    expected: { width: 26, height: 14 }
  },
  ico: {
    fileName: 'favicon.ico',
    bytes: encodeIco(
      ICO_SIZES.map((size) => ({
        size,
        png: encodePng(size, size, { fill: GREY })
      }))
    ),
    expected: { width: Math.max(...ICO_SIZES), height: Math.max(...ICO_SIZES) }
  },
  gridDefect: {
    fileName: 'grid-defect.png',
    bytes: encodePng(PDF_GRID_DEFECT_SIZE.width, PDF_GRID_DEFECT_SIZE.height, { fill: GREY }),
    expected: PDF_GRID_DEFECT_SIZE
  },
  fresh: {
    fileName: 'fresh.png',
    bytes: encodePng(FRESH_PNG_SIZE.width, FRESH_PNG_SIZE.height, { fill: GREY }),
    expected: FRESH_PNG_SIZE
  }
}

/**
 * Write every fixture into a project directory.
 *
 * Called from a `testProject` fixture override so the files exist before the
 * Electron app launches and the project tree is first read — a file appearing
 * later would put the test at the mercy of the directory watcher.
 *
 * Asserts on the artefact, not on the write returning: an image tool that
 * silently produces zero bytes is a real failure mode, and a fixture that is
 * not on disk must fail here rather than as a mystery timeout in a spec.
 *
 * @param projectPath - Directory to seed
 * @throws When any fixture did not land on disk at its expected byte length
 */
export function writeImageFixtures(projectPath: string): void {
  for (const fixture of Object.values(IMAGE_FIXTURES)) {
    const target = path.join(projectPath, fixture.fileName)
    fs.writeFileSync(target, fixture.bytes)

    const written = fs.statSync(target).size
    if (written !== fixture.bytes.length) {
      throw new Error(
        `fixture ${fixture.fileName} wrote ${written} bytes, expected ${fixture.bytes.length}`
      )
    }
  }
}

/**
 * Rewrite `fresh.png` at a different pixel size.
 *
 * The fresh-from-disk requirement is only falsifiable if the second export can
 * be told apart from the first by its bytes alone, which is why the rewrite
 * changes the dimensions rather than the colour.
 *
 * @param projectPath - The seeded project directory
 */
export function rewriteFreshPng(projectPath: string): void {
  const bytes = encodePng(FRESH_PNG_REWRITTEN_SIZE.width, FRESH_PNG_REWRITTEN_SIZE.height, {
    fill: { r: 10, g: 200, b: 90, a: 255 }
  })
  fs.writeFileSync(path.join(projectPath, IMAGE_FIXTURES.fresh.fileName), bytes)
}
