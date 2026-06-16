// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// REUSE-IgnoreStart
const TOKEN = 'SPDX-License-Identifier: GPL-3.0-only'
const HEADER = `// SPDX-License-Identifier: GPL-3.0-only\n// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.\n`
const CSS_HEADER = `/* SPDX-License-Identifier: GPL-3.0-only */\n/* SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. */\n`
// REUSE-IgnoreEnd
const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css']

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => EXTS.some((e) => f.endsWith(e)))
  .filter((f) => !f.startsWith('node_modules/') && !f.startsWith('dist/') && !f.startsWith('out/'))

let changed = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  if (src.slice(0, 512).includes(TOKEN)) continue
  const header = f.endsWith('.css') ? CSS_HEADER : HEADER
  // Preserve a leading shebang if present.
  if (src.startsWith('#!')) {
    const nl = src.indexOf('\n')
    writeFileSync(f, src.slice(0, nl + 1) + header + src.slice(nl + 1))
  } else {
    writeFileSync(f, header + src)
  }
  changed++
}
console.log(`Added SPDX header to ${changed} file(s).`)
