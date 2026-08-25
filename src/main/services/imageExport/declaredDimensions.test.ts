// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the declared-dimension preflight.
 *
 * This parser is the decompression-bomb guard, so the cases that matter most
 * are the negative ones: a truncated header, a wrong signature and a capped
 * walk must all produce `null`, because `null` is what makes the export refuse
 * instead of handing unverified bytes to a renderer.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect } from 'vitest'
import { readDeclaredDimensions } from './declaredDimensions'
import {
  ascii,
  bmp,
  bytes,
  gif,
  ico,
  jpegWithSof,
  png,
  u16be,
  utf8,
  webpVp8,
  webpVp8x
} from './__fixtures__/imageBytes'

describe('readDeclaredDimensions', () => {
  it('reads a PNG IHDR', () => {
    expect(readDeclaredDimensions(png(137, 61), '.png')).toEqual({ width: 137, height: 61 })
  })

  it('reads a GIF logical screen descriptor', () => {
    expect(readDeclaredDimensions(gif(320, 240, { frames: 1 }), '.gif')).toEqual({
      width: 320,
      height: 240
    })
  })

  it('reads a BMP BITMAPINFOHEADER', () => {
    expect(readDeclaredDimensions(bmp(64, 48), '.bmp')).toEqual({ width: 64, height: 48 })
  })

  it('treats a negative BMP height as top-down row order, not a negative size', () => {
    expect(readDeclaredDimensions(bmp(64, -48), '.bmp')).toEqual({ width: 64, height: 48 })
  })

  it('reads an extended WebP canvas size', () => {
    expect(readDeclaredDimensions(webpVp8x(800, 600), '.webp')).toEqual({
      width: 800,
      height: 600
    })
  })

  it('reads a lossy WebP frame size', () => {
    expect(readDeclaredDimensions(webpVp8(300, 150), '.webp')).toEqual({
      width: 300,
      height: 150
    })
  })

  it('reads the largest entry of an ICO directory', () => {
    expect(readDeclaredDimensions(ico([{ w: 16 }, { w: 32 }, { w: 0 }]), '.ico')).toEqual({
      width: 256,
      height: 256
    })
  })

  it.each([0xc0, 0xc1, 0xc2, 0xc3, 0xc9, 0xca, 0xcf])(
    'reads a JPEG SOF marker 0x%s',
    (marker) => {
      expect(readDeclaredDimensions(jpegWithSof(marker, 1024, 768), '.jpg')).toEqual({
        width: 1024,
        height: 768
      })
    }
  )

  it('accepts .jpeg as well as .jpg', () => {
    expect(readDeclaredDimensions(jpegWithSof(0xc0, 10, 20), '.jpeg')).toEqual({
      width: 10,
      height: 20
    })
  })

  it('does not mistake a Huffman table for a frame header', () => {
    // 0xC4 shares the SOF numeric range but is DHT. A file that carries only a
    // DHT and no SOF has no declared size.
    const noFrame = bytes([0xff, 0xd8], [0xff, 0xc4], u16be(4), [0, 0])
    expect(readDeclaredDimensions(noFrame, '.jpg')).toBeNull()
  })

  it('returns null for a JPEG whose segment chain does not lead to a marker', () => {
    const broken = bytes([0xff, 0xd8], [0xff, 0xe0], u16be(4), [0x00, 0x00], [0x11, 0x22])
    expect(readDeclaredDimensions(broken, '.jpg')).toBeNull()
  })

  it('returns null when the extension does not match the bytes', () => {
    expect(readDeclaredDimensions(png(4, 4), '.gif')).toBeNull()
    expect(readDeclaredDimensions(gif(4, 4, { frames: 1 }), '.png')).toBeNull()
  })

  it('returns null for SVG, which has no pixel header', () => {
    expect(readDeclaredDimensions(utf8('<svg width="10" height="10"/>'), '.svg')).toBeNull()
  })

  it('returns null for an unsupported extension', () => {
    expect(readDeclaredDimensions(png(4, 4), '.tiff')).toBeNull()
  })

  it.each([
    ['.png', png(10, 10)],
    ['.gif', gif(10, 10, { frames: 1 })],
    ['.bmp', bmp(10, 10)],
    ['.webp', webpVp8x(10, 10)],
    ['.jpg', jpegWithSof(0xc0, 10, 10)],
    ['.ico', ico([{ w: 16 }])]
  ])('returns null for a truncated %s', (extension, full) => {
    expect(readDeclaredDimensions(full.subarray(0, 8), extension)).toBeNull()
  })

  it('returns null for a zero-sized PNG', () => {
    expect(readDeclaredDimensions(png(0, 10), '.png')).toBeNull()
  })

  it('returns null for a RIFF container that is not WebP', () => {
    const notWebp = bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('AVI '), new Uint8Array(20))
    expect(readDeclaredDimensions(notWebp, '.webp')).toBeNull()
  })

  it('returns a declared size far larger than the file, which is the point', () => {
    // A 40-byte "PNG" declaring 60000 x 60000: the caller compares this against
    // the pixel cap and refuses BEFORE any decoder sees the bytes.
    const bomb = png(60_000, 60_000)
    expect(bomb.byteLength).toBeLessThan(64)
    expect(readDeclaredDimensions(bomb, '.png')).toEqual({ width: 60_000, height: 60_000 })
  })

  it('never throws on random bytes', () => {
    const random = Uint8Array.from({ length: 256 }, (_value, index) => (index * 91) % 256)
    for (const extension of ['.png', '.jpg', '.gif', '.bmp', '.webp', '.ico']) {
      expect(() => readDeclaredDimensions(random, extension)).not.toThrow()
    }
  })
})
