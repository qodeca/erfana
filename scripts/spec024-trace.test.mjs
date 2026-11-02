// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Spec 024 traceability over the real tree (024-AC-018, 024-AC-019,
// 024-AC-020, 024-AC-035): the comments-v2 items and owner decisions, and
// every row of the menu matrix and the comment state table, each have a test
// that names them. Reads the working tree and `git ls-files` only – no
// history – so it runs on a shallow clone.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { REQUIRED, SPEC, recordedIds, scanTitles, tableIds, testFiles } from './check-spec-trace.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => {
  const full = path.join(ROOT, rel)
  return existsSync(full) ? readFileSync(full, 'utf8') : ''
}

/** comments-v2 items that change both previews and are tested per preview (C-11's HTML half: pins visual only, D-07). */
export const SPLIT_ITEMS = ['C-07', 'C-10', 'C-11', 'C-12', 'C-16', 'C-17', 'C-22']

/** Row IDs in the first column of a design table: M-01, S-01, F-01, W-01 … */
export function rowIds(text) {
  return [...text.matchAll(/^\|\s*([A-Z]-\d{2})\s*\|/gm)].map(m => m[1])
}

// it / test / describe titles, any quote, `.only`/`.each` allowed, never skipped; the text in full.
const ANY_TITLE = /\b(?:it|test|describe)(?:\.(?!skip|todo|fixme)\w+)*\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g

/** Every test or describe title in `files`, in full. */
export function allTitles(files, readFile = f => readFileSync(path.join(ROOT, f), 'utf8')) {
  const titles = []
  for (const file of files) for (const m of readFile(file).matchAll(ANY_TITLE)) titles.push({ file, title: m[2] })
  return titles
}

describe('spec 024 traceability', () => {
  let files
  let byId
  let recorded
  let leftOut
  beforeAll(() => {
    files = testFiles()
    byId = scanTitles(files)
    recorded = recordedIds(read(`${SPEC}/verification/recorded-checks.md`))
    leftOut = tableIds(read(`${SPEC}/verification/left-out.md`))
  })
  /** IDs with neither a test whose title starts with the ID nor a recorded-check row (nor, for P1, a left-out row). */
  const uncovered = (ids, allowLeftOut = false) =>
    ids.filter(id => !byId.has(id) && !recorded.has(id) && !(allowLeftOut && leftOut.has(id)))

  it('024-AC-018 every P0 comments-v2 change has a test titled with its ID or a recorded-check row', () => {
    expect(REQUIRED.p0).toEqual(['C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06', 'C-07', 'C-08', 'C-09', 'C-10', 'C-11', 'C-12', 'C-14', 'C-16', 'C-19', 'C-22'])
    expect(uncovered(REQUIRED.p0)).toEqual([])
  })

  it('024-AC-019 every P1 comments-v2 change has a test titled with its ID, a recorded-check row, or a left-out row', () => {
    expect(REQUIRED.p1).toEqual(['C-13', 'C-15', 'C-17', 'C-18', 'C-20', 'C-21'])
    expect(uncovered(REQUIRED.p1, true)).toEqual([])
  })

  it('024-AC-020 every owner decision OD-01 – OD-08 has a test titled with its ID or a recorded-check row', () => {
    expect(REQUIRED.owner).toEqual(['OD-01', 'OD-02', 'OD-03', 'OD-04', 'OD-05', 'OD-06', 'OD-07', 'OD-08'])
    expect(uncovered(REQUIRED.owner)).toEqual([])
  })

  it('024-AC-018 024-AC-019 a change that applies to both previews has a "(HTML)" and a "(Markdown)" test', () => {
    const titles = [...byId.values()].flat().map(t => t.title)
    const missing = SPLIT_ITEMS.flatMap(id =>
      ['HTML', 'Markdown'].filter(preview => !titles.some(t => t.includes(`${id} (${preview})`))).map(preview => `${id} (${preview})`)
    )
    expect(missing).toEqual([])
    // C-11's HTML half is the forced difference D-07: pins are visual only.
    expect(titles.filter(t => t.includes('C-11 (HTML)')).some(t => /visual only/.test(t))).toBe(true)
  })

  it('024-AC-035 every row of the menu matrix and the comment state table has a test whose title names it', () => {
    const matrix = rowIds(read(`${SPEC}/design/menu-matrix.md`)).filter(id => id.startsWith('M-'))
    const states = rowIds(read(`${SPEC}/design/state-table.md`)).filter(id => /^[SFW]-/.test(id))
    expect(matrix).toHaveLength(23)
    expect(states.map(id => id[0])).toEqual([...'SSSSSSSSS', ...'FFFFFFF', ...'WWWWWWWWWWW'])
    // This file's own helper tests hold sample titles (M-03, W-09 …) as fixtures: not coverage.
    const titles = allTitles(files.filter(f => f !== 'scripts/spec024-trace.test.mjs')).map(t => t.title)
    const missing = [...matrix, ...states].filter(id => !titles.some(t => new RegExp(String.raw`\b${id}\b`).test(t)))
    expect(missing).toEqual([])
  })
})

describe('spec 024 traceability helpers', () => {
  it('reads row IDs from the first column only', () => {
    expect(rowIds('| # | State |\n|---|---|\n| S-01 | Open, see S-02 |\n| W-11 | All done |\nM-03 in prose\n')).toEqual(['S-01', 'W-11'])
  })

  it('reads full titles with any quote, including describe, and skips skipped tests', () => {
    const src = { 'a.test.ts': "describe('file states (F-04)', () => {})\nit(\"M-03 'Add comment'\", () => {})\nit(`W-09 (${p}) x`, () => {})\nit.skip('S-07 no', () => {})" }
    expect(allTitles(Object.keys(src), f => src[f]).map(t => t.title)).toEqual(['file states (F-04)', "M-03 'Add comment'", 'W-09 (${p}) x'])
  })
})
