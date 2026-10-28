// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * The guard behind the claims ledger, and behind the baked cards.
 *
 * docs/design-system/ states numbers to make its rules credible – "six spinners at three
 * speeds", "49 files bypass the icon registry", "3.72:1". Two reviews found nine
 * such numbers were wrong, and then found eighteen more errors in the plan
 * written to fix them. Numbers copied instead of derived go stale silently, and
 * a wrong number does not just fail on its own: it hands the reader a reason to
 * reopen every decision on the card.
 *
 * So no card types a count of the app. A card writes `<span data-claim="id"></span>`,
 * `npm run design` derives the value from src/ and BAKES it into the card's own
 * text (the cards run no JavaScript), and this file re-derives it on every CI run
 * and compares it with what is baked. When someone deletes a spinner, the Motion
 * card does not quietly become wrong – this goes red and names the card and line.
 *
 * @see scripts/lib/design-claims.mjs for the predicate kinds and their limits
 * @see docs/design-system/claims.json for the ledger itself
 * @see scripts/design-sync.mjs for the baker and the governance guards
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'parse5'
import { describe, expect, it } from 'vitest'

import {
  collectCustomProperties,
  contrastRatio,
  evaluate,
  parseColor,
  relativeLuminance,
  resolveVar,
  stripCssComments,
  walk
} from './lib/design-claims.mjs'
import { nodesOf } from './lib/design-static.mjs'
import {
  COMPONENT_CSS,
  GROUP_FOLDERS,
  TOKEN_OWNERS,
  anatomyProblems,
  authoredPages,
  bakePage,
  collectCards,
  deviationProblems,
  loadClaims,
  ownershipProblems,
  readMarker,
  stylelintCoverageProblems
} from './design-sync.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DESIGN = path.join(ROOT, 'docs/design-system')
const TOKEN_FILE = path.join(ROOT, 'src/renderer/src/styles/design-tokens.css')

const LEDGER = (() => {
  const parsed = JSON.parse(readFileSync(path.join(DESIGN, 'claims.json'), 'utf8'))
  delete parsed.$comment
  return parsed
})()

/** Every page that can carry a bake target, repo-relative. */
const PAGES = authoredPages()

/** The text of a node, children included. */
function textOf(node) {
  const parts = []
  for (const n of nodesOf(node)) if (n.nodeName === '#text') parts.push(n.value)
  return parts.join('')
}

/**
 * What the cards actually render: every data-claim element, read with parse5
 * from the committed HTML. Replaces the old COMMITTED object parsed out of the
 * generated claims.js – there is no script any more, the text IS the value.
 */
const BAKED = PAGES.flatMap(file => {
  const doc = parse(readFileSync(path.join(ROOT, file), 'utf8'), { sourceCodeLocationInfo: true })
  return [...nodesOf(doc)]
    .filter(n => n.attrs?.some(a => a.name === 'data-claim'))
    .map(n => ({
      file,
      line: n.sourceCodeLocation?.startLine,
      id: n.attrs.find(a => a.name === 'data-claim').value,
      text: textOf(n)
    }))
})

/** A claim value as the baker writes it. */
const formatted = (id, value) => (LEDGER[id].kind === 'contrast' ? value.toFixed(2) : String(value))

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

/** Feature screens live in docs/designs/ and carry the same @card marker and bake
 * targets, so they are held to the same checks. A claim's `card` is relative to
 * docs/design-system/, hence `../designs/...` for them. */
