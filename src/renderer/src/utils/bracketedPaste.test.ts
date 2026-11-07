// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  stripControlCharacters,
  toBracketedPaste
} from './bracketedPaste'

describe('stripControlCharacters', () => {
  it('leaves plain text unchanged', () => {
    expect(stripControlCharacters('label cut off')).toBe('label cut off')
  })

  it('returns an empty string for empty input', () => {
    expect(stripControlCharacters('')).toBe('')
  })

  it('025-AC-032 removes ESC and BEL', () => {
    expect(stripControlCharacters('a\x1b]0;title\x07b')).toBe('a]0;titleb')
  })

  it('025-AC-032 removes every C0 control except line breaks', () => {
    const c0 = Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i))
      .filter((c) => c !== '\n' && c !== '\r' && c !== '\t')
      .join('')
    expect(stripControlCharacters(`x${c0}y`)).toBe('xy')
  })

  it('025-AC-032 removes DEL and every C1 control (including 8-bit CSI)', () => {
    const c1 = Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(0x80 + i)).join('')
    expect(stripControlCharacters(`x\x7f${c1}y`)).toBe('xy')
    expect(stripControlCharacters('a\x9b31mb')).toBe('a31mb')
  })

  it('025-AC-032 defuses an injected bracketed-paste end marker', () => {
    expect(stripControlCharacters('before\x1b[201~rm -rf ~\rafter')).toBe('before[201~rm -rf ~\rafter')
  })

  it('turns \\n, \\r\\n and \\r line breaks into \\r', () => {
    expect(stripControlCharacters('one\ntwo\r\nthree\rfour')).toBe('one\rtwo\rthree\rfour')
  })

  it('keeps blank lines', () => {
    expect(stripControlCharacters('a\n\nb')).toBe('a\r\rb')
  })

  it('turns a tab into a space so the words it separated stay apart', () => {
    expect(stripControlCharacters('a\tb')).toBe('a b')
  })

  it('keeps non-control Unicode, including emoji and astral characters', () => {
    expect(stripControlCharacters('zażółć 🎉 𝔘')).toBe('zażółć 🎉 𝔘')
  })
})

describe('toBracketedPaste', () => {
  it('025-AC-032 wraps a single-line text in one bracketed paste', () => {
    expect(toBracketedPaste('explain this')).toBe(`${BRACKETED_PASTE_START}explain this${BRACKETED_PASTE_END}`)
  })

  it('025-AC-032 wraps a multi-line text in exactly one bracketed paste', () => {
    const paste = toBracketedPaste('line one\nline two\nline three')
    expect(paste).toBe(`${BRACKETED_PASTE_START}line one\rline two\rline three${BRACKETED_PASTE_END}`)
    expect(paste.split(BRACKETED_PASTE_START)).toHaveLength(2)
    expect(paste.split(BRACKETED_PASTE_END)).toHaveLength(2)
  })

  it('025-AC-032 keeps one start and one end marker even when the text carries both markers', () => {
    const paste = toBracketedPaste(`a${BRACKETED_PASTE_END}b${BRACKETED_PASTE_START}c`)
    expect(paste.split(BRACKETED_PASTE_START)).toHaveLength(2)
    expect(paste.split(BRACKETED_PASTE_END)).toHaveLength(2)
    expect(paste.endsWith(BRACKETED_PASTE_END)).toBe(true)
    // Only the protocol's own two markers carry ESC.
    expect(paste.split('\x1b')).toHaveLength(3)
  })
})
