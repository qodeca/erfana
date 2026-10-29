// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Spec 024 traceability (024-AC-018, 024-AC-019, 024-AC-020, and the goal's
// "every 024-AC has a test or a recorded check"). An item is covered when a
// test whose title starts with its ID exists – `it('024-AC-003 …')`,
// `test('C-07 …')` – in a unit or e2e test file, or when the spec's
// verification/recorded-checks.md has a row for it. A P1 item may instead be
// listed in verification/left-out.md with its reason and fallback.
//
// With `--report <vitest-or-playwright-json>` (repeatable), a title only counts
// when that report shows it passed.
//
// Usage: node scripts/check-spec-trace.mjs [--report file.json]...
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPEC = 'specs/spec-t3-024-unified-comments'

const range = (prefix, from, to, width) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(width, '0')}`)

export const REQUIRED = {
  acceptance: range('024-AC-', 1, 38, 3),
  p0: ['C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06', 'C-07', 'C-08', 'C-09', 'C-10', 'C-11', 'C-12', 'C-14', 'C-16', 'C-19', 'C-22'],
  p1: ['C-13', 'C-15', 'C-17', 'C-18', 'C-20', 'C-21'],
  owner: range('OD-', 1, 8, 2)
}

const ID = String.raw`(?:024-AC-\d{3}|C-\d{2}|OD-\d{2})`
// it / test, optionally .only/.concurrent/.each(...) – but never .skip/.todo/.fixme.
const TITLE = new RegExp(String.raw`\b(?:it|test)(?:\.(?!skip|todo|fixme)\w+)*\(\s*(['"\x60])(${ID}(?:[ ,/]+${ID})*)\b([^'"\x60]*)\1`, 'g')

/** Test files tracked by git (unit and e2e). */
function testFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'e2e', 'scripts'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  return out.split('\n').filter(f => /\.(test|e2e|spec)\.(m?[jt]sx?)$/.test(f))
}

/** ID → [{ file, title }] from test titles. */
export function scanTitles(files, read = f => readFileSync(path.join(ROOT, f), 'utf8')) {
  const found = new Map()
  for (const file of files) {
    const text = read(file)
    for (const m of text.matchAll(TITLE)) {
      const ids = m[2].split(/[ ,/]+/)
      const title = `${m[2]}${m[3]}`
      for (const id of ids) {
        if (!found.has(id)) found.set(id, [])
        found.get(id).push({ file, title })
      }
    }
  }
  return found
}

/** IDs named in the first column of a Markdown table in `file` (rows only, header skipped). */
export function tableIds(text) {
  const ids = new Set()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue
    for (const cell of line.split('|').slice(1, -1)) {
      for (const m of cell.matchAll(new RegExp(ID, 'g'))) ids.add(m[0])
    }
  }
  return ids
}

/** Full titles that passed, from vitest (--reporter=json) or Playwright (--reporter=json) reports. */
export function passedTitles(reports) {
  const passed = new Set()
  const walkPw = suite => {
    for (const spec of suite.specs ?? []) {
      if (spec.tests?.every(t => t.results?.some(r => r.status === 'passed') && t.status !== 'skipped')) passed.add(spec.title)
    }
    for (const child of suite.suites ?? []) walkPw(child)
  }
  for (const report of reports) {
    for (const file of report.testResults ?? []) {
      for (const t of file.assertionResults ?? []) if (t.status === 'passed') passed.add(t.title)
    }
    for (const suite of report.suites ?? []) walkPw(suite)
  }
  return passed
}

function readOptional(rel) {
  const full = path.join(ROOT, rel)
  return existsSync(full) ? readFileSync(full, 'utf8') : ''
}

function main(argv) {
  const reports = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--report') reports.push(JSON.parse(readFileSync(argv[++i], 'utf8')))
  }
  const titles = scanTitles(testFiles())
  const passed = reports.length ? passedTitles(reports) : null
  const recorded = tableIds(readOptional(`${SPEC}/verification/recorded-checks.md`))
  const leftOut = tableIds(readOptional(`${SPEC}/verification/left-out.md`))

  const rows = []
  let missing = 0
  const check = (group, id, allowLeftOut) => {
    const tests = (titles.get(id) ?? []).filter(t => passed === null || passed.has(t.title))
    let how
    if (tests.length) how = `test (${tests.length}): ${tests[0].file}`
    else if (recorded.has(id)) how = 'recorded check'
    else if (allowLeftOut && leftOut.has(id)) how = 'left out (listed with reason)'
    else {
      how = 'MISSING'
      missing++
    }
    rows.push(`${group.padEnd(10)} ${id.padEnd(11)} ${how}`)
  }
  for (const id of REQUIRED.acceptance) check('acceptance', id, false)
  for (const id of REQUIRED.p0) check('P0', id, false)
  for (const id of REQUIRED.p1) check('P1', id, true)
  for (const id of REQUIRED.owner) check('owner', id, false)

  console.log(rows.join('\n'))
  const total = rows.length
  const acMissing = rows.filter(r => r.startsWith('acceptance') && r.endsWith('MISSING')).length
  console.log(
    `\nspec 024 trace${passed ? ' (passing tests only)' : ''}: ${REQUIRED.acceptance.length - acMissing} of ${REQUIRED.acceptance.length} acceptance criteria covered, ${acMissing} missing; ${total - missing} of ${total} items covered in all, ${missing} missing`
  )
  return missing === 0 ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