const CARD_FILES = PAGES
const CLAIM_IDS_IN_CARDS = new Set(BAKED.map(b => b.id))

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

    it('reads every colour form the token file uses', () => {
      expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
      expect(parseColor('#E3E829')).toEqual({ r: 227, g: 232, b: 41, a: 1 })
      expect(parseColor('#00000080').a).toBeCloseTo(0.502, 3)
      expect(parseColor('rgba(160, 168, 255, 0.2)')).toEqual({ r: 160, g: 168, b: 255, a: 0.2 })
      expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 })
      expect(() => parseColor('red')).toThrow(/not a colour/)
      expect(() => parseColor('#12')).toThrow(/not a colour/)
    })

    it('uses the 0.04045 sRGB threshold', () => {
      // 10/255 = 0.0392 is linear under both thresholds; 0.0400-0.0404 is where they differ.
      expect(relativeLuminance('#0a0a0a')).toBeCloseTo((10 / 255 / 12.92), 6)
    })

    it('composites a translucent foreground over the background before measuring', () => {
      // 50% white over black is mid-grey #808080, not white.
      expect(contrastRatio('rgba(255, 255, 255, 0.5)', '#000000')).toBe(contrastRatio('rgb(127.5, 127.5, 127.5)', '#000000'))
    })

    it('takes an "over" surface for a translucent background, and refuses to guess without one', () => {
      expect(() => contrastRatio('#ffffff', 'rgba(0, 0, 0, 0.5)')).toThrow(/needs an "over" surface/)
      expect(() => contrastRatio('#ffffff', 'rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0.5)')).toThrow(/must be opaque/)
      expect(contrastRatio('#ffffff', 'rgba(0, 0, 0, 0.5)', '#ffffff')).toBe(contrastRatio('#ffffff', 'rgb(127.5, 127.5, 127.5)'))
    })
  })

  describe('every predicate still runs', () => {
    it('evaluates the whole ledger without throwing', () => {
      expect(() => evaluate(ROOT, LEDGER)).not.toThrow()
    })

    it.each(Object.keys(LEDGER))('derives a usable value for %s', id => {
      const value = evaluate(ROOT, { [id]: LEDGER[id] })[id]
      if (typeof value === 'string') expect(value.length).toBeGreaterThan(0)
      else expect(Number.isFinite(value)).toBe(true)
    })
  })

  describe('the baked values match the code', () => {
    // This is the one that goes red when someone changes src/ and does not
    // re-run `npm run design`. `npm run design -- --check` catches it too; this
    // one names the card and line in the test run.
    const FRESH = evaluate(ROOT, LEDGER)
    it.each(BAKED.map(b => [`${b.file}:${b.line} ${b.id}`, b]))('%s is still what the source says', (_label, baked) => {
      expect(
        baked.text,
        `${baked.file}:${baked.line} data-claim="${baked.id}" is stale. Run \`npm run design\` and commit the result.`
      ).toBe(formatted(baked.id, FRESH[baked.id]))
    })

    it('has no empty bake target', () => {
      const empty = BAKED.filter(b => b.text.trim() === '').map(b => `${b.file}:${b.line} ${b.id}`)
      expect(empty, 'run `npm run design` to fill these').toEqual([])
    })

    it('has every data-token and data-contrast fresh, and every target well formed', async () => {
      const { ledger, claims } = loadClaims()
      const tokens = collectCustomProperties(readFileSync(TOKEN_FILE, 'utf8'))
      const stale = []
      for (const file of PAGES) {
        const text = readFileSync(path.join(ROOT, file), 'utf8')
        const { targets } = await bakePage(file, text, { claims, ledger, tokens })
        for (const t of targets) if (t.stale !== t.fresh) stale.push(`${file}:${t.line} ${t.kind}="${t.id}"`)
      }
      expect(stale, 'run `npm run design`').toEqual([])
    })

    it('no longer ships a claims.js – the values live in the cards', () => {
      expect(existsSync(path.join(DESIGN, 'claims.js'))).toBe(false)
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

    it.each(Object.entries(LEDGER))('%s names a card that exists, and that card shows it', (id, claim) => {
      const cards = CARD_FILES.map(f => path.posix.relative('docs/design-system', f))
      expect(cards, `claim "${id}" points at a missing card`).toContain(claim.card)
      const on = BAKED.filter(b => b.id === id).map(b => path.posix.relative('docs/design-system', b.file))
      expect(on, `claim "${id}" says its card is ${claim.card}, but it is rendered on ${on.join(', ')}`).toContain(claim.card)
    })
  })

  describe('the folder itself', () => {
    it('finds cards to check', () => {
      // Guards against a rename silently emptying every assertion above.
      expect(CARD_FILES.length).toBeGreaterThan(5)
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
      'docs/design-system/system/components/row/row.css',
      'docs/design-system/system/components/badge/badge.css',
      'docs/design-system/system/components/button/button.css',
      'docs/design-system/system/components/splitter/splitter.css',
      'docs/design-system/system/components/tabs/tabs.css',
      'docs/design-system/system/components/toolbar/toolbar.css',
      'docs/design-system/system/components/tooltip/tooltip.css',
      'docs/design-system/system/patterns/dialog/dialog.css',
      'docs/design-system/system/patterns/states/states.css'
    ]

    const synced = COMPONENT_CSS.map(({ rel }) => `docs/design-system/${rel}`)

    const onDisk = [
      ...walk(ROOT, 'docs/design-system/system/components', ['.css']),
      ...walk(ROOT, 'docs/design-system/system/patterns', ['.css'])
    ]
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

  it('has every card carrying its @card marker on line 1 – exactly line 1', () => {
    // A scan of "the first few lines" let a marker drift below the SPDX header
    // unnoticed. The rule is one line, and the message says which.
    const missing = CARD_FILES.filter(file => {
      const first = readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/, 1)[0]
      return !/^<!--\s*@card\s+group="/.test(first)
    })
    expect(missing, `the @card marker must be on line 1, before the SPDX lines: ${missing.join(', ')}`).toEqual([])
  })

  it('refuses a marker that is not on line 1', () => {
    expect(() => readMarker('<!-- SPDX -->\n<!-- @card group="Foundations" name="X" -->', 'x.html')).toThrow(/line 1/)
    expect(readMarker('<!-- @card group="Foundations" name="X" status="proposed" -->\n', 'x.html')).toMatchObject({ name: 'X' })
  })

  it.each(CARD_FILES)('%s declares a status and a review date', file => {
    const head = readFileSync(path.join(ROOT, file), 'utf8').split('\n')[0]
    expect(head, `${file}: status must be decided | proposed | superseded`).toMatch(
      /status="(decided|proposed|superseded)"/
    )
    expect(head, `${file}: reviewed must be an ISO date, or "never" on a proposed card`).toMatch(
      /reviewed="\d{4}-\d{2}-\d{2}"|status="proposed"[^>]*reviewed="never"/
    )
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
        `Run \`npm run design\`. The marker must be on line 1.`
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

  it('keeps every system card in a group folder, including the new patterns/', () => {
    expect(Object.keys(GROUP_FOLDERS)).toContain('system/patterns/')
    expect(() => collectCards()).not.toThrow()
  })
})

describe('design system governance', () => {
  const tokens = collectCustomProperties(readFileSync(TOKEN_FILE, 'utf8'))

  it('gives every owned token family an owner card that exists', () => {
    for (const href of new Set(Object.values(TOKEN_OWNERS))) {
      expect(existsSync(path.join(DESIGN, href)), href).toBe(true)
    }
  })

  it('shows every owned token on its owner card, or says why not', () => {
    expect(ownershipProblems(tokens)).toEqual([])
  })

  it('flags a token its owner card neither shows nor excuses', () => {
    const extra = new Map(tokens)
    extra.set('--space-999', '999px')
    expect(ownershipProblems(extra).join('\n')).toMatch(/--space-999: not shown on its owner card/)
  })

  it('has #decision, #exceptions, a breadcrumb, <main> and a status badge matching the marker on every system card', () => {
    expect(anatomyProblems(collectCards())).toEqual([])
  })

  it('requires replaced-by on a superseded card', () => {
    for (const card of collectCards().filter(c => c.status === 'superseded')) {
      expect(card['replaced-by'], card.file).toBeTruthy()
      expect(existsSync(path.join(DESIGN, card['replaced-by'])), card.file).toBe(true)
    }
  })

  it('keeps every adopted stylesheet under the erf- stylelint rule', () => {
    expect(stylelintCoverageProblems()).toEqual([])
  })

  it('has every deviates: marker in src/ pointing at a real card that lists it', () => {
    expect(deviationProblems()).toEqual([])
  })

  it('writes no em dash in a card subtitle', () => {
    const bad = CARD_FILES.filter(f => /subtitle="[^"]*—/.test(readFileSync(path.join(ROOT, f), 'utf8').split('\n')[0]))
    expect(bad).toEqual([])
  })
})
