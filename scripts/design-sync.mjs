// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Build docs/design-system/ and docs/designs/ so they open in a browser with no
 * JavaScript, and verify they are up to date.
 *
 *   npm run design            write the generated files and bake every card
 *   npm run design -- --check exit non-zero if anything is stale or breaks a rule
 *
 * Everything is committed, including the generated files, so both folders render
 * on a fresh clone with nothing run first. The --check mode is what keeps that
 * honest: it regenerates in memory and fails if the committed result disagrees,
 * which is how a stale token copy, a stale index or a stale number is caught in
 * CI rather than by a reader who trusts a wrong swatch.
 *
 * WHAT "BAKE" MEANS. The cards are static HTML: no <script>, enforced by
 * scripts/lib/design-static.mjs and by a CSP meta on every page. A value the
 * card must not type by hand is written as an empty (or stale) element with a
 * data attribute, and this script splices the fresh value between its start and
 * end tags:
 *
 *   <span data-claim="id"></span>          a ledger value from claims.json (title = its label)
 *   <code data-token="--space-4"></code>   the literal the token resolves to in design-tokens.css
 *   <td data-contrast="--fg on --bg" data-min="4.5"></td>
 *                                          "N.NN:1 · pass|fail" and data-result="pass|fail";
 *                                          add "over --surface" for a translucent background;
 *                                          without data-min it is a bare "N.NN:1" measurement
 *   <svg data-icon="x"></svg>              the lucide-react icon's children, plus stroke attributes
 *   <div data-generated="host-elide"></div> a region from GENERATED_REGIONS (markup only Node can compute)
 *
 * Only the bytes between the tags (and the one attribute) change, so a CRLF
 * checkout stays byte-identical to an LF one everywhere else (#104).
 */

import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { URL, fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'parse5'

import { collectCustomProperties, evaluate, resolveVar, tokenContrast } from './lib/design-claims.mjs'
import {
  CSP_META,
  STATIC_TREES,
  brokenLinks,
  nodesOf,
  staticProblems,
  walkAll
} from './lib/design-static.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DESIGN = path.join(ROOT, 'docs/design-system')
const DESIGNS = path.join(ROOT, 'docs/designs')
const TOKENS = path.join(ROOT, 'src/renderer/src/styles/design-tokens.css')
const FONTS = path.join(ROOT, 'src/renderer/src/assets/fonts')

/**
 * Component CSS that has been ADOPTED: the file lives in src/ and is copied back
 * into docs/design-system/ so the card renders what actually ships.
 *
 * Adoption is a MOVE, not a copy. A component stylesheet still authored under
 * docs/design-system/ is a proposal with no incumbent; once it has one, two editable copies
 * is how one of them stays wrong – which is exactly how a broken bidi front-elide
 * survived in the Rows card for months.
 *
 * `rel` must keep the path the cards already link, because a card opens over
 * file:// and cannot reach up into src/. Every `src` here must also sit in the
 * erf- override of .stylelintrc.json – a guard below checks it.
 */
export const COMPONENT_CSS = [
  {
    src: 'src/renderer/src/styles/hostName.css',
    rel: 'system/components/row/host.css'
  },
  {
    src: 'src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewChromeBand.css',
    rel: 'system/components/permission-band/band.css'
  },
  {
    // Back, the link-mode toggle and the band's narrow-width tiers (issue #124).
    src: 'src/renderer/src/components/Panels/HtmlPreviewPanel/components/PreviewNavControls.css',
    rel: 'system/components/permission-band/nav.css'
  }
]

const FONT_FILES = [
  'CascadiaMono-Regular.woff2',
  'CascadiaMono-Bold.woff2',
  'CascadiaMono-Regular.woff2.license',
  'CascadiaMono-Bold.woff2.license'
]

/** Files this script used to generate and must never come back. */
const RETIRED_GENERATED = ['docs/design-system/claims.js']

// REUSE-IgnoreStart -- these are the headers this script WRITES into the
// generated files, not this file's own licensing. Without the markers `reuse
// lint` parses "GPL-3.0-only -->" as a licence expression and fails the required
// License compliance check. Same reason, same fix as scripts/check-spdx-headers.mjs.
const SPDX = [
  '<!-- SPDX-License-Identifier: GPL-3.0-only -->',
  '<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->'
].join('\n')
// REUSE-IgnoreEnd

/** Section order: read the foundations before the parts built on them. The
 * group is DERIVED from the folder; a marker that names another group fails. */
export const ORDER = ['Foundations', 'Components', 'Patterns']
export const GROUP_FOLDERS = {
  'system/foundations/': 'Foundations',
  'system/components/': 'Components',
  'system/patterns/': 'Patterns'
}

/**
 * Which card owns which token family. One map, read by the ownership guard
 * and rendered into the index's "Which card owns this token" table. A token in
 * an owned family must appear on its owner card as data-token="--name", or in
 * that card's "Not shown" list (data-not-shown="--name") with a reason.
 * Longest prefix wins.
 */
export const TOKEN_OWNERS = {
  '--color-': 'system/foundations/colors.html',
  '--text-': 'system/foundations/type.html',
  '--font-': 'system/foundations/type.html',
  '--leading-': 'system/foundations/type.html',
  '--space-': 'system/foundations/spacing.html',
  '--shadow-': 'system/foundations/surfaces.html',
  '--border-': 'system/foundations/surfaces.html',
  '--scrollbar-': 'system/foundations/surfaces.html',
  '--opacity-': 'system/foundations/surfaces.html',
  '--transition-': 'system/foundations/motion.html',
  '--z-': 'system/foundations/layering.html',
  '--icon-size-': 'system/components/icon/index.html',
  '--btn-height-': 'system/components/button/index.html',
  '--input-height-': 'system/components/form/index.html'
}

/** The owner card of a token, or undefined when its family is not owned. */
export function ownerOf(token) {
  const prefix = Object.keys(TOKEN_OWNERS)
    .filter(p => token.startsWith(p))
    .sort((a, b) => b.length - a.length)[0]
  return prefix ? TOKEN_OWNERS[prefix] : undefined
}

const MARKER = /^<!--\s*@card\s+([^>]*?)-->/
const FIELD = /([a-z-]+)="([^"]*)"/g
const REQUIRED_FIELDS = ['group', 'name', 'status', 'reviewed']
const VALID_STATUS = new Set(['decided', 'proposed', 'superseded'])

