// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Spec 024 024-AC-030: the design-system checks pass on the tree –
// `npm run lint:css` and `npm run design -- --check` both exit 0. The two run
// as child processes exactly as the npm scripts do: stylelint with the globs
// read from package.json's `lint:css`, so the list is never restated here, and
// design-sync with `--check`, which writes nothing.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUN_TIMEOUT_MS = 120_000

/** The quoted globs of package.json's `lint:css` script. */
export function lintCssGlobs(script) {
  if (!/^stylelint\s/.test(script)) throw new Error(`lint:css no longer starts with stylelint: ${script}`)
  return [...script.matchAll(/"([^"]+)"/g)].map(m => m[1])
}

/** Runs node with `args`; resolves with the exit status and the tail of the output. */
function run(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: ROOT, timeout: RUN_TIMEOUT_MS })
    let output = ''
    child.stdout.on('data', chunk => (output += chunk))
    child.stderr.on('data', chunk => (output += chunk))
    child.on('error', error => resolve({ status: null, output: String(error) }))
    child.on('close', status => resolve({ status, output: output.trim().slice(-4000) }))
  })
}

describe('spec 024 design-system checks', () => {
  it(
    '024-AC-030 npm run lint:css and npm run design -- --check both exit 0',
    async () => {
      const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
      const globs = lintCssGlobs(pkg.scripts['lint:css'])
      expect(globs.length).toBeGreaterThan(0)
      // Both at once: neither writes, and the test takes as long as the slower one.
      const [stylelint, design] = await Promise.all([
        run([path.join(ROOT, 'node_modules/stylelint/bin/stylelint.mjs'), ...globs]),
        run([path.join(ROOT, 'scripts/design-sync.mjs'), '--check'])
      ])
      expect(stylelint, stylelint.output).toMatchObject({ status: 0 })
      expect(design, design.output).toMatchObject({ status: 0 })
    },
    RUN_TIMEOUT_MS + 10_000
  )

  it('reads the globs from the lint:css script', () => {
    expect(lintCssGlobs('stylelint "src/**/*.css" "docs/**/*.html"')).toEqual(['src/**/*.css', 'docs/**/*.html'])
    expect(() => lintCssGlobs('eslint "x"')).toThrow(/no longer starts with stylelint/)
  })
})
