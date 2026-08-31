// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Build design/ so it can be opened in a browser, and verify it is up to date.
 *
 *   npm run design            write the generated files
 *   npm run design -- --check exit non-zero if any generated file is stale
 *
 * Everything under design/ is committed, including the generated files, so the
 * folder renders on a fresh clone with nothing run first. The --check mode is
 * what keeps that honest: it regenerates in memory and fails if the committed
 * result disagrees, which is how a stale token copy or a stale index is caught
 * in CI rather than by a reader who trusts a wrong swatch.
 *
 * Replaces the earlier design/sync.sh + design/build-index.py. The port is
 * deliberately faithful in four places where Node and Python differ; each is
 * marked PARITY below, because a silent divergence there would mean the
 * committed index and the regenerated one never agree again.
 */

import { Buffer } from 'node:buffer'
import { evaluate } from './lib/design-claims.mjs'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DESIGN = path.join(ROOT, 'design')
const TOKENS = path.join(ROOT, 'src/renderer/src/styles/design-tokens.css')
const FONTS = path.join(ROOT, 'src/renderer/src/assets/fonts')

const FONT_FILES = [
  'CascadiaMono-Regular.woff2',
  'CascadiaMono-Bold.woff2',
  // Both REUSE sidecars. sync.sh copied only the Regular one, so the Bold font
  // arrived unlicensed; the files are committed now, so that would be a real gap.
  'CascadiaMono-Regular.woff2.license',
  'CascadiaMono-Bold.woff2.license'
]

// REUSE-IgnoreStart -- these are the headers this script WRITES into the
// generated files, not this file's own licensing. Without the markers `reuse
// lint` parses "GPL-3.0-only -->" as a licence expression and fails the required
// License compliance check. Same reason, same fix as scripts/check-spdx-headers.mjs.
const SPDX = [
  '<!-- SPDX-License-Identifier: GPL-3.0-only -->',
  '<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->'
].join('\n')
// REUSE-IgnoreEnd

// Section order is deliberate: read the foundations before the parts, and the
// parts before the screens built out of them.
const ORDER = ['Foundations', 'Components', 'HTML preview']

const MARKER = /<!--\s*@card\s+([^>]*?)-->/
const FIELD = /([a-z]+)="([^"]*)"/g

/** Fields every card must declare. The generator FAILS on a missing one rather
 * than rendering a card with no status, because "is this decided or is it a
 * sketch?" is the first question a reader has and the folder had no way to
 * answer it. `status` is deliberately three-valued: a card can be proposed for a
 * long time, and saying so is worth more than quietly implying it is settled. */
const REQUIRED_FIELDS = ['group', 'name', 'status', 'reviewed']
const VALID_STATUS = new Set(['decided', 'proposed', 'superseded'])

/** How many leading lines are scanned for the @card marker.
 *
 * build-index.py read line 1 only, which made adding an SPDX header silently
 * empty the index — the marker moved to line 3 and every card vanished with no
 * error. Scanning a few lines removes the trap instead of documenting it. */
const MARKER_SCAN_LINES = 5

/** PARITY: Python's html.escape() defaults to quote=True. */
function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/** PARITY: Python sorts Path objects by their component tuple, so "components"
 * sorts before "components-x". A plain string sort on the joined path reverses
 * that, because "/" (0x2F) is above "-" (0x2D). Compare component-wise. */
function byPathComponents(a, b) {
  const left = a.split('/')
  const right = b.split('/')
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
  }
  return left.length - right.length
}

/** PARITY: hrefs must be posix even when built on Windows, or every link in the
 * generated index is dead. */
function walkHtml(dir, prefix = '') {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const href = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...walkHtml(path.join(dir, entry.name), href))
    else if (entry.name.endsWith('.html')) found.push(href)
  }
  return found
}

