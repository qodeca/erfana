// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Tests for the documentation claim-ledger drift check.
 *
 * Each test names the break it catches: the change to scripts/check-claims.mjs
 * that would make it fail. They run the checker against a throw-away
 * repository in the OS temp directory, with a planted ledger, page and source.
 */

import nodeFs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  LEDGER,
  MAX_FILE_BYTES,
  checkLedger,
  linesContaining,
  parseSource,
  run,
  safeResolve,
  validateEntry
} from './check-claims.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let sandbox
let root
let outside

beforeEach(() => {
  sandbox = nodeFs.realpathSync(nodeFs.mkdtempSync(path.join(os.tmpdir(), 'check-claims-')))
  root = path.join(sandbox, 'repo')
  outside = path.join(sandbox, 'outside')
  nodeFs.mkdirSync(root)
  nodeFs.mkdirSync(outside)
  nodeFs.writeFileSync(path.join(outside, 'secret.ts'), "label: 'Secret'\n")
})

afterEach(() => {
  nodeFs.rmSync(sandbox, { recursive: true, force: true })
})

/** Write files (repository-relative path → content) into the temp repository. */
function write(files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    nodeFs.mkdirSync(path.dirname(abs), { recursive: true })
    nodeFs.writeFileSync(abs, content)
  }
}

const MENU_SOURCE = [
  "export const fileMenu = [",
  "  { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O' },",
  "  { label: 'Export to PDF…' }",
  ']',
  ''
].join('\n')

const PAGE = '# Menus\n\nChoose **File > Open Folder…** to open a project.\n'

/** A ledger with one verified claim about the Open Folder menu item. */
function ledgerWith(claims, pages = { 'docs/user-guide/reference/menus.md': { diataxis: 'reference' } }) {
  return { version: 1, pages, claims }
}

const OPEN_FOLDER = {
  id: 'menus/01',
  doc: 'docs/user-guide/reference/menus.md',
  quote: '**File > Open Folder…**',
  status: 'verified',
  evidence: 'source',
  source: 'src/main/menu.ts:2',
  match: "label: 'Open Folder…'"
}

function plant(ledger, source = MENU_SOURCE, page = PAGE) {
  write({
    'src/main/menu.ts': source,
    'docs/user-guide/reference/menus.md': page,
    [LEDGER]: JSON.stringify(ledger, null, 2)
  })
}

function capture() {
  const out = []
  const err = []
  return { out, err, log: (m) => out.push(m), error: (m) => err.push(m) }
}

// ---------------------------------------------------------------------------
// Unit helpers
// ---------------------------------------------------------------------------

describe('parseSource', () => {
  it('splits path and line – taking the first colon breaks Windows-style or colon-bearing paths', () => {
    expect(parseSource('src/a:b.ts:12')).toEqual({ file: 'src/a:b.ts', line: 12 })
  })
  it('rejects a missing, zero or non-numeric line – accepting them points the check at nothing', () => {
    for (const bad of ['src/a.ts', 'src/a.ts:', 'src/a.ts:0', 'src/a.ts:1a', ':3', 42, undefined]) {
      expect(parseSource(bad)).toBeNull()
    }
  })
})

describe('linesContaining', () => {
  it('returns every 1-based line number – an off-by-one re-anchors to the wrong line', () => {
    expect(linesContaining(['a', 'xb', 'b'], 'b')).toEqual([2, 3])
  })
})

describe('validateEntry', () => {
  it('accepts a complete entry', () => {
    expect(validateEntry(OPEN_FOLDER)).toEqual([])
  })
  it('names each missing field – a silent pass lets an unproven claim into the ledger', () => {
    expect(validateEntry({ id: 'x' })).toEqual(
      expect.arrayContaining(['missing doc', 'missing quote', 'missing status', 'missing evidence'])
    )
    expect(validateEntry(null)).toEqual(['entry is not an object'])
    expect(validateEntry([])).toEqual(['entry is not an object'])
  })
  it('rejects unknown status and evidence values', () => {
    const problems = validateEntry({ ...OPEN_FOLDER, status: 'probably', evidence: 'vibes' })
    expect(problems.join('\n')).toMatch(/status "probably"/)
    expect(problems.join('\n')).toMatch(/evidence "vibes"/)
  })
  it('requires source and match unless removed – a removed claim has nothing left to prove', () => {
    const bare = { ...OPEN_FOLDER }
    delete bare.source
    delete bare.match
    expect(validateEntry(bare)).toEqual(['source must be "path:line"', 'missing match'])
    expect(validateEntry({ ...bare, status: 'removed', note: 'menu item gone' })).toEqual([])
  })
  it('requires a note on fixed and removed entries – the note is the audit trail', () => {
    expect(validateEntry({ ...OPEN_FOLDER, status: 'fixed' })).toEqual([
      'a fixed entry needs a note saying what was wrong'
    ])
  })
})

