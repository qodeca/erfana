// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `commentState` parser and the overlay's default theme
 * (docs/designs/html-preview-comments.md §8, §10.9; J-008 receive side).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_ICONS } from './constants'
import { DEFAULT_THEME, IDLE_STATE, parseCommentState, pxOf, type OverlayTheme } from './state'
import { token } from './__test-helpers__/harness'

const TOKENS_CSS = readFileSync(
  join(__dirname, '../../renderer/src/styles/design-tokens.css'),
  'utf8'
)

/** A token's value in design-tokens.css, following `var()` chains. */
function tokenValue(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(TOKENS_CSS)
  if (match === null) throw new Error(`${name} not in design-tokens.css`)
  const value = match[1].replace(/\s+/g, ' ').trim()
  const ref = /^var\((--[\w-]+)\)$/.exec(value)
  return ref === null ? value : tokenValue(ref[1])
}

const icon = (n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  key: `k${n}`,
  token: token(n),
  count: 1,
  status: 'open',
  ...extra
})

describe('DEFAULT_THEME', () => {
  // §10.9: the page cannot read Erfana's stylesheet, so the defaults are
  // literals – pinned here to the tokens they mirror (lint cannot see CSS in TS).
  const mapping: Record<keyof OverlayTheme, string> = {
    accent: '--color-accent-primary',
    accentHover: '--color-brand-violet-hover',
    ink: '--color-brand-black',
    paper: '--color-brand-white',
    muted: '--color-text-primary',
    warning: '--color-warning',
    font: '--font-mono',
    size: '--text-sm',
    ring: '--border-width-thick',
    pinTarget: '--btn-height-sm',
    hairline: '--border-width',
    space1: '--space-1',
    space2: '--space-2',
    space4: '--space-4',
    leading: '--leading-snug'
  }

  it.each(Object.entries(mapping))('%s mirrors %s', (key, cssName) => {
    expect(DEFAULT_THEME[key as keyof OverlayTheme].toLowerCase()).toBe(tokenValue(cssName).toLowerCase())
  })

  it('every default passes its own validation', () => {
    expect(parseCommentState({ mode: false, theme: DEFAULT_THEME })?.theme).toEqual(DEFAULT_THEME)
  })
})

