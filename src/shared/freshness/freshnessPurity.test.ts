// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The freshness core stays pure (#478, plan decisions 1–2): its non-test
 * sources import nothing but relative modules that resolve inside
 * `src/shared/` – no Electron, Node, DOM or React, and no package. The core
 * runs in the renderer and in main, and against a fake disk and clock.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHARED_ROOT = resolve(HERE, '..')

/** `import … from 'x'`, `export … from 'x'`, `import 'x'`, `import('x')`, `require('x')`. */
const SPECIFIER_PATTERNS = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

/** Non-test sources under `dir`: no `*.test.ts`, nothing under `__test__/`. */
function coreSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__test__') out.push(...coreSources(path))
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path)
    }
  }
  return out
}

/** Every module specifier a source names. */
function specifiersOf(source: string): string[] {
  const found: string[] = []
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) found.push(match[1])
  }
  return found
}

/** Why `specifier`, imported by `file`, breaks the rule – or `null` when it is fine. */
function violation(file: string, specifier: string): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return 'not a relative import'
  const target = resolve(dirname(file), specifier)
  const inside = relative(SHARED_ROOT, target)
  if (inside.startsWith('..') || inside.startsWith(sep) || /^[a-zA-Z]:/.test(inside)) return 'resolves outside src/shared'
  return null
}

describe('freshness core purity', () => {
  const files = coreSources(HERE)

  it('finds the core sources', () => {
    expect(files.map((f) => relative(HERE, f))).toEqual(expect.arrayContaining(['timingProfiles.ts', 'freshnessTypes.ts']))
  })

  it('imports only relative modules inside src/shared/', () => {
    const problems: string[] = []
    for (const file of files) {
      for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
        const why = violation(file, specifier)
        if (why) problems.push(`${relative(HERE, file)}: '${specifier}' – ${why}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('the scanner sees every import form it guards', () => {
    const sample = [
      "import { a } from 'electron'",
      "import type { B } from '../clock'",
      "export { c } from 'node:fs'",
      "import 'react'",
      "const d = await import('zod')",
      "const e = require('chokidar')",
    ].join('\n')
    expect(specifiersOf(sample).sort()).toEqual(['../clock', 'chokidar', 'electron', 'node:fs', 'react', 'zod'])
  })

  it('flags a relative import that climbs out of src/shared', () => {
    expect(violation(join(HERE, 'x.ts'), '../../main/services/FileWatcherService')).toBe('resolves outside src/shared')
    expect(violation(join(HERE, 'x.ts'), '../clock')).toBeNull()
  })
})
