// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * The max-lines ratchet in eslint.config.mjs, proven to fire.
 *
 * Every non-test `.ts` / `.tsx` source under src/ is held to the baseline's
 * limit, and each file in scripts/max-lines-baseline.json to its own size. Each case lints
 * generated source as if it lived at a real path, so a config edit that drops
 * the rule, downgrades it to a warning (which `eslint .` passes) or reorders a
 * block so the base limit wins turns this red. The last case proves the
 * config's globs and the check script's `isCovered()` agree on every file.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { BASELINE_PATH, isCovered, parseBaseline } from './check-max-lines.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: ROOT })
const baseline = parseBaseline(readFileSync(path.join(ROOT, BASELINE_PATH), 'utf8'))
const LIMIT = baseline.limit
const [BASELINED, ALLOWANCE] = Object.entries(baseline.files)[0]
const NEW_FILE = 'src/main/services/maxLinesProbe.ts'
const ERROR = 2

/** `n` lines of valid TypeScript, each ending in `eol` */
const source = (n, eol = '\n') =>
  Array.from({ length: n }, (_, i) => `export const v${i} = ${i}${eol}`).join('')

/** The max-lines messages for `code` linted as if it were the file at `rel` */
async function maxLines(rel, code) {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, rel) })
  return result.messages.filter((m) => m.ruleId === 'max-lines')
}

describe('max-lines ratchet', () => {
  it('fails a new source one line over the limit, as an error', async () => {
    const messages = await maxLines(NEW_FILE, source(LIMIT + 1))
    expect(messages).toHaveLength(1)
    expect(messages[0].severity).toBe(ERROR)
    expect(messages[0].message).toContain(`Maximum allowed is ${LIMIT}.`)
  })

  it('passes a new source at the limit', async () => {
    expect(await maxLines(NEW_FILE, source(LIMIT))).toHaveLength(0)
  })

  it('holds a baselined file to its own size: one line more fails, its size passes', async () => {
    const messages = await maxLines(BASELINED, source(ALLOWANCE + 1))
    expect(messages).toHaveLength(1)
    expect(messages[0].severity).toBe(ERROR)
    expect(messages[0].message).toContain(`Maximum allowed is ${ALLOWANCE}.`)
    expect(await maxLines(BASELINED, source(ALLOWANCE))).toHaveLength(0)
  })

  it('counts a CRLF checkout the same', async () => {
    expect(await maxLines(BASELINED, source(ALLOWANCE + 1, '\r\n'))).toHaveLength(1)
    expect(await maxLines(BASELINED, source(ALLOWANCE, '\r\n'))).toHaveLength(0)
  })

  it.each([
    'src/main/services/maxLinesProbe.test.ts',
    'src/renderer/src/components/maxLinesProbe.test.tsx',
    'src/main/__test__/maxLinesProbe.ts',
    'src/main/__tests__/maxLinesProbe.ts',
    'src/main/__test-helpers__/maxLinesProbe.ts',
    'src/renderer/src/__test-utils__/maxLinesProbe.ts',
    'src/renderer/src/test-utils/maxLinesProbe.tsx',
    'src/renderer/src/types/maxLinesProbe.d.ts',
    'e2e/maxLinesProbe.ts',
    'scripts/maxLinesProbe.mjs'
  ])('leaves %s alone', async (rel) => {
    expect(await maxLines(rel, source(LIMIT + 1))).toHaveLength(0)
  })

  it('applies the same files as isCovered(), at the baseline allowance or the limit', async () => {
    const listing = execFileSync('git', ['ls-files', '-z', '--', 'src'], { cwd: ROOT, encoding: 'utf8' })
    const tracked = listing
      .split('\0')
      .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))
    const probes = [
      NEW_FILE,
      'src/main/maxLinesProbe.js',
      'src/main/maxLinesProbe.d.tsx',
      'src/main/test-utilsx/maxLinesProbe.ts',
      'src/main/maxLinesProbe.test.ts'
    ]
    const disagreements = []
    for (const rel of [...tracked, ...probes]) {
      const config = await eslint.calculateConfigForFile(path.join(ROOT, rel))
      const rule = config?.rules?.['max-lines']
      const expected = isCovered(rel) ? [ERROR, { max: baseline.files[rel] ?? LIMIT }] : undefined
      if (JSON.stringify(rule) !== JSON.stringify(expected)) {
        disagreements.push({ rel, rule, expected })
      }
    }
    expect(disagreements).toEqual([])
    expect(tracked.filter(isCovered).length).toBeGreaterThan(Object.keys(baseline.files).length)
  }, 60_000)
})
