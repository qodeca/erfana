// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the GIF / ICO / SVG metadata parsers.
 *
 * Three properties are held to across every case:
 * - a malformed, truncated or hostile input returns `null`, and NEVER throws;
 * - a bounded walk really is bounded (the GIF block cap, the SVG 64 KB window);
 * - a parser never guesses — `null` means "omit the clause", not "assume".
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect } from 'vitest'
import { IMAGE_EXPORT } from '../../../shared/ipc/image-export-schema'
import { countGifFrames, readIcoDirectory, readSvgIntrinsicSize } from './imageMetadata'
import { gif, ico, png, utf8 } from './__fixtures__/imageBytes'

const SVG_WINDOW = IMAGE_EXPORT.SVG_HEADER_WINDOW_BYTES

describe('countGifFrames', () => {
  it('counts a single-frame GIF', () => {
    expect(countGifFrames(gif(4, 4, { frames: 1 }))).toBe(1)
  })

  it('counts an animated GIF', () => {
    expect(countGifFrames(gif(16, 16, { frames: 12, gct: true, graphicControl: true }))).toBe(12)
  })

  it('walks past a global colour table', () => {
    expect(countGifFrames(gif(4, 4, { frames: 3, gct: true }))).toBe(3)
  })

  it('walks past local colour tables', () => {
    expect(countGifFrames(gif(4, 4, { frames: 2, lct: true }))).toBe(2)
  })

  it('walks past comment and graphic-control extensions', () => {
    const bytes = gif(4, 4, { frames: 5, withComment: true, graphicControl: true })
    expect(countGifFrames(bytes)).toBe(5)
  })

  it('returns null for a file that is not a GIF', () => {
    expect(countGifFrames(png(4, 4))).toBeNull()
  })

  it('returns null for a GIF truncated before its trailer', () => {
    expect(countGifFrames(gif(4, 4, { frames: 2, truncated: true }))).toBeNull()
  })

  it('returns null for a header shorter than the logical screen descriptor', () => {
    expect(countGifFrames(utf8('GIF89'))).toBeNull()
  })

  it('returns null when the block stream loses sync', () => {
    const bytes = Array.from(gif(4, 4, { frames: 1 }))
    // Overwrite the image separator with a byte that is not a known marker.
    bytes[13] = 0x99
    expect(countGifFrames(Uint8Array.from(bytes))).toBeNull()
  })

  it('returns null rather than looping when the block budget is exceeded', () => {
    // A sub-block run of single-byte blocks, longer than MAX_GIF_BLOCKS.
    const run: number[] = []
    for (let i = 0; i < IMAGE_EXPORT.MAX_GIF_BLOCKS + 10; i++) run.push(1, 0x00)
    const bytes = Uint8Array.from([
      ...Array.from(utf8('GIF89a')),
      4, 0, 4, 0, 0, 0, 0,
      0x21, 0xfe, ...run, 0,
      0x3b
    ])
    expect(countGifFrames(bytes)).toBeNull()
  })
})

describe('readIcoDirectory', () => {
  it('reads every entry and picks the largest', () => {
    const directory = readIcoDirectory(ico([{ w: 16 }, { w: 32 }, { w: 48 }, { w: 0 }]))
    expect(directory?.entries).toHaveLength(4)
    expect(directory?.largest.width).toBe(256)
    expect(directory?.largest.height).toBe(256)
  })

  it('applies the 0 => 256 rule to both dimensions', () => {
    const directory = readIcoDirectory(ico([{ w: 0 }]))
    expect(directory?.entries[0]).toMatchObject({ width: 256, height: 256 })
  })

  it('reports the payload offset and length of the largest entry', () => {
    const directory = readIcoDirectory(ico([{ w: 16 }, { w: 32 }]))
    expect(directory?.largest.offset).toBeGreaterThan(0)
    expect(directory?.largest.byteLength).toBeGreaterThan(0)
  })

  it('returns null when the reserved field is not zero', () => {
    const bytes = Array.from(ico([{ w: 16 }]))
    bytes[0] = 1
    expect(readIcoDirectory(Uint8Array.from(bytes))).toBeNull()
  })

  it('returns null for an unknown type', () => {
    const bytes = Array.from(ico([{ w: 16 }]))
    bytes[2] = 9
    expect(readIcoDirectory(Uint8Array.from(bytes))).toBeNull()
  })

  it('returns null for a zero-entry directory', () => {
    expect(readIcoDirectory(Uint8Array.from([0, 0, 1, 0, 0, 0]))).toBeNull()
  })

  it('returns null when an entry claims a payload past the end of the file', () => {
    const bytes = ico([{ w: 16 }])
    // Blow up the declared payload length of entry 0.
    bytes[6 + 8] = 0xff
    bytes[6 + 9] = 0xff
    expect(readIcoDirectory(bytes)).toBeNull()
  })

  it('returns null for a truncated directory', () => {
    expect(readIcoDirectory(ico([{ w: 16 }, { w: 32 }]).subarray(0, 10))).toBeNull()
  })
})