/** A build failure: collected, reported together, exit 1. */
class DesignError extends Error {}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/** Python-compatible component-wise path sort, so "components" < "components-x". */
function byPathComponents(a, b) {
  const left = a.split('/')
  const right = b.split('/')
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
  }
  return left.length - right.length
}

/** Encode generated text as LF bytes, whatever its inputs carried (#104). */
function lfBytes(text) {
  return Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8')
}

/* ---------------------------------------------------------------- markers */

/**
 * Parse the @card marker. It must be on LINE 1 – exactly line 1. A scan of
 * "the first few lines" once let a marker drift below an SPDX header while the
 * header itself moved to line 1; the rule is now one line, stated and checked.
 */
export function readMarker(text, file) {
  const first = text.split(/\r?\n/, 1)[0]
  const found = MARKER.exec(first)
  if (!found) {
    if (/@card\b/.test(text.split(/\r?\n/).slice(0, 8).join('\n'))) {
      throw new DesignError(`${file}: the @card marker must be on line 1, before the SPDX lines`)
    }
    return null
  }
  const card = { subtitle: '' }
  for (const [, key, value] of found[1].matchAll(FIELD)) card[key] = value
  return card
}

/** Every HTML page in a tree that is a card (not a generated page). */
function pagesUnder(base, rel = '') {
  return walkAll(ROOT, path.posix.join(path.relative(ROOT, base).split(path.sep).join('/'), rel))
    .filter(f => f.endsWith('.html'))
}

/** System cards, validated, with their href relative to docs/design-system/. */
export function collectCards() {
  const problems = []
  const cards = []
  for (const file of pagesUnder(DESIGN)) {
    const href = file.slice('docs/design-system/'.length)
    if (GENERATED_PAGES.has(file)) continue
    let card
    try {
      card = readMarker(readFileSync(path.join(ROOT, file), 'utf8'), file)
    } catch (error) {
      problems.push(error.message)
      continue
    }
    if (!card) {
      problems.push(`${file}: no @card marker on line 1`)
      continue
    }
    const missing = REQUIRED_FIELDS.filter(f => !card[f])
    if (missing.length) problems.push(`${file}: missing @card ${missing.join(', ')}`)
    if (card.status && !VALID_STATUS.has(card.status)) {
      problems.push(`${file}: status="${card.status}" – expected one of ${[...VALID_STATUS].join(', ')}`)
    }
    // `reviewed` is the date a PERSON last opened the card, never the date the
    // file changed. A card no person has opened yet says "never" – allowed only
    // while it is proposed, because a decided card is one somebody signed off.
    if (card.reviewed && card.reviewed !== 'never' && !/^\d{4}-\d{2}-\d{2}$/.test(card.reviewed)) {
      problems.push(`${file}: reviewed="${card.reviewed}" – expected YYYY-MM-DD, or "never" on a proposed card`)
    }
    if (card.reviewed === 'never' && card.status && card.status !== 'proposed') {
      problems.push(`${file}: reviewed="never" on a ${card.status} card – only a proposed card may be unreviewed`)
    }
    const folder = Object.keys(GROUP_FOLDERS).find(prefix => href.startsWith(prefix))
    if (!folder) problems.push(`${file}: a card must live under ${Object.keys(GROUP_FOLDERS).join(', ')}`)
    else if (card.group !== GROUP_FOLDERS[folder]) {
      problems.push(`${file}: group="${card.group}" but the folder says "${GROUP_FOLDERS[folder]}"`)
    }
    if (/—/.test(card.subtitle)) problems.push(`${file}: the @card subtitle uses an em dash – use an en dash (–)`)
    if (card.status === 'superseded') {
      const target = card['replaced-by']
      if (!target) problems.push(`${file}: a superseded card needs replaced-by="<card path>"`)
      else if (!existsSync(path.join(DESIGN, target))) problems.push(`${file}: replaced-by="${target}" does not exist`)
    }
    cards.push({ ...card, group: GROUP_FOLDERS[folder] ?? card.group, href, file })
  }
  if (problems.length) throw new DesignError(problems.join('\n'))
  return cards.sort((a, b) => byPathComponents(a.href, b.href))
}

