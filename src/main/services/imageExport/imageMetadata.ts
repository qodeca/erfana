// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Reading the few facts an export needs out of an image's own bytes.
 *
 * Three questions, three total functions:
 *
 * - how many frames does this GIF have (so the toast can say "first frame of 12");
 * - what sizes does this ICO offer, and which is largest (requirement 5);
 * - what intrinsic size does this SVG declare (so it can be rasterized at 2x).
 *
 * ## These bytes are untrusted
 *
 * The file comes from the user's project and may be hostile or simply broken.
 * Two rules follow, and both are load-bearing rather than stylistic:
 *
 * 1. **NO XML PARSER IS USED, EVER.** The SVG intrinsic size is read with
 *    anchored, linear regular expressions over a bounded prefix of the file.
 *    Handing an untrusted SVG to a DTD-capable parser re-opens billion-laughs
 *    (main-process OOM) and XXE — where the width/height we read back becomes
 *    the oracle that exfiltrates the file that was read. The decision is
 *    recorded here, in the file, the way `docx/docxImageStrip.ts` records the
 *    opposite decision, so a later maintainer sees a choice rather than a gap.
 * 2. **Every walk is bounded.** All of this runs on the main-process event
 *    loop, where a freeze stalls the terminal the user is watching an agent
 *    work in. The GIF walk carries a hard block cap, the SVG scan sees at most
 *    a 64 KB window, and the ICO directory is bounded by its own count field.
 *
 * All three functions return `null` on malformed, truncated or hostile input.
 * They never throw and they never guess: a `null` makes the caller refuse the
 * export or omit a toast clause, which is always better than a confident lie.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { IMAGE_EXPORT } from '../../../shared/ipc/image-export-schema'

/** A `width x height` pair in CSS pixels. */
export interface PixelSize {
  width: number
  height: number
}

/** One entry of an ICO directory. */
export interface IcoEntry extends PixelSize {
  /** Byte offset of this entry's payload within the file. */
  offset: number
  /** Payload length in bytes. */
  byteLength: number
}

/** A parsed ICO directory, plus the entry the export must use. */
export interface IcoDirectory {
  entries: IcoEntry[]
  /** The entry with the most pixels. Requirement 5: the export uses this one. */
  largest: IcoEntry
}

/** `GIF87a` / `GIF89a` share this six-byte prefix shape. */
const GIF_SIGNATURE = 'GIF8'
/** Extension introducer — a metadata block, skipped. */
const GIF_EXTENSION_INTRODUCER = 0x21
/** Image separator — the start of one frame. */
const GIF_IMAGE_SEPARATOR = 0x2c
/** Trailer — end of file. */
const GIF_TRAILER = 0x3b
/** Bytes of the Logical Screen Descriptor that precede any colour table. */
const GIF_HEADER_BYTES = 13
/** Image Descriptor length, excluding the separator byte itself. */
const GIF_IMAGE_DESCRIPTOR_BYTES = 9
/** ICO/CUR file header: reserved, type, image count. */
const ICO_HEADER_BYTES = 6
/** One ICO directory entry. */
const ICO_ENTRY_BYTES = 16
/** A `0` in an ICO width/height byte means 256 — the format's escape hatch. */
const ICO_DIMENSION_256 = 256

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
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

/** Size in bytes of a GIF colour table described by a packed field. */
function colorTableBytes(packed: number): number {
  return (packed & 0x80) === 0 ? 0 : 3 * 2 ** ((packed & 0x07) + 1)
}

/**
 * Skip a run of GIF length-prefixed sub-blocks, terminated by a zero byte.
 *
 * @returns The offset just past the terminator, or `null` when the run is
 *          truncated or exceeds the shared block budget.
 */
function skipSubBlocks(bytes: Uint8Array, start: number, budget: { blocks: number }): number | null {
  let offset = start
  for (;;) {
    if (offset >= bytes.length) return null
    if (--budget.blocks < 0) return null
    const size = bytes[offset]
    offset += 1
    if (size === 0) return offset
    offset += size
  }
}