describe('readSvgIntrinsicSize', () => {
  const svg = (attributes: string): Uint8Array => utf8(`<svg ${attributes}></svg>`)

  /**
   * Wall-clock ceiling for one bounded parse of a full 64 KB window.
   *
   * Generous on purpose. The verdict assertion beside each measurement is the
   * real proof of correctness, and the ReDoS these guards exist for is closed
   * twice over (a linear pattern AND `MAX_CSS_LENGTH_CHARS`), so the only job
   * left for a timing assertion is to catch a return to SECONDS. A tight budget
   * buys nothing here and fails on a loaded runner's GC pause; 250 ms is still
   * ~1/30th of the 7.8 s regression it guards.
   */
  const SVG_PARSE_BUDGET_MS = 250

  it.each([
    ['bare numbers', 'width="120" height="60"', 120, 60],
    ['px', 'width="120px" height="60px"', 120, 60],
    ['pt', 'width="72pt" height="36pt"', 96, 48],
    ['pc', 'width="6pc" height="3pc"', 96, 48],
    ['in', 'width="1in" height="2in"', 96, 192],
    ['cm', 'width="2.54cm" height="5.08cm"', 96, 192],
    ['mm', 'width="25.4mm" height="50.8mm"', 96, 192],
    ['single quotes', "width='40' height='20'", 40, 20],
    ['fractional', 'width="10.5" height="20.4"', 11, 20]
  ])('resolves %s', (_label, attributes, width, height) => {
    expect(readSvgIntrinsicSize(svg(attributes), SVG_WINDOW)).toEqual({ width, height })
  })

  it.each([
    ['percent', 'width="100%" height="50%"'],
    ['em', 'width="10em" height="5em"'],
    ['ex', 'width="10ex" height="5ex"'],
    ['rem', 'width="10rem" height="5rem"'],
    ['an unknown unit', 'width="10zz" height="5zz"']
  ])('falls through to the viewBox for %s', (_label, attributes) => {
    const bytes = svg(`${attributes} viewBox="0 0 100 40"`)
    expect(readSvgIntrinsicSize(bytes, SVG_WINDOW)).toEqual({ width: 100, height: 40 })
  })

  it('uses the viewBox when no width or height is declared', () => {
    expect(readSvgIntrinsicSize(svg('viewBox="0 0 200 80"'), SVG_WINDOW)).toEqual({
      width: 200,
      height: 80
    })
  })

  it('accepts a comma-separated viewBox', () => {
    expect(readSvgIntrinsicSize(svg('viewBox="0,0,200,80"'), SVG_WINDOW)).toEqual({
      width: 200,
      height: 80
    })
  })

  it('falls back to the CSS default when neither a size nor a viewBox is usable', () => {
    expect(readSvgIntrinsicSize(svg('xmlns="http://www.w3.org/2000/svg"'), SVG_WINDOW)).toEqual({
      width: IMAGE_EXPORT.SVG_DEFAULT_WIDTH,
      height: IMAGE_EXPORT.SVG_DEFAULT_HEIGHT
    })
  })

  it('ignores a non-positive declared size', () => {
    const bytes = svg('width="0" height="0" viewBox="0 0 10 20"')
    expect(readSvgIntrinsicSize(bytes, SVG_WINDOW)).toEqual({ width: 10, height: 20 })
  })

  it('returns null when the file is not an SVG at all', () => {
    expect(readSvgIntrinsicSize(png(4, 4), SVG_WINDOW)).toBeNull()
  })

  /**
   * A decoy root tag, ten times the real one, written where an editor or a
   * generator would legitimately leave it: in the preamble, as prose.
   */
  const COMMENTED_DECOY = '<!-- <svg width="10" height="10"></svg> -->'
  const CDATA_DECOY = '<![CDATA[ <svg width="10" height="10"></svg> ]]>'

  it.each([
    ['a comment', COMMENTED_DECOY],
    ['a CDATA section', CDATA_DECOY]
  ])('ignores an <svg> tag inside %s and sizes from the real root', (_label, decoy) => {
    const document = utf8(`<?xml version="1.0"?>${decoy}<svg width="2" height="2"></svg>`)
    expect(readSvgIntrinsicSize(document, SVG_WINDOW)).toEqual({ width: 2, height: 2 })
  })

  it('refuses a document whose ONLY <svg> tag is inside a comment', () => {
    expect(readSvgIntrinsicSize(utf8(COMMENTED_DECOY), SVG_WINDOW)).toBeNull()
  })

  it('reads the root that precedes a commented decoy', () => {
    const document = utf8(`<svg width="2" height="2">${COMMENTED_DECOY}</svg>`)
    expect(readSvgIntrinsicSize(document, SVG_WINDOW)).toEqual({ width: 2, height: 2 })
  })

  it('stays linear with a window full of comments', () => {
    // 8000 sections, then the real root, all inside the 64 KB window: a
    // strip that re-scanned from the start for every section would be
    // quadratic here, and the budget is what would catch that.
    const many = utf8(`${'<!--x-->'.repeat(8_000)}<svg width="2" height="2"></svg>`)
    const startedAt = performance.now()
    const size = readSvgIntrinsicSize(many, SVG_WINDOW)
    const elapsedMs = performance.now() - startedAt

    expect(size).toEqual({ width: 2, height: 2 })
    expect(elapsedMs).toBeLessThan(SVG_PARSE_BUDGET_MS)
  })

  it('returns null when the root element lies beyond the scan window', () => {
    const padded = utf8(`<!--${'x'.repeat(SVG_WINDOW)}--><svg width="10" height="10"></svg>`)
    expect(readSvgIntrinsicSize(padded, SVG_WINDOW)).toBeNull()
  })

  it('reads only the window, however large the file is', () => {
    const head = '<svg width="10" height="10">'
    const huge = utf8(head + 'y'.repeat(SVG_WINDOW * 2))
    expect(readSvgIntrinsicSize(huge, SVG_WINDOW)).toEqual({ width: 10, height: 10 })
  })

  it('never throws on random bytes', () => {
    const random = Uint8Array.from({ length: 512 }, (_value, index) => (index * 37) % 256)
    expect(() => readSvgIntrinsicSize(random, SVG_WINDOW)).not.toThrow()
  })

  /**
   * Regression guard: this input used to freeze the main-process event loop
   * for ~7.8 seconds.
   *
   * The old CSS-length pattern was `\d*\.?\d+`, where the two quantifiers
   * compete for the same digits — so a value that CANNOT match costs O(N^2)
   * backtracking. The trailing `!` is what makes it unmatchable, and the 64 KB
   * scan window is what SET the ceiling on N rather than capping the cost.
   */
  it('refuses a pathological length attribute in single-digit milliseconds', () => {
    const hostile = svg(`width="${'9'.repeat(65_000)}!" height="10" viewBox="0 0 10 20"`)
    // One warm-up so the measurement is about the parse, not first-call JIT.
    readSvgIntrinsicSize(svg('width="10" height="10"'), SVG_WINDOW)

    const startedAt = performance.now()
    const size = readSvgIntrinsicSize(hostile, SVG_WINDOW)
    const elapsedMs = performance.now() - startedAt

    // An unusable width falls through to the viewBox, exactly as any other
    // unreadable value does — the guard changes the cost, not the verdict.
    expect(size).toEqual({ width: 10, height: 20 })
    expect(elapsedMs).toBeLessThan(SVG_PARSE_BUDGET_MS)
  })
})