describe('parseCommentState', () => {
  it('ignores anything that is not an object with a boolean mode', () => {
    for (const raw of [null, undefined, 'x', 3, [], { mode: 'on' }, {}]) {
      expect(parseCommentState(raw)).toBeNull()
    }
  })

  it('gives a frame main cannot map the mode only (R3-3)', () => {
    expect(parseCommentState({ mode: true, icons: [icon(1)], showIcons: true, reveal: 'k1' })).toEqual({
      mode: true,
      commentable: false,
      showIcons: false,
      icons: [],
      theme: DEFAULT_THEME
    })
  })

  it('parses a full commentable state', () => {
    const state = parseCommentState({
      mode: true,
      commentable: true,
      showIcons: false,
      icons: [icon(1, { runtime: { path: 'li:nth-of-type(2)', tag: 'li' } }), icon(2, { status: 'damaged', count: 0 })],
      reveal: 'k1',
      restore: { x: 0, y: 1200.5 },
      childFrames: [{ key: 'f1', commentable: true }, { key: 'f2', commentable: false }],
      focusFrame: 'f1',
      theme: { accent: 'rgb(1, 2, 3)', size: '12px' }
    })
    expect(state).toEqual({
      mode: true,
      commentable: true,
      showIcons: false,
      icons: [
        { key: 'k1', token: token(1), count: 1, status: 'open', runtime: { path: 'li:nth-of-type(2)', tag: 'li' } },
        { key: 'k2', token: token(2), count: 0, status: 'damaged' }
      ],
      reveal: 'k1',
      restore: { x: 0, y: 1200.5 },
      childFrames: [{ key: 'f1', commentable: true }, { key: 'f2', commentable: false }],
      focusFrame: 'f1',
      theme: { ...DEFAULT_THEME, accent: 'rgb(1, 2, 3)', size: '12px' }
    })
  })

  it('M-064 carries the print hide to every frame, and only a literal true hides', () => {
    expect(parseCommentState({ mode: true, commentable: true, hidden: true })?.hidden).toBe(true)
    expect(parseCommentState({ mode: true, hidden: true })).toMatchObject({ commentable: false, hidden: true })
    for (const hidden of [false, 'true', 1, undefined]) {
      expect(parseCommentState({ mode: true, commentable: true, hidden })).not.toHaveProperty('hidden')
    }
  })

  it('defaults showIcons on and drops every malformed icon', () => {
    const state = parseCommentState({
      mode: false,
      commentable: true,
      icons: [
        icon(1),
        icon(1),
        'junk',
        icon(3, { key: '' }),
        icon(4, { key: 'x'.repeat(41) }),
        icon(5, { token: 'SHORT' }),
        icon(6, { count: 1.5 }),
        icon(7, { count: -1 }),
        icon(8, { status: 'resolved' }),
        icon(9, { runtime: 'li' }),
        icon(10, { runtime: { path: 'x'.repeat(1025), tag: 'li' } }),
        icon(11, { runtime: { path: '', tag: '<script>' } }),
        icon(12, { runtime: { path: 3, tag: 'li' } })
      ]
    })
    expect(state?.showIcons).toBe(true)
    expect(state?.icons.map(i => i.key)).toEqual(['k1'])
  })

  it(`keeps at most ${MAX_ICONS} pins`, () => {
    const icons = Array.from({ length: MAX_ICONS + 5 }, (_, n) => icon(n))
    expect(parseCommentState({ mode: false, commentable: true, icons })?.icons).toHaveLength(MAX_ICONS)
    expect(parseCommentState({ mode: false, commentable: true, icons: 'nope' })?.icons).toEqual([])
  })

  it('drops a malformed reveal, restore, frame list or frame focus', () => {
    const state = parseCommentState({
      mode: false,
      commentable: true,
      reveal: 42,
      restore: { x: Number.NaN, y: 0 },
      childFrames: [{ key: 'f1', commentable: 'yes' }],
      focusFrame: ''
    })
    expect(state).toEqual({ mode: false, commentable: true, showIcons: true, icons: [], theme: DEFAULT_THEME })
    expect(parseCommentState({ mode: false, commentable: true, restore: 'top' })?.restore).toBeUndefined()
    expect(parseCommentState({ mode: false, commentable: true, restore: { x: -1, y: 0 } })?.restore).toBeUndefined()
    expect(parseCommentState({ mode: false, commentable: true, childFrames: 'x' })?.childFrames).toBeUndefined()
    const many = Array.from({ length: 1_001 }, (_, n) => ({ key: `f${n}`, commentable: true }))
    expect(parseCommentState({ mode: false, commentable: true, childFrames: many })?.childFrames).toBeUndefined()
    expect(parseCommentState({ mode: false, commentable: true, childFrames: [null] })?.childFrames).toBeUndefined()
  })

  it('keeps a theme value only when it is a plain colour, font list or pixel length', () => {
    const theme = parseCommentState({
      mode: false,
      theme: {
        accent: 'red; background: url(x)',
        ink: '#123',
        paper: 'rgba(1, 2, 3, 0.5)',
        font: 'Mono}*{color:red',
        size: '1e3px',
        ring: 3,
        pinTarget: '28px'
      }
    })?.theme
    expect(theme).toEqual({ ...DEFAULT_THEME, ink: '#123', paper: 'rgba(1, 2, 3, 0.5)', pinTarget: '28px' })
    expect(parseCommentState({ mode: false, theme: 'dark' })?.theme).toBe(DEFAULT_THEME)
  })

  it('reads a theme length as pixels', () => {
    expect(pxOf('24px')).toBe(24)
    expect(pxOf('1.5px')).toBe(1.5)
  })

  it('starts idle', () => {
    expect(IDLE_STATE).toEqual({ mode: false, commentable: false, showIcons: false, icons: [], theme: DEFAULT_THEME })
  })
})