/**
 * Count the frames in a GIF.
 *
 * A GIF is a header, an optional global colour table, then a stream of blocks.
 * Only Image Descriptors are frames; comments, application blocks and
 * graphic-control extensions are skipped. The walk stops at the trailer.
 *
 * @param bytes - The whole file.
 * @returns The frame count, or `null` when the stream is malformed, truncated,
 *          or needs more than `MAX_GIF_BLOCKS` steps to walk.
 *
 * @example
 * ```ts
 * countGifFrames(animatedGifBytes) // 12
 * countGifFrames(notAGif)          // null
 * ```
 */
export function countGifFrames(bytes: Uint8Array): number | null {
  if (bytes.length < GIF_HEADER_BYTES) return null
  for (let i = 0; i < GIF_SIGNATURE.length; i++) {
    if (bytes[i] !== GIF_SIGNATURE.charCodeAt(i)) return null
  }

  // The Logical Screen Descriptor's packed field sits at offset 10 and says
  // whether a global colour table follows the 13-byte header.
  let offset = GIF_HEADER_BYTES + colorTableBytes(bytes[10])
  const budget = { blocks: IMAGE_EXPORT.MAX_GIF_BLOCKS }
  let frames = 0

  while (offset < bytes.length) {
    if (--budget.blocks < 0) return null
    const marker = bytes[offset]

    if (marker === GIF_TRAILER) return frames

    if (marker === GIF_EXTENSION_INTRODUCER) {
      // introducer + label, then the extension's own sub-blocks.
      const next = skipSubBlocks(bytes, offset + 2, budget)
      if (next === null) return null
      offset = next
      continue
    }

    if (marker === GIF_IMAGE_SEPARATOR) {
      const descriptorEnd = offset + 1 + GIF_IMAGE_DESCRIPTOR_BYTES
      if (descriptorEnd > bytes.length) return null
      const localTable = colorTableBytes(bytes[descriptorEnd - 1])
      // Local colour table, then the LZW minimum-code-size byte, then data.
      const next = skipSubBlocks(bytes, descriptorEnd + localTable + 1, budget)
      if (next === null) return null
      frames += 1
      offset = next
      continue
    }

    // Anything else means we lost sync with the block stream.
    return null
  }

  // Ran off the end without a trailer: truncated file.
  return null
}

/**
 * Read an ICO/CUR directory and pick the entry with the most pixels.
 *
 * The `0 => 256` escape in the width and height bytes is applied, so a modern
 * 256x256 icon does not read as a 0x0 one. Entries whose payload falls outside
 * the file are rejected, because the export slices those bytes on the ICO
 * contingency path.
 *
 * @param bytes - The whole file.
 * @returns The directory and its largest entry, or `null` when the header is
 *          not an icon, the count is zero, or an entry is out of bounds.
 */
export function readIcoDirectory(bytes: Uint8Array): IcoDirectory | null {
  if (bytes.length < ICO_HEADER_BYTES) return null
  if (readU16LE(bytes, 0) !== 0) return null

  const type = readU16LE(bytes, 2)
  if (type !== 1 && type !== 2) return null

  const count = readU16LE(bytes, 4)
  if (count === 0) return null
  if (bytes.length < ICO_HEADER_BYTES + count * ICO_ENTRY_BYTES) return null

  const entries: IcoEntry[] = []
  for (let i = 0; i < count; i++) {
    const base = ICO_HEADER_BYTES + i * ICO_ENTRY_BYTES
    const width = bytes[base] === 0 ? ICO_DIMENSION_256 : bytes[base]
    const height = bytes[base + 1] === 0 ? ICO_DIMENSION_256 : bytes[base + 1]
    const byteLength = readU32LE(bytes, base + 8)
    const offset = readU32LE(bytes, base + 12)

    if (byteLength === 0) return null
    if (offset < ICO_HEADER_BYTES) return null
    if (offset + byteLength > bytes.length) return null

    entries.push({ width, height, offset, byteLength })
  }

  const largest = entries.reduce((best, entry) =>
    entry.width * entry.height > best.width * best.height ? entry : best
  )
  return { entries, largest }
}

/** CSS absolute-length units, expressed in px (1 in = 96 px). */
const CSS_UNIT_TO_PX: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6
}

