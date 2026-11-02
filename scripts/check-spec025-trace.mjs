// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Spec 025 traceability (issue #448, definition of done § 3). Every
// `### 025-AC-NNN` heading in the spec's 04-acceptance.md must be covered by
//   - a unit or e2e test whose title starts with the ID – `it('025-AC-002 …')`,
//     never a skipped one – or
//   - a row in verification/manual-evidence.md whose Evidence cell names a
//     file that exists in the repository (manual, packaged, bench and review
//     lanes, and checks that run only after release).
// Prints each uncovered ID and exits 1 when any is left; prints
// "025 trace: all N acceptance IDs covered" and exits 0 otherwise.
//
// Usage: node scripts/check-spec025-trace.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SPEC = 'specs/spec-t4-025-built-in-browser'
export const ACCEPTANCE = `${SPEC}/requirements/04-acceptance.md`
export const MANUAL_EVIDENCE = `${SPEC}/verification/manual-evidence.md`

const ID = String.raw`025-AC-\d{3}`
// it / test, optionally .only/.concurrent/.each(...) – never .skip/.todo/.fixme.
const TITLE = new RegExp(String.raw`\b(?:it|test)(?:\.(?!skip|todo|fixme)\w+)*\(\s*(['"\x60])(${ID}(?:[ ,/]+${ID})*)\b`, 'g')

/** The tracer's own unit test holds sample titles that are fixtures, not coverage. */
export const SELF_TESTS = ['scripts/check-spec025-trace.test.mjs']

/** Every acceptance ID the spec defines, in file order. */
export function requiredIds(text) {
  return [...text.matchAll(new RegExp(String.raw`^### (${ID}):`, 'gm'))].map(m => m[1])
}

/** Test files tracked or new in git (unit and e2e), the tracer's own test left out. */
export function testFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'e2e', 'scripts'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  return out.split('\n').filter(f => /\.(test|e2e|spec)\.(m?[jt]sx?)$/.test(f) && !SELF_TESTS.includes(f))
}

/** IDs named at the start of a test title. */
export function testedIds(files, read) {
  const ids = new Set()
  for (const file of files) {
    for (const m of read(file).matchAll(TITLE)) for (const id of m[2].split(/[ ,/]+/)) ids.add(id)
  }
  return ids
}

/**
 * IDs with a manual-evidence row: a Markdown table row whose first cell is the
 * ID and whose last cell names an existing file in backticks.
 */
export function evidencedIds(text, exists) {
  const ids = new Set()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (!new RegExp(`^${ID}$`).test(cells[0] ?? '')) continue
    const evidence = [...(cells.at(-1) ?? '').matchAll(/`([^`]+)`/g)].map(m => m[1])
    if (evidence.length > 0 && evidence.every(exists)) ids.add(cells[0])
  }
  return ids
}

export function uncovered({ required, tested, evidenced }) {
  return required.filter(id => !tested.has(id) && !evidenced.has(id))
}

export function main() {
  const read = f => readFileSync(path.join(ROOT, f), 'utf8')
  const exists = f => existsSync(path.join(ROOT, f))
  const required = requiredIds(read(ACCEPTANCE))
  const tested = testedIds(testFiles(), read)
  const evidenced = exists(MANUAL_EVIDENCE) ? evidencedIds(read(MANUAL_EVIDENCE), exists) : new Set()
  const missing = uncovered({ required, tested, evidenced })
  for (const id of missing) console.log(`uncovered: ${id}`)
  if (missing.length > 0) {
    console.log(`025 trace: ${missing.length} of ${required.length} acceptance IDs uncovered`)
    return 1
  }
  console.log(`025 trace: all ${required.length} acceptance IDs covered`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
