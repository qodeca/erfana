// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guards the contract between the GitHub presentation card, brand.mjs and the
 * committed README artwork (#139): every element brand.mjs screenshots exists
 * in the card, and every committed PNG has the size and budget brand.mjs
 * promises. Renaming a card id or committing a hand-edited image fails here
 * rather than at the next `npm run docs:brand`.
 */

import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ARTWORK } from './brand.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CARD = readFileSync(path.join(ROOT, 'design/product/github-presentation/index.html'), 'utf8')

describe('README brand artwork', () => {
  it.each(ARTWORK)('the card has an element with id $id', art => {
    expect(CARD).toContain(`id="${art.id}"`)
  })

  it.each(ARTWORK)('$file is a PNG of the promised size, within budget', art => {
    const file = path.join(ROOT, 'docs/assets/readme', art.file)
    const buf = readFileSync(file)
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([art.width, art.height])
    expect(statSync(file).size).toBeLessThanOrEqual(art.maxKB * 1024)
  })
})
