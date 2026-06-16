// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'

/**
 * Programmatic-lint test proving the renderer-scoped `no-restricted-syntax`
 * rule from `eslint.config.mjs` actually fires (issue #238). That rule bans
 * POSIX-only path manipulation in `src/renderer/**` — `.split('/').pop()` and
 * the `x.endsWith('/') ? x : x + '/'` ternary — while exempting the helper
 * module `src/renderer/src/utils/fileUtils.ts`, which owns the separator-class
 * logic.
 *
 * Runs in the `main` (node-environment) vitest project so the ESLint Node API
 * is available. `new ESLint()` auto-loads the repo `eslint.config.mjs` from the
 * working directory (repo root under vitest), so no `overrideConfigFile` is
 * needed. We assert only on messages whose `ruleId === 'no-restricted-syntax'`
 * so unrelated rules (no-unused-vars, etc.) on the minimal snippets cannot
 * affect the count.
 */
describe('eslint renderer POSIX-path guard (#238)', () => {
  const RULE = 'no-restricted-syntax'

  function countRuleMessages(results: ESLint.LintResult[]): number {
    return results
      .flatMap((r) => r.messages)
      .filter((m) => m.ruleId === RULE).length
  }

  async function lint(code: string, filePath: string): Promise<number> {
    const eslint = new ESLint()
    const results = await eslint.lintText(code, { filePath })
    return countRuleMessages(results)
  }

  it("flags .split('/').pop() in a renderer file", async () => {
    const code = "const x = p.split('/').pop()\n"
    const count = await lint(code, 'src/renderer/src/components/Foo.tsx')
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it("flags the endsWith('/') ternary in a renderer file", async () => {
    const code = "const y = p.endsWith('/') ? p : p + '/'\n"
    const count = await lint(code, 'src/renderer/src/components/Foo.tsx')
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('exempts the fileUtils helper module', async () => {
    const code = "const x = p.split('/').pop()\n"
    const count = await lint(code, 'src/renderer/src/utils/fileUtils.ts')
    expect(count).toBe(0)
  })

  it('does not flag the cross-platform getBasename helper', async () => {
    const code = 'const x = getBasename(p)\n'
    const count = await lint(code, 'src/renderer/src/components/Foo.tsx')
    expect(count).toBe(0)
  })
})