/** `<svg ...>` open tag, up to the first `>`. Linear, no nested quantifiers. */
const SVG_OPEN_TAG = /<svg\b[^>]*>/i

/**
 * Regions whose contents are text, not markup.
 *
 * `SVG_OPEN_TAG` is a plain scan, so a `<svg>` written inside an XML comment or
 * a CDATA block looks exactly like a root element to it. A document carrying
 * `<!-- <svg width="10" height="10"> -->` above its real 1 x 1 root would then
 * export at 20 x 20 - the silently wrong-sized output this module exists to
 * make impossible. They are removed before the scan instead.
 */
const IGNORED_SECTIONS = [
  { open: '<!--', close: '-->' },
  { open: '<![CDATA[', close: ']]>' }
] as const

/**
 * Remove every comment and CDATA section from a decoded markup window.
 *
 * Linear in the length of `text`: each section's opener is searched for from
 * the cursor and the result is cached until the cursor passes it, so an opener
 * is never re-scanned over ground already covered - and an opener that is
 * absent is searched for exactly once. No regular expression is involved, so
 * there is no backtracking to re-open the ReDoS this module already fixed once.
 *
 * An UNTERMINATED section swallows the rest of the window, which is the honest
 * reading: within the bytes available, everything after it is inside it. The
 * caller then finds no root tag and refuses the export rather than sizing it
 * from a decoy.
 *
 * @param text - Decoded prefix of the file
 * @returns The same text with comment and CDATA sections removed
 */
function stripIgnoredSections(text: string): string {
  // Index of each section's next opener, or -1 once it no longer occurs. Both
  // only ever move forward, which is what keeps the total work linear.
  const nextOpenAt = IGNORED_SECTIONS.map((section) => text.indexOf(section.open))

  let out = ''
  let cursor = 0
  while (cursor < text.length) {
    let chosen = -1
    for (let i = 0; i < IGNORED_SECTIONS.length; i++) {
      if (nextOpenAt[i] !== -1 && nextOpenAt[i] < cursor) {
        nextOpenAt[i] = text.indexOf(IGNORED_SECTIONS[i].open, cursor)
      }
      if (nextOpenAt[i] !== -1 && (chosen === -1 || nextOpenAt[i] < nextOpenAt[chosen])) {
        chosen = i
      }
    }

    if (chosen === -1) {
      out += text.slice(cursor)
      break
    }

    const section = IGNORED_SECTIONS[chosen]
    out += text.slice(cursor, nextOpenAt[chosen])
    const closesAt = text.indexOf(section.close, nextOpenAt[chosen] + section.open.length)
    if (closesAt === -1) break
    cursor = closesAt + section.close.length
  }
  return out
}
/** A `width=` / `height=` attribute with a single- or double-quoted value. */
const SVG_WIDTH_ATTR = /\bwidth\s*=\s*"([^"]*)"|\bwidth\s*=\s*'([^']*)'/i
const SVG_HEIGHT_ATTR = /\bheight\s*=\s*"([^"]*)"|\bheight\s*=\s*'([^']*)'/i
const SVG_VIEWBOX_ATTR = /\bviewBox\s*=\s*"([^"]*)"|\bviewBox\s*=\s*'([^']*)'/i
/**
 * A CSS length: an optional sign, digits, an optional fraction, an optional unit.
 *
 * The two number shapes (`12`, `12.5` | `.5`) are spelled as ALTERNATIVES on
 * purpose. The obvious `\d*\.?\d+` makes `\d*` and `\d+` compete for the same
 * digits, so a non-matching value of N digits costs O(N^2) backtracking — a
 * `width="<65000 nines>!"` on an SVG root tag froze the main-process event loop
 * for ~7.8 s. This form gives each digit exactly one owner, so a failure is
 * linear. Capture groups are unchanged: `100`, `100.5`, `.5`, `+2`, `-3`,
 * `12pt`, `12 pt`, `100%` match identically, and `1.`, `abc`, `1e3`, `""`, `0`
 * are rejected identically.
 */
const CSS_LENGTH = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*([a-z%]*)$/i

