// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown placement goldens, locked (G-M01 …; spec 024 design
 * `markdown-format.md` § 8, 024-AC-003, 024-AC-031). One per kind of the
 * `@data` table and per slot rule: each is what an add writes, byte for byte,
 * with a fixed author, clock and random source; a SHA-256 lock holds them.
 * The frozen v0.23.1 parser reads every one `ok`, the current one reads it
 * attached, and delete gives the file before back.
 *
 * To write the goldens after an intended format change, run this suite with
 * `MD_GOLDENS_WRITE=1`; then review the diff, and update the lock with the
 * hashes the lock test prints.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeCommentDocument as frozenAnalyze } from '../comments/__fixtures__/frozen-v0.23.1/parse'
import { decodeLossless, encodeText } from '../comments/encoding'
import { GOLDEN_CASES, type GoldenCase } from './__fixtures__/goldenCases'
import { addComment, changeThread, mdOf, parseMd, pickOf, unambiguousTargetBy, written } from './__test-helpers__/mdHarness'

const FIXTURES = join(__dirname, '__fixtures__')
const FOLDER = join(FIXTURES, 'goldens')
const LOCK = join(FIXTURES, 'goldens.lock.json')
const SEED = 4242

/** What the add of `c` writes, from a fixed seed. */
function goldenOf(c: GoldenCase): string {
  const doc = parseMd(c.before)
  const target = unambiguousTargetBy(doc, c.kind, c.match ?? '', c.nth ?? 0)
  return written(addComment(c.before, pickOf(doc, target), 'Please review this.', { seed: SEED, sel: c.sel })).text
}

const fileOf = (c: GoldenCase): string => `${c.name}.md`

if (process.env.MD_GOLDENS_WRITE === '1') {
  if (!existsSync(FOLDER)) mkdirSync(FOLDER)
  for (const c of GOLDEN_CASES) writeFileSync(join(FOLDER, fileOf(c)), encodeText(goldenOf(c)))
}

const committed = (c: GoldenCase): string => {
  const decoded = decodeLossless(new Uint8Array(readFileSync(join(FOLDER, fileOf(c)))))
  if (!decoded.ok) throw new Error(decoded.reason)
  return decoded.text
}

describe('Markdown placement goldens (locked)', () => {
  it.each(GOLDEN_CASES.map(c => [c.name, c] as const))('024-AC-003 %s is what an add writes, byte for byte', (_name, c) => {
    expect(encodeText(goldenOf(c))).toEqual(new Uint8Array(readFileSync(join(FOLDER, fileOf(c)))))
  })

  it('024-AC-003 the SHA-256 lock matches every golden, with none missing or extra', () => {
    const lock = JSON.parse(readFileSync(LOCK, 'utf8')) as { algorithm: string; files: Record<string, string> }
    const actual: Record<string, string> = {}
    for (const file of readdirSync(FOLDER).sort()) {
      actual[`goldens/${file}`] = createHash('sha256').update(readFileSync(join(FOLDER, file))).digest('hex')
    }
    expect(lock.algorithm).toBe('sha256')
    expect(actual).toEqual(lock.files)
    expect(Object.keys(actual)).toEqual(GOLDEN_CASES.map(c => `goldens/${fileOf(c)}`).sort())
  })

  it('024-AC-003 a golden never names an outer list item whose text merely holds a nested item\'s words', () => {
    const doc = parseMd('- Prepare\n  - Write the notes.\n  - Check the links.\n- Ship\n')
    expect(() => unambiguousTargetBy(doc, 'item', 'Check the links')).toThrow(/holds ul:nth-of-type\(1\) > li:nth-of-type\(1\) > ul:nth-of-type\(1\) > li:nth-of-type\(2\)/)
    expect(unambiguousTargetBy(doc, 'item', 'Check the links', 1).path).toBe('ul:nth-of-type(1) > li:nth-of-type(1) > ul:nth-of-type(1) > li:nth-of-type(2)')
  })

  it('024-AC-003 git keeps the goldens\' bytes (-text, C8)', () => {
    const root = join(__dirname, '..', '..', '..')
    const file = relative(root, join(FOLDER, 'g-m27-crlf.md')).replaceAll('\\', '/')
    const out = execFileSync('git', ['check-attr', 'text', '--', file], { cwd: root, encoding: 'utf8' })
    expect(out.trim()).toBe(`${file}: text: unset`)
  })

  it.each(GOLDEN_CASES.map(c => [c.name, c] as const))('024-AC-003 %s reads ok in v0.23.1, attached now, and delete restores the file', (_name, c) => {
    const text = committed(c)
    expect(frozenAnalyze(text).state.blocks.map(b => b.kind)).toEqual(['ok'])
    const doc = parseMd(text)
    const [block] = doc.state.blocks
    if (block?.kind !== 'ok') throw new Error(`${c.name}: not ok`)
    expect(block.target.state).toBe('attached')
    expect(written(changeThread(text, block.data.id, 'delete')).text).toBe(c.before)
    expect(mdOf(doc).comments.length).toBe(mdOf(parseMd(c.before)).comments.length + 1)
  })
})
