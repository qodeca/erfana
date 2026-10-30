// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The lock on the Markdown placement rules and the Markdown agent note (spec
 * 024 024-FR-016, 024-AC-017; architecture note 001 § 6 commit 16).
 *
 * The rules and the note were locked on the day the Claude Code gate passed,
 * and `__fixtures__/markdownFormat.lock.json` records what passed: the note
 * text's SHA-256, a digest of the placement goldens' lock, and the gate round,
 * Claude Code version and model of the report. A later change to the note or
 * to any placement golden fails here – FR-016: "any change to the note or the
 * placement means a full re-run". Run the gate again (`gate/README.md`), then
 * update this lock together with the report.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MARKDOWN_AGENT_NOTE_LINES } from '../comments/agentNotes'

const ROOT = join(__dirname, '..', '..', '..')
const FIXTURES = join(__dirname, '__fixtures__')

interface MarkdownFormatLock {
  readonly lockedOn: string
  readonly gate: { readonly report: string; readonly round: number; readonly claudeCode: string; readonly model: string }
  /** SHA-256 of the Markdown agent note's lines joined with LF, UTF-8 – the gate lock's own measure. */
  readonly agentNote: string
  /** SHA-256 of `goldens.lock.json`'s entries, sorted, one `<path> <sha256>\n` each. */
  readonly goldens: string
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

const lock = readJson<MarkdownFormatLock>(join(FIXTURES, 'markdownFormat.lock.json'))

/** The digest of a goldens lock: its entries in path order, so key order and line endings never matter. */
function goldensDigest(files: Readonly<Record<string, string>>): string {
  return sha256(Object.keys(files).sort().map(path => `${path} ${files[path]}\n`).join(''))
}

describe('Markdown placement rules and agent note, locked after the Claude Code gate', () => {
  it('024-AC-017 the Markdown agent note is the note the gate ran: its hash equals the lock and the gate lock', () => {
    const gateLock = readJson<{ agentNote: string }>(join(FIXTURES, 'gate', 'gate.lock.json'))
    const now = sha256(MARKDOWN_AGENT_NOTE_LINES.join('\n'))
    // A failure here means the note changed after the gate: run the whole gate again (024-FR-016).
    expect(now).toBe(lock.agentNote)
    expect(gateLock.agentNote).toBe(lock.agentNote)
  })

  it('024-AC-017 the placement goldens are the ones locked with the gate: the goldens lock is current', () => {
    const goldensLock = readJson<{ algorithm: string; files: Record<string, string> }>(join(FIXTURES, 'goldens.lock.json'))
    expect(goldensLock.algorithm).toBe('sha256')
    // A failure here means a placement golden changed after the gate: run the whole gate again (024-FR-016).
    expect(goldensDigest(goldensLock.files)).toBe(lock.goldens)
  })

  it('024-AC-017 the lock names the gate report it rests on, and the report passed with that round, version and model', () => {
    const report = readFileSync(join(ROOT, lock.gate.report), 'utf8')
    expect(report).toMatch(new RegExp(`^Round ${lock.gate.round}\\.`, 'm'))
    expect(report).toContain(`- Claude Code version: \`${lock.gate.claudeCode}\``)
    expect(report).toContain(`- Model ID: \`${lock.gate.model}\``)
    expect(report).toContain(`| agent note text | ${lock.agentNote} |`)
    expect(report).toMatch(/^\*\*Gate: pass\*\*/m)
  })

  it('the goldens digest ignores key order and changes with any hash', () => {
    const a = { 'goldens/a.md': '1', 'goldens/b.md': '2' }
    expect(goldensDigest(a)).toBe(goldensDigest({ 'goldens/b.md': '2', 'goldens/a.md': '1' }))
    expect(goldensDigest(a)).not.toBe(goldensDigest({ ...a, 'goldens/b.md': '3' }))
    expect(goldensDigest(a)).not.toBe(goldensDigest({ 'goldens/a.md': '1' }))
  })
})
