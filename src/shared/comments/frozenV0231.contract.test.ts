// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frozen v0.23.1 comment parser and writer (spec 024, 024-AC-010,
 * architecture note § 8 C30): its bytes are locked, and nothing in it imports
 * outside its folder except the pinned packages.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCommentFile as frozenParse } from './__fixtures__/frozen-v0.23.1/parse'

const FROZEN = join(__dirname, '__fixtures__', 'frozen-v0.23.1')
const GOLDENS = join(__dirname, '..', 'htmlComments', '__fixtures__', 'v1-compat')
const PINNED_PACKAGES = new Set(['parse5-v0.23.1', 'zod-v0.23.1', '@noble/hashes/sha2', '@noble/hashes/utils'])

describe('frozen v0.23.1 copy', () => {
  it('024-AC-010 the SHA-256 lock matches every frozen file, with none missing or extra', () => {
    const lock = JSON.parse(readFileSync(join(FROZEN, 'frozen.lock.json'), 'utf8')) as {
      algorithm: string
      files: Record<string, string>
    }
    expect(lock.algorithm).toBe('sha256')
    const actual: Record<string, string> = {}
    for (const file of readdirSync(FROZEN)) {
      if (file === 'frozen.lock.json') continue
      actual[file] = createHash('sha256').update(readFileSync(join(FROZEN, file))).digest('hex')
    }
    expect(actual).toEqual(lock.files)
  })

  it('024-AC-010 nothing in the frozen folder imports outside it except the pinned packages', () => {
    const outside: string[] = []
    for (const file of readdirSync(FROZEN).filter(f => f.endsWith('.ts'))) {
      const text = readFileSync(join(FROZEN, file), 'utf8')
      for (const match of text.matchAll(/\bfrom\s+'([^']+)'/g)) {
        const spec = match[1]
        const inside = spec.startsWith('./') && !spec.slice(2).includes('/')
        if (!inside && !PINNED_PACKAGES.has(spec)) outside.push(`${file}: ${spec}`)
      }
      expect(text, file).not.toMatch(/\bimport\(|\brequire\(/)
    }
    expect(outside).toEqual([])
  })

  it('024-AC-010 the frozen parser reads the shipped v1 goldens as ok', () => {
    const pages = readdirSync(GOLDENS).filter(f => f.endsWith('.html'))
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) {
      const result = frozenParse(new Uint8Array(readFileSync(join(GOLDENS, page))))
      expect(result.ok, page).toBe(true)
    }
  })
})
