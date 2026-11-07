// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { decodePunycodeLabel, encodePunycodeLabel, labelToAscii, labelToUnicode } from './punycode'

// RFC 3492 § 7.1 samples and well-known labels.
const SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['bücher', 'bcher-kva'],
  ['münchen', 'mnchen-3ya'],
  ['例え', 'r8jz45g'],
  ['ليهمابتكلموشعربي؟', 'egbpdaj6bu4bxfgehfvwxn'],
  ['他们为什么不说中文', 'ihqwcrb4cv8a8dqg056pqjye'],
  ['почемужеонинеговорятпорусски', 'b1abfaaepdrnnbgefbadotcwatmq2g4l'],
  ['аррӏе', '80ak6aa92e'],
  ['3年B組金八先生', '3B-ww4c5e180e575a65lsy2b']
]

describe('punycode labels (RFC 3492)', () => {
  it('encodes and decodes the reference samples', () => {
    for (const [unicode, puny] of SAMPLES) {
      expect(encodePunycodeLabel(unicode)).toBe(puny)
      expect(decodePunycodeLabel(puny)).toBe(unicode)
    }
  })

  it('round-trips through the xn-- label helpers', () => {
    expect(labelToAscii('bücher')).toBe('xn--bcher-kva')
    expect(labelToUnicode('xn--bcher-kva')).toBe('bücher')
    expect(labelToUnicode('XN--BCHER-KVA')).toBe('bücher')
    expect(labelToAscii('plain')).toBe('plain')
    expect(labelToUnicode('plain')).toBe('plain')
  })

  it('returns null for invalid punycode instead of throwing', () => {
    expect(decodePunycodeLabel('a€-b')).toBeNull()
    expect(decodePunycodeLabel('abc-!')).toBeNull()
    expect(decodePunycodeLabel('99999999999')).toBeNull()
    expect(decodePunycodeLabel('-')).toBeNull()
    expect(labelToUnicode('xn--zzzzzzzzzzzz')).toBeNull()
  })
})
