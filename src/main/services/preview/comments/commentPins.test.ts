// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pins, counts and the overlay theme main sends
 * (docs/designs/comments/html-preview-comments.md §8 `icons`, §10.1, §10.9).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { accentRgb, COMMENT_OVERLAY_THEME, type CommentOverlayTheme } from './commentOverlayTheme'
import { addCounts, countsOf, groupPins, NO_COUNTS } from './commentPins'
import type { CommentLoadView } from './ElementTokenTable'

type Block = CommentLoadView['blocks'][number]

const TOKENS_CSS = readFileSync(join(__dirname, '../../../../renderer/src/styles/design-tokens.css'), 'utf8')

/** A token's value in design-tokens.css, following `var()` chains. */
function tokenValue(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(TOKENS_CSS)
  if (match === null) throw new Error(`${name} not in design-tokens.css`)
  const value = match[1].replace(/\s+/g, ' ').trim()
  const ref = /^var\((--[\w-]+)\)$/.exec(value)
  return ref === null ? value : tokenValue(ref[1])
}

const open = (id: string, token?: string, runtime?: Block['runtime']): Block => ({
  kind: 'ok',
  id,
  status: 'open',
  ...(token === undefined ? {} : { token }),
  ...(runtime === undefined ? {} : { runtime })
})

describe('groupPins', () => {
  it('groups open threads and damaged blocks by element, and leaves resolved ones out', () => {
    const blocks: Block[] = [
      open('c-1', 'aaaaaaaaaaaa'),
      { kind: 'ok', id: 'c-2', status: 'resolved', token: 'aaaaaaaaaaaa' },
      open('c-3', 'aaaaaaaaaaaa'),
      { kind: 'damaged', token: 'aaaaaaaaaaaa' },
      open('c-4', 'bbbbbbbbbbbb', { path: 'li:nth-of-type(2)', tag: 'li' }),
      open('c-5', 'bbbbbbbbbbbb'),
      { kind: 'newer', token: 'cccccccccccc' },
      open('c-6')
    ]
    expect(groupPins({ blocks })).toEqual([
      { id: 'aaaaaaaaaaaa', token: 'aaaaaaaaaaaa', threadIds: ['c-1', 'c-3'], attention: 1, count: 3, status: 'damaged' },
      {
        id: 'bbbbbbbbbbbb li li:nth-of-type(2)',
        token: 'bbbbbbbbbbbb',
        runtime: { path: 'li:nth-of-type(2)', tag: 'li' },
        threadIds: ['c-4'],
        attention: 0,
        count: 1,
        status: 'open'
      },
      { id: 'bbbbbbbbbbbb', token: 'bbbbbbbbbbbb', threadIds: ['c-5'], attention: 0, count: 1, status: 'open' },
      { id: 'cccccccccccc', token: 'cccccccccccc', threadIds: [], attention: 1, count: 1, status: 'damaged' }
    ])
  })
})

describe('countsOf and addCounts', () => {
  it('counts open, resolved and what needs attention – an orphaned open thread included', () => {
    const blocks: Block[] = [
      open('c-1', 'aaaaaaaaaaaa'),
      open('c-2'),
      { kind: 'ok', id: 'c-3', status: 'resolved' },
      { kind: 'damaged' },
      { kind: 'newer', token: 'bbbbbbbbbbbb' }
    ]
    expect(countsOf({ blocks })).toEqual({ open: 1, resolved: 1, attention: 3 })
    expect(addCounts([{ open: 1, resolved: 2, attention: 3 }, { open: 4, resolved: 0, attention: 1 }])).toEqual({ open: 5, resolved: 2, attention: 4 })
    expect(addCounts([])).toEqual(NO_COUNTS)
  })
})

describe('COMMENT_OVERLAY_THEME', () => {
  const mapping: Record<keyof CommentOverlayTheme, string> = {
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
    expect(COMMENT_OVERLAY_THEME[key as keyof CommentOverlayTheme].toLowerCase()).toBe(tokenValue(cssName).toLowerCase())
  })

  // The preload's own defaults are pinned to the same tokens (`state.test.ts`),
  // so a frame looks the same before and after its first state.
  it('is frozen', () => {
    expect(Object.isFrozen(COMMENT_OVERLAY_THEME)).toBe(true)
  })

  it('accentRgb reads the accent as three channels', () => {
    expect(accentRgb()).toEqual([0xa0, 0xa8, 0xff])
    expect(accentRgb({ ...COMMENT_OVERLAY_THEME, accent: '#010203' })).toEqual([1, 2, 3])
  })
})
