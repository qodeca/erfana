// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Quote text readers (docs/designs/comments/html-preview-comments.md §5.3, §5.9 step 4;
 * U-088). The readers copy whole runs of text instead of one character at a
 * time; they must read exactly what the character-by-character loop they
 * replaced read, which is kept here as the reference.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PREVIEW_LIMITS } from '../preview-limits'
import { PROPERTY_TIMEOUT_MS, fcParams, hostileText } from './__fixtures__/arbitraries'
import { ch, unit } from './__fixtures__/commentTestData'
import type { HtmlIndex, IndexedElement } from './htmlIndex'
import {
  QUOTE_CONTEXT_CHARS,
  exactOf,
  isQuoteWhitespace,
  prefixOf,
  suffixOf,
  type WorkMeter
} from './quoteText'

const WHITESPACE = /\s/
const NFC_SLACK = 8
const CONTEXT_WINDOW = 512
const UNITS = 0x10000

// --- the reference: the character-by-character readers before the run copy ---

function referenceCutHead(text: string, max: number): string {
  if (text.length <= max) return text
  const code = text.charCodeAt(max - 1)
  const end = code >= 0xd800 && code <= 0xdbff ? max - 1 : max
  return text.slice(0, end).trimEnd()
}

function referenceCutTail(text: string, max: number): string {
  if (text.length <= max) return text
  const start = text.length - max
  const code = text.charCodeAt(start)
  return text.slice(code >= 0xdc00 && code <= 0xdfff ? start + 1 : start).trimStart()
}

function referenceHead(text: string, from: number, to: number, max: number): string {
  let out = ''
  let gap = false
  for (let i = from; i < to && out.length < max + NFC_SLACK; i += 1) {
    const char = text[i]
    if (WHITESPACE.test(char)) {
      gap = out.length > 0
      continue
    }
    if (gap) out += ' '
    gap = false
    out += char
  }
  return referenceCutHead(out.normalize('NFC'), max)
}

function referenceTail(text: string, from: number, to: number, max: number): string {
  let out = ''
  let gap = false
  for (let i = to - 1; i >= from && out.length < max + NFC_SLACK; i -= 1) {
    const char = text[i]
    if (WHITESPACE.test(char)) {
      gap = out.length > 0
      continue
    }
    if (gap) out = ` ${out}`
    gap = false
    out = char + out
  }
  return referenceCutTail(out.normalize('NFC'), max)
}

/** The three readers on `text[from, to)` as an element's text range. */
function readAll(text: string, from: number, to: number, meter?: WorkMeter) {
  const index = { visibleText: text } as HtmlIndex
  const el = { textStart: from, textEnd: to } as IndexedElement
  return {
    exact: exactOf(index, el, meter),
    prefix: prefixOf(index, el, meter),
    suffix: suffixOf(index, el, meter)
  }
}

function referenceAll(text: string, from: number, to: number) {
  return {
    exact: referenceHead(text, from, to, PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS),
    prefix: referenceTail(text, Math.max(0, from - CONTEXT_WINDOW), from, QUOTE_CONTEXT_CHARS),
    suffix: referenceHead(
      text,
      to,
      Math.min(text.length, to + CONTEXT_WINDOW),
      QUOTE_CONTEXT_CHARS
    )
  }
}

/** Runs that cross the read limits, between hostile pieces and every kind of whitespace. */
const piece = fc.oneof(
  { arbitrary: hostileText(1, 6), weight: 4 },
  { arbitrary: fc.constantFrom(' ', '\n\t  ', unit(0xa0), unit(0x3000), unit(0xfeff)), weight: 2 },
  {
    arbitrary: fc
      .tuple(fc.constantFrom('w', ch(0x1f600), `e${unit(0x301)}`), fc.integer({ min: 20, max: 230 }))
      .map(([part, count]) => part.repeat(count)),
    weight: 1
  }
)
const textWithRange = fc
  .array(piece, { maxLength: 12 })
  .map(parts => parts.join(''))
  .chain(text =>
    fc
      .tuple(fc.nat({ max: text.length }), fc.nat({ max: text.length }))
      .map(([a, b]) => ({ text, from: Math.min(a, b), to: Math.max(a, b) }))
  )

describe('quote whitespace', () => {
  it('is /\\s/ on every UTF-16 unit', () => {
    const differing: number[] = []
    for (let code = 0; code < UNITS; code += 1) {
      const text = String.fromCharCode(code)
      if (isQuoteWhitespace(text, 0) !== WHITESPACE.test(text)) differing.push(code)
    }
    expect(differing).toEqual([])
  })
})

describe('quote readers', () => {
  it(
    'read exactly what the character-by-character readers read',
    () => {
      fc.assert(
        fc.property(textWithRange, ({ text, from, to }) => {
          expect(readAll(text, from, to)).toEqual(referenceAll(text, from, to))
        }),
        fcParams()
      )
    },
    PROPERTY_TIMEOUT_MS
  )

  it('stop at the quote limit on the same character whatever surrounds it', () => {
    const max = PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS
    for (const text of [
      'w'.repeat(max + 20),
      `${'w'.repeat(max - 1)} ${'v'.repeat(20)}`,
      `${'w'.repeat(max + NFC_SLACK - 1)} v`,
      `${'w'.repeat(max + NFC_SLACK)} v`,
      `  ${'w '.repeat(max)}`,
      `${'w'.repeat(max - 1)}${ch(0x1f600)}tail`
    ]) {
      expect(readAll(text, 0, text.length)).toEqual(referenceAll(text, 0, text.length))
    }
  })
})

describe('work meter', () => {
  it('leaves an unmetered read and a meter with room unchanged in what they read', () => {
    const text = `Before ${'the target text '.repeat(20)} after it.`
    const meter: WorkMeter = { left: 1_000_000 }
    expect(readAll(text, 7, 300, meter)).toEqual(readAll(text, 7, 300))
    expect(meter.left).toBeGreaterThan(0)
  })

  it('takes off exactly the characters each read visited', () => {
    const text = 'ab   cd'
    const index = { visibleText: text } as HtmlIndex
    const el = { textStart: 2, textEnd: 7 } as IndexedElement
    const meter: WorkMeter = { left: 100 }
    expect(exactOf(index, el, meter)).toBe('cd')
    expect(meter.left).toBe(95)
    expect(prefixOf(index, el, meter)).toBe('ab')
    expect(meter.left).toBe(93)
    expect(suffixOf(index, el, meter)).toBe('')
    expect(meter.left).toBe(93)
  })

  it('stops a read when the meter runs out, forwards and backwards', () => {
    const text = `x${' '.repeat(1_000)}y`
    const index = { visibleText: text } as HtmlIndex
    const forwards: WorkMeter = { left: 10 }
    exactOf(index, { textStart: 0, textEnd: text.length } as IndexedElement, forwards)
    expect(forwards.left).toBe(0)
    const backwards: WorkMeter = { left: 10 }
    prefixOf(index, { textStart: text.length, textEnd: text.length } as IndexedElement, backwards)
    expect(backwards.left).toBe(0)
    const spent: WorkMeter = { left: 0 }
    expect(readAll(text, 0, text.length, spent)).toEqual({ exact: '', prefix: '', suffix: '' })
    expect(spent.left).toBe(0)
  })
})
