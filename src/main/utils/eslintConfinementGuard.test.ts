// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'

/**
 * Programmatic-lint test proving the main-process `no-restricted-syntax`
 * selectors from `eslint.config.mjs` fire:
 *
 * - a path is never confined by a string prefix of the project root
 *   (`x.startsWith(projectPath)` and friends) – `src/main/ipc/confinement`
 *   owns the one permitted form;
 * - only the native resolver is used: `realpathSync(` without `.native` does
 *   not canonicalise Windows paths (subst drives, typed case, UNC folder case).
 *
 * Counts only `no-restricted-syntax` messages, so unrelated rules on the
 * minimal snippets cannot affect the result.
 */
describe('eslint main-process path guards', () => {
  async function count(code: string, filePath: string): Promise<number> {
    const results = await new ESLint().lintText(code, { filePath })
    return results
      .flatMap((r) => r.messages)
      .filter((m) => m.ruleId === 'no-restricted-syntax').length
  }

  describe('string-prefix confinement', () => {
    const file = 'src/main/services/Foo.ts'

    it.each([
      'export const a = (p: string, o: { projectPath: string }) => p.startsWith(o.projectPath)\n',
      'export const a = (p: string, o: { projectRoot: string }) => p.startsWith(o.projectRoot)\n',
      'export const a = (p: string, projectPath: string) => p.startsWith(projectPath)\n',
      'export const a = (p: string, projectRoot: string) => p.startsWith(projectRoot)\n',
      'export const a = (p: string, resolvedRoot: string) => p.startsWith(resolvedRoot)\n',
      'export const a = (p: string, realRoot: string) => p.startsWith(realRoot)\n'
    ])('flags %s', async (code) => {
      expect(await count(code, file)).toBeGreaterThanOrEqual(1)
    })

    it('does not flag an unrelated prefix test', async () => {
      expect(await count('export const a = (p: string, prefix: string) => p.startsWith(prefix)\n', file)).toBe(0)
    })

    it('does not flag the segment-boundary form used by the path checker', async () => {
      const code = 'export const a = (p: string, r: string, sep: string) => p.startsWith(r + sep)\n'
      expect(await count(code, 'src/main/ipc/confinement/resolveConfinedPath.ts')).toBe(0)
    })
  })

  describe('native realpath only', () => {
    const files = ['src/main/services/Foo.ts', 'src/main/ipc/confinement/Foo.ts']

    it.each(files)('flags the plain realpathSync in %s', async (file) => {
      expect(await count("import { realpathSync } from 'fs'\nexport const a = realpathSync('/x')\n", file)).toBe(1)
      expect(await count("import fs from 'fs'\nexport const a = fs.realpathSync('/x')\n", file)).toBe(1)
    })

    it.each(files)('allows realpathSync.native in %s', async (file) => {
      expect(await count("import { realpathSync } from 'fs'\nexport const a = realpathSync.native('/x')\n", file)).toBe(0)
      expect(await count("import fs from 'fs'\nexport const a = fs.realpathSync.native('/x')\n", file)).toBe(0)
    })

    it.each(files)('allows the promise realpath in %s', async (file) => {
      expect(
        await count("import { realpath } from 'fs/promises'\nexport const a = realpath('/x')\n", file)
      ).toBe(0)
    })
  })
})
