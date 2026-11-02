// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { changedLines, maskPaths, unmatched } from './check-move-commit.mjs'

describe('check-move-commit', () => {
  it('masks import specifiers and repo paths, nothing else', () => {
    expect(maskPaths("import { a } from '../htmlComments/format'")).toBe('import { a } from <path>')
    expect(maskPaths("  'src/shared/htmlComments/format.ts': { lines: 98 },")).toBe('  <path>: { lines: 98 },')
    expect(maskPaths("const x = 'hello'")).toBe("const x = 'hello'")
    expect(maskPaths("const D = join(__dirname, '..', 'htmlComments', '__fixtures__')")).toBe('const D = <path>')
    expect(maskPaths('"gen": "esbuild src/shared/a/gen.ts --bundle",')).toBe('"gen": "esbuild <path> --bundle",')
    // design-sync's generated deviations page breaks paths with <wbr>.
    expect(maskPaths('<code>src/<wbr>renderer/<wbr>a.css:18</code>')).toBe('<code><path>:18</code>')
  })

  it('accepts a change of paths only, and reports any other change', () => {
    expect(unmatched(["import { a } from './format'"], ["import { a } from '../comments/format'"])).toEqual([])
    expect(unmatched(["import { a } from './format'"], ["import { a, b } from '../comments/format'"])).toHaveLength(2)
    expect(unmatched(['const limit = 1'], ['const limit = 2'])).toEqual(['- const limit = 1', '+ const limit = 2'])
  })

  it('splits a unified diff into removed and added lines per file', () => {
    const diff = [
      'diff --git a/x.ts b/y.ts',
      '--- a/x.ts',
      '+++ b/y.ts',
      "-import a from './a'",
      "+import a from '../a'"
    ].join('\n')
    const [[, entry]] = [...changedLines(diff)]
    expect(entry).toEqual({ removed: ["import a from './a'"], added: ["import a from '../a'"], header: 'diff --git a/x.ts b/y.ts' })
  })
})
