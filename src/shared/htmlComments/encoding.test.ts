// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Lossless decoding (docs/designs/html-preview-comments.md §3 "Non-UTF-8
 * files"; U-094): only a byte-identical UTF-8 round trip may be written.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOM, LONE_HIGH, LONE_LOW, ch } from './__fixtures__/commentTestData'
import {
  BOM_CHAR,
  CHARSET_PRESCAN_BYTES,
  declaredCharsets,
  decodeLossless,
  encodeText,
  utf8Length,
  type DecodeFailure
} from './encoding'

const bytes = (...values: number[]): Uint8Array<ArrayBuffer> => Uint8Array.from(values)
const ascii = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(text, c => c.charCodeAt(0))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('decodeLossless', () => {
  it('U-094 accepts UTF-8 with and without a BOM, keeping the BOM as text', () => {
    const plain = encodeText(`<p>Zażółć ${ch(0x1f600)}</p>`)
    expect(decodeLossless(plain)).toEqual({
      ok: true,
      text: `<p>Zażółć ${ch(0x1f600)}</p>`,
      hasBom: false
    })
    const withBom = bytes(0xef, 0xbb, 0xbf, ...ascii('<p>x</p>'))
    const decoded = decodeLossless(withBom)
    expect(decoded).toEqual({ ok: true, text: `${BOM}<p>x</p>`, hasBom: true })
    expect(decoded.ok && encodeText(decoded.text)).toEqual(withBom)
    expect(BOM_CHAR).toBe(BOM)
    expect(decodeLossless(new Uint8Array(0))).toEqual({ ok: true, text: '', hasBom: false })
    expect(decodeLossless(bytes(0x41))).toEqual({ ok: true, text: 'A', hasBom: false })
  })

  const refused: Array<[string, Uint8Array, DecodeFailure]> = [
    ['UTF-16 LE BOM', bytes(0xff, 0xfe, 0x3c, 0x00), 'utf16'],
    ['UTF-16 BE BOM', bytes(0xfe, 0xff, 0x00, 0x3c), 'utf16'],
    ['BOM-less UTF-16', bytes(0x3c, 0x00, 0x70, 0x00), 'nul-bytes'],
    ['a NUL byte in UTF-8', bytes(...ascii('<p>a'), 0, ...ascii('b</p>')), 'nul-bytes'],
    ['a stray continuation byte', bytes(0x3c, 0x80, 0x3e), 'invalid-utf8'],
    ['a windows-1252 byte', bytes(0x63, 0x61, 0x66, 0xe9), 'invalid-utf8'],
    ['an overlong slash', bytes(0xc0, 0xaf), 'invalid-utf8'],
    ['an overlong three-byte form', bytes(0xe0, 0x80, 0xaf), 'invalid-utf8'],
    ['an encoded surrogate', bytes(0xed, 0xa0, 0x80), 'invalid-utf8'],
    ['a truncated sequence', bytes(0x41, 0xe2, 0x82), 'invalid-utf8'],
    ['a code point above U+10FFFF', bytes(0xf4, 0x90, 0x80, 0x80), 'invalid-utf8'],
    [
      'a legacy <meta charset>',
      ascii('<meta charset="windows-1252"><p>ascii only</p>'),
      'declared-charset'
    ],
    [
      'a legacy http-equiv charset',
      ascii('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=ISO-8859-2"><p>x</p>'),
      'declared-charset'
    ]
  ]

  it.each(refused)('U-094 refuses %s', (_name, input, reason) => {
    expect(decodeLossless(input)).toEqual({ ok: false, reason })
  })

  it('U-094 a UTF-8 or UTF-16 declaration is fine; one past the prescan window is not looked at', () => {
    for (const meta of [
      '<meta charset=utf-8>',
      "<meta charset='UTF8'>",
      '<meta charset="utf-16">',
      '<meta name=x>'
    ]) {
      expect(decodeLossless(ascii(`${meta}<p>x</p>`)).ok, meta).toBe(true)
    }
    const late = ascii(`${' '.repeat(CHARSET_PRESCAN_BYTES)}<meta charset="windows-1252">`)
    expect(decodeLossless(late).ok).toBe(true)
  })

  it('U-094 refuses a decode that does not encode back to the same bytes', () => {
    vi.spyOn(TextEncoder.prototype, 'encode').mockReturnValue(bytes(0x42))
    expect(decodeLossless(bytes(0x41))).toEqual({ ok: false, reason: 'round-trip' })
    vi.spyOn(TextEncoder.prototype, 'encode').mockReturnValue(bytes(0x41, 0x41))
    expect(decodeLossless(bytes(0x41))).toEqual({ ok: false, reason: 'round-trip' })
  })
})

describe('declaredCharsets', () => {
  it('lists every meta charset label, lowercased', () => {
    const head = ascii(
      '<meta charset = " Shift_JIS "><meta http-equiv=content-type content="text/html;charset=utf-8">'
    )
    expect(declaredCharsets(head)).toEqual(['shift_jis', 'utf-8'])
    expect(declaredCharsets(ascii('<p>charset=koi8-r</p><metadata charset=x>'))).toEqual([])
  })
})

describe('utf8Length', () => {
  it('counts the bytes TextEncoder writes, lone surrogates included', () => {
    const samples = [
      '',
      'ascii',
      'zażółć',
      `${ch(0x20ac)}${ch(0x1f600)}`,
      `a${LONE_HIGH}b`,
      `${LONE_LOW}`,
      `${LONE_HIGH}`,
      BOM
    ]
    for (const text of samples)
      expect(utf8Length(text), JSON.stringify(text)).toBe(encodeText(text).length)
    const mixed = `ab${ch(0x1f600)}cd`
    expect(utf8Length(mixed, 2, 4)).toBe(4)
    expect(utf8Length(mixed, 2, 3)).toBe(3)
  })
})
