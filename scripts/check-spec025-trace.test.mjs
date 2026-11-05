// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCEPTANCE, evidencedIds, laneOfFile, lanesById, requiredIds, testedIds, uncovered } from './check-spec025-trace.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const acceptance = readFileSync(path.join(ROOT, ACCEPTANCE), 'utf8')

describe('check-spec025-trace', () => {
  it('reads every acceptance heading of the spec', () => {
    const ids = requiredIds(acceptance)
    expect(ids).toHaveLength(83)
    expect(ids[0]).toBe('025-AC-001')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reads the lanes of every ID from the Test checklist, with "(after release)" stripped', () => {
    const lanes = lanesById(acceptance)
    expect(lanes.size).toBe(83)
    expect(lanes.get('025-AC-002')).toEqual(['unit', 'e2e'])
    expect(lanes.get('025-AC-047')).toEqual(['review'])
    expect(lanes.get('025-AC-051')).toEqual(['all'])
  })

  it('sorts test files into the unit and e2e lanes', () => {
    expect(laneOfFile('src/shared/browser/x.test.ts')).toBe('unit')
    expect(laneOfFile('scripts/x.test.mjs')).toBe('unit')
    expect(laneOfFile('e2e/browser-tab.e2e.ts')).toBe('e2e')
    expect(laneOfFile('e2e/x.spec.ts')).toBe('e2e')
  })

  it('counts IDs at the start of titles per lane and ignores skipped tests and later mentions', () => {
    const files = {
      'a.test.ts': `it('025-AC-002 rule 1', () => {})\ntest("025-AC-003, 025-AC-004 nav", () => {})\nit.skip('025-AC-005 no', () => {})\nit('see 025-AC-006', () => {})`,
      'b.e2e.ts': `test('025-AC-002 loads', async () => {})\ntest.fixme('025-AC-007 no', async () => {})\ntest.fail('025-AC-008 expected to fail', async () => {})`
    }
    const byLane = testedIds(Object.keys(files), f => files[f])
    expect([...byLane.unit].sort()).toEqual(['025-AC-002', '025-AC-003', '025-AC-004'])
    expect([...byLane.e2e]).toEqual(['025-AC-002'])
  })

  it('counts a manual-evidence row only for the lanes it names and only when every evidence file exists', () => {
    const text = [
      '| ID | Lane | Result | Evidence |',
      '|---|---|---|---|',
      '| 025-AC-048 | manual | 57 of 60 | `docs/testing/browser-precision/run.md` |',
      '| 025-AC-017 | packaged, review | pass | `docs/testing/browser-precision/run.md` |',
      '| 025-AC-053 | manual | pass | `missing.md` |',
      '| 025-AC-054 | manual | pass | none yet |',
      '| note 025-AC-055 | manual | pass | `docs/testing/browser-precision/run.md` |'
    ].join('\n')
    const byLane = evidencedIds(text, f => f === 'docs/testing/browser-precision/run.md')
    expect([...byLane.get('manual')]).toEqual(['025-AC-048'])
    expect([...byLane.get('packaged')]).toEqual(['025-AC-017'])
    expect([...byLane.get('review')]).toEqual(['025-AC-017'])
  })

  it('reports every lane an ID still misses – a unit test never covers an e2e lane', () => {
    const lanes = new Map([
      ['025-AC-001', ['e2e']],
      ['025-AC-002', ['unit', 'e2e']],
      ['025-AC-048', ['manual']],
      ['025-AC-061', ['e2e', 'manual']]
    ])
    const tested = { unit: new Set(['025-AC-001', '025-AC-002']), e2e: new Set(['025-AC-061']) }
    const evidenced = new Map([['manual', new Set(['025-AC-048'])]])
    expect(uncovered({ required: [...lanes.keys()], lanes, tested, evidenced })).toEqual([
      { id: '025-AC-001', missing: ['e2e'] },
      { id: '025-AC-002', missing: ['e2e'] },
      { id: '025-AC-061', missing: ['manual'] }
    ])
  })

  it('treats an ID with no checklist row as uncovered', () => {
    expect(uncovered({ required: ['025-AC-099'], lanes: new Map(), tested: { unit: new Set(), e2e: new Set() }, evidenced: new Map() })).toEqual([
      { id: '025-AC-099', missing: ['unknown lane'] }
    ])
  })
})