/** Feature screens in docs/designs/, grouped by functionality folder. */
function collectScreens() {
  const groups = new Map()
  for (const file of pagesUnder(DESIGNS)) {
    if (GENERATED_PAGES.has(file)) continue
    const rel = file.slice('docs/designs/'.length)
    const folder = rel.includes('/') ? rel.split('/')[0] : '(top level)'
    let card
    try {
      card = readMarker(readFileSync(path.join(ROOT, file), 'utf8'), file)
    } catch (error) {
      throw new DesignError(error.message)
    }
    if (!groups.has(folder)) groups.set(folder, { screens: [], notes: [] })
    groups.get(folder).screens.push({ rel, name: card?.name ?? rel, subtitle: card?.subtitle ?? '', status: card?.status ?? 'unmarked', reviewed: card?.reviewed ?? '' })
  }
  for (const file of walkAll(ROOT, 'docs/designs').filter(f => f.endsWith('.md'))) {
    const rel = file.slice('docs/designs/'.length)
    if (!rel.includes('/')) continue
    const folder = rel.split('/')[0]
    if (!groups.has(folder)) groups.set(folder, { screens: [], notes: [] })
    groups.get(folder).notes.push(rel)
  }
  return new Map([...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
}

/* ---------------------------------------------------------------- shared page shell */

/** The head every generated page carries – CSP first, as the guard requires. */
function head(title, depth = '') {
  return `${CSP_META}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${depth}tokens.css">
<link rel="stylesheet" href="${depth}ds.css">`
}

const STATUS_MEANING = {
  decided: 'binding – the app must match it, or say why at the site',
  proposed: 'a direction of travel, not settled law',
  superseded: 'kept for history – follow "Replaced by"'
}

/* ---------------------------------------------------------------- index.html */

function renderIndex(cards, tokens) {
  const live = cards.filter(c => c.status !== 'superseded')
  const superseded = cards.filter(c => c.status === 'superseded')
  const counts = Object.fromEntries([...VALID_STATUS].map(s => [s, cards.filter(c => c.status === s).length]))
  const groups = [
    ...ORDER.filter(g => live.some(c => c.group === g)),
    ...[...new Set(live.map(c => c.group))].filter(g => !ORDER.includes(g)).sort()
  ]

  const cardLink = ({ name, subtitle, href, status, reviewed }) =>
    `    <a class="ix-card" href="${escapeHtml(href)}">\n` +
    `      <span class="ix-card__name">${escapeHtml(name)}</span>\n` +
    `      <span class="ix-card__sub">${escapeHtml(subtitle)}</span>\n` +
    `      <span class="ix-card__meta"><span class="ds-status" data-status="${escapeHtml(status)}">${escapeHtml(status)}</span>` +
    ` ${reviewed === 'never' ? 'not yet reviewed' : `reviewed ${escapeHtml(reviewed)}`}</span>\n` +
    `    </a>`

  const sections = groups.map(group => {
    const list = live.filter(c => c.group === group)
    return (
      `<h2 id="${escapeHtml(group.toLowerCase())}">${escapeHtml(group)} <span class="ix-count">${list.length}</span></h2>\n` +
      `<div class="ix-grid">\n${list.map(cardLink).join('\n')}\n</div>`
    )
  })
  if (!groups.includes('Patterns')) {
    sections.push(
      '<h2 id="patterns">Patterns <span class="ix-count">0</span></h2>\n' +
        '<p class="ds-muted">No pattern cards yet. A pattern combines components into a recurring flow ' +
        '(a confirm step, an empty state); it lives in <code>system/patterns/</code>.</p>'
    )
  }

  const tasks = cards
    .filter(c => c.answers && c.status !== 'superseded')
    .flatMap(c => c.answers.split(';').map(a => a.trim()).filter(Boolean).map(answer => ({ answer, c })))
    .sort((a, b) => (a.answer.toLowerCase() < b.answer.toLowerCase() ? -1 : 1))
  const taskRows = tasks
    .map(({ answer, c }) => `  <tr><td>${escapeHtml(answer)}</td><td><a href="${escapeHtml(c.href)}">${escapeHtml(c.name)}</a></td></tr>`)
    .join('\n')

  const families = Object.entries(TOKEN_OWNERS)
  const ownerRows = families
    .map(([prefix, href]) => {
      const card = cards.find(c => c.href === href)
      const n = [...tokens.keys()].filter(t => ownerOf(t) === href && t.startsWith(prefix)).length
      return `  <tr><td><code>${escapeHtml(prefix)}*</code></td><td class="ds-num">${n}</td><td><a href="${escapeHtml(href)}">${escapeHtml(card?.name ?? href)}</a></td></tr>`
    })
    .join('\n')

  const supersededBlock = superseded.length
    ? `<details class="ix-superseded">\n<summary>Superseded cards (${superseded.length})</summary>\n<table>\n<thead><tr><th>Card</th><th>Replaced by</th></tr></thead>\n<tbody>\n${superseded
        .map(c => {
          const to = cards.find(x => x.href === c['replaced-by'])
          return `  <tr><td><a href="${escapeHtml(c.href)}">${escapeHtml(c.name)}</a></td><td><a href="${escapeHtml(c['replaced-by'])}">${escapeHtml(to?.name ?? c['replaced-by'])}</a></td></tr>`
        })
        .join('\n')}\n</tbody>\n</table>\n</details>`
    : '<p class="ds-muted">No card is superseded yet. A superseded card stays in the folder for history and names its replacement.</p>'

  return `${SPDX}
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
${head('Erfana design system')}
<style>
  .ix-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
             gap: var(--space-4); margin-bottom: var(--space-16); }
  .ix-card { display: flex; flex-direction: column; gap: var(--space-3);
             padding: var(--space-8) var(--space-10); background: var(--color-bg-secondary);
             border: var(--border-width) solid var(--color-border-default); text-decoration: none; }
  .ix-card:hover { background: var(--color-bg-hover-solid); border-color: var(--color-border-subtle); }
  /* The grid does not scroll, so the ring goes OUTSIDE the card – see
     system/foundations/focus.html. */
  .ix-card:focus-visible { outline: var(--border-width-thick) solid var(--color-border-focus);
                           outline-offset: var(--space-1); }
  .ix-card__name { font-family: var(--font-mono); font-size: var(--text-md); color: var(--color-text-emphasis); }
  .ix-card__sub { font-size: var(--text-sm); line-height: var(--leading-snug); color: var(--color-text-tertiary); }
  .ix-card__meta { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-tertiary); }
  .ix-count { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--color-text-tertiary);
              font-weight: var(--font-normal); }
  .ix-summary { display: flex; flex-wrap: wrap; gap: var(--space-8); margin: 0 0 var(--space-12); padding: 0;
                list-style: none; }
  .ix-summary li { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--color-text-tertiary); }
  .ix-superseded summary { cursor: pointer; color: var(--color-text-bright); }
</style>
</head>
<body>
<main>
<h1>Erfana design system</h1>
<p class="ds-lede">
  ${cards.length} cards, generated from the folder itself. Every page reads a synced copy of the app's
  <code>design-tokens.css</code> and the real bundled Cascadia Mono, and every number a card quotes is
  baked in from the source by <code>npm run design</code> – no page runs JavaScript.
</p>

<ul class="ix-summary" aria-label="Cards by status">
${[...VALID_STATUS].map(s => `  <li><span class="ds-status" data-status="${s}">${s}</span> ${counts[s]}</li>`).join('\n')}
</ul>

<div class="ds-note">
  <strong>How to read this.</strong> Check a card's status before citing it.
  <ul>
${[...VALID_STATUS].map(s => `    <li><strong>${s}</strong> – ${escapeHtml(STATUS_MEANING[s])}.</li>`).join('\n')}
  </ul>
  A deviation is allowed only when the code says so at the site –
  <code>/* deviates: docs/design-system/&lt;card&gt; – why */</code> – and the card lists it under
  Exceptions. Every marker in <code>src/</code> is listed in the <a href="deviations.html">deviation register</a>.
  The folder is <strong>static by rule</strong>: HTML, CSS and images only, guarded by
  <code>npm run design -- --check</code> and a content security policy on every page.
  The full rules are in <a href="README.md">README.md</a>.
</div>

<div class="ds-note">
  <strong>Looking for a screen, not a rule?</strong> Feature screens built from these cards live in
  <a href="../designs/index.html">the designs index</a>. A screen cites a card; it never decides a system rule.
</div>

<h2 id="start-here">Start here by task</h2>
${tasks.length ? `<table>\n<thead><tr><th>I need to…</th><th>Card</th></tr></thead>\n<tbody>\n${taskRows}\n</tbody>\n</table>` : '<p class="ds-muted">No card declares an <code>answers</code> field yet.</p>'}

${sections.join('\n\n')}

<h2 id="token-owners">Which card owns this token</h2>
<p class="ds-muted">Each token family has exactly one owner card, which shows every token in it or says why not.</p>
<table>
<thead><tr><th>Family</th><th>Tokens</th><th>Owner</th></tr></thead>
<tbody>
${ownerRows}
</tbody>
</table>

<h2 id="superseded">Superseded</h2>
${supersededBlock}

<div class="ds-note">
  <strong>Rebuild with <code>npm run design</code></strong> after adding a card or changing a token.
  This index, <code>deviations.html</code>, <code>tokens.css</code>, the fonts and the adopted component CSS
  are generated – do not edit them.
</div>
</main>
</body>
</html>
`
}

/* ---------------------------------------------------------------- deviations.html */

/** Every `deviates:` marker in src/, as { file, line, target, reason }. */
export function collectDeviations() {
  const found = []
  for (const file of walkAll(ROOT, 'src')) {
    if (!/\.(css|ts|tsx|js|mjs|html)$/.test(file) || /\.test\./.test(file)) continue
    const lines = readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/)
    lines.forEach((text, i) => {
      const hit = /deviates:\s*(docs\/design(?:s|-system)\/[^\s,)*]*)\s*(?:[–—-]\s*)?(.*)$/.exec(text)
      if (!hit) return
      const reason = hit[2].replace(/\*\/\s*$/, '').trim()
      found.push({ file, line: i + 1, target: hit[1].replace(/[.,;:]$/, ''), reason })
    })
  }
  return found
}

