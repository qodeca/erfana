// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  ancestorPathNames,
  elementLabel,
  elementName,
  elementSize,
  fitAncestorPath
} from './elementLabel'

describe('pick label (025-FR-026)', () => {
  it('025-AC-026 shows the tag, then #id or the first three classes, then the size', () => {
    expect(elementLabel({ tagName: 'BUTTON', classAttr: 'cta', width: 176, height: 32 })).toBe('button.cta 176 × 32')
    expect(elementLabel({ tagName: 'div', id: 'main', classAttr: 'a b', width: 1, height: 2 })).toBe('div#main 1 × 2')
    expect(elementName({ tagName: 'li', classAttr: '  one\ttwo\nthree four ' })).toBe('li.one.two.three')
    expect(elementName({ tagName: 'p', id: '', classAttr: null })).toBe('p')
  })

  it('025-AC-026 uses U+00D7 with a space on each side and rounds to whole pixels', () => {
    expect(elementSize(10.6, 31.4)).toBe('11 × 31')
    expect(elementSize(10.5, 0.4)).toBe('11 × 0')
    expect(elementSize(Number.NaN, -3)).toBe('0 × 0')
    expect(elementSize(10, 20)).toContain(' × ')
  })

  it('025-AC-026 shows SVG classes and an id such as :r1:', () => {
    expect(elementName({ tagName: 'svg', classAttr: 'icon icon-lg' })).toBe('svg.icon.icon-lg')
    expect(elementName({ tagName: 'clipPath', classAttr: 'c' })).toBe('clippath.c')
    expect(elementName({ tagName: 'span', id: ':r1:' })).toBe('span#:r1:')
  })

  it('025-AC-026 cuts the name to 40 characters (40 kept, 41 cut) and never the size', () => {
    const forty = `div.${'a'.repeat(36)}`
    expect(elementName({ tagName: 'div', classAttr: 'a'.repeat(36) })).toBe(forty)
    expect(elementName({ tagName: 'div', classAttr: 'a'.repeat(37) })).toBe(forty)
    const label = elementLabel({ tagName: 'div', classAttr: `${'x'.repeat(30)} ${'y'.repeat(30)}`, width: 1234, height: 56 })
    expect(label).toBe(`div.${'x'.repeat(30)}.${'y'.repeat(5)} 1234 × 56`)
  })

  it('025-AC-026 never cuts an emoji or a surrogate pair at character 40', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'
    const name = elementName({ tagName: 'div', classAttr: `${'a'.repeat(35)}${family}tail` })
    expect(name).toBe(`div.${'a'.repeat(35)}${family}`)
    const atBoundary = elementName({ tagName: 'div', classAttr: `${'a'.repeat(36)}\u{1F600}` })
    expect(atBoundary).toBe(`div.${'a'.repeat(36)}`)
  })

  it('removes bidi and control characters from page ids and classes (S10)', () => {
    expect(elementName({ tagName: 'a', id: 'x‮y' })).toBe('a#xy')
    expect(elementName({ tagName: 'a', classAttr: '​ one' })).toBe('a.one')
  })
})

describe('ancestor path (025-FR-027)', () => {
  const names = ancestorPathNames([
    { tagName: 'HTML' },
    { tagName: 'body' },
    { tagName: 'main', id: 'app' },
    { tagName: 'section', classAttr: 'hero' },
    { tagName: 'button', classAttr: 'cta primary big extra' }
  ])

  it('025-AC-027 names each ancestor as the label does, without the size', () => {
    expect(names).toEqual(['html', 'body', 'main#app', 'section.hero', 'button.cta.primary.big'])
    expect(fitAncestorPath(names, 200)).toBe('html › body › main#app › section.hero › button.cta.primary.big')
  })

  it('025-AC-027 cuts the path from its start behind … and always keeps the picked element', () => {
    expect(fitAncestorPath(names, 45)).toBe('… › section.hero › button.cta.primary.big')
    expect(fitAncestorPath(names, 10)).toBe('… › button.cta.primary.big')
    expect(fitAncestorPath(['only'], 1)).toBe('only')
  })
})
