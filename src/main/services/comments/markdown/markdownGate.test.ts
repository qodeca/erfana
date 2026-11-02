// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Claude Code gate (spec 024 024-FR-016, 024-NFR-004; 024-AC-017,
 * 024-AC-027): the samples, their lock, the report, and the merge-time test
 * that the report's hashes match the final samples and agent note.
 *
 * Three modes, by environment (the gate folder's README has the commands):
 * - `GATE_SAMPLES_WRITE=1` writes the samples, `prompt.txt` and
 *   `gate.lock.json` once – it refuses while a lock exists, because a sample
 *   is never edited after it is hashed; a new round first moves the last
 *   one, unchanged, to `round-<n>/` (README);
 * - `GATE_RUNS_DIR=<folder>` checks every run `run-gate.sh` left there and
 *   writes `verification/claude-code-gate.md`;
 * - neither (CI): the samples are what the writer writes, the lock and the
 *   report match them, the report shows the gate passed, and every earlier
 *   round is still there byte for byte, its report linked.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeCommentDocument as frozenAnalyze } from '../../../../shared/comments/__fixtures__/frozen-v0.23.1/parse'
import { TARGET_HINT_LEAD, WORDS_HINT_LEAD } from '../../../../shared/comments/noteLines'
import { GATE_CASES, GATE_PROMPT } from '../../../../shared/markdownComments/__fixtures__/gate/gateCases'
import { markdownKind } from '../../../../shared/markdownComments/markdownKind'
import {
  GATE_HISTORY,
  GATE_ROUND,
  GATE_RUNS,
  GATE_RUNS_TO_PASS,
  checkGateRuns,
  gateSetupOf,
  parseGateReport,
  renderGateReport
} from './__test-helpers__/gateReport'
import { agentNoteText, gateLockOf, gateSampleBytes, gateSamples, sha256Hex, textOfBytes, type GateLock } from './__test-helpers__/gateSamples'

const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const GATE_DIR = join(ROOT, 'src', 'shared', 'markdownComments', '__fixtures__', 'gate')
const SAMPLES_DIR = join(GATE_DIR, 'samples')
const LOCK = join(GATE_DIR, 'gate.lock.json')
const PROMPT_FILE = join(GATE_DIR, 'prompt.txt')
const VERIFICATION_DIR = join(ROOT, 'specs', 'spec-t3-024-unified-comments', 'verification')
const REPORT = join(VERIFICATION_DIR, 'claude-code-gate.md')

/** The eleven sample kinds 024-AC-027 names. */
const REQUIRED_COVERS = [
  'paragraph',
  'heading',
  'list item 1',
  'list item 2',
  'nested list item',
  'table row',
  'paragraph inside a block quote',
  'code block',
  'resolved comment',
  'selection comment',
  'run twice'
]

const readLock = (): GateLock => JSON.parse(readFileSync(LOCK, 'utf8')) as GateLock

if (process.env.GATE_SAMPLES_WRITE === '1') {
  if (existsSync(LOCK)) throw new Error('gate.lock.json exists: the samples are locked and never rewritten (README)')
  const samples = await gateSamples()
  mkdirSync(SAMPLES_DIR, { recursive: true })
  for (const [file, bytes] of samples) writeFileSync(join(SAMPLES_DIR, file), bytes)
  writeFileSync(PROMPT_FILE, GATE_PROMPT)
  writeFileSync(LOCK, JSON.stringify(gateLockOf(samples), null, 2) + '\n')
}