/** Deviation markers that point nowhere, or at a card that does not list them. */
export function deviationProblems() {
  const problems = []
  for (const { file, line, target } of collectDeviations()) {
    const abs = path.join(ROOT, target)
    if (!target.endsWith('.html') || !existsSync(abs)) {
      problems.push(`${file}:${line} deviates: ${target} – the target must be an existing .html card`)
      continue
    }
    if (target.startsWith('docs/design-system/')) {
      const exceptions = sectionText(readFileSync(abs, 'utf8'), 'exceptions')
      const base = path.posix.basename(file)
      if (exceptions === null) problems.push(`${file}:${line} ${target} has no #exceptions section`)
      else if (!exceptions.includes(base)) {
        problems.push(`${file}:${line} ${target} does not list ${base} in its #exceptions section`)
      }
    }
  }
  return problems
}

/** The text content of the element with this id, or null. */
function sectionText(html, id) {
  for (const node of nodesOf(parse(html))) {
    if ((node.attrs ?? []).some(a => a.name === 'id' && a.value === id)) {
      const parts = []
      for (const n of nodesOf(node)) if (n.nodeName === '#text') parts.push(n.value)
      return parts.join('')
    }
  }
  return null
}

function renderDeviations(entries, cards) {
  const rows = entries
    .map(({ file, line, target, reason }) => {
      const href = target.startsWith('docs/design-system/')
        ? target.slice('docs/design-system/'.length)
        : `../${target.slice('docs/'.length)}`
      const card = cards.find(c => c.file === target)
      return `  <tr><td><code>${escapeHtml(file)}:${line}</code></td><td><a href="${escapeHtml(href)}">${escapeHtml(card?.name ?? target.replace(/^docs\//, ''))}</a></td><td>${escapeHtml(reason || '(reason continues on the next lines at the site)')}</td></tr>`
    })
    .join('\n')
  return `${SPDX}
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
${head('Deviation register')}
</head>
<body>
<main>
<nav class="ds-crumbs" aria-label="Breadcrumb"><a href="index.html">Erfana design system</a> <span aria-hidden="true">/</span> <span aria-current="page">Deviation register</span></nav>
<h1>Deviation register</h1>
<p class="ds-lede">
  Every <code>deviates:</code> marker in <code>src/</code> – ${entries.length} today – generated by
  <code>npm run design</code>. A deviation is legal only when the code says so at the site and the card it
  departs from lists the file under Exceptions; <code>npm run design -- --check</code> fails otherwise.
</p>
<table>
<thead><tr><th>Site</th><th>Card</th><th>Reason, as written at the site</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</main>
</body>
</html>
`
}