describe('safeResolve – trust boundary', () => {
  it('refuses absolute, backslashed, NUL and escaping paths without touching the file system', () => {
    const calls = []
    const fsApi = { realpathSync: (p) => (calls.push(p), p) }
    for (const bad of ['/etc/hosts', '..\\x', '../outside/secret.ts', 'a/../../x', 'C:/x', '', 'a\0b', 7]) {
      expect(safeResolve(root, bad, fsApi)).toBeNull()
    }
    expect(calls).toEqual([])
  })
  it('refuses a symlink whose real path leaves the repository – following it would read outside', () => {
    nodeFs.mkdirSync(path.join(root, 'src'))
    nodeFs.symlinkSync(path.join(outside, 'secret.ts'), path.join(root, 'src/link.ts'))
    expect(safeResolve(root, 'src/link.ts')).toBeNull()
  })
  it('follows a symlink that stays inside and reports a missing file as not existing', () => {
    write({ 'src/real.ts': 'x\n' })
    nodeFs.symlinkSync(path.join(root, 'src/real.ts'), path.join(root, 'src/alias.ts'))
    expect(safeResolve(root, 'src/alias.ts')).toEqual({ abs: path.join(root, 'src/real.ts'), exists: true })
    expect(safeResolve(root, 'src/none.ts')).toEqual({ abs: path.join(root, 'src/none.ts'), exists: false })
  })
})

// ---------------------------------------------------------------------------
// The drift check
// ---------------------------------------------------------------------------

