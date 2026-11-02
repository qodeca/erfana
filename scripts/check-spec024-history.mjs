// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Spec 024 history checks (024-AC-021, 024-AC-033, the history half of
// 024-AC-022). They read git history, which a CI unit test cannot rely on
// (a shallow clone has none), so this script runs locally on the branch and
// writes its findings to verification/history-check.md; a fast unit test
// (check-spec024-history.test.mjs) reads that report.
//
// 021 – the #429 and #426 fixes and the v0.23.1 pin commits come before the
//       first commit that moves shipped comment code; the #429 commit keeps
//       numRuns at 200; invariant pins never change after they land (new files
//       and byte-identical renames are fine); every change to a
//       characterisation pin sits in a `feat:` commit naming a C-xx or OD-xx;
//       E-020 is retired in the commit that adds Markdown comments.
// 033 – every `decided` card changed on the branch has a row in
//       design/approvals.md dated on or before the first UI commit, and
//       comments-v2 § 8.1 is refreshed (and matches approvals § 3).
// 022 – the branch name the one pull request is opened from, and a linear
//       history (no merge commits) so it can merge without squashing. The
//       `git rebase --exec` log is attached separately.
//
// Usage: node scripts/check-spec024-history.mjs [--base develop] [--out <file>]
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPEC = 'specs/spec-t3-024-unified-comments'
export const REPORT = `${SPEC}/verification/history-check.md`
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })

/**
 * The commits the spec's history rules name (spec 024 build plan, architecture
 * note § 7), found by their subject line so a rebase that rewrites their SHAs
 * does not break the check. A subject not on the branch resolves to a
 * `missing:` marker, which no commit matches.
 */
export const COMMIT_SUBJECTS = {
  fix429: 'fix(test): stop P-007 timing out under coverage (#429)',
  fix426: "fix(e2e): wait for the reloaded page's overlay in E-019 (#426)",
  frozenPin: 'test(comments): freeze the v0.23.1 comment parser and writer',
  behaviourPin: 'test(comments): pin the v0.23.1 HTML comment behaviour',
  firstMove: 'refactor(comments): move the parse5-free format core to src/shared/comments',
  markdownComments: 'feat(comments): comments in the Markdown Preview',
  markdownLock: 'feat(comments): lock the Markdown placement rules and agent note',
  refresh81: 'docs(comments-v2): refresh § 8.1 against the current cards (spec 024, 024-FR-025)'
}

function resolveSubjects(subjects) {
  const bySubject = new Map()
  for (const line of git(['log', '--format=%h%x09%s', 'HEAD', '-n', '2000']).split('\n')) {
    const tab = line.indexOf('\t')
    if (tab > 0 && !bySubject.has(line.slice(tab + 1))) bySubject.set(line.slice(tab + 1), line.slice(0, tab))
  }
  return Object.fromEntries(Object.entries(subjects).map(([name, subject]) => [name, bySubject.get(subject) ?? `missing:${name}`]))
}

export const COMMITS = resolveSubjects(COMMIT_SUBJECTS)

/**
 * Invariant pins (architecture note § 8 C26). A group starts at `since` when
 * given – the Markdown goldens are locked by commit 16, after the Claude Code
 * gate was allowed to correct them – and otherwise at the first commit that
 * holds a matching file (the base, for the shipped v1 goldens).
 */
export const INVARIANTS = [
  { name: 'writer-byte pins', match: /^src\/shared\/(?:htmlComments|comments)\/__fixtures__\/pins\// },
  { name: 'frozen v0.23.1 copy', match: /^src\/shared\/comments\/__fixtures__\/frozen-v0\.23\.1\// },
  { name: 'preview-page surface snapshot', match: /^src\/preload\/__snapshots__\/previewPage\.surface\.pin\.test\.ts\.snap$/ },
  {
    name: 'v1 HTML goldens and lock',
    match: /^src\/shared\/(?:htmlComments|comments)\/__fixtures__\/(?:(?:v1|v1-compat)\/(?!.*\.ts$).+|v1\.lock\.json)$/
  },
  {
    name: 'spec 024 goldens and lock',
    match: /^src\/shared\/comments\/__fixtures__\/(?:v1-spec024\/(?!.*\.ts$).+|v1-spec024\.lock\.json)$/
  },
  {
    name: 'Markdown goldens and locks',
    match: /^src\/shared\/markdownComments\/__fixtures__\/(?:goldens\/.+|goldens\.lock\.json|markdownFormat\.lock\.json)$/,
    since: COMMITS.markdownLock
  },
  {
    name: 'Claude Code gate samples and locks',
    match: /^src\/shared\/markdownComments\/__fixtures__\/gate\/(?:.+\/)?(?:samples\/.+|gate\.lock\.json|prompt\.txt)$/
  }
]

/** Characterisation pins: may change, but only in a `feat:` commit that names its C-xx or OD-xx. */
export const CHARACTERISATION = /(?:^|\/)__snapshots__\/(?:commentCopy\.pin\.test\.ts|preview-comment-schema\.pin\.test\.ts)\.snap$/

const FEAT = /^feat(?:\([^)]*\))?!?:/
const ITEM = /\b(?:C-\d{2}|OD-\d{2})\b/

/** `git diff-tree --raw -M` lines → [{ status, from, to, oldSha, newSha }]. */
export function parseRaw(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (!line.startsWith(':')) continue
    const [meta, ...paths] = line.split('\t')
    const [, , oldSha, newSha, status] = meta.split(' ')
    out.push({ status: status[0], from: paths[0], to: paths[paths.length - 1], oldSha, newSha })
  }
  return out
}