/* ---------------------------------------------------------------- docs/designs/index.html */

function renderDesignsIndex(groups) {
  const sections = [...groups.entries()]
    .map(([folder, { screens, notes }]) => {
      const screenRows = screens
        .sort((a, b) => byPathComponents(a.rel, b.rel))
        .map(
          s =>
            `  <tr><td><a href="${escapeHtml(s.rel)}">${escapeHtml(s.name)}</a></td><td>${escapeHtml(s.subtitle)}</td>` +
            `<td><span class="ds-status" data-status="${escapeHtml(s.status)}">${escapeHtml(s.status)}</span></td><td class="ds-mono">${s.reviewed === 'never' ? 'not yet reviewed' : escapeHtml(s.reviewed)}</td></tr>`
        )
        .join('\n')
      const noteItems = notes.sort(byPathComponents).map(n => `  <li><a href="${escapeHtml(n)}"><code>${escapeHtml(n)}</code></a></li>`).join('\n')
      return (
        `<h2 id="${escapeHtml(folder)}">${escapeHtml(folder)}</h2>\n` +
        (screens.length
          ? `<table>\n<thead><tr><th>Screen</th><th>What it shows</th><th>Status</th><th>Reviewed</th></tr></thead>\n<tbody>\n${screenRows}\n</tbody>\n</table>\n`
          : '') +
        (notes.length ? `<p class="ds-muted">Design notes</p>\n<ul>\n${noteItems}\n</ul>` : '')
      )
    })
    .join('\n\n')
  return `${SPDX}
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
${head('Erfana feature designs', '../design-system/')}
</head>
<body>
<main>
<nav class="ds-crumbs" aria-label="Breadcrumb"><a href="../design-system/index.html">Erfana design system</a> <span aria-hidden="true">/</span> <span aria-current="page">Feature designs</span></nav>
<h1>Erfana feature designs</h1>
<p class="ds-lede">
  Screens and design notes, grouped by the functionality they belong to. Generated by
  <code>npm run design</code>. A screen <strong>cites</strong> design-system cards for every rule it uses and
  never decides a system rule itself; <em>decided</em> on a screen means approved for build. See
  <a href="README.md">README.md</a>.
</p>
${sections}
</main>
</body>
</html>
`
}

/* ---------------------------------------------------------------- the baker */

const ICON_ATTRS = [
  ['xmlns', 'http://www.w3.org/2000/svg'],
  ['viewBox', '0 0 24 24'],
  ['fill', 'none'],
  ['stroke', 'currentColor'],
  ['stroke-width', '2'],
  ['stroke-linecap', 'round'],
  ['stroke-linejoin', 'round'],
  ['aria-hidden', 'true']
]

const iconCache = new Map()
/** The SVG children for a lucide icon, from the shipping package. */
async function iconMarkup(name) {
  if (!iconCache.has(name)) {
    const file = path.join(ROOT, 'node_modules/lucide-react/dist/esm/icons', `${name}.js`)
    if (!existsSync(file)) throw new DesignError(`unknown lucide icon "${name}"`)
    const { __iconNode } = await import(pathToFileURL(file).href)
    iconCache.set(
      name,
      __iconNode
        .map(([tag, attrs]) => {
          const list = Object.entries(attrs).filter(([k]) => k !== 'key')
          return `<${tag}${list.map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('')}/>`
        })
        .join('')
    )
  }
  return iconCache.get(name)
}

/**
 * Generated regions: markup a card cannot compute without a script, computed
 * here instead. `<div data-generated="name"></div>` is replaced with the
 * region's output on every build.
 */
const HOST_ORIGINS = [
  'https://a-very-long-subdomain.cdn.evil.com',
  'https://cdn.jsdelivr.net',
  // A non-default port and a plain-http origin: both drawn because both are NOT the default.
  'https://evil.com:8443',
  'http://localhost:3000',
  // A trailing dot is normalised away, not refused (see the Rows card).
  'https://evil.com./',
  'https://xn--80ak6aa92e.com',
  // Enters as a U-label and comes out punycoded, by the URL parser: the homograph defence, rendered.
  'https://مثال.إختبار.evil.com',
  'https://averyveryverylongregistrabledomainname.example',
  'https://assets.tracking.eu-west-1.metrics.a-very-long-tenant-name.example.co.uk',
  'https://onesingleunbreakablelabelwithnodotsatallthatcannotwrapatalabelboundary.example'
]