describe('checkLedger', () => {
  it('passes a ledger whose quote and match still hold', () => {
    plant(ledgerWith([OPEN_FOLDER]))
    const { findings, counts } = checkLedger(ledgerWith([OPEN_FOLDER]), { root })
    expect(findings).toEqual([])
    expect(counts).toEqual({ verified: 1, fixed: 0, removed: 0 })
  })

  it('catches a renamed menu label – the planted drift this check exists for', () => {
    const ledger = ledgerWith([OPEN_FOLDER])
    plant(ledger, MENU_SOURCE.replace("'Open Folder…'", "'Open Project…'"))
    const { findings, moves } = checkLedger(ledger, { root })
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toMatch(/no longer has "label: 'Open Folder…'" anywhere in src\/main\/menu\.ts/)
    expect(moves).toEqual([])
  })

  it('catches a moved line and proposes the new one – without the hint every refactor needs a hand search', () => {
    const ledger = ledgerWith([OPEN_FOLDER])
    plant(ledger, '// a new header line\n' + MENU_SOURCE)
    const { findings, moves } = checkLedger(ledger, { root })
    expect(findings[0].message).toMatch(/moved to line 3/)
    expect(moves).toEqual([{ index: 0, source: 'src/main/menu.ts:3' }])
  })

  it('refuses to guess when the match is on several lines', () => {
    const ledger = ledgerWith([{ ...OPEN_FOLDER, match: 'label:' }])
    plant(ledger, '\n' + MENU_SOURCE)
    const { findings, moves } = checkLedger(ledger, { root })
    expect(findings[0].message).toMatch(/on lines 3, 4 – pick one by hand/)
    expect(moves).toEqual([])
  })

  it('catches a page rewritten under the entry – the claim must then be re-checked', () => {
    const ledger = ledgerWith([OPEN_FOLDER])
    plant(ledger, MENU_SOURCE, '# Menus\n\nUse the folder button.\n')
    const { findings } = checkLedger(ledger, { root })
    expect(findings[0].message).toMatch(/quote is no longer in docs\/user-guide\/reference\/menus\.md/)
  })

  it('reports a missing source, a missing doc and a source that is a directory', () => {
    const ledger = ledgerWith([
      { ...OPEN_FOLDER, id: 'a', source: 'src/main/gone.ts:1' },
      { ...OPEN_FOLDER, id: 'b', doc: 'docs/gone.md' },
      { ...OPEN_FOLDER, id: 'c', source: 'src/main:1' }
    ])
    plant(ledger)
    const messages = checkLedger(ledger, { root }).findings.map((f) => `${f.id}: ${f.message}`)
    expect(messages).toEqual([
      'a: src/main/gone.ts does not exist',
      'b: docs/gone.md does not exist',
      'c: src/main is not a file'
    ])
  })

  it('refuses a Markdown source – proving a doc from another doc is what the ledger forbids', () => {
    const ledger = ledgerWith([{ ...OPEN_FOLDER, source: 'docs/user-guide/reference/menus.md:3', match: 'Open' }])
    plant(ledger)
    expect(checkLedger(ledger, { root }).findings[0].message).toMatch(/is a Markdown doc/)
  })

  it('accepts a Markdown file under src/ – a shipped prompt template is code, not a doc', () => {
    const ledger = ledgerWith([{ ...OPEN_FOLDER, source: 'src/prompts/explain.md:1', match: 'Explain' }])
    plant(ledger)
    write({ 'src/prompts/explain.md': 'Explain the selection.\n' })
    expect(checkLedger(ledger, { root }).findings).toEqual([])
  })

  it('reports an outside path without reading it', () => {
    const ledger = ledgerWith([{ ...OPEN_FOLDER, source: '../outside/secret.ts:1', match: 'Secret' }])
    plant(ledger)
    expect(checkLedger(ledger, { root }).findings[0].message).toMatch(/outside the repository/)
  })

  it('skips oversized files instead of reading them whole', () => {
    const ledger = ledgerWith([OPEN_FOLDER])
    plant(ledger)
    const fsApi = { ...nodeFs, statSync: () => ({ isFile: () => true, size: MAX_FILE_BYTES + 1 }) }
    expect(checkLedger(ledger, { root, fsApi }).findings[0].message).toMatch(/is over/)
  })

  it('checks the e2e test named by an app entry', () => {
    const ledger = ledgerWith([{ ...OPEN_FOLDER, evidence: 'app', test: 'e2e/gone.e2e.ts' }])
    plant(ledger)
    expect(checkLedger(ledger, { root }).findings[0].message).toBe('test e2e/gone.e2e.ts does not exist')
    write({ 'e2e/gone.e2e.ts': 'test()\n' })
    expect(checkLedger(ledger, { root }).findings).toEqual([])
  })

  it('does not check removed entries but counts them', () => {
    const removed = { id: 'r', doc: 'docs/x.md', quote: 'old', status: 'removed', evidence: 'source', note: 'gone' }
    plant(ledgerWith([OPEN_FOLDER, removed]))
    const { findings, counts } = checkLedger(ledgerWith([OPEN_FOLDER, removed]), { root })
    expect(findings).toEqual([])
    expect(counts).toEqual({ verified: 1, fixed: 0, removed: 1 })
  })

  it('flags malformed and duplicate entries and a ledger without claims', () => {
    plant(ledgerWith([]))
    const dup = checkLedger(ledgerWith([OPEN_FOLDER, OPEN_FOLDER, 5]), { root }).findings
    expect(dup.map((f) => f.message)).toEqual(['duplicate id', 'entry is not an object'])
    expect(checkLedger({}, { root }).findings[0].message).toMatch(/no "claims" array/)
    expect(checkLedger(null, { root }).findings[0].message).toMatch(/no "claims" array/)
  })

  it('checks the page map – an unknown Diataxis type or a missing page fails', () => {
    plant(ledgerWith([]))
    const ledger = ledgerWith([], {
      'docs/user-guide/reference/menus.md': { diataxis: 'novel' },
      'docs/gone.md': { diataxis: 'how-to' },
      'docs/user-guide/reference/menus.md#': null
    })
    const messages = checkLedger(ledger, { root }).findings.map((f) => f.message)
    expect(messages).toEqual([
      'page type must be one of tutorial, how-to, reference, explanation, index',
      'listed page: docs/gone.md does not exist',
      'page type must be one of tutorial, how-to, reference, explanation, index',
      'listed page: docs/user-guide/reference/menus.md# does not exist'
    ])
  })
})