/**
 * Walks `commits` (oldest first, each `{ sha, changes, tree }`) and reports
 * every change to an invariant pin after its group started. `baseTree` is the
 * file list before the first commit. A rename that keeps the bytes moves the
 * pin; an edit, a delete or a rename with new bytes is a violation.
 */
export function invariantViolations(baseTree, commits, groups = INVARIANTS) {
  const tracked = new Map()
  const started = new Set()
  const notes = []
  const violations = []
  const seed = (group, files) => {
    for (const f of files) if (group.match.test(f)) tracked.set(f, group.name)
    started.add(group.name)
  }
  for (const g of groups) if (!g.since && baseTree.some(f => g.match.test(f))) seed(g, baseTree)
  for (const { sha, subject, changes, tree } of commits) {
    for (const c of changes) {
      const group = tracked.get(c.from)
      if (group === undefined) {
        const g = groups.find(x => x.match.test(c.from) || x.match.test(c.to))
        if (g && !started.has(g.name) && g.since && c.status !== 'A') notes.push(`${sha} ${subject}: ${c.status} ${c.to} (before the ${g.name} lock)`)
        continue
      }
      if (c.status === 'R' && c.oldSha === c.newSha) {
        tracked.delete(c.from)
        tracked.set(c.to, group)
      } else if (c.status !== 'A') {
        violations.push(`${sha} ${subject}: ${c.status} ${c.to} (${group})`)
      }
    }
    for (const g of groups) {
      if (started.has(g.name)) continue
      if (g.since ? sha.startsWith(g.since) : tree.some(f => g.match.test(f))) seed(g, tree)
    }
    // Files added after a group started are new pins of that group.
    for (const c of changes) {
      if (c.status !== 'A' && c.status !== 'R') continue
      const g = groups.find(x => started.has(x.name) && x.match.test(c.to))
      if (g && !tracked.has(c.to)) tracked.set(c.to, g.name)
    }
  }
  return { violations, notes, tracked: tracked.size }
}

/** Commits that change a characterisation pin's bytes without being a `feat:` commit naming a C-xx or OD-xx. */
export function characterisationProblems(commits) {
  const changed = []
  const problems = []
  for (const { sha, subject, message, changes } of commits) {
    const hits = changes.filter(c => CHARACTERISATION.test(c.to) && c.status !== 'A' && c.oldSha !== c.newSha)
    if (!hits.length) continue
    const items = [...new Set(message.match(new RegExp(ITEM.source, 'g')) ?? [])]
    const line = `${sha} ${subject} – ${hits.map(h => path.basename(h.to)).join(', ')}; names ${items.join(', ') || 'no item'}`
    changed.push(line)
    if (!FEAT.test(subject) || !items.length) problems.push(line)
  }
  return { changed, problems }
}

/** The card a changed design file belongs to: its own path, or its folder's index.html. */
export function cardOf(file) {
  if (file.startsWith('docs/designs/comments/html-comments/')) return file.endsWith('.html') ? [file] : ['*html-comments*']
  if (!file.startsWith('docs/design-system/system/')) return []
  if (file.endsWith('.html')) return [file]
  const dir = path.posix.dirname(file)
  return dir.split('/').length > 4 ? [`${dir}/index.html`] : []
}

/** `status="…"` from a card's first lines, or null. */
export function cardStatus(text) {
  return /status="([a-z]+)"/.exec(text.split('\n').slice(0, 3).join('\n'))?.[1] ?? null
}

