// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMPOSITION_ROOTS, checkRows, isTestOnly, parseNameStatus, seamProblem } from './check-seam-commit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const row = (status, ...paths) => ({ status, paths })

describe('check-seam-commit', () => {
  it('024-AC-002 accepts a commit of new test-only files plus composition-root edits', () => {
    const rows = [
      row('A', 'src/shared/comments/__conformance__/txt/txtKind.ts'),
      row('A', 'src/shared/comments/__conformance__/fileKind.suite.ts'),
      row('A', 'src/main/services/comments/__conformance__/txt/txtFileKind.conformance.test.ts'),
      row('A', 'src/renderer/src/components/Comments/__conformance__/txt/TxtCommentsPreview.tsx'),
      row('A', 'scripts/check-seam-commit.mjs'),
      row('M', 'src/main/services/comments/commentFileKinds.ts')
    ]
    expect(checkRows(rows)).toEqual({ problems: [], added: 5, roots: 1 })
  })

  it('024-AC-002 fails on an edited, deleted or renamed base file, and on a new production module', () => {
    const { problems } = checkRows([
      row('M', 'src/shared/comments/splice.ts'),
      row('D', 'src/shared/comments/blocks.ts'),
      row('R100', 'src/shared/comments/a.ts', 'src/shared/comments/b.ts'),
      row('A', 'src/shared/comments/txtSupport.ts'),
      row('M', 'src/shared/comments/__conformance__/overlay.suite.ts')
    ])
    expect(problems).toHaveLength(5)
    expect(problems[0]).toMatch(/^src\/shared\/comments\/splice\.ts: an edit outside the composition roots/)
    expect(problems[1]).toMatch(/blocks\.ts: deleted/)
    expect(problems[2]).toMatch(/a\.ts -> .*b\.ts: R100/)
    expect(problems[3]).toMatch(/txtSupport\.ts: a new non-test file/)
    // An existing shared suite is part of the base too: editing it is not plugging in.
    expect(problems[4]).toMatch(/overlay\.suite\.ts: an edit outside/)
  })

  it('tells test-only files by name or folder', () => {
    expect(isTestOnly('src/a/b.test.ts')).toBe(true)
    expect(isTestOnly('src/a/b.test.tsx')).toBe(true)
    expect(isTestOnly('scripts/x.test.mjs')).toBe(true)
    expect(isTestOnly('src/a/fileKind.suite.ts')).toBe(true)
    expect(isTestOnly('src/a/__conformance__/txt/txtAdapter.ts')).toBe(true)
    expect(isTestOnly('src/a/__test-helpers__/h.ts')).toBe(true)
    expect(isTestOnly('src/a/__fixtures__/f.md')).toBe(true)
    expect(isTestOnly('src/a/testing.ts')).toBe(false)
    expect(isTestOnly('src/a/conformance/x.ts')).toBe(false)
  })

  it('parses git show --name-status output, CRLF included', () => {
    expect(parseNameStatus('A\tsrc/a.test.ts\r\nM\tsrc/b.ts\n\nR090\told.ts\tnew.ts\n')).toEqual([
      row('A', 'src/a.test.ts'),
      row('M', 'src/b.ts'),
      row('R090', 'old.ts', 'new.ts')
    ])
  })

  it('a composition root is accepted only when edited, and every one named exists', () => {
    expect(seamProblem(row('M', COMPOSITION_ROOTS[0]))).toBeNull()
    expect(seamProblem(row('D', COMPOSITION_ROOTS[0]))).toMatch(/deleted/)
    for (const file of COMPOSITION_ROOTS) expect(existsSync(path.join(ROOT, file)), file).toBe(true)
  })
})
