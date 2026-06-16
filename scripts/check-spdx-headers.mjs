// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css']
// REUSE-IgnoreStart
const TOKEN = 'SPDX-License-Identifier: GPL-3.0-only'
// REUSE-IgnoreEnd

// Track only files git knows about, excluding vendored/generated trees.
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => EXTS.some((e) => f.endsWith(e)))
  .filter((f) => !f.startsWith('node_modules/') && !f.startsWith('dist/') && !f.startsWith('out/'))

const missing = files.filter((f) => !readFileSync(f, 'utf8').slice(0, 512).includes(TOKEN))

if (missing.length) {
  console.error(`Missing SPDX header in ${missing.length} file(s):`)
  for (const f of missing) console.error(`  ${f}`)
  process.exit(1)
}
console.log(`SPDX header present in all ${files.length} source files.`)