describe('Claude Code gate samples (024-FR-016)', () => {
  it('024-AC-017 each sample is what Erfana\'s writer writes, byte for byte', async () => {
    for (const [file, bytes] of await gateSamples()) {
      expect(new Uint8Array(readFileSync(join(SAMPLES_DIR, file))), file).toEqual(bytes)
    }
  })

  it('024-AC-017 the lock holds every sample, the prompt and the note, with none missing or extra', () => {
    const lock = readLock()
    const files: Record<string, string> = {}
    for (const file of readdirSync(SAMPLES_DIR).sort()) files[`samples/${file}`] = sha256Hex(readFileSync(join(SAMPLES_DIR, file)))
    expect(lock.algorithm).toBe('sha256')
    expect(files).toEqual(lock.samples)
    expect(Object.keys(files)).toEqual(GATE_CASES.map(c => `samples/${c.name}.md`).sort())
    expect(readFileSync(PROMPT_FILE, 'utf8')).toBe(GATE_PROMPT)
    expect(sha256Hex(GATE_PROMPT)).toBe(lock.prompt)
  })

  it.each(GATE_CASES.map(c => [c.name, c] as const))('024-AC-017 %s reads ok in v0.23.1 and now, with its hints', (_name, c) => {
    const text = textOfBytes(readFileSync(join(SAMPLES_DIR, `${c.name}.md`)))
    expect(frozenAnalyze(text).state.blocks.map(b => b.kind)).toEqual(c.comments.map(() => 'ok'))
    const blocks = markdownKind.parse(text, 0).state.blocks
    expect(blocks.map(b => (b.kind === 'ok' ? b.data.status : b.kind))).toEqual(c.comments.map(m => (m.resolved === true ? 'resolved' : 'open')))
    expect(text.split(TARGET_HINT_LEAD).length - 1).toBe(c.comments.length)
    expect(text.includes(WORDS_HINT_LEAD)).toBe(c.comments.some(m => m.sel !== undefined))
    expect(text).toContain('Gate Reviewer <gate@example.invalid>')
  })

  it('024-AC-017 the nested-list-item sample comments on the nested item, at its own level, not on the outer item', async () => {
    const at = GATE_CASES.findIndex(c => c.name === 'gate-05-nested-list-item')
    const text = textOfBytes(await gateSampleBytes(GATE_CASES[at], at))
    const [block] = markdownKind.parse(text, 0).state.blocks
    if (block?.kind !== 'ok') throw new Error('gate-05: no ok block')
    expect(block.data.anchor).toMatchObject({ tag: 'li', path: 'ul:nth-of-type(1) > li:nth-of-type(1) > ul:nth-of-type(1) > li:nth-of-type(2)', quote: { exact: 'Tag the build today.' } })
    expect(block.data.anchor.runtime).toBeUndefined()
    expect(text).toContain('\n  - Update the changelog today.\n    <!-- erfana:comment v1 ')
    expect(text).toContain('\n      target in Markdown (when commented): item 2 of the list starting "- Tag the build today."\n')
    expect(text).toContain('\n    -->\n  - Tag the build today.\n')
  })

  it('024-AC-017 git keeps the samples\' bytes (-text, C8)', () => {
    const file = relative(ROOT, join(SAMPLES_DIR, `${GATE_CASES[0].name}.md`)).replaceAll('\\', '/')
    const out = execFileSync('git', ['check-attr', 'text', '--', file], { cwd: ROOT, encoding: 'utf8' })
    expect(out.trim()).toBe(`${file}: text: unset`)
  })
})

describe('Claude Code gate history (earlier rounds, kept unchanged)', () => {
  it.each(GATE_HISTORY.map(h => [h.round, h] as const))('024-AC-017 round %i: its samples still match its lock byte for byte, with none missing or extra', (_round, h) => {
    const dir = join(GATE_DIR, h.folder)
    const lock = JSON.parse(readFileSync(join(dir, 'gate.lock.json'), 'utf8')) as GateLock
    const files: Record<string, string> = {}
    for (const file of readdirSync(join(dir, 'samples')).sort()) files[`samples/${file}`] = sha256Hex(readFileSync(join(dir, 'samples', file)))
    expect(lock.algorithm).toBe('sha256')
    expect(files).toEqual(lock.samples)
    expect(existsSync(join(VERIFICATION_DIR, h.report)), h.report).toBe(true)
  })
})

describe.runIf(process.env.GATE_RUNS_DIR !== undefined)('Claude Code gate report (writes the report from the runs)', () => {
  it('writes verification/claude-code-gate.md from the runs', async () => {
    const runsDir = process.env.GATE_RUNS_DIR!
    const lock = readLock()
    const results = await checkGateRuns(GATE_DIR, runsDir, lock)
    writeFileSync(REPORT, renderGateReport(results, gateSetupOf(runsDir, basename(runsDir)), lock))
  }, 120_000)
})

describe('Claude Code gate report (merge-time)', () => {
  const report = (): ReturnType<typeof parseGateReport> => {
    if (!existsSync(REPORT)) throw new Error('verification/claude-code-gate.md is missing: run the gate (gate/README.md)')
    return parseGateReport(readFileSync(REPORT, 'utf8'))
  }

  it('024-AC-017 the gate report\'s hashes match the final samples and agent note', () => {
    const parsed = report()
    const lock = readLock()
    const now: Record<string, string> = {}
    for (const c of GATE_CASES) now[`samples/${c.name}.md`] = sha256Hex(readFileSync(join(SAMPLES_DIR, `${c.name}.md`)))
    expect(parsed.hashes).toEqual(now)
    expect(lock.samples).toEqual(now)
    expect(parsed.agentNote).toBe(sha256Hex(agentNoteText()))
    expect(lock.agentNote).toBe(sha256Hex(agentNoteText()))
  })

  it('024-AC-027 the gate report lists at least 11 samples, each passing 2 of 3, with version and model ID', () => {
    const parsed = report()
    expect(parsed.samples.length).toBeGreaterThanOrEqual(11)
    expect(parsed.samples.map(s => s.covers)).toEqual(expect.arrayContaining(REQUIRED_COVERS))
    for (const sample of parsed.samples) {
      expect(sample.runs, sample.file).toBe(GATE_RUNS)
      expect(sample.passed, sample.file).toBeGreaterThanOrEqual(GATE_RUNS_TO_PASS)
      expect(sample.result, sample.file).toBe('pass')
    }
    expect(parsed.version).toMatch(/\d+\.\d+\.\d+/)
    expect(parsed.model).toMatch(/^claude-/)
  })

  it('024-AC-017 the gate report is the current round\'s and links every earlier round', () => {
    const parsed = report()
    expect(parsed.round).toBe(GATE_ROUND)
    expect(parsed.history).toEqual(GATE_HISTORY.map(h => h.report))
  })
})