/** Rows of the Markdown table under the heading that starts with `heading`. */
export function tableUnder(text, heading) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(l => l.startsWith(heading))
  if (start < 0) return []
  const rows = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6} /.test(line)) break
    if (line.startsWith('|') && !/^\|\s*-/.test(line)) rows.push(line.trim())
  }
  return rows.slice(1)
}

/** Card paths named in approvals § 2.1 (full paths) and § 2.2 (html-comments screen names). */
export function approvedCards(approvals) {
  const cards = new Set()
  for (const row of tableUnder(approvals, '### 2.1')) for (const m of row.matchAll(/`(docs\/design-system\/[^`]+\.html)`/g)) cards.add(m[1])
  for (const row of tableUnder(approvals, '### 2.2')) {
    const m = /^\|\s*`([\w-]+\.html)`/.exec(row)
    if (m) cards.add(`docs/designs/comments/html-comments/${m[1]}`)
  }
  return cards
}

/** The approval date approvals § 1 gives the decided-card changes. */
export function cardApprovalDate(approvals) {
  const row = tableUnder(approvals, '## 1.').find(r => /decided/.test(r) && /cards/.test(r))
  return row ? /(\d{4}-\d{2}-\d{2})\s*\|\s*$/.exec(row)?.[1] ?? null : null
}

function commitList(base) {
  const shas = git(['rev-list', '--reverse', `${base}..HEAD`]).trim().split('\n').filter(Boolean)
  return shas.map(full => {
    const [sha, date, subject] = git(['log', '-1', '--format=%h%x09%as%x09%s', full]).trim().split('\t')
    return {
      full,
      sha,
      date,
      subject,
      message: git(['log', '-1', '--format=%B', full]),
      changes: parseRaw(git(['diff-tree', '-r', '-M', '--raw', '--no-commit-id', '--abbrev=40', full])),
      tree: git(['ls-tree', '-r', '--name-only', full]).trim().split('\n')
    }
  })
}

function indexOfCommit(commits, short) {
  return commits.findIndex(c => c.full.startsWith(short))
}

function rule021Order(commits) {
  const at = name => indexOfCommit(commits, COMMITS[name])
  const move = at('firstMove')
  const before = ['fix429', 'fix426', 'frozenPin', 'behaviourPin']
  const missing = [...before, 'firstMove'].filter(n => at(n) < 0)
  if (missing.length) return { pass: false, evidence: `not on the branch: ${missing.map(n => COMMITS[n]).join(', ')}` }
  const late = before.filter(n => at(n) > move)
  return {
    pass: late.length === 0,
    evidence: `${before.map(n => `${COMMITS[n]} at #${at(n) + 1}`).join(', ')}; first move ${COMMITS.firstMove} at #${move + 1}${late.length ? `; after it: ${late.join(', ')}` : ''}`
  }
}

function rule021NumRuns() {
  const diff = git(['show', '--format=', '-U0', COMMITS.fix429])
  const touched = diff.split('\n').filter(l => /^[-+](?![-+])/.test(l) && /numRuns|NUM_RUNS|FC_NUM_RUNS/.test(l))
  const files = git(['show', '--name-only', '--format=', COMMITS.fix429]).trim().split('\n')
  const arbitraries = files.map(f => path.posix.join(path.posix.dirname(f), '__fixtures__/arbitraries.ts'))[0]
  const source = git(['show', `${COMMITS.fix429}:${arbitraries}`])
  const defaults = /NUM_RUNS\s*=\s*Number\(process\.env\.FC_NUM_RUNS[^)]*\)\s*\|\|\s*200\b/.test(source)
  const message = /numRuns stays at 200/.test(git(['log', '-1', '--format=%B', COMMITS.fix429]))
  return {
    pass: touched.length === 0 && defaults && message,
    evidence: `diff lines touching numRuns: ${touched.length}; ${arbitraries} at the commit defaults NUM_RUNS to 200: ${defaults}; message says "numRuns stays at 200": ${message}`
  }
}

