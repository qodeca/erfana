// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Spec 024 history checks. CI may test a shallow clone, so nothing here reads
// git history: the rules run locally in scripts/check-spec024-history.mjs,
// which writes verification/history-check.md, and these tests read that
// report. Re-run the script after any history change (a rebase, a reword).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  REPORT,
  approvedCards,
  cardApprovalDate,
  cardOf,
  cardStatus,
  characterisationProblems,
  fix426Note,
  invariantViolations,
  parseRaw,
  tableUnder
} from './check-spec024-history.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** { rules: Map<id, { result, evidence }>, commits: string[] } from the written report. */
function readReport() {
  const text = readFileSync(path.join(ROOT, REPORT), 'utf8')
  const rules = new Map()
  for (const row of tableUnder(text, '## Rules')) {
    const [id, , result, evidence] = row.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim())
    rules.set(id, { result, evidence })
  }
  return { rules, commits: tableUnder(text, '## Commits') }
}

/** Every rule whose id starts with `prefix`, with its result. */
function rulesFor(prefix) {
  const { rules } = readReport()
  return [...rules].filter(([id]) => id.startsWith(prefix)).map(([id, r]) => ({ id, result: r.result, evidence: r.evidence }))
}

describe('spec 024 history report', () => {
  it('024-AC-021 the safety net comes first, pins hold and E-020 is retired with Markdown comments (report from check-spec024-history.mjs)', () => {
    const { commits } = readReport()
    expect(commits.length).toBeGreaterThan(0)
    const rules = rulesFor('021-')
    expect(rules.map(r => r.id)).toEqual(['021-order', '021-numruns', '021-invariants', '021-characterisation', '021-e020'])
    expect(rules.filter(r => r.result !== 'pass')).toEqual([])
  })

  it('024-AC-033 every changed decided card was approved before the first UI commit, and comments-v2 § 8.1 is refreshed (report from check-spec024-history.mjs)', () => {
    const rules = rulesFor('033-')
    expect(rules.map(r => r.id)).toEqual(['033-cards', '033-refresh'])
    expect(rules.filter(r => r.result !== 'pass')).toEqual([])
  })

  it('records the one pull request branch and a linear history (history half of the one-pull-request check)', () => {
    const [rule] = rulesFor('022-')
    expect(rule.result).toBe('pass')
    expect(rule.evidence).toMatch(/one pull request from `[^`]+` into `[^`]+`/)
  })
})

