// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * The guard behind the claims ledger.
 *
 * docs/design-system/ states numbers to make its rules credible — "six spinners at three
 * speeds", "49 files bypass the icon registry", "3.72:1". Two reviews found nine
 * such numbers were wrong, and then found eighteen more errors in the plan
 * written to fix them. Numbers copied instead of derived go stale silently, and
 * a wrong number does not just fail on its own: it hands the reader a reason to
 * reopen every decision on the card.
 *
 * So no card holds a digit. A card writes `<span data-claim="id"></span>`, the
 * value is derived from src/ at build time into docs/design-system/claims.js, and this file
 * re-derives it on every CI run. When someone deletes a spinner, the Motion card
 * does not quietly become wrong — this goes red and names it.
 *
 * @see scripts/lib/design-claims.mjs for the predicate kinds and their limits
 * @see docs/design-system/claims.json for the ledger itself
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
const DESIGN = path.join(ROOT, 'docs/design-system')

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

/**
 * What is wrong with a stylesheet's app-wide reduced-motion rule, as a list of
 * problems (empty when it holds). The contract, from the Motion card: an exact
 * `@media (prefers-reduced-motion: reduce)` block – not negated, no extra
 * conditions – whose rule targets `*`, `*::before` and `*::after` and makes
 * every animation start at once (delay 0), last at most 1 ms and run once, all
 * `!important` so a component rule cannot win. A `transition-duration`, if the
 * block sets one, is held to the same 1 ms.
 *
 * The delay matters: a 1 ms animation behind a 2 s delay still holds its first
 * frame for 2 s, and a flash or slide that starts late is still motion.
 */