/** One host row, exactly as the app's hostName.css primitive expects it: the
 * drawn host is aria-hidden (its <wbr> hints must not reach the name), and the
 * whole origin is announced from .erf-host__announced. Scheme and port are drawn
 * only when not the default; label boundaries get a <wbr>. */
export function hostRow(origin) {
  const url = new URL(origin)
  const host = url.hostname.endsWith('.') ? url.hostname.slice(0, -1) : url.hostname
  const scheme = url.protocol === 'https:' ? '' : `<span class="erf-host__scheme">${escapeHtml(url.protocol)}//</span>`
  const port = url.port === '' ? '' : `<span class="erf-host__port">:${escapeHtml(url.port)}</span>`
  const drawn = scheme + escapeHtml(host).replace(/\./g, '.<wbr>') + port
  const announced = `Host ${url.protocol}//${host}${url.port === '' ? '' : `:${url.port}`}`
  return (
    `<div class="erf-row"><span class="erf-host" dir="ltr" aria-hidden="true">${drawn}</span>` +
    `<span class="erf-host__announced">${escapeHtml(announced)}</span></div>`
  )
}

export const GENERATED_REGIONS = {
  'host-elide': () => HOST_ORIGINS.map(hostRow).join('')
}

/** Parse "--fg on --bg [over --surface]". */
function parseContrastSpec(spec) {
  const m = /^\s*(--[\w-]+)\s+on\s+(--[\w-]+)(?:\s+over\s+(--[\w-]+))?\s*$/.exec(spec)
  return m ? { fg: m[1], bg: m[2], over: m[3] } : null
}

/**
 * Bake one page. Returns { text, targets }, where `targets` lists each bake
 * target with its line, what it asked for, the stale inner text and the fresh
 * one – the check mode reports from that list.
 */
export async function bakePage(file, text, { claims, ledger, tokens }) {
  const doc = parse(text, { sourceCodeLocationInfo: true })
  const edits = []
  const targets = []
  const problems = []

  for (const node of nodesOf(doc)) {
    if (!node.tagName) continue
    const attrs = Object.fromEntries(node.attrs.map(a => [a.name, a.value]))
    const kinds = ['data-claim', 'data-token', 'data-contrast', 'data-icon', 'data-generated'].filter(k => k in attrs)
    if (kinds.length === 0) continue
    const loc = node.sourceCodeLocation
    const where = `${file}:${loc.startLine}`
    if (kinds.length > 1) {
      problems.push(`${where} one element may carry only one of ${kinds.join(', ')}`)
      continue
    }
    if (!loc.endTag) {
      problems.push(`${where} a bake target needs an explicit end tag`)
      continue
    }
    const kind = kinds[0]
    const id = attrs[kind]
    if (kind !== 'data-icon' && kind !== 'data-generated' && node.childNodes.some(c => c.tagName)) {
      problems.push(`${where} ${kind}="${id}" holds an element – a bake target may hold text only`)
      continue
    }

    let inner
    const setAttrs = {}
    if (kind === 'data-claim') {
      if (!(id in claims)) {
        problems.push(`${where} data-claim="${id}" is not in docs/design-system/claims.json`)
        continue
      }
      // A ratio is quoted to two decimals, as WCAG tools quote it: 2.20, not 2.2.
      inner = escapeHtml(ledger[id].kind === 'contrast' ? claims[id].toFixed(2) : String(claims[id]))
      setAttrs.title = ledger[id].label
    } else if (kind === 'data-token') {
      if (!tokens.has(id)) {
        problems.push(`${where} data-token="${id}" is not declared in design-tokens.css`)
        continue
      }
      inner = escapeHtml(resolveVar(`var(${id})`, tokens).replace(/\s+/g, ' '))
    } else if (kind === 'data-contrast') {
      const spec = parseContrastSpec(id)
      const min = Number(attrs['data-min'])
      if (!spec) {
        problems.push(`${where} data-contrast="${id}" – expected "--fg on --bg" or "--fg on --bg over --surface"`)
        continue
      }
      if ('data-min' in attrs && !Number.isFinite(min)) {
        problems.push(`${where} data-min="${attrs['data-min']}" is not a number (4.5 for text, 3 for non-text)`)
        continue
      }
      let ratio
      try {
        ratio = tokenContrast(tokens, spec.fg, spec.bg, spec.over)
      } catch (error) {
        problems.push(`${where} data-contrast="${id}": ${error.message}`)
        continue
      }
      if ('data-min' in attrs) {
        // A verdict: pass or fail against the bar the card names.
        const verdict = ratio >= min ? 'pass' : 'fail'
        inner = `${ratio.toFixed(2)}:1 · ${verdict}`
        setAttrs['data-result'] = verdict
      } else {
        // A measurement with no bar – a surface's step from its neighbour.
        inner = `${ratio.toFixed(2)}:1`
      }
    } else if (kind === 'data-generated') {
      if (!(id in GENERATED_REGIONS)) {
        problems.push(`${where} data-generated="${id}" names no region in GENERATED_REGIONS`)
        continue
      }
      inner = GENERATED_REGIONS[id]()
    } else {
      try {
        inner = await iconMarkup(id)
      } catch (error) {
        problems.push(`${where} ${error.message}`)
        continue
      }
      for (const [name, value] of ICON_ATTRS) if (!(name in attrs) && !(name.toLowerCase() in attrs)) setAttrs[name] = value
      if (node.tagName !== 'svg') {
        problems.push(`${where} data-icon belongs on an <svg>`)
        continue
      }
    }

    const start = loc.startTag.endOffset
    const end = loc.endTag.startOffset
    const stale = text.slice(start, end)
    targets.push({ line: loc.startLine, kind, id, stale, fresh: inner })
    if (stale !== inner) edits.push([start, end, inner])

    for (const [name, value] of Object.entries(setAttrs)) {
      const encoded = escapeHtml(value)
      const attrLoc = loc.startTag.attrs?.[name.toLowerCase()]
      if (attrLoc) {
        const current = text.slice(attrLoc.startOffset, attrLoc.endOffset)
        const wanted = `${name}="${encoded}"`
        if (current !== wanted) edits.push([attrLoc.startOffset, attrLoc.endOffset, wanted])
        if (current !== wanted) targets.push({ line: loc.startLine, kind: `${kind} ${name}`, id, stale: current, fresh: wanted })
      } else {
        const close = text.slice(loc.startTag.startOffset, loc.startTag.endOffset).endsWith('/>') ? 2 : 1
        const at = loc.startTag.endOffset - close
        edits.push([at, at, ` ${name}="${encoded}"`])
        targets.push({ line: loc.startLine, kind: `${kind} ${name}`, id, stale: '(missing)', fresh: `${name}="${encoded}"` })
      }
    }
  }
  if (problems.length) throw new DesignError(problems.join('\n'))

  let out = text
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
    out = out.slice(0, start) + value + out.slice(end)
  }
  return { text: out, targets }
}

