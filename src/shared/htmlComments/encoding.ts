// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Lossless text decoding for comment writes
 * (docs/designs/html-preview-comments.md §3 "Non-UTF-8 files", §7.6 step 4).
 *
 * Erfana writes a comment by splicing decoded text and encoding it again, so
 * the decode must be exactly reversible or every byte outside the block would
 * be at risk (decision 24). Only UTF-8, with or without a BOM, qualifies:
 *
 * - a UTF-16 (or UTF-32) BOM, or NUL bytes (BOM-less UTF-16 is full of them,
 *   and NUL is never valid in an HTML document), is refused;
 * - an invalid sequence – a stray byte, an overlong form, an encoded
 *   surrogate – is refused (the decoder runs in `fatal` mode);
 * - a `<meta charset>` in the first 1,024 bytes that names anything other
 *   than UTF-8 is refused: an ASCII-only windows-1252 page decodes as UTF-8,
 *   but a UTF-8 comment written into it would be mis-read by every tool that
 *   honours the declaration;
 * - finally the decoded text is encoded again and must equal the input byte
 *   for byte.
 *
 * The BOM is kept as U+FEFF at the start of the text, so `encodeText` of the
 * decoded text reproduces it, and a file without one never gains one.
 */

/** Why a file cannot be decoded losslessly. */
export type DecodeFailure =
  /** A UTF-16 or UTF-32 byte order mark. */
  | 'utf16'
  /** NUL bytes: BOM-less UTF-16, or a binary file. */
  | 'nul-bytes'
  /** Not valid UTF-8. */
  | 'invalid-utf8'
  /** A `<meta charset>` naming a legacy encoding. */
  | 'declared-charset'
  /** Decoding and encoding again did not give the same bytes. */
  | 'round-trip'

/** Result of {@link decodeLossless}. */
export type DecodeResult =
  | { readonly ok: true; readonly text: string; readonly hasBom: boolean }
  | { readonly ok: false; readonly reason: DecodeFailure }

/** The prescan window browsers use for a `<meta charset>` (WHATWG encoding sniffing). */
export const CHARSET_PRESCAN_BYTES = 1_024

/**
 * Labels a `<meta charset>` may carry for a UTF-8 file. A meta naming UTF-16
 * is read as UTF-8 by browsers (the bytes are ASCII-compatible), so it is
 * accepted too.
 */
const UTF8_COMPATIBLE_LABELS: ReadonlySet<string> = new Set([
  'utf-8',
  'utf8',
  'unicode-1-1-utf-8',
  'unicode11utf8',
  'unicode20utf8',
  'x-unicode20utf8',
  'utf-16',
  'utf-16le',
  'utf-16be',
  'unicode',
  'unicodefeff',
  'unicodefffe',
  'ucs-2',
  'csunicode',
  'iso-10646-ucs-2'
])

/**
 * A `charset=` inside a `<meta …>` tag; covers both `<meta charset=x>` and
 * `<meta http-equiv="content-type" content="text/html; charset=x">`. Applied
 * only to the 1,024-byte prescan window, and `[^>]*` cannot backtrack across
 * a `>`, so it is linear.
 */
const META_CHARSET = /<meta\b[^>]*?charset\s*=\s*["']?\s*([^\s"'>;/]+)/gi

/** The byte order mark as a decoded character (built from its number: the source holds no invisible character). */
export const BOM_CHAR = String.fromCharCode(0xfeff)

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const encoder = new TextEncoder()

/** Encode text as UTF-8 bytes (a U+FEFF at the start becomes the BOM). */
export function encodeText(text: string): Uint8Array {
  return encoder.encode(text)
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

/** The labels of every `<meta charset>` in the prescan window, lowercased. */
export function declaredCharsets(bytes: Uint8Array): string[] {
  const window = bytes.subarray(0, CHARSET_PRESCAN_BYTES)
  // Latin-1 maps each byte to one character, so ASCII markup reads as itself.
  let head = ''
  for (const byte of window) head += String.fromCharCode(byte)
  return [...head.matchAll(META_CHARSET)].map(match => match[1].toLowerCase())
}

/**
 * Decode `bytes` as UTF-8, refusing anything that would not survive a
 * byte-identical round trip.
 */
export function decodeLossless(bytes: Uint8Array): DecodeResult {
  if (bytes.length >= 2) {
    const b0 = bytes[0]
    const b1 = bytes[1]
    if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff)) {
      return { ok: false, reason: 'utf16' }
    }
  }
  if (bytes.includes(0)) return { ok: false, reason: 'nul-bytes' }
  let text: string
  try {
    text = decoder.decode(bytes)
  } catch {
    return { ok: false, reason: 'invalid-utf8' }
  }
  if (declaredCharsets(bytes).some(label => !UTF8_COMPATIBLE_LABELS.has(label))) {
    return { ok: false, reason: 'declared-charset' }
  }
  if (!bytesEqual(encodeText(text), bytes)) return { ok: false, reason: 'round-trip' }
  return { ok: true, text, hasBom: text.startsWith(BOM_CHAR) }
}

/**
 * UTF-8 byte length of `text.slice(start, end)`, without allocating. A lone
 * surrogate counts 3 bytes, as `TextEncoder` writes it as U+FFFD.
 */
export function utf8Length(text: string, start = 0, end = text.length): number {
  let bytes = 0
  for (let i = start; i < end; i += 1) {
    const unit = text.charCodeAt(i)
    if (unit < 0x80) bytes += 1
    else if (unit < 0x800) bytes += 2
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < end) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i += 1
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}
