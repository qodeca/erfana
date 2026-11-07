// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Punycode (RFC 3492) for one host label, both directions (spec 025,
 * panel finding S9).
 *
 * The URL parser hands Erfana hosts in their ASCII (`xn--`) form; the origin
 * formatter decodes a label only to decide whether it may be shown in Unicode,
 * and the public-suffix list holds some rules in Unicode that are encoded
 * once for lookup. Node's `url.domainToUnicode` is not available in the
 * renderer, so both directions live here.
 *
 * Both functions work on a single label without the `xn--` prefix and return
 * `null` for input that is not valid punycode, never throw.
 */

const BASE = 36
const T_MIN = 1
const T_MAX = 26
const SKEW = 38
const DAMP = 700
const INITIAL_BIAS = 72
const INITIAL_N = 128
const DELIMITER = '-'
const MAX_INT = 0x7fffffff
const MAX_CODE_POINT = 0x10ffff

/** The ASCII Compatible Encoding prefix of an encoded label. */
export const ACE_PREFIX = 'xn--'

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1
  d += Math.floor(d / numPoints)
  let k = 0
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN))
    k += BASE
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW))
}

/** The digit value of a basic code point, or -1. */
function digitOf(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26
  if (code >= 0x41 && code <= 0x5a) return code - 0x41
  if (code >= 0x61 && code <= 0x7a) return code - 0x61
  return -1
}

/** The basic code point for a digit value (lower case). */
function digitChar(d: number): number {
  return d < 26 ? d + 0x61 : d - 26 + 0x30
}

function threshold(k: number, bias: number): number {
  if (k <= bias) return T_MIN
  if (k >= bias + T_MAX) return T_MAX
  return k - bias
}

/** Decode the punycode part of a label (after `xn--`) to Unicode, or `null`. */
export function decodePunycodeLabel(input: string): string | null {
  const lastDelimiter = input.lastIndexOf(DELIMITER)
  const output: number[] = []
  for (let j = 0; j < Math.max(lastDelimiter, 0); j++) {
    const code = input.charCodeAt(j)
    if (code >= 0x80) return null
    output.push(code)
  }
  let n = INITIAL_N
  let bias = INITIAL_BIAS
  let i = 0
  let pos = lastDelimiter > 0 ? lastDelimiter + 1 : 0
  while (pos < input.length) {
    const oldI = i
    let w = 1
    for (let k = BASE; ; k += BASE) {
      if (pos >= input.length) return null
      const digit = digitOf(input.charCodeAt(pos++))
      if (digit < 0 || digit > Math.floor((MAX_INT - i) / w)) return null
      i += digit * w
      const t = threshold(k, bias)
      if (digit < t) break
      if (w > Math.floor(MAX_INT / (BASE - t))) return null
      w *= BASE - t
    }
    const length = output.length + 1
    bias = adapt(i - oldI, length, oldI === 0)
    if (Math.floor(i / length) > MAX_CODE_POINT - n) return null
    n += Math.floor(i / length)
    i %= length
    if (n > MAX_CODE_POINT || (n >= 0xd800 && n <= 0xdfff)) return null
    output.splice(i, 0, n)
    i++
  }
  return String.fromCodePoint(...output)
}

/** Encode a Unicode label to its punycode part (without `xn--`), or `null`. */
export function encodePunycodeLabel(input: string): string | null {
  const codes = Array.from(input, ch => ch.codePointAt(0) ?? 0)
  const basic = codes.filter(c => c < 0x80)
  const out: number[] = [...basic]
  const basicLength = basic.length
  let handled = basicLength
  if (basicLength > 0) out.push(DELIMITER.charCodeAt(0))
  let n = INITIAL_N
  let delta = 0
  let bias = INITIAL_BIAS
  while (handled < codes.length) {
    const m = Math.min(...codes.filter(c => c >= n))
    if (m - n > Math.floor((MAX_INT - delta) / (handled + 1))) return null
    delta += (m - n) * (handled + 1)
    n = m
    for (const c of codes) {
      if (c < n && ++delta > MAX_INT) return null
      if (c !== n) continue
      let q = delta
      for (let k = BASE; ; k += BASE) {
        const t = threshold(k, bias)
        if (q < t) break
        out.push(digitChar(t + ((q - t) % (BASE - t))))
        q = Math.floor((q - t) / (BASE - t))
      }
      out.push(digitChar(q))
      bias = adapt(delta, handled + 1, handled === basicLength)
      delta = 0
      handled++
    }
    delta++
    n++
  }
  return String.fromCharCode(...out)
}

/** A host label in Unicode: `xn--` labels decoded, others as they are; `null` if invalid. */
export function labelToUnicode(label: string): string | null {
  if (!label.toLowerCase().startsWith(ACE_PREFIX)) return label
  return decodePunycodeLabel(label.slice(ACE_PREFIX.length).toLowerCase())
}

/** A host label in ASCII: non-ASCII labels encoded with `xn--`; `null` if invalid. */
export function labelToAscii(label: string): string | null {
  // eslint-disable-next-line no-control-regex -- the ASCII range is the point
  if (/^[\u0000-\u007f]*$/.test(label)) return label
  const encoded = encodePunycodeLabel(label)
  return encoded === null ? null : `${ACE_PREFIX}${encoded}`
}