describe('checkLedger – reviewed pages', () => {
  it('accepts a reviewed page with a kind and a note, and flags a bad or missing one', () => {
    plant(ledgerWith([]))
    write({ 'docs/future/plan.md': '# Plan\n' })
    const good = { ...ledgerWith([]), reviewed: { 'docs/future/plan.md': { kind: 'proposal', note: 'unshipped graph engine' } } }
    expect(checkLedger(good, { root }).findings).toEqual([])
    const bad = { ...ledgerWith([]), reviewed: { 'docs/future/plan.md': { kind: 'vibes' }, 'docs/gone.md': { kind: 'index', note: 'x' } } }
    expect(checkLedger(bad, { root }).findings.map((f) => f.message)).toEqual([
      'reviewed page needs a kind (proposal, index, record) and a note',
      'reviewed page: docs/gone.md does not exist'
    ])
  })
})

describe('run', () => {
  it('exits 0 with the counts when nothing drifted', () => {
    plant(ledgerWith([OPEN_FOLDER]))
    const io = capture()
    expect(run([], { root, ...io })).toBe(0)
    expect(io.out).toEqual(['check-claims: 1 claims (1 verified, 0 fixed, 0 removed), no drift.'])
  })

  it('exits 1 and names the entry on a renamed label', () => {
    plant(ledgerWith([OPEN_FOLDER]), MENU_SOURCE.replace('Open Folder…', 'Open Project…'))
    const io = capture()
    expect(run([], { root, ...io })).toBe(1)
    expect(io.err[0]).toMatch(/^docs\/user-guide\/claims\.json: menus\/01: src\/main\/menu\.ts:2 no longer has/)
    expect(io.err.at(-1)).toMatch(/1 finding\(s\) in 1 claims/)
  })

  it('--update re-anchors a moved line and then passes – but never hides a renamed label', () => {
    plant(ledgerWith([OPEN_FOLDER]), '\n\n' + MENU_SOURCE)
    const io = capture()
    expect(run(['--update'], { root, ...io })).toBe(0)
    expect(io.out[0]).toBe('check-claims: re-anchored 1 entry.')
    expect(JSON.parse(nodeFs.readFileSync(path.join(root, LEDGER), 'utf8')).claims[0].source).toBe('src/main/menu.ts:4')

    plant(ledgerWith([OPEN_FOLDER, { ...OPEN_FOLDER, id: 'menus/02', source: 'src/main/menu.ts:9' }]), MENU_SOURCE.replace('Open Folder…', 'Open Project…'))
    const io2 = capture()
    expect(run(['--update'], { root, ...io2 })).toBe(1)
    expect(io2.out).toEqual([])
  })

  it('pluralises the re-anchor message', () => {
    plant(ledgerWith([OPEN_FOLDER, { ...OPEN_FOLDER, id: 'menus/02' }]), '\n' + MENU_SOURCE)
    const io = capture()
    expect(run(['--update'], { root, ...io })).toBe(0)
    expect(io.out[0]).toBe('check-claims: re-anchored 2 entries.')
  })

  it('rejects unknown options and an unreadable ledger', () => {
    const io = capture()
    expect(run(['--fix'], { root, ...io })).toBe(1)
    expect(io.err[0]).toMatch(/unknown option --fix/)
    expect(run([], { root, ...io })).toBe(1)
    expect(io.err.at(-1)).toMatch(/cannot read docs\/user-guide\/claims\.json/)
  })

  it('masks control characters in findings – a planted ESC sequence must not reach the terminal', () => {
    const ledger = ledgerWith([{ ...OPEN_FOLDER, quote: 'gone\u001b[2J' }])
    plant(ledger)
    const io = capture()
    run([], { root, ...io })
    expect(io.err[0]).toContain('gone?[2J')
  })

  it('runs as a command and sets the exit code', () => {
    plant(ledgerWith([OPEN_FOLDER]))
    const script = path.join(root, 'scripts/check-claims.mjs')
    nodeFs.mkdirSync(path.dirname(script))
    nodeFs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-claims.mjs'), script)
    expect(execFileSync(process.execPath, [script], { encoding: 'utf8' })).toMatch(/no drift/)
  })
})