/** The ledger without its comment, and its evaluated values. */
export function loadClaims() {
  const ledger = JSON.parse(readFileSync(path.join(DESIGN, 'claims.json'), 'utf8'))
  delete ledger.$comment
  return { ledger, claims: evaluate(ROOT, ledger) }
}

/** Every authored page in both trees (generated pages excluded). */
export function authoredPages() {
  return STATIC_TREES.flatMap(tree => walkAll(ROOT, tree).filter(f => f.endsWith('.html') && !GENERATED_PAGES.has(f)))
}

const GENERATED_PAGES = new Set([
  'docs/design-system/index.html',
  'docs/design-system/deviations.html',
  'docs/designs/index.html'
])

/* ---------------------------------------------------------------- governance guards */

/** Problems with token ownership: a token its owner card neither shows nor excuses. */
export function ownershipProblems(tokens) {
  const problems = []
  const cache = new Map()
  const read = href => {
    if (!cache.has(href)) {
      const abs = path.join(DESIGN, href)
      const html = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
      const shown = new Set([...html.matchAll(/data-token="(--[\w-]+)"/g)].map(m => m[1]))
      const excused = new Map()
      for (const node of nodesOf(parse(html))) {
        const name = (node.attrs ?? []).find(a => a.name === 'data-not-shown')?.value
        if (!name) continue
        const parts = []
        for (const n of nodesOf(node)) if (n.nodeName === '#text') parts.push(n.value)
        excused.set(name, parts.join('').replace(name, '').replace(/[\s–—:-]+/g, ' ').trim())
      }
      cache.set(href, { shown, excused, exists: html !== '' })
    }
    return cache.get(href)
  }
  for (const token of tokens.keys()) {
    const owner = ownerOf(token)
    if (!owner) continue
    const card = read(owner)
    if (!card.exists) {
      problems.push(`token owner ${owner} does not exist`)
      continue
    }
    if (card.shown.has(token)) continue
    const reason = card.excused.get(token)
    if (reason === undefined) problems.push(`${token}: not shown on its owner card ${owner} (add data-token="${token}", or list it with data-not-shown and a reason)`)
    else if (reason.length < 3) problems.push(`${token}: listed as not shown on ${owner} without a reason`)
  }
  return problems
}

/** Problems with a system card's anatomy: #decision, #exceptions, and a status badge that matches the marker. */
export function anatomyProblems(cards) {
  const problems = []
  for (const card of cards) {
    const html = readFileSync(path.join(ROOT, card.file), 'utf8')
    const doc = parse(html)
    const ids = new Set()
    let badge = null
    let main = false
    let crumbs = false
    for (const node of nodesOf(doc)) {
      for (const a of node.attrs ?? []) if (a.name === 'id') ids.add(a.value)
      if (node.tagName === 'main') main = true
      const cls = (node.attrs ?? []).find(a => a.name === 'class')?.value.split(/\s+/) ?? []
      if (cls.includes('ds-crumbs')) crumbs = true
      if (cls.includes('ds-status') && badge === null) {
        const parts = []
        for (const n of nodesOf(node)) if (n.nodeName === '#text') parts.push(n.value)
        badge = { text: parts.join('').trim(), attr: node.attrs.find(a => a.name === 'data-status')?.value }
      }
    }
    for (const id of ['decision', 'exceptions']) if (!ids.has(id)) problems.push(`${card.file}: no element with id="${id}"`)
    if (!main) problems.push(`${card.file}: the card content must sit in <main>`)
    if (!crumbs) problems.push(`${card.file}: no .ds-crumbs breadcrumb`)
    if (!badge) problems.push(`${card.file}: no .ds-status badge`)
    else if (badge.text !== card.status || badge.attr !== card.status) {
      problems.push(`${card.file}: the status badge says "${badge.text}" (data-status="${badge.attr}") but the marker says "${card.status}"`)
    }
  }
  return problems
}