function reduceBlockProblems(rawCss) {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const media = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/.exec(css)
  if (!media) return ['no exact @media (prefers-reduced-motion: reduce) block']
  const rule = /^\s*([^{}]+)\{([^}]*)\}/.exec(css.slice(media.index + media[0].length))
  if (!rule) return ['the reduce block holds no rule']
  const problems = []
  const selectors = rule[1].split(',').map(sel => sel.trim())
  for (const needed of ['*', '*::before', '*::after']) {
    if (!selectors.includes(needed)) problems.push(`selector list lacks ${needed}`)
  }
  const decl = name => new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]+?)\\s*(!important)?\\s*(?:;|$)`).exec(rule[2])
  const ms = value => {
    const m = /^(\d*\.?\d+)(ms|s)$/.exec(value)
    return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : NaN
  }
  const duration = decl('animation-duration')
  if (!duration || !duration[2] || !(ms(duration[1]) <= 1)) {
    problems.push('animation-duration must be at most 1ms (or 0s) and !important')
  }
  const delay = decl('animation-delay')
  if (!delay || !delay[2] || ms(delay[1]) !== 0) problems.push('animation-delay must be 0 and !important')
  const count = decl('animation-iteration-count')
  if (!count || !count[2] || count[1] !== '1') {
    problems.push('animation-iteration-count must be 1 and !important')
  }
  const transition = decl('transition-duration')
  if (transition && (!transition[2] || !(ms(transition[1]) <= 1))) {
    problems.push('transition-duration, when set, must be at most 1ms and !important')
  }
  return problems
}

/** Feature screens live in docs/designs/ (comments first), but load the same
 * claims.js and carry the same @card marker, so they are held to the same checks.
 * A claim's `card` is relative to docs/design-system/, hence `../designs/...` for them. */
const CARD_FILES = [
  ...walk(ROOT, 'docs/design-system', ['.html']).filter(f => f !== 'docs/design-system/index.html'),
  ...walk(ROOT, 'docs/designs', ['.html'])
]

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
        `docs/design-system/claims.js is stale for "${id}" (card: ${LEDGER[id].card}). ` +
          `Run \`npm run design\` and commit the result.`
      ).toBe(fresh)
    })
  })

  describe('the reduced-motion contract (#96, system/foundations/motion.html)', () => {
    // The drift check above only proves the card matches the code: deleting the
    // app-wide block and re-running `npm run design` would turn the count to 0
    // and pass it. Twelve stylesheets once animated with no escape because the
    // rule lived per file, so these checks are what keep it from going back.
    const ENTRY_CSS = readFileSync(path.join(ROOT, 'src/renderer/src/index.css'), 'utf8')

    it('keeps the app-wide reduce block whenever a stylesheet animates', () => {
      const fresh = evaluate(ROOT, {
        animating: LEDGER['animating-stylesheets'],
        entry: LEDGER['reduced-motion-entry-rules']
      })
      // Nothing animating needs no escape; the rule is only owed while something moves.
      if (fresh.animating === 0) return
      expect(
        fresh.entry,
        'src/renderer/src/index.css lost its @media (prefers-reduced-motion: reduce) block'
      ).toBeGreaterThanOrEqual(1)
    })

    it('ends every animation on every element in the entry stylesheet', () => {
      expect(reduceBlockProblems(ENTRY_CSS)).toEqual([])
    })

    // Each mutation of the shipped block must be caught, or the check above
    // proves nothing.
    const GOOD = `@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
  }
}`
    it('accepts the shipped shape, in any selector order', () => {
      expect(reduceBlockProblems(GOOD)).toEqual([])
      expect(reduceBlockProblems(GOOD.replace('*, *::before, *::after', '*::after,\n*,*::before'))).toEqual([])
    })

    it.each([
      ['no block at all', '', /no exact/],
      ['a negated query', GOOD.replace('(prefers', 'not all and (prefers'), /no exact/],
      ['an extra condition', GOOD.replace('reduce)', 'reduce) and (min-width: 1px)'), /no exact/],
      ['no-preference', GOOD.replace('reduce', 'no-preference'), /no exact/],
      ['a missing ::before', GOOD.replace('*::before, ', ''), /\*::before/],
      ['a missing ::after', GOOD.replace(', *::after', ''), /\*::after/],
      ['a missing bare *', GOOD.replace('*, ', ''), /selector list lacks \*$/],
      ['a long duration', GOOD.replace('1ms', '200ms'), /animation-duration/],
      ['a duration in seconds over 1ms', GOOD.replace('1ms', '0.5s'), /animation-duration/],
      ['a duration without !important', GOOD.replace('1ms !important', '1ms'), /animation-duration/],
      ['a delay left in', GOOD.replace('animation-delay: 0s', 'animation-delay: 2s'), /animation-delay/],
      ['no delay rule', GOOD.replace(/\s*animation-delay[^;]*;/, ''), /animation-delay/],
      ['iterations left looping', GOOD.replace('count: 1', 'count: infinite'), /iteration-count/],
      ['a long transition', GOOD.replace('{\n    animation-delay', '{\n    transition-duration: 300ms !important;\n    animation-delay'), /transition-duration/]
    ])('rejects %s', (_label, css, problem) => {
      expect(reduceBlockProblems(css).join('\n')).toMatch(problem)
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
      const cards = CARD_FILES.map(f => path.posix.relative('docs/design-system', f))
      expect(cards, `claim "${id}" points at a missing card`).toContain(claim.card)
    })
  })

  describe('the folder itself', () => {
    it('finds cards to check', () => {
      // Guards against a rename silently emptying every assertion above.
      expect(CARD_FILES.length).toBeGreaterThan(5)
    })

    it('keeps docs/design-system/claims.js generated, never hand-edited', () => {
      expect(readFileSync(path.join(DESIGN, 'claims.js'), 'utf8')).toContain('GENERATED by')
    })

    it('has no stray tokens.css copies left from the old two-project layout', () => {
      // The folder used to keep one copy per "project"; a second copy is how the
      // drift check starts passing while a card renders last month's colours.
      const copies = walk(ROOT, 'docs/design-system', ['.css']).filter(f => f.endsWith('tokens.css'))
      expect(copies).toEqual(['docs/design-system/tokens.css'])
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
  const CARD = readFileSync(path.join(ROOT, 'docs/designs/html-waiting/index.html'), 'utf8')
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
    // while the docs/design-system/ copy drifts away from the shipping one — the exact
    // failure the tokens.css comparison exists to prevent, reintroduced one
    // directory down. So every file under docs/design-system/system/components/ must be
    // either synced from src/ or listed here as a proposal with no incumbent.
    const PROPOSED_NOT_YET_ADOPTED = [
      'docs/design-system/system/components/menu/menu.css',
      'docs/design-system/system/components/row/row.css'
    ]

    const synced = SYNC_SOURCE.match(/rel: '([^']+\.css)'/g)
      .map(m => `docs/design-system/${m.slice(6, -1)}`)

    const onDisk = walk(ROOT, 'docs/design-system/system/components', ['.css'])
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
    // Only the design system's own cards: feature screens in docs/designs/ are not indexed.
    const missing = CARD_FILES.filter(f => f.startsWith('docs/design-system/'))
      .map(f => f.replace(/^docs\/design-system\//, ''))
      .filter(href => !index.includes(`href="${href}"`))
    expect(
      missing,
      `cards absent from docs/design-system/index.html: ${missing.join(', ')}. ` +
        `Run \`npm run design\`. If the marker moved off the first few lines, the ` +
        `scan silently skipped it — that trap ate the whole index once already.`
    ).toEqual([])
  })

  it('keeps feature screens out of the design system', () => {
    // docs/design-system/product/ once held feature screens, and before that copies of
    // ds.css, fonts.css, tokens.css and a lib/ of component CSS — copies of copies.
    // Feature screens now live in docs/designs/<functionality>/; this stops the folder
    // growing back.
    const top = readdirSync(DESIGN, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
    expect(top).not.toContain('product')
  })
})