/**
 * Longest attribute value `resolveSvgLength` will even look at.
 *
 * A real CSS length is a handful of characters; `-0.000000001234567px` is 20.
 * The cap is belt-and-braces next to the linear regex above: it keeps ANY
 * future edit to that pattern from re-opening a main-process freeze, and it
 * costs one comparison.
 */
const MAX_CSS_LENGTH_CHARS = 64

/**
 * Resolve one SVG length attribute to CSS pixels.
 *
 * Absolute units convert by their CSS factor. RELATIVE and font-relative units
 * (`%`, `em`, `ex`, `rem`, `ch`, `vw`, ...) have no meaning without a
 * containing block or a computed font size, and an unknown unit is simply not
 * understood — all of those return `null` so the caller falls through to the
 * `viewBox`, which is the only other thing that carries real geometry.
 *
 * @returns Pixels (> 0), or `null` when the value is relative, unparseable,
 *          non-positive, or longer than `MAX_CSS_LENGTH_CHARS`.
 */
function resolveSvgLength(raw: string | undefined): number | null {
  if (!raw) return null
  if (raw.length > MAX_CSS_LENGTH_CHARS) return null
  const match = CSS_LENGTH.exec(raw.trim())
  if (!match) return null

  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value) || value <= 0) return null

  const unit = match[2].toLowerCase()
  if (unit === '') return value
  const factor = CSS_UNIT_TO_PX[unit]
  if (factor === undefined) return null
  return value * factor
}

/** Pull the value out of the two alternation groups of an attribute regex. */
function attributeValue(source: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(source)
  if (!match) return undefined
  return match[1] ?? match[2]
}

/** `viewBox="minX minY width height"` → the width/height half, if usable. */
function readViewBoxSize(openTag: string): PixelSize | null {
  const raw = attributeValue(openTag, SVG_VIEWBOX_ATTR)
  if (!raw) return null
  const parts = raw.trim().split(/[\s,]+/)
  if (parts.length !== 4) return null
  const width = Number.parseFloat(parts[2])
  const height = Number.parseFloat(parts[3])
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

/**
 * Read the intrinsic size an SVG declares.
 *
 * Resolution order matches how a browser sizes a replaced SVG element:
 * explicit `width` + `height` in absolute units first, then the `viewBox`,
 * then the CSS default of 300 x 150.
 *
 * Only the first `windowBytes` of the file are decoded and scanned, and
 * comments and CDATA sections are removed from that window first so a `<svg>`
 * written inside one cannot be mistaken for the root. A document whose root
 * element does not appear in the remaining text is treated as unreadable rather
 * than assumed — `null` makes the export refuse rather than produce a
 * wrongly-sized image.
 *
 * @param bytes - The whole file; only a bounded prefix is looked at.
 * @param windowBytes - How much to decode. Pass `IMAGE_EXPORT.SVG_HEADER_WINDOW_BYTES`.
 * @returns Rounded pixel dimensions, or `null` when no `<svg>` open tag is
 *          found inside the window.
 */
export function readSvgIntrinsicSize(bytes: Uint8Array, windowBytes: number): PixelSize | null {
  const head = bytes.subarray(0, Math.max(0, windowBytes))
  // `fatal: false` so a multi-byte character sliced by the window boundary
  // degrades to a replacement char instead of throwing.
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(head)
  // Comments and CDATA first: a `<svg>` written inside either is prose, and
  // sizing the export from it would produce a wrongly-scaled file.
  const text = stripIgnoredSections(decoded)

  const openTag = SVG_OPEN_TAG.exec(text)?.[0]
  if (!openTag) return null

  const width = resolveSvgLength(attributeValue(openTag, SVG_WIDTH_ATTR))
  const height = resolveSvgLength(attributeValue(openTag, SVG_HEIGHT_ATTR))
  if (width !== null && height !== null) {
    return { width: Math.round(width), height: Math.round(height) }
  }

  const viewBox = readViewBoxSize(openTag)
  if (viewBox) {
    return { width: Math.round(viewBox.width), height: Math.round(viewBox.height) }
  }

  return { width: IMAGE_EXPORT.SVG_DEFAULT_WIDTH, height: IMAGE_EXPORT.SVG_DEFAULT_HEIGHT }
}