function rule021E020(commits) {
  const at = indexOfCommit(commits, COMMITS.markdownComments)
  const diff = git(['show', '--format=', COMMITS.markdownComments, '--', 'e2e'])
  const removed = /^-\s*test\('E-020 /m.test(diff)
  const testsWith = sha => git(['grep', '-c', "test('E-020 ", sha, '--', 'e2e']).trim()
  let before = ''
  let after = ''
  try {
    before = testsWith(`${COMMITS.markdownComments}~1`)
  } catch {
    before = ''
  }
  try {
    after = testsWith('HEAD')
  } catch {
    after = ''
  }
  return {
    pass: at >= 0 && removed && before !== '' && after === '',
    evidence: `${COMMITS.markdownComments} removes the E-020 test: ${removed}; E-020 test before it: ${before ? 'yes' : 'no'}; at HEAD: ${after ? 'yes' : 'no'}`
  }
}

function rule033Cards(base, commits, approvals) {
  const changed = git(['diff', '--name-only', `${base}...HEAD`, '--', 'docs/design-system/system', 'docs/designs/comments/html-comments'])
    .trim()
    .split('\n')
    .filter(Boolean)
  const html = git(['ls-tree', '-r', '--name-only', 'HEAD', 'docs/designs/comments/html-comments']).trim().split('\n').filter(f => f.endsWith('.html'))
  const cards = new Set(changed.flatMap(cardOf).flatMap(c => (c === '*html-comments*' ? html : [c])))
  const statusAt = (ref, file) => {
    try {
      return cardStatus(git(['show', `${ref}:${file}`]))
    } catch {
      return null
    }
  }
  const decided = [...cards].filter(c => statusAt(base, c) === 'decided' || statusAt('HEAD', c) === 'decided').sort()
  const approved = approvedCards(approvals)
  const date = cardApprovalDate(approvals)
  const ui = commits[indexOfCommit(commits, COMMITS.markdownComments)]
  const unlisted = decided.filter(c => !approved.has(c))
  const onTime = date !== null && ui !== undefined && date <= ui.date
  const signOff = /full sign-off .* on 2026-10-29/.test(approvals)
  // approvals § 2.3 step 1 also plans a dated history line in each card; reported, not a rule of 024-AC-033 here.
  const noHistoryLine = decided.filter(c => !/owner approved the (?:comments-v2 changes|changes comments-v2 makes)/.test(git(['show', `HEAD:${c}`])))
  return {
    noHistoryLine,
    pass: unlisted.length === 0 && onTime && signOff,
    evidence:
      `${decided.length} decided cards changed: ${decided.map(c => c.replace(/^docs\//, '')).join(', ')}; ` +
      `approval row date ${date ?? 'none'} vs first UI commit ${COMMITS.markdownComments} on ${ui?.date ?? '?'}; ` +
      `owner sign-off 2026-10-29 recorded: ${signOff}` +
      (unlisted.length ? `; NOT in approvals § 2: ${unlisted.join(', ')}` : '')
  }
}

function rule033Refresh(commits, approvals) {
  const touches = commits.filter(c => c.changes.some(x => x.to === 'docs/designs/comments/comments-v2.md'))
  const refresh = touches.find(c => c.full.startsWith(COMMITS.refresh81)) ?? touches.find(c => /§ ?8\.1/.test(c.subject))
  const v2 = readFileSync(path.join(ROOT, 'docs/designs/comments/comments-v2.md'), 'utf8')
  const ours = tableUnder(v2, '### 8.1')
  const theirs = tableUnder(approvals, '## 3.')
  const same = ours.length > 0 && JSON.stringify(ours) === JSON.stringify(theirs)
  const ui = indexOfCommit(commits, COMMITS.markdownComments)
  const early = refresh !== undefined && indexOfCommit(commits, refresh.sha) < ui
  return {
    pass: refresh !== undefined && same && early,
    evidence: `refresh commit ${refresh ? `${refresh.sha} "${refresh.subject}"` : 'none'}, before the first UI commit: ${early}; § 8.1 rows (${ours.length}) equal approvals § 3 rows (${theirs.length}): ${same}`
  }
}

function rule022(base, commits) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const merges = git(['rev-list', '--merges', `${base}..HEAD`]).trim().split('\n').filter(Boolean)
  return {
    pass: merges.length === 0 && commits.length > 0,
    evidence: `one pull request from \`${branch}\` into \`${base}\`; ${commits.length} commits, ${merges.length} merge commits (linear, so it merges without squashing); the rebase --exec log is attached separately`
  }
}

/**
 * 024-AC-021 also asks the #426 commit to show a failing-before run and a
 * 20-of-20 passing-after run and to state the cause. Run counts in prose are
 * not a rule this script can judge, so it reports what the message says.
 */
export function fix426Note(message) {
  const failedBefore = /^Before\b[^\n]*(?:\n(?!\n)[^\n]*)*\b\d+ failed\b/m.test(message)
  const after20 = /--repeat-each=20\b/.test(message) && /^After\b/m.test(message)
  const cause = /^Cause\b/m.test(message)
  const owed = /still owed/.test(message)
  return `#426 commit ${COMMITS.fix426}: cause stated: ${cause}; a failing before-run shown: ${failedBefore}; a --repeat-each=20 after-run shown: ${after20}${owed ? '; the message says runs are still owed' : ''}`
}

