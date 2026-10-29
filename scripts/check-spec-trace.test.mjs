// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { REQUIRED, passedTitles, scanTitles, tableIds } from './check-spec-trace.mjs'

describe('check-spec-trace', () => {
  it('finds IDs at the start of it/test titles, several per title, and ignores skipped tests', () => {
    const files = { 'a.test.ts': `it('024-AC-003 adds', () => {})\ntest("C-07, OD-01 keys", () => {})\nit.skip('C-08 nope', () => {})\nit('see C-09 later', () => {})` }
    const found = scanTitles(Object.keys(files), f => files[f])
    expect([...found.keys()].sort()).toEqual(['024-AC-003', 'C-07', 'OD-01'])
    expect(found.get('C-07')[0].title).toBe('C-07, OD-01 keys')
  })

  it('reads IDs from Markdown table rows only', () => {
    const text = '| ID | Note |\n|---|---|\n| C-13 | left out, see C-14 |\nC-15 in prose\n'
    expect([...tableIds(text)].sort()).toEqual(['C-13', 'C-14'])
  })

  it('collects passed titles from vitest and Playwright JSON reports', () => {
    const vitest = { testResults: [{ assertionResults: [{ title: 'C-01 a', status: 'passed' }, { title: 'C-02 b', status: 'failed' }] }] }
    const pw = { suites: [{ specs: [{ title: 'OD-03 c', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }], suites: [] }] }
    expect([...passedTitles([vitest, pw])].sort()).toEqual(['C-01 a', 'OD-03 c'])
  })

  it('requires all 38 acceptance criteria, the P0 and P1 changes and the eight owner decisions', () => {
    expect(REQUIRED.acceptance).toHaveLength(38)
    expect(REQUIRED.p0).toHaveLength(16)
    expect(REQUIRED.p1).toHaveLength(6)
    expect(REQUIRED.owner).toEqual(['OD-01', 'OD-02', 'OD-03', 'OD-04', 'OD-05', 'OD-06', 'OD-07', 'OD-08'])
  })
})