describe('check-spec024-history rules', () => {
  const raw = (status, from, oldSha, newSha, to = from) =>
    parseRaw(`:100644 100644 ${oldSha} ${newSha} ${status}\t${from}${to === from ? '' : `\t${to}`}`)[0]
  const groups = [
    { name: 'pins', match: /^pins\// },
    { name: 'locked', match: /^gold\//, since: 'c3' }
  ]

  it('reads git diff-tree --raw lines, renames included', () => {
    expect(parseRaw(':100644 100644 aaa bbb R100\told/x\tnew/x\n:000000 100644 000 ccc A\tnew/y')).toEqual([
      { status: 'R', from: 'old/x', to: 'new/x', oldSha: 'aaa', newSha: 'bbb' },
      { status: 'A', from: 'new/y', to: 'new/y', oldSha: '000', newSha: 'ccc' }
    ])
  })

  it('lets a pin move with its bytes and new pins arrive, and flags an edit, a delete or a rename with new bytes', () => {
    const commits = [
      { sha: 'c1', subject: 'add', changes: [raw('A', 'pins/a', '0', 'a1')], tree: ['pins/a'] },
      { sha: 'c2', subject: 'move', changes: [raw('R', 'pins/a', 'a1', 'a1', 'pins/b'), raw('A', 'pins/c', '0', 'c1')], tree: ['pins/b', 'pins/c'] },
      { sha: 'c3', subject: 'edit', changes: [raw('M', 'pins/b', 'a1', 'a2')], tree: ['pins/b', 'pins/c'] },
      { sha: 'c4', subject: 'drop', changes: [raw('D', 'pins/c', 'c1', '0')], tree: ['pins/b'] }
    ]
    expect(invariantViolations([], commits, groups).violations).toEqual(['c3 edit: M pins/b (pins)', 'c4 drop: D pins/c (pins)'])
  })

  it('starts a locked group at its lock commit and notes earlier changes', () => {
    const commits = [
      { sha: 'c1', subject: 'add', changes: [raw('A', 'gold/g', '0', 'g1')], tree: ['gold/g'] },
      { sha: 'c2', subject: 'fix', changes: [raw('M', 'gold/g', 'g1', 'g2')], tree: ['gold/g'] },
      { sha: 'c3', subject: 'lock', changes: [], tree: ['gold/g'] },
      { sha: 'c4', subject: 'late', changes: [raw('M', 'gold/g', 'g2', 'g3')], tree: ['gold/g'] }
    ]
    const result = invariantViolations([], commits, groups)
    expect(result.notes).toEqual(['c2 fix: M gold/g (before the locked lock)'])
    expect(result.violations).toEqual(['c4 late: M gold/g (locked)'])
  })

  it('accepts a characterisation-pin change only in a feat: commit naming a C-xx or OD-xx', () => {
    const snap = 'src/x/__snapshots__/commentCopy.pin.test.ts.snap'
    const commit = (sha, subject, message) => ({ sha, subject, message: `${subject}\n\n${message}`, changes: [raw('M', snap, 's1', 's2')] })
    const { changed, problems } = characterisationProblems([
      commit('c1', 'feat(comments): add the thing', 'C-19 refusal copy.'),
      commit('c2', 'feat(comments): add more', 'C-xx per-kind note.'),
      commit('c3', 'test(comments): pin', 'OD-01.')
    ])
    expect(changed).toHaveLength(3)
    expect(problems.map(p => p.slice(0, 2))).toEqual(['c2', 'c3'])
  })

  it('maps a changed design file to its card and reads the card status', () => {
    expect(cardOf('docs/design-system/system/components/form/form.css')).toEqual(['docs/design-system/system/components/form/index.html'])
    expect(cardOf('docs/design-system/system/foundations/focus.html')).toEqual(['docs/design-system/system/foundations/focus.html'])
    expect(cardOf('docs/design-system/tokens.css')).toEqual([])
    expect(cardOf('docs/designs/comments/html-comments/comments.css')).toEqual(['*html-comments*'])
    expect(cardStatus('<!-- @card group="Components" name="Menu" status="decided" -->\n')).toBe('decided')
    expect(cardStatus('<p>no card</p>')).toBeNull()
  })

  it('reads approved cards and their date from approvals.md', () => {
    const approvals = [
      '## 1. What was approved',
      '| Approval | Requirement | File | Approved |',
      '|---|---|---|---|',
      '| The changes comments-v2 makes to `decided` cards | 024-FR-025 | § 2 below | 2026-10-29 |',
      '### 2.1 Design-system cards',
      '| Card | Path | What | Items |',
      '|---|---|---|---|',
      '| Menu | `docs/design-system/system/components/menu/index.html` | x | C-19 |',
      '### 2.2 HTML comment screens',
      '| Screen | What | Items |',
      '|---|---|---|',
      '| `toolbar.html` | x | C-20 |'
    ].join('\n')
    expect([...approvedCards(approvals)]).toEqual([
      'docs/design-system/system/components/menu/index.html',
      'docs/designs/comments/html-comments/toolbar.html'
    ])
    expect(cardApprovalDate(approvals)).toBe('2026-10-29')
  })

  it('says what the #426 message shows', () => {
    expect(fix426Note('fix\n\nCause: x.\n\nBefore, on y: 3 failed, 7 passed.\nAfter, same (--repeat-each=20): 20 passed.')).toMatch(
      /cause stated: true; a failing before-run shown: true; a --repeat-each=20 after-run shown: true$/
    )
  })
})