function collect() {
  const groups = new Map()
  const hrefs = walkHtml(DESIGN).filter(h => h !== 'index.html').sort(byPathComponents)

  for (const href of hrefs) {
    const head = readFileSync(path.join(DESIGN, href), 'utf8')
      .split('\n')
      .slice(0, MARKER_SCAN_LINES)
      .join('\n')
    const found = MARKER.exec(head)
    if (!found) continue

    const card = { subtitle: '' }
    for (const [, key, value] of found[1].matchAll(FIELD)) card[key] = value

    const missing = REQUIRED_FIELDS.filter(f => !card[f])
    if (missing.length > 0) {
      console.error(`design-sync: ${href} is missing @card ${missing.join(', ')}`)
      process.exit(1)
    }
    if (!VALID_STATUS.has(card.status)) {
      console.error(
        `design-sync: ${href} has status="${card.status}" — expected one of ${[...VALID_STATUS].join(', ')}`
      )
      process.exit(1)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(card.reviewed)) {
      console.error(`design-sync: ${href} has reviewed="${card.reviewed}" — expected YYYY-MM-DD`)
      process.exit(1)
    }

    if (!groups.has(card.group)) groups.set(card.group, [])
    groups.get(card.group).push({ ...card, href })
  }
  return groups
}

function render(groups) {
  const ordered = [
    ...ORDER.filter(g => groups.has(g)),
    ...[...groups.keys()].filter(g => !ORDER.includes(g)).sort()
  ]

  let total = 0
  const sections = ordered.map(group => {
    const cards = groups.get(group)
    total += cards.length
    const items = cards
      .map(
        ({ name, subtitle, href, status, reviewed }) =>
          `    <a class="card" href="${escapeHtml(href)}">\n` +
          `      <span class="card__name">${escapeHtml(name)}</span>\n` +
          `      <span class="card__sub">${escapeHtml(subtitle)}</span>\n` +
          `      <span class="card__meta" data-status="${escapeHtml(status)}">` +
          `${escapeHtml(status)} · reviewed ${escapeHtml(reviewed)}</span>\n` +
          `    </a>`
      )
      .join('\n')
    return (
      `  <h2>${escapeHtml(group)} <span class="count">${cards.length}</span></h2>\n` +
      `  <div class="grid">\n${items}\n  </div>`
    )
  })

  return `${SPDX}
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Erfana design</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="ds.css">
<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: var(--border-width); background: var(--color-border-default);
          border: var(--border-width) solid var(--color-border-default);
          margin-bottom: var(--space-16); }
  .card { display: flex; flex-direction: column; gap: var(--space-3);
          padding: var(--space-8) var(--space-10); background: var(--color-bg-secondary);
          text-decoration: none; }
  .card:hover { background: var(--color-bg-hover-solid); }
  /* The grid does not scroll, so the ring goes OUTSIDE the card. The inset
     variant is for a target clipped by a scroll container — see
     design/system/foundations/focus.html. */
  .card:focus-visible { outline: var(--border-width-thick) solid var(--color-border-focus);
                        outline-offset: var(--space-1); }
  .card__name { font-family: var(--font-mono); font-size: var(--text-md);
                color: var(--color-text-emphasis); }
  .card__sub { font-size: var(--text-sm); line-height: var(--leading-snug);
               color: var(--color-text-tertiary); }
  .count { font-family: var(--font-mono); font-size: var(--text-sm);
           color: var(--color-text-secondary); font-weight: var(--font-normal); }
  /* Status is on the card, not buried in the page. "proposed" is not a failure
     state - it is the honest one for most of these, and hiding it is how a
     sketch gets cited as a decision. */
  .card__meta { font-family: var(--font-mono); font-size: var(--text-xs);
                color: var(--color-text-tertiary); }
  .card__meta[data-status="decided"] { color: var(--color-brand-lime); }
</style>
</head>
<body>

<h1>Erfana design</h1>
<p class="ds-lede">
  ${total} cards, generated from the folder itself. Every page reads a synced copy of
  the app's <code>design-tokens.css</code> and the real bundled Cascadia Mono, so no value
  here is transcribed by hand — and <code>npm run design -- --check</code> fails in CI when
  the copy and the app disagree.
</p>
<p class="ds-lede">
  <strong>Check a card's status before citing it.</strong> <em>decided</em> is binding;
  <em>proposed</em> is a direction of travel, not settled law.
</p>

<div class="ds-note">
  <strong>Rebuild with <code>npm run design</code></strong> after adding a card or changing a token.
  This index, <code>tokens.css</code> and the fonts are generated — do not edit them.
</div>

${sections.join('\n')}

</body>
</html>
`
}

