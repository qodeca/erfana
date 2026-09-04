// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Reading the dimensions an image file DECLARES, before anything decodes it.
 *
 * This is the decompression-bomb guard. A 40 KB PNG can declare 60000 x 60000
 * in its IHDR; by the time Chromium has been asked to decode it, the shared
 * GPU process has already tried to allocate ~14 GB and the whole app is gone.
 * Checking the pixel budget against the harness's REPORTED size is therefore
 * too late — the check has to happen against the header, in main, on the same
 * authoritative buffer the bytes will be sent from.
 *
 * Every parser here is total and bounded: it reads a fixed offset (or, for
 * JPEG, walks a capped number of markers) and returns `null` the moment the
 * bytes stop making sense. `null` is a refusal, not a fallback — the caller
 * fails the export with `IMAGE_EXPORT_DECODE_FAILED` rather than sending
 * unverified bytes into a renderer.
 *
 * SVG is not handled here and never will be: it declares CSS lengths, not
 * pixels, and its size is resolved by `readSvgIntrinsicSize` instead.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 * @see ./imageMetadata.ts for the GIF / ICO / SVG metadata parsers
 */
import { IMAGE_EXPORT } from '../../../shared/ipc/image-export-schema'
import { readIcoDirectory, type PixelSize } from './imageMetadata'

/** PNG's eight-byte signature. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** IHDR must be the first chunk; its width sits at 16, its height at 20. */
const PNG_IHDR_WIDTH_OFFSET = 16
/** JPEG start-of-image marker. */
const JPEG_SOI = 0xd8
/** Markers in this range are Start-Of-Frame variants and carry the size... */
const JPEG_SOF_FIRST = 0xc0
const JPEG_SOF_LAST = 0xcf
/** ...except these three, which share the numeric range but are not frames. */
const JPEG_NON_SOF = new Set([0xc4, 0xc8, 0xcc])
/** Standalone markers that carry no length field. */
const JPEG_STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7])
/** Size of the BITMAPCOREHEADER, the only DIB header with 16-bit dimensions. */
const BMP_CORE_HEADER_SIZE = 12

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  )
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function readI32LE(bytes: Uint8Array, offset: number): number {
  return readU32LE(bytes, offset) | 0
}

/** `true` when `bytes` carries `ascii` at `offset`. */
function matchesAscii(bytes: Uint8Array, offset: number, ascii: string): boolean {
  if (offset + ascii.length > bytes.length) return false
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false
  }
  return true
}

/** A size is only usable if both sides are positive integers. */
function toSize(width: number, height: number): PixelSize | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

function readPngSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < PNG_IHDR_WIDTH_OFFSET + 8) return null
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null
  }
  if (!matchesAscii(bytes, 12, 'IHDR')) return null
  return toSize(
    readU32BE(bytes, PNG_IHDR_WIDTH_OFFSET),
    readU32BE(bytes, PNG_IHDR_WIDTH_OFFSET + 4)
  )
}

function readGifSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 10) return null
  if (!matchesAscii(bytes, 0, 'GIF8')) return null
  return toSize(readU16LE(bytes, 6), readU16LE(bytes, 8))
}

function readBmpSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 26) return null
  if (!matchesAscii(bytes, 0, 'BM')) return null

  const headerSize = readU32LE(bytes, 14)
  if (headerSize === BMP_CORE_HEADER_SIZE) {
    return toSize(readU16LE(bytes, 18), readU16LE(bytes, 20))
  }
  // Every later DIB header (INFO, V4, V5) keeps 32-bit signed dimensions at
  // the same offsets. A negative height means a top-down row order, not a
  // negative size.
  return toSize(Math.abs(readI32LE(bytes, 18)), Math.abs(readI32LE(bytes, 22)))
}

/** WebP stores the size differently in each of its three chunk flavours. */
function readWebpSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 30) return null
  if (!matchesAscii(bytes, 0, 'RIFF') || !matchesAscii(bytes, 8, 'WEBP')) return null

  if (matchesAscii(bytes, 12, 'VP8X')) {
    // Extended format: 24-bit little-endian canvas size, stored minus one.
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1
    return toSize(width, height)
  }

  if (matchesAscii(bytes, 12, 'VP8 ')) {
    // Lossy: a 3-byte frame tag, then the 3-byte sync code, then 14-bit sizes.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    return toSize(readU16LE(bytes, 26) & 0x3fff, readU16LE(bytes, 28) & 0x3fff)
  }

  if (matchesAscii(bytes, 12, 'VP8L')) {
    // Lossless: a signature byte, then two 14-bit fields packed across 4 bytes.
    if (bytes[20] !== 0x2f) return null
    const packed = readU32LE(bytes, 21)
    return toSize((packed & 0x3fff) + 1, ((packed >> 14) & 0x3fff) + 1)
  }

  return null
}

/**
 * Walk a JPEG's marker segments until a Start-Of-Frame is found.
 *
 * Bounded by `MAX_JPEG_MARKERS`: a hostile file can otherwise be a very long
 * chain of tiny segments, and this runs on the main event loop.
 */
function readJpegSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length < 4) return null
  if (bytes[0] !== 0xff || bytes[1] !== JPEG_SOI) return null

  let offset = 2
  for (let marker = 0; marker < IMAGE_EXPORT.MAX_JPEG_MARKERS; marker++) {
    // Fill bytes (0xFF padding) are legal between segments.
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null

    const code = bytes[offset]
    offset += 1
    if (JPEG_STANDALONE.has(code)) continue

    if (offset + 2 > bytes.length) return null
    const segmentLength = readU16BE(bytes, offset)
    if (segmentLength < 2) return null

    if (code >= JPEG_SOF_FIRST && code <= JPEG_SOF_LAST && !JPEG_NON_SOF.has(code)) {
      // SOF payload: precision(1), height(2), width(2).
      if (offset + 7 > bytes.length) return null
      return toSize(readU16BE(bytes, offset + 5), readU16BE(bytes, offset + 3))
    }

    offset += segmentLength
    // The next segment must start on a marker prefix; anything else means we
    // walked into entropy-coded data and cannot trust what follows.
    if (offset >= bytes.length || bytes[offset] !== 0xff) return null
  }
  return null
}

function readIcoSize(bytes: Uint8Array): PixelSize | null {
  const directory = readIcoDirectory(bytes)
  if (!directory) return null
  return toSize(directory.largest.width, directory.largest.height)
}

/**
 * Read the dimensions a raster image file declares in its header.
 *
 * @param bytes - The whole file, as read fresh from disk.
 * @param extension - Lower-cased extension including the dot (`.png`).
 * @returns The declared size, or `null` for a malformed, truncated or
 *          unsupported file. `.svg` always returns `null` — it has no pixel
 *          header, and callers must use `readSvgIntrinsicSize` instead.
 *
 * @example
 * ```ts
 * readDeclaredDimensions(pngBytes, '.png') // { width: 137, height: 61 }
 * readDeclaredDimensions(truncated, '.png') // null → refuse the export
 * ```
 */
export function readDeclaredDimensions(bytes: Uint8Array, extension: string): PixelSize | null {
  switch (extension.toLowerCase()) {
    case '.png':
      return readPngSize(bytes)
    case '.jpg':
    case '.jpeg':
      return readJpegSize(bytes)
    case '.gif':
      return readGifSize(bytes)
    case '.bmp':
      return readBmpSize(bytes)
    case '.webp':
      return readWebpSize(bytes)
    case '.ico':
      return readIcoSize(bytes)
    default:
      return null
  }
}
