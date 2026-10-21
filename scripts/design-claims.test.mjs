// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * The guard behind the claims ledger.
 *
 * design/ states numbers to make its rules credible — "six spinners at three
 * speeds", "49 files bypass the icon registry", "3.72:1". Two reviews found nine
 * such numbers were wrong, and then found eighteen more errors in the plan
 * written to fix them. Numbers copied instead of derived go stale silently, and
 * a wrong number does not just fail on its own: it hands the reader a reason to
 * reopen every decision on the card.
 *
 * So no card holds a digit. A card writes `<span data-claim="id"></span>`, the
 * value is derived from src/ at build time into design/claims.js, and this file
 * re-derives it on every CI run. When someone deletes a spinner, the Motion card
 * does not quietly become wrong — this goes red and names it.
 *
 * @see scripts/lib/design-claims.mjs for the predicate kinds and their limits
 * @see design/claims.json for the ledger itself
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  collectCustomProperties,
  contrastRatio,
  evaluate,
  resolveVar,
  stripCssComments,
  walk
} from './lib/design-claims.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The generator's own source, read as text so the manifest test below cannot
 * drift from it. Importing would be cleaner, but design-sync.mjs runs its CLI on
 * import and does not export its file list; reading the text keeps the test
 * honest without reshaping the script around it.
 */
const SYNC_SOURCE = readFileSync(path.join(ROOT, 'scripts/design-sync.mjs'), 'utf8')
const DESIGN = path.join(ROOT, 'design')

const LEDGER = (() => {
  const parsed = JSON.parse(readFileSync(path.join(DESIGN, 'claims.json'), 'utf8'))
  delete parsed.$comment
  return parsed
})()

/** The committed, generated values the cards actually render. */
const COMMITTED = (() => {
  const source = readFileSync(path.join(DESIGN, 'claims.js'), 'utf8')
  const start = source.indexOf('{', source.indexOf('window.ERFANA_CLAIMS'))
  // The FIRST `\n};` after the object — not the last, which closes the IIFE
  // that fills the spans.
  const end = source.indexOf('\n};', start)
  return JSON.parse(source.slice(start, end + 2))
})()

const CARD_FILES = walk(ROOT, 'design', ['.html']).filter(f => f !== 'design/index.html')

const CLAIM_IDS_IN_CARDS = new Set(
  CARD_FILES.flatMap(file =>
    [...readFileSync(path.join(ROOT, file), 'utf8').matchAll(/data-claim="([^"]+)"/g)].map(m => m[1])
  )
)