/** Every adopted src stylesheet must sit in the erf- override of .stylelintrc.json. */
export function stylelintCoverageProblems() {
  const config = JSON.parse(readFileSync(path.join(ROOT, '.stylelintrc.json'), 'utf8'))
  const erf = config.overrides.find(o => o.rules?.['selector-class-pattern'])
  const files = erf?.files ?? []
  return COMPONENT_CSS.filter(({ src }) => !files.includes(src)).map(
    ({ src }) => `${src} is adopted (COMPONENT_CSS) but missing from the erf- override in .stylelintrc.json`
  )
}

/** Files in a generated directory that nothing generates, and retired outputs that came back. */
function orphanProblems(files) {
  const generated = new Set(files.map(f => f.rel))
  const problems = []
  for (const file of walkAll(ROOT, 'docs/design-system/fonts')) {
    if (!generated.has(file)) problems.push(`${file} is in a generated folder but nothing generates it`)
  }
  for (const file of RETIRED_GENERATED) if (existsSync(path.join(ROOT, file))) problems.push(`${file} is retired – delete it`)
  return problems
}

/* ---------------------------------------------------------------- generate + main */

/** Every generated file, as { rel (repo-relative), bytes }. */
function generate(cards) {
  if (!existsSync(TOKENS)) throw new DesignError(`token file not found at ${TOKENS}`)
  const tokenText = readFileSync(TOKENS, 'utf8')
  const files = [{ rel: 'docs/design-system/tokens.css', bytes: readFileSync(TOKENS) }]

  for (const name of FONT_FILES) {
    const source = path.join(FONTS, name)
    if (!existsSync(source)) throw new DesignError(`font asset not found at ${source}`)
    files.push({ rel: `docs/design-system/fonts/${name}`, bytes: readFileSync(source) })
  }
  for (const { src, rel } of COMPONENT_CSS) {
    const source = path.join(ROOT, src)
    if (!existsSync(source)) throw new DesignError(`adopted component CSS not found at ${source}`)
    files.push({ rel: `docs/design-system/${rel}`, bytes: readFileSync(source) })
  }
  const tokens = collectCustomProperties(tokenText)
  files.push({ rel: 'docs/design-system/index.html', bytes: lfBytes(renderIndex(cards, tokens)) })
  files.push({ rel: 'docs/design-system/deviations.html', bytes: lfBytes(renderDeviations(collectDeviations(), cards)) })
  files.push({ rel: 'docs/designs/index.html', bytes: lfBytes(renderDesignsIndex(collectScreens())) })
  return files
}

async function run() {
  const check = process.argv.includes('--check')
  const cards = collectCards()
  const files = generate(cards)
  const { ledger, claims } = loadClaims()
  const tokens = collectCustomProperties(readFileSync(TOKENS, 'utf8'))

  const baked = []
  for (const file of authoredPages()) {
    const text = readFileSync(path.join(ROOT, file), 'utf8')
    const result = await bakePage(file, text, { claims, ledger, tokens })
    baked.push({ file, before: text, ...result })
  }

  if (!check) {
    for (const { rel, bytes } of files) {
      const target = path.join(ROOT, rel)
      mkdirSync(path.dirname(target), { recursive: true })
      if (!existsSync(target) || !readFileSync(target).equals(bytes)) writeFileSync(target, bytes)
    }
    for (const file of RETIRED_GENERATED) rmSync(path.join(ROOT, file), { force: true })
    let changed = 0
    for (const { file, before, text } of baked) {
      if (text !== before) {
        writeFileSync(path.join(ROOT, file), text)
        changed += 1
      }
    }
    console.log(
      `design-sync: ${cards.length} cards, ${files.length} generated files, ${baked.reduce((n, b) => n + b.targets.length, 0)} bake targets in ${baked.length} pages (${changed} rewritten). Open docs/design-system/index.html`
    )
    return
  }

  const problems = []
  for (const { rel, bytes } of files) {
    const target = path.join(ROOT, rel)
    if (!existsSync(target) || !readFileSync(target).equals(bytes)) problems.push(`${rel} is stale or missing`)
  }
  for (const { file, targets } of baked) {
    for (const t of targets) {
      if (t.stale !== t.fresh) problems.push(`${file}:${t.line} ${t.kind}="${t.id}" is stale: baked "${t.stale}", source says "${t.fresh}"`)
    }
  }
  problems.push(...orphanProblems(files))
  problems.push(...staticProblems(ROOT))
  problems.push(...brokenLinks(ROOT))
  problems.push(...deviationProblems())
  problems.push(...ownershipProblems(tokens))
  problems.push(...anatomyProblems(cards))
  problems.push(...stylelintCoverageProblems())

  if (problems.length > 0) {
    console.error(`design-sync: ${problems.length} problem(s):`)
    for (const p of problems) console.error(`  ${p}`)
    console.error('\nRun `npm run design` for anything stale, fix the rest, and commit the result.')
    process.exit(1)
  }
  console.log(
    `design-sync: ${files.length} generated files and ${baked.reduce((n, b) => n + b.targets.length, 0)} bake targets up to date; static, links, deviations, ownership and anatomy guards pass`
  )
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) {
  run().catch(error => {
    if (error instanceof DesignError) {
      console.error(`design-sync: ${error.message.split('\n').join('\ndesign-sync: ')}`)
      process.exit(1)
    }
    throw error
  })
}
