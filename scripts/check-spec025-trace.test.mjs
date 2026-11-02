// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCEPTANCE, evidencedIds, requiredIds, testedIds, uncovered } from './check-spec025-trace.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('check-spec025-trace', () => {
  it('reads every acceptance heading of the spec', () => {
    const ids = requiredIds(readFileSync(path.join(ROOT, ACCEPTANCE), 'utf8'))
    expect(ids).toHaveLength(83)
    expect(ids[0]).toBe('025-AC-001')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('counts IDs at the start of it/test titles and ignores skipped tests and later mentions', () => {
    const files = {
      'a.test.ts': `it('025-AC-002 rule 1', () => {})\ntest("025-AC-003, 025-AC-004 nav", () => {})\nit.skip('025-AC-005 no', () => {})\nit('see 025-AC-006', () => {})\ntest.fixme('025-AC-007 no', () => {})`
    }
    expect([...testedIds(Object.keys(files), f => files[f])].sort()).toEqual(['025-AC-002', '025-AC-003', '025-AC-004'])
  })

  it('counts a manual-evidence row only when every named evidence file exists', () => {
    const text = [
      '| ID | Lane | Result | Evidence |',
      '|---|---|---|---|',
      '| 025-AC-048 | manual | 57 of 60 | `docs/testing/browser-precision/run.md` |',
      '| 025-AC-053 | manual | pass | `missing.md` |',
      '| 025-AC-054 | manual | pass | none yet |',
      '| note 025-AC-055 | manual | pass | `docs/testing/browser-precision/run.md` |'
    ].join('\n')
    const exists = f => f === 'docs/testing/browser-precision/run.md'
    expect([...evidencedIds(text, exists)]).toEqual(['025-AC-048'])
  })

  it('lists the IDs with neither a test nor evidence, in spec order', () => {
    expect(
      uncovered({ required: ['025-AC-001', '025-AC-002', '025-AC-003'], tested: new Set(['025-AC-002']), evidenced: new Set(['025-AC-003']) })
    ).toEqual(['025-AC-001'])
  })
})