/** Every generated file, as {path, bytes}. Written in write mode, compared in
 * check mode — one description, so the two modes cannot disagree. */
function generate() {
  if (!existsSync(TOKENS)) {
    console.error(`design-sync: token file not found at ${TOKENS}`)
    process.exit(1)
  }

  const files = [{ rel: 'tokens.css', bytes: readFileSync(TOKENS) }]

  for (const name of FONT_FILES) {
    const source = path.join(FONTS, name)
    if (!existsSync(source)) {
      console.error(`design-sync: font asset not found at ${source}`)
      process.exit(1)
    }
    files.push({ rel: `fonts/${name}`, bytes: readFileSync(source) })
  }

  files.push({ rel: 'claims.js', bytes: Buffer.from(renderClaims(), 'utf8') })

  // PARITY: write LF explicitly. Python's write_text() translates newlines on
  // Windows; .gitattributes normalises on the way in, but do not rely on it.
  files.push({ rel: 'index.html', bytes: Buffer.from(render(collect()), 'utf8') })
  return files
}

/**
 * The claims ledger, evaluated against the shipping source and frozen into a
 * script the cards load.
 *
 * The cards stay authored — this never rewrites them. A card writes an empty
 * `<span data-claim="id">` and the value arrives at page load, so there is
 * nowhere in a card to type a digit by hand. That is the whole point: nine
 * numbers in this folder were wrong because they were copied from a summary
 * instead of re-read from the code.
 */
function renderClaims() {
  const ledger = JSON.parse(readFileSync(path.join(DESIGN, 'claims.json'), 'utf8'))
  delete ledger.$comment
  const values = evaluate(ROOT, ledger)

  const entries = Object.entries(ledger).map(([id, claim]) => [
    id,
    { value: values[id], label: claim.label, card: claim.card }
  ])

  // REUSE-IgnoreStart -- the header written INTO design/claims.js, not this file's.
  return `/* SPDX-License-Identifier: GPL-3.0-only */
/* SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. */
/* GENERATED by scripts/design-sync.mjs from design/claims.json — do not edit.
   Every value below was derived from src/ at build time. design/claims.test.ts
   re-derives them on every CI run and fails naming the card that drifted. */
window.ERFANA_CLAIMS = ${JSON.stringify(Object.fromEntries(entries), null, 2)};

(function fillClaims() {
  var fill = function () {
    var spans = document.querySelectorAll('[data-claim]');
    for (var i = 0; i < spans.length; i += 1) {
      var id = spans[i].getAttribute('data-claim');
      var claim = window.ERFANA_CLAIMS[id];
      if (!claim) {
        /* Loud on purpose. A card asking for a number that no longer exists
           must not render an empty gap that reads as a typo. */
        spans[i].textContent = '[no claim "' + id + '"]';
        spans[i].style.color = 'var(--color-error)';
        continue;
      }
      spans[i].textContent = String(claim.value);
      spans[i].title = claim.label;
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill);
  else fill();
})();
`
  // REUSE-IgnoreEnd
}

function main() {
  const check = process.argv.includes('--check')
  const files = generate()

  if (check) {
    const stale = files.filter(({ rel, bytes }) => {
      const target = path.join(DESIGN, rel)
      return !existsSync(target) || !readFileSync(target).equals(bytes)
    })
    if (stale.length > 0) {
      console.error('design-sync: these generated files are stale or missing:')
      for (const { rel } of stale) console.error(`  design/${rel}`)
      console.error('\nRun `npm run design` and commit the result.')
      process.exit(1)
    }
    console.log(`design-sync: ${files.length} generated files up to date`)
    return
  }

  for (const { rel, bytes } of files) {
    const target = path.join(DESIGN, rel)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
  const groups = collect()
  const cards = [...groups.values()].reduce((n, list) => n + list.length, 0)
  console.log(`design-sync: ${cards} cards in ${groups.size} groups. Open design/index.html`)
}

main()