describe('design claims ledger', () => {
  describe('the contrast formula itself', () => {
    // If the maths is wrong every ratio below is confidently wrong, which is the
    // exact failure this whole mechanism exists to stop.
    it('computes the WCAG reference extremes', () => {
      expect(contrastRatio('#ffffff', '#000000')).toBe(21)
      expect(contrastRatio('#ffffff', '#ffffff')).toBe(1)
    })

    it('is order-independent', () => {
      expect(contrastRatio('#161312', '#858585')).toBe(contrastRatio('#858585', '#161312'))
    })
  })

  describe('every predicate still runs', () => {
    it('evaluates the whole ledger without throwing', () => {
      expect(() => evaluate(ROOT, LEDGER)).not.toThrow()
    })

    it.each(Object.keys(LEDGER))('derives a finite value for %s', id => {
      const value = evaluate(ROOT, { [id]: LEDGER[id] })[id]
      expect(Number.isFinite(value)).toBe(true)
    })
  })

  describe('the committed values match the code', () => {
    // This is the one that goes red when someone changes src/ and does not
    // re-run `npm run design`. `npm run design -- --check` catches it too; both
    // are required checks, and this one names the card.
    it.each(Object.keys(LEDGER))('%s is still what the source says', id => {
      const fresh = evaluate(ROOT, { [id]: LEDGER[id] })[id]
      expect(
        COMMITTED[id]?.value,
        `design/claims.js is stale for "${id}" (card: ${LEDGER[id].card}). ` +
          `Run \`npm run design\` and commit the result.`
      ).toBe(fresh)
    })
  })

  describe('the ledger and the cards agree', () => {
    it('has no card asking for a claim that does not exist', () => {
      const missing = [...CLAIM_IDS_IN_CARDS].filter(id => !(id in LEDGER))
      expect(missing, `cards reference unknown claim ids: ${missing.join(', ')}`).toEqual([])
    })

    it('has no claim that no card uses', () => {
      // A dead claim is a number nobody reads, still costing a CI run — and more
      // importantly a sign a card was edited to drop a rule without dropping its
      // evidence.
      const unused = Object.keys(LEDGER).filter(id => !CLAIM_IDS_IN_CARDS.has(id))
      expect(unused, `claims declared but never rendered: ${unused.join(', ')}`).toEqual([])
    })

    it.each(Object.entries(LEDGER))('%s names a card that exists', (id, claim) => {
      const cards = CARD_FILES.map(f => f.replace(/^design\//, ''))
      expect(cards, `claim "${id}" points at a missing card`).toContain(claim.card)
    })
  })

  describe('the folder itself', () => {
    it('finds cards to check', () => {
      // Guards against a rename silently emptying every assertion above.
      expect(CARD_FILES.length).toBeGreaterThan(5)
    })

    it('keeps design/claims.js generated, never hand-edited', () => {
      expect(readFileSync(path.join(DESIGN, 'claims.js'), 'utf8')).toContain('GENERATED by')
    })

    it('has no stray tokens.css copies left from the old two-project layout', () => {
      // The folder used to keep one copy per "project"; a second copy is how the
      // drift check starts passing while a card renders last month's colours.
      const copies = walk(ROOT, 'design', ['.css']).filter(f => f.endsWith('tokens.css'))
      expect(copies).toEqual(['design/tokens.css'])
    })
  })
})

describe('a card does not render the contrast failure it warns about', () => {
  /*
   * THE BUG THIS EXISTS FOR (#114). The html-waiting card drew its aside in
   * --color-text-muted at --text-xs on the pre-paint backdrop: 3.63:1, under the
   * 4.5:1 small text needs (WCAG 1.4.3). Every gate was green, because the ratio
   * was never a claim – and a card is the reference the app copies. So every text
   * rule of Surface A is read from the card's own <style> and measured against
   * the backdrop it sits on.
   */
  const CARD = readFileSync(path.join(DESIGN, 'product/html-waiting/index.html'), 'utf8')
  const STYLE = stripCssComments(CARD.slice(CARD.indexOf('<style>'), CARD.indexOf('</style>')))
  const TOKENS = collectCustomProperties(
    readFileSync(path.join(ROOT, 'src/renderer/src/styles/design-tokens.css'), 'utf8')
  )
  /** The value `property` takes in the card's first rule for exactly `selector`. */
  const declOf = (selector, property) => {
    for (const [, sel, body] of STYLE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (sel.trim() !== selector) continue
      return new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`).exec(body)?.[1].trim()
    }
    return undefined
  }

  it('paints the waiting message on the brand-black backdrop', () => {
    // The surface the ratios below are measured against. If this moves, so do they.
    expect(declOf('.panel__body--backdrop', 'background')).toBe('var(--color-brand-black)')
  })

  it.each(['.erf-wait__title', '.erf-wait__text', '.erf-wait__aside'])(
    '%s clears 4.5:1 on that backdrop',
    selector => {
      const colour = declOf(selector, 'color')
      expect(colour, `${selector} must declare a colour`).toBeDefined()
      const ratio = contrastRatio(
        resolveVar(colour, TOKENS),
        resolveVar('var(--color-brand-black)', TOKENS)
      )
      expect(ratio, `${selector} is ${ratio}:1`).toBeGreaterThanOrEqual(4.5)
    }
  )

  it.each(['.erf-wait__title', '.erf-wait__text', '.erf-wait__aside'])(
    '%s sets its colour exactly once, so no later rule can override the measured one',
    selector => {
      // Innermost brace pairs, so rules nested in @media or @container are seen
      // as themselves. Any rule whose selector mentions the class counts, not
      // only an exact match: a `.panel .erf-wait__aside` would win just as well.
      const name = new RegExp(`${selector.replace('.', '\\.')}(?![\\w-])`)
      const setters = [...STYLE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
        ([, sel, body]) => name.test(sel) && /(?:^|;)\s*color:/.test(body)
      )
      expect(setters.map(([, sel]) => sel.trim())).toHaveLength(1)
    }
  )
})

describe('design folder hygiene', () => {
  it('accounts for every component stylesheet — adopted ones must be synced', () => {
    // The gap this closes: `design -- --check` compares only the files
    // design-sync.mjs lists. Move a component stylesheet into src/ and forget to
    // add it to COMPONENT_CSS, and the check cheerfully reports "up to date"
    // while the design/ copy drifts away from the shipping one — the exact
    // failure the tokens.css comparison exists to prevent, reintroduced one
    // directory down. So every file under design/system/components/ must be
    // either synced from src/ or listed here as a proposal with no incumbent.
    const PROPOSED_NOT_YET_ADOPTED = [
      'design/system/components/menu/menu.css',
      'design/system/components/row/row.css'
    ]

    const synced = SYNC_SOURCE.match(/rel: '([^']+\.css)'/g)
      .map(m => `design/${m.slice(6, -1)}`)

    const onDisk = walk(ROOT, 'design/system/components', ['.css'])
    const unaccounted = onDisk.filter(
      f => !synced.includes(f) && !PROPOSED_NOT_YET_ADOPTED.includes(f)
    )

    expect(
      unaccounted,
      `component CSS neither synced from src/ nor declared proposed: ${unaccounted.join(', ')}. ` +
        'If it moved to src/, add it to COMPONENT_CSS in scripts/design-sync.mjs.'
    ).toEqual([])

    // And the reverse: a file listed as proposed must not have quietly gained a
    // src/ home, which would make its header comment a lie.
    const stale = PROPOSED_NOT_YET_ADOPTED.filter(f => synced.includes(f))
    expect(stale, `declared proposed but actually synced: ${stale.join(', ')}`).toEqual([])
  })

  it('has every card carrying its @card marker', () => {
    const missing = CARD_FILES.filter(file => {
      const head = readFileSync(path.join(ROOT, file), 'utf8').split('\n').slice(0, 5).join('\n')
      return !/<!--\s*@card\s+group="/.test(head)
    })
    expect(missing, `cards missing an @card marker: ${missing.join(', ')}`).toEqual([])
  })

  it.each(CARD_FILES)('%s declares a status and a review date', file => {
    // The generator already refuses to build without these. Asserting them here
    // too means the failure names the card in the test run as well as the build,
    // and it is what stops "is this decided or a sketch?" being unanswerable.
    const head = readFileSync(path.join(ROOT, file), 'utf8').split('\n')[0]
    expect(head, `${file}: status must be decided | proposed | superseded`).toMatch(
      /status="(decided|proposed|superseded)"/
    )
    expect(head, `${file}: reviewed must be an ISO date`).toMatch(/reviewed="\d{4}-\d{2}-\d{2}"/)
  })

  it('lists every card in the generated index', () => {
    const index = readFileSync(path.join(DESIGN, 'index.html'), 'utf8')
    const missing = CARD_FILES.map(f => f.replace(/^design\//, '')).filter(
      href => !index.includes(`href="${href}"`)
    )
    expect(
      missing,
      `cards absent from design/index.html: ${missing.join(', ')}. ` +
        `Run \`npm run design\`. If the marker moved off the first few lines, the ` +
        `scan silently skipped it — that trap ate the whole index once already.`
    ).toEqual([])
  })

  it('keeps the generated files out of the authored tree', () => {
    // design/product/ used to hold copies of ds.css, fonts.css, tokens.css and a
    // lib/ of component CSS — copies of copies. Committing the folder made the
    // duplication visible; this stops it growing back.
    const product = readdirSync(path.join(DESIGN, 'product'), { withFileTypes: true })
    expect(product.filter(e => e.isFile()).map(e => e.name)).toEqual([])
  })
})
