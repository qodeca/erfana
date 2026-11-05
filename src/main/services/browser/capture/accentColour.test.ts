// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mainDesignTokenDefines, resolveTokenHex } from '../../../../../electron.vite.design-tokens'
import { hexToRgb, OUTLINE_COLOUR, OUTLINE_TOKEN, outlineColour } from './accentColour'

const TOKENS_CSS = readFileSync(join(__dirname, '../../../../renderer/src/styles/design-tokens.css'), 'utf8')

/** A token's `#rrggbb` value in design-tokens.css, following `var()` chains – read here on its own, not through the build helper. */
function tokenHex(name: string, depth = 0): string {
  if (depth > 8) throw new Error(`${name}: var() chain too deep`)
  const match = new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`).exec(TOKENS_CSS)
  if (match === null) throw new Error(`${name} not in design-tokens.css`)
  const value = match[1].replace(/\/\*.*?\*\//g, '').trim()
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)
  return ref === null ? value : tokenHex(ref[1], depth + 1)
}

const hex = ({ r, g, b }: { r: number; g: number; b: number }): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

describe('accentColour', () => {
  it('025-AC-034 the outline colour is the --color-accent-primary token of the real design tokens, as the build inlines it', () => {
    expect(OUTLINE_TOKEN).toBe('--color-accent-primary')
    expect(hex(OUTLINE_COLOUR)).toBe(tokenHex(OUTLINE_TOKEN).toLowerCase())
    expect(__ERFANA_ACCENT_PRIMARY__).toBe(tokenHex(OUTLINE_TOKEN).toLowerCase())
    expect(outlineColour()).toBe(OUTLINE_COLOUR)
  })

  it('reads #rrggbb in either case and refuses anything else', () => {
    expect(hexToRgb('#A0a8ff')).toEqual({ r: 0xa0, g: 0xa8, b: 0xff })
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 })
    for (const bad of ['', 'a0a8ff', '#abc', '#a0a8ffff', '#gggggg', 'rgb(1, 2, 3)']) expect(() => hexToRgb(bad)).toThrow(/Not a #rrggbb colour/)
  })
})

describe('electron.vite.design-tokens (the build-time resolution)', () => {
  const css = `:root {\n  --a: #ABCDEF; /* base */\n  --b: var(--a);\n  --c: var( --b );\n  --mix: color-mix(in srgb, var(--a) 35%, transparent);\n  --loop: var(--loop);\n  --x-a: #111111;\n}`

  it('follows var() chains to a lower-case hex, and never takes another token whose name contains it', () => {
    expect(resolveTokenHex(css, '--c')).toBe('#abcdef')
    expect(resolveTokenHex(css, '--a')).toBe('#abcdef')
    expect(resolveTokenHex(':root{--a-b: #222222; x--a: #444444; --a: #333333;}', '--a')).toBe('#333333')
  })

  it('fails the build on a missing token, a non-hex value and a loop', () => {
    expect(() => resolveTokenHex(css, '--missing')).toThrow(/not declared/)
    expect(() => resolveTokenHex(css, '--mix')).toThrow(/not a #rrggbb colour/)
    expect(() => resolveTokenHex(css, '--loop')).toThrow(/deeper than/)
  })

  it('defines __ERFANA_ACCENT_PRIMARY__ and the live outline’s ink and paper from the real stylesheet', () => {
    expect(mainDesignTokenDefines()).toEqual({
      __ERFANA_ACCENT_PRIMARY__: JSON.stringify(tokenHex(OUTLINE_TOKEN).toLowerCase()),
      __ERFANA_OUTLINE_INK__: JSON.stringify(tokenHex('--color-brand-black').toLowerCase()),
      __ERFANA_OUTLINE_PAPER__: JSON.stringify(tokenHex('--color-white').toLowerCase())
    })
    expect(
      mainDesignTokenDefines(
        ':root { --color-brand-x: #010203; --color-accent-primary: var(--color-brand-x); --color-brand-black: #0A0B0C; --color-white: #fefefe; }'
      )
    ).toEqual({ __ERFANA_ACCENT_PRIMARY__: '"#010203"', __ERFANA_OUTLINE_INK__: '"#0a0b0c"', __ERFANA_OUTLINE_PAPER__: '"#fefefe"' })
    // Without either token the build fails rather than inline a colour it cannot draw.
    expect(() => mainDesignTokenDefines(':root { --color-accent-primary: #010203; --color-white: #fefefe; }')).toThrow(/--color-brand-black is not declared/)
  })
})
