// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUTLINE_COLOUR, OUTLINE_TOKEN, outlineColour } from './accentColour'

const TOKENS_CSS = readFileSync(join(__dirname, '../../../../renderer/src/styles/design-tokens.css'), 'utf8')

/** A token's `#rrggbb` value in design-tokens.css, following `var()` chains. */
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
  it('025-AC-034 the outline colour is the --color-accent-primary token of the real design tokens', () => {
    expect(OUTLINE_TOKEN).toBe('--color-accent-primary')
    expect(hex(OUTLINE_COLOUR)).toBe(tokenHex(OUTLINE_TOKEN).toLowerCase())
    expect(outlineColour()).toBe(OUTLINE_COLOUR)
  })
})