/** Runs every rule; returns { commits, rules, notes }. */
export function runChecks(base = 'develop') {
  const commits = commitList(base)
  const approvals = readFileSync(path.join(ROOT, SPEC, 'design/approvals.md'), 'utf8')
  const baseTree = git(['ls-tree', '-r', '--name-only', base]).trim().split('\n')
  const inv = invariantViolations(baseTree, commits)
  inv.notes.push(fix426Note(git(['log', '-1', '--format=%B', COMMITS.fix426])))
  const { noHistoryLine, ...cards } = rule033Cards(base, commits, approvals)
  if (noHistoryLine.length) {
    inv.notes.push(`approvals § 2.3 step 1 (a dated approval line in each card's history) is not done in ${noHistoryLine.length} of the changed decided cards: ${noHistoryLine.join(', ')}`)
  }
  const chr = characterisationProblems(commits)
  const rules = [
    { id: '021-order', title: '#429 and #426 fixes and the v0.23.1 pin commits come before the first move commit', ...rule021Order(commits) },
    { id: '021-numruns', title: 'the #429 commit keeps numRuns at 200', ...rule021NumRuns() },
    {
      id: '021-invariants',
      title: 'invariant pins never change after they land (new files and byte-identical renames allowed)',
      pass: inv.violations.length === 0,
      evidence: `${inv.tracked} pin files tracked to HEAD; ${inv.violations.length ? `changed: ${inv.violations.join('; ')}` : 'none changed'}`
    },
    {
      id: '021-characterisation',
      title: 'every characterisation-pin change sits in a feat: commit naming a C-xx or OD-xx',
      pass: chr.problems.length === 0,
      evidence: `${chr.changed.length} changing commits: ${chr.changed.join('; ') || 'none'}${chr.problems.length ? `; FAILING: ${chr.problems.join('; ')}` : ''}`
    },
    { id: '021-e020', title: 'E-020 is retired in the commit that adds Markdown comments', ...rule021E020(commits) },
    { id: '033-cards', title: 'every decided card changed on the branch has an approvals row dated on or before the first UI commit', ...cards },
    { id: '033-refresh', title: 'comments-v2 § 8.1 was refreshed before the first UI commit and matches approvals § 3', ...rule033Refresh(commits, approvals) },
    { id: '022-one-pr', title: 'one pull request, linear history', ...rule022(base, commits) }
  ]
  return { commits, rules, notes: inv.notes }
}

const cell = s => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

/** The Markdown report the unit test reads. */
export function renderReport({ base, head, commits, rules, notes }) {
  const lines = [
    // REUSE-IgnoreStart -- the header this script writes into the report, not this file's own
    '<!-- SPDX-License-Identifier: GPL-3.0-only -->',
    '<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->',
    // REUSE-IgnoreEnd
    '',
    '# Spec 024 history check',
    '',
    `Written by \`node scripts/check-spec024-history.mjs\` – do not edit by hand. Base \`${base}\`, HEAD \`${head}\`, ${commits.length} commits. Acceptance: 024-AC-021, 024-AC-033 and the history half of 024-AC-022; \`scripts/check-spec024-history.test.mjs\` reads this file.`,
    '',
    '## Rules',
    '',
    '| Rule | Check | Result | Evidence |',
    '|---|---|---|---|',
    ...rules.map(r => `| ${r.id} | ${cell(r.title)} | ${r.pass ? 'pass' : 'fail'} | ${cell(r.evidence)} |`),
    '',
    '## Notes',
    '',
    ...(notes.length ? notes.map(n => `- ${n}`) : ['- None.']),
    '',
    '## Commits, oldest first',
    '',
    '| # | Commit | Date | Subject |',
    '|---|---|---|---|',
    ...commits.map((c, i) => `| ${i + 1} | ${c.sha} | ${c.date} | ${cell(c.subject)} |`),
    ''
  ]
  return lines.join('\n')
}

function main(argv) {
  const opt = (flag, fallback) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : fallback
  }
  const base = opt('--base', 'develop')
  const out = opt('--out', REPORT)
  const result = runChecks(base)
  const head = git(['rev-parse', '--short=8', 'HEAD']).trim()
  writeFileSync(path.join(ROOT, out), renderReport({ base, head, ...result }))
  for (const r of result.rules) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.id.padEnd(22)} ${r.evidence}`)
  for (const n of result.notes) console.log(`note ${n}`)
  console.log(`\nwrote ${out}`)
  return result.rules.every(r => r.pass) ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
