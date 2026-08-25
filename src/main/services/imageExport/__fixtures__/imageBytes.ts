// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Byte builders for the image-export parser tests.
 *
 * Every parser under `src/main/services/imageExport/` consumes raw file bytes,
 * so the honest fixture for one is a hand-built buffer rather than a checked-in
 * binary. That is deliberate on three counts: no third-party image bytes enter
 * the repository (which would raise a REUSE licensing question over files that
 * cannot carry an SPDX header), the fixture IS the format specification the
 * parser is being held to, and malformed and truncated inputs become
 * first-class cases instead of things nobody could produce.
 *
 * These builders produce structurally valid HEADERS. They do not produce
 * decodable images and are not meant to — nothing here is ever decoded.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

/** Concatenate byte chunks into one buffer. */
export function bytes(...parts: Array<number[] | Uint8Array>): Uint8Array {
  const flat: number[] = []
  for (const part of parts) flat.push(...Array.from(part))
  return Uint8Array.from(flat)
}

/** Big-endian uint32. */
export function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

/** Big-endian uint16. */
export function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

/** Little-endian uint16. */
export function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff]
}

/** Little-endian uint32. */
export function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
}

/** ASCII string as bytes. */
export function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0))
}

/** A PNG file header: signature + IHDR chunk. */
export function png(width: number, height: number): Uint8Array {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    u32be(13),
    ascii('IHDR'),
    u32be(width),
    u32be(height),
    [8, 6, 0, 0, 0]
  )
}

/** Options for {@link gif}. */
export interface GifOptions {
  frames: number
  /** Include a global colour table (2 entries, 6 bytes). */
  gct?: boolean
  /** Include a local colour table on every frame. */
  lct?: boolean
  /** Prefix each frame with a graphic-control extension. */
  graphicControl?: boolean
  /** Include one comment extension before the frames. */
  withComment?: boolean
  /** Omit the trailer, as a truncated file would. */
  truncated?: boolean
}

/** One length-prefixed sub-block run, terminated. */
function subBlocks(...blocks: number[][]): number[] {
  const out: number[] = []
  for (const block of blocks) out.push(block.length, ...block)
  out.push(0)
  return out
}

/** A GIF89a file with a chosen number of frames. */
export function gif(width: number, height: number, options: GifOptions): Uint8Array {
  const packed = options.gct ? 0x80 : 0x00
  const parts: number[] = [
    ...ascii('GIF89a'),
    ...u16le(width),
    ...u16le(height),
    packed,
    0,
    0
  ]
  if (options.gct) parts.push(0, 0, 0, 255, 255, 255)
  if (options.withComment) parts.push(0x21, 0xfe, ...subBlocks(ascii('made by a test')))

  for (let frame = 0; frame < options.frames; frame++) {
    if (options.graphicControl) parts.push(0x21, 0xf9, ...subBlocks([0x04, 0x0a, 0x00, 0x00]))
    const framePacked = options.lct ? 0x80 : 0x00
    parts.push(
      0x2c,
      ...u16le(0),
      ...u16le(0),
      ...u16le(width),
      ...u16le(height),
      framePacked
    )
    if (options.lct) parts.push(0, 0, 0, 255, 255, 255)
    parts.push(0x02, ...subBlocks([0x44, 0x01]))
  }

  if (!options.truncated) parts.push(0x3b)
  return Uint8Array.from(parts)
}

/** One entry in a synthetic ICO directory. */
export interface IcoEntrySpec {
  /** Width byte; `0` means 256 in the ICO format. */
  w: number
  /** Height byte; defaults to `w`. */
  h?: number
  /** Payload flavour — a PNG-signed slice, or a BMP one. */
  payload?: 'png' | 'bmp'
  /**
   * Size the PNG payload's OWN header declares, when it should differ from the
   * directory entry. Defaults to the entry size. A directory entry cannot
   * express more than 256, so this is the only way to build the icon-shaped
   * decompression bomb: a "256 x 256" entry whose IHDR claims 60000 x 60000.
   */
  payloadSize?: number
}

/** An ICO file with a directory and one payload per entry. */
export function ico(entries: IcoEntrySpec[]): Uint8Array {
  const header = [...u16le(0), ...u16le(1), ...u16le(entries.length)]
  const directoryBytes = 6 + entries.length * 16
  const payloads: number[][] = entries.map((entry) => {
    const size = entry.w === 0 ? 256 : entry.w
    const declared = entry.payloadSize ?? size
    return entry.payload === 'bmp'
      ? [...u32le(40), ...u32le(size), ...u32le(size * 2), 0, 0, 0, 0]
      : Array.from(png(declared, declared))
  })

  let offset = directoryBytes
  const directory: number[] = []
  entries.forEach((entry, index) => {
    directory.push(
      entry.w,
      entry.h ?? entry.w,
      0,
      0,
      ...u16le(1),
      ...u16le(32),
      ...u32le(payloads[index].length),
      ...u32le(offset)
    )
    offset += payloads[index].length
  })

  return Uint8Array.from([...header, ...directory, ...payloads.flat()])
}

/** A JPEG with one APP0 segment and one Start-Of-Frame of the given marker. */
export function jpegWithSof(marker: number, width: number, height: number): Uint8Array {
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0],
    u16be(16),
    ascii('JFIF\0'),
    [1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, marker],
    u16be(11),
    [8],
    u16be(height),
    u16be(width),
    [1, 1, 0x11, 0]
  )
}

/** A BMP with a BITMAPINFOHEADER. `height` may be negative (top-down rows). */
export function bmp(width: number, height: number): Uint8Array {
  return bytes(
    ascii('BM'),
    u32le(70),
    u16le(0),
    u16le(0),
    u32le(54),
    u32le(40),
    u32le(width >>> 0),
    u32le(height >>> 0),
    u16le(1),
    u16le(24),
    u32le(0),
    u32le(16)
  )
}

/** A WebP in the extended (`VP8X`) flavour. */
export function webpVp8x(width: number, height: number): Uint8Array {
  return bytes(
    ascii('RIFF'),
    u32le(30),
    ascii('WEBP'),
    ascii('VP8X'),
    u32le(10),
    [0x10, 0, 0, 0],
    [(width - 1) & 0xff, ((width - 1) >>> 8) & 0xff, ((width - 1) >>> 16) & 0xff],
    [(height - 1) & 0xff, ((height - 1) >>> 8) & 0xff, ((height - 1) >>> 16) & 0xff]
  )
}

/** A WebP in the lossy (`VP8 `) flavour. */
export function webpVp8(width: number, height: number): Uint8Array {
  return bytes(
    ascii('RIFF'),
    u32le(30),
    ascii('WEBP'),
    ascii('VP8 '),
    u32le(10),
    [0x00, 0x00, 0x00],
    [0x9d, 0x01, 0x2a],
    u16le(width),
    u16le(height)
  )
}

/** UTF-8 bytes of a string, for the SVG cases. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}
