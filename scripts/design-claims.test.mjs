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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'parse5'
import { describe, expect, it } from 'vitest'

import {
  collectCustomProperties,
  contrastRatio,
  evaluate,
  formatRatio,
  parseColor,
  relativeLuminance,
  resolveVar,
  stripCssComments,
  walk
} from './lib/design-claims.mjs'
import { nodesOf } from './lib/design-static.mjs'
import { CSP_CONTENT } from './lib/design-static.mjs'
import {
  ANSI_KEYS,
  COMPONENT_CSS,
  DesignError,
  GROUP_FOLDERS,
  REASON_MAX,
  TOKEN_OWNERS,
  anatomyProblems,
  ansiContrast,
  authoredPages,
  bakePage,
  collectCards,
  deviationProblems,
  deviationsIn,
  iconMarkup,
  iconRegistryRegion,
  loadClaims,
  ownershipProblems,
  readIconRegistry,
  readMarker,
  readXtermTheme,
  renderDeviations,
  renderIndex,
  stylelintCoverageProblems,
  xtermDuplicateProblems
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
const formatted = (id, value) => (LEDGER[id].kind === 'contrast' ? formatRatio(value) : String(value))

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
      expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10)
      expect(contrastRatio('#ffffff', '#ffffff')).toBe(1)
      expect(formatRatio(contrastRatio('#ffffff', '#000000'))).toBe('21.00')
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

    it('returns the raw ratio, and quotes it rounded DOWN', () => {
      // #767676 on white is the classic 4.54:1 – unrounded it carries more digits.
      const raw = contrastRatio('#767676', '#ffffff')
      expect(raw).not.toBe(Math.round(raw * 100) / 100)
      expect(formatRatio(4.4951)).toBe('4.49')
      expect(formatRatio(4.5)).toBe('4.50')
      expect(formatRatio(10.4)).toBe('10.40')
      expect(formatRatio(2.999)).toBe('2.99')
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
   * rule of Surface A is measured against the backdrop it sits on.
   *
   * Surface A is now the States pattern's inline state (states.css), drawn on the
   * card's backdrop. The colours are read from states.css, and the card's own
   * <style> must not re-colour them – a local override would escape the measure.
   */
  const CARD = readFileSync(path.join(ROOT, 'docs/designs/html-waiting/index.html'), 'utf8')
  const STYLE = stripCssComments(CARD.slice(CARD.indexOf('<style>'), CARD.indexOf('</style>')))
  const STATES = stripCssComments(
    readFileSync(path.join(ROOT, 'docs/design-system/system/patterns/states/states.css'), 'utf8')
  )
  const TOKENS = collectCustomProperties(
    readFileSync(path.join(ROOT, 'src/renderer/src/styles/design-tokens.css'), 'utf8')
  )
  const SURFACE_A = ['.erf-state', '.erf-state__title', '.erf-state__hint', '.erf-state__action']
  /** The value `property` takes in the first rule of `css` for exactly `selector`. */
  const declOf = (css, selector, property) => {
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (sel.trim() !== selector) continue
      return new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`).exec(body)?.[1].trim()
    }
    return undefined
  }
  /** Innermost rules whose selector mentions the class and that set `color`. */
  const colourSetters = (css, selector) => {
    // Innermost brace pairs, so rules nested in @media or @container are seen
    // as themselves. Any rule whose selector mentions the class counts, not
    // only an exact match: a `.panel .erf-state__hint` would win just as well.
    const name = new RegExp(`${selector.replace('.', '\\.')}(?![\\w-])`)
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel, body]) => name.test(sel) && /(?:^|;)\s*color:/.test(body))
      .map(([, sel]) => sel.trim())
  }

  it('paints the waiting message on the brand-black backdrop', () => {
    // The surface the ratios below are measured against. If this moves, so do they.
    expect(declOf(STYLE, '.hw-body--backdrop', 'background')).toBe('var(--color-brand-black)')
    expect(CARD).toMatch(
      /class="hw-body hw-body--backdrop"[^>]*>\s*<div class="erf-state erf-state--inline"/
    )
  })

  it.each(SURFACE_A)('%s clears 4.5:1 on that backdrop', selector => {
    const colour = declOf(STATES, selector, 'color')
    expect(colour, `${selector} must declare a colour`).toBeDefined()
    const ratio = contrastRatio(
      resolveVar(colour, TOKENS),
      resolveVar('var(--color-brand-black)', TOKENS)
    )
    expect(ratio, `${selector} is ${ratio}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it.each(SURFACE_A)(
    '%s sets its colour exactly once, so no later rule can override the measured one',
    selector => {
      expect(colourSetters(STATES, selector)).toHaveLength(1)
      expect(colourSetters(STYLE, selector)).toHaveLength(0)
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
      'docs/design-system/system/patterns/states/states.css',
      'docs/design-system/system/components/feedback/feedback.css',
      'docs/design-system/system/components/form/form.css',
      'docs/design-system/system/components/segmented/segmented.css',
      'docs/design-system/system/components/status-bar/status-bar.css',
      'docs/design-system/system/patterns/drawer/drawer.css'
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

/* ---------------------------------------------------------------- the baker's error paths */

/** A grey whose ratio on black is `target`, found by bisection (the ratio grows with the grey). */
function greyAt(target) {
  let lo = 0
  let hi = 255
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2
    if (contrastRatio(`rgb(${mid} ${mid} ${mid})`, '#000000') < target) lo = mid
    else hi = mid
  }
  return `rgb(${lo} ${lo} ${lo})`
}

const PAGE = body => `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">
<title>t</title>
</head>
<body>
${body}
</body>
</html>`

describe('bakePage', () => {
  const tokens = new Map([
    ['--fg', '#ffffff'],
    ['--bg', '#000000'],
    ['--near', greyAt(4.4951)],
    ['--shadow', '0 0 var(--bg)'],
    ['--alias', 'var(--bg)']
  ])
  const ledger = { 'n-files': { kind: 'count', label: 'files' }, 'a-ratio': { kind: 'contrast', label: 'a ratio' } }
  const claims = { 'n-files': 7, 'a-ratio': 4.4951 }
  const regions = {
    ok: () => '<li>one</li>',
    broken: () => {
      throw new DesignError('the source moved')
    }
  }
  const bake = body => bakePage('x.html', PAGE(body), { claims, ledger, tokens, regions })

  it.each([
    ['an unknown claim', '<span data-claim="nope"></span>', /data-claim="nope" is not in docs\/design-system\/claims\.json/],
    ['an unknown token', '<code data-token="--nope"></code>', /data-token="--nope" is not declared/],
    ['a token that resolves to a value holding var()', '<code data-token="--shadow"></code>', /still holds a var\(\)/],
    ['a malformed contrast spec', '<span data-contrast="--fg against --bg"></span>', /expected "--fg on --bg"/],
    ['a non-numeric bar', '<span data-contrast="--fg on --bg" data-min="AA"></span>', /data-min="AA" is not a number/],
    ['a contrast on an undeclared token', '<span data-contrast="--fg on --missing" data-min="4.5"></span>', /undefined custom property: --missing/],
    ['an unknown region', '<div data-generated="nope"></div>', /data-generated="nope" names no region/],
    ['a region whose reader fails', '<div data-generated="broken"></div>', /data-generated="broken": the source moved/],
    ['an icon off an <svg>', '<span data-icon="x"></span>', /data-icon belongs on an <svg>/],
    ['an icon name that walks the filesystem', '<svg data-icon="../../package"></svg>', /is not a lucide icon name/],
    ['an unknown icon', '<svg data-icon="no-such-glyph-at-all"></svg>', /unknown lucide icon "no-such-glyph-at-all"/],
    ['two kinds on one element', '<span data-claim="n-files" data-token="--fg"></span>', /may carry only one of/],
    ['a target holding an element', '<span data-claim="n-files"><b>7</b></span>', /holds an element/],
    ['a target with no end tag', '<img data-claim="n-files">', /needs an explicit end tag/]
  ])('refuses %s', async (_name, body, problem) => {
    await expect(bake(body)).rejects.toThrow(problem)
  })

  it('reports every problem in the page at once, each with its line', async () => {
    await expect(bake('<span data-claim="a"></span>\n<span data-claim="b"></span>')).rejects.toThrow(/x\.html:8 .*"a"[\s\S]*x\.html:9 .*"b"/)
  })

  it('bakes a verdict on the RAW ratio: 4.4951 fails 4.5 and is quoted as 4.49', async () => {
    const { text } = await bake('<span data-contrast="--near on --bg" data-min="4.5"></span>')
    expect(text).toContain('<span data-contrast="--near on --bg" data-min="4.5" data-result="fail">4.49:1 · fail</span>')
  })

  it('quotes a contrast claim rounded down too', async () => {
    const { text } = await bake('<span data-claim="a-ratio"></span>')
    expect(text).toContain('<span data-claim="a-ratio" title="a ratio">4.49</span>')
  })

  it('follows a whole-value var() chain for a token', async () => {
    const { text } = await bake('<code data-token="--alias"></code>')
    expect(text).toContain('<code data-token="--alias">#000000</code>')
  })

  it('inserts every missing attribute of one tag in one edit, in order', async () => {
    const { text } = await bake('<svg data-icon="x"></svg>')
    expect(text).toMatch(
      /<svg data-icon="x" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">/
    )
  })

  it('bakes the CSP meta to the current policy', async () => {
    const stale = PAGE('<p>x</p>').replace(CSP_CONTENT, "script-src 'none'")
    const { text, targets } = await bakePage('x.html', stale, { claims, ledger, tokens, regions })
    expect(text).toContain(`content="${CSP_CONTENT}"`)
    expect(targets.find(t => t.kind === 'csp content').stale).toBe(`content="script-src 'none'"`)
  })

  it('is idempotent: a baked page bakes to itself', async () => {
    const { text } = await bake('<span data-claim="n-files"></span><div data-generated="ok"></div><svg data-icon="x"></svg>')
    const again = await bakePage('x.html', text, { claims, ledger, tokens, regions })
    expect(again.text).toBe(text)
    expect(again.targets.filter(t => t.stale !== t.fresh)).toEqual([])
  })
})

describe('lucide icons are read as text', () => {
  it('follows an alias module to the glyph it re-exports', () => {
    expect(iconMarkup('edit-3')).toBe(iconMarkup('pen-line'))
    expect(iconMarkup('edit-3')).toMatch(/^<path d="/)
  })

  it('resolves CheckCircle to circle-check-big, not circle-check', () => {
    const entry = readIconRegistry().find(e => e.name === 'check-circle')
    expect(entry).toEqual({ name: 'check-circle', component: 'CheckCircle', file: 'circle-check-big' })
    expect(iconMarkup('check-circle')).toBe(iconMarkup('circle-check-big'))
    expect(iconMarkup('check-circle')).not.toBe(iconMarkup('circle-check'))
  })

  it.each(['../../package', 'x/../../y', 'X', 'a--b', '-a', 'a.js', ''])('refuses the name %j before touching the disk', name => {
    expect(() => iconMarkup(name)).toThrow(/is not a lucide icon name/)
  })

  it('throws a DesignError for an alias it cannot resolve, or a module with neither', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ds-lucide-'))
    try {
      const icons = path.join(dir, 'node_modules/lucide-react/dist/esm/icons')
      mkdirSync(icons, { recursive: true })
      writeFileSync(path.join(icons, 'dangling.js'), "export { default } from './gone.js';\n")
      writeFileSync(path.join(icons, 'odd.js'), 'export default 1\n')
      writeFileSync(path.join(icons, 'loop-a.js'), "export { default } from './loop-b.js';\n")
      writeFileSync(path.join(icons, 'loop-b.js'), "export { default } from './loop-a.js';\n")
      expect(() => iconMarkup('dangling', dir)).toThrow(DesignError)
      expect(() => iconMarkup('dangling', dir)).toThrow(/unknown lucide icon "gone"/)
      expect(() => iconMarkup('odd', dir)).toThrow(/no __iconNode and no single alias/)
      expect(() => iconMarkup('loop-a', dir)).toThrow(/no __iconNode and no single alias/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generated regions read the code', () => {
  it('lists every registry name, with the glyph an alias really draws', () => {
    const entries = readIconRegistry()
    const source = readFileSync(path.join(ROOT, 'src/renderer/src/utils/iconRegistry.tsx'), 'utf8')
    const union = /export type IconName\s*=([\s\S]*?)\n\s*\n/.exec(source)[1]
    expect(entries.length).toBe([...union.matchAll(/\|\s*'/g)].length)
    const region = iconRegistryRegion()
    expect([...region.matchAll(/<li>/g)]).toHaveLength(entries.length)
    expect(region).toContain('<span>edit-3 <span class="ic-glyphs__src">draws pen-line</span></span>')
    expect(region).toContain('<span>x</span>')
  })

  it('reads all 21 theme colours and the font size from XTERM_OPTIONS', () => {
    const { theme, fontSize } = readXtermTheme()
    expect(Object.keys(theme).length).toBeGreaterThanOrEqual(21)
    expect(Number.isFinite(fontSize)).toBe(true)
    expect(ansiContrast().map(c => c.key)).toEqual(ANSI_KEYS)
  })

  it('fails when the theme it reads is short', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ds-xterm-'))
    try {
      const file = path.join(dir, 'src/renderer/src/components/Panels/TerminalPanel/hooks/useXtermSession.ts')
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, "const XTERM_OPTIONS = {\n  fontSize: 12,\n  theme: {\n    background: '#000000',\n    red: '#cd3131'\n  }\n}\n")
      expect(() => readXtermTheme(dir)).toThrow(/lacks foreground, cursor/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the two copies of the terminal palette equal, and notices when they drift', () => {
    expect(xtermDuplicateProblems()).toEqual([])
    const dir = mkdtempSync(path.join(tmpdir(), 'ds-xterm-'))
    try {
      const base = 'src/renderer/src/components/Panels/TerminalPanel'
      mkdirSync(path.join(dir, base, 'hooks'), { recursive: true })
      const hook = readFileSync(path.join(ROOT, base, 'hooks/useXtermSession.ts'), 'utf8')
      const logic = readFileSync(path.join(ROOT, base, 'terminalPanel.logic.ts'), 'utf8')
      writeFileSync(path.join(dir, base, 'hooks/useXtermSession.ts'), hook)
      writeFileSync(path.join(dir, base, 'terminalPanel.logic.ts'), logic.replace("red: '#cd3131'", "red: '#ff0000'"))
      expect(xtermDuplicateProblems(dir).join('\n')).toMatch(/TERMINAL_THEME\.red is #ff0000 but XTERM_OPTIONS\.theme\.red .* is #cd3131/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the deviation register', () => {
  it('reads a reason across a three-line block comment', () => {
    const css = [
      '.a { color: red; }',
      '/* deviates: docs/design-system/system/foundations/focus.html — inset, not outward.',
      ' * The bar is a scroller, so an outward ring',
      '   would be clipped by it. */',
      '.b { outline: 0; }'
    ].join('\n')
    expect(deviationsIn('x.css', css)).toEqual([
      {
        file: 'x.css',
        line: 2,
        target: 'docs/design-system/system/foundations/focus.html',
        reason: 'inset, not outward. The bar is a scroller, so an outward ring would be clipped by it.'
      }
    ])
  })

  it('reads a marker that sits on a * line of a comment opened above', () => {
    const ts = "/*\n * deviates: docs/designs/comments/html-comments/overlay.html — the pin's\n * focus ring is the accent.\n */\nexport const x = 1\n"
    expect(deviationsIn('x.ts', ts)[0].reason).toBe("the pin's focus ring is the accent.")
  })

  it('stops a line-comment reason at the first line that is not a comment', () => {
    const ts = '// deviates: docs/design-system/system/components/menu/index.html – no aria-haspopup:\n// xterm owns its textarea.\nconst x = 1\n// unrelated\n'
    expect(deviationsIn('x.ts', ts)[0].reason).toBe('no aria-haspopup: xterm owns its textarea.')
  })

  it('stops at a blank line inside a block comment', () => {
    const css = '/* deviates: docs/design-system/system/foundations/focus.html – one\n   two\n\n   not part of it */'
    expect(deviationsIn('x.css', css)[0].reason).toBe('one two')
  })

  it('caps a long reason with an ellipsis', () => {
    const css = `/* deviates: docs/design-system/system/foundations/focus.html – ${'word '.repeat(80)}*/`
    const { reason } = deviationsIn('x.css', css)[0]
    expect(reason.length).toBeLessThanOrEqual(REASON_MAX)
    expect(reason.endsWith('…')).toBe(true)
  })
})

describe('generated pages are LF on every OS (#104)', () => {
  it('renders the index and the register with no carriage return, whatever the inputs carried', () => {
    const cards = collectCards()
    const tokens = collectCustomProperties(readFileSync(TOKEN_FILE, 'utf8').replace(/\n/g, '\r\n'))
    expect(renderIndex(cards, tokens)).not.toContain('\r')
    const crlf = '/* deviates: docs/design-system/system/foundations/focus.html – one\r\n   two */\r\n'
    const entries = deviationsIn('x.css', crlf)
    expect(entries[0].reason).toBe('one two')
    expect(renderDeviations(entries, cards)).not.toContain('\r')
  })
})

describe('the index', () => {
  const card = (href, name, answers) => ({ href, name, answers, subtitle: '', status: 'proposed', reviewed: 'never', group: 'Foundations' })

  it('puts the card grids before "Start here by task"', () => {
    const html = renderIndex(collectCards(), new Map())
    expect(html.indexOf('id="foundations"')).toBeGreaterThan(-1)
    expect(html.indexOf('id="foundations"')).toBeLessThan(html.indexOf('id="start-here"'))
    expect(html.indexOf('id="patterns"')).toBeLessThan(html.indexOf('id="start-here"'))
  })

  it('merges a task two cards answer into one row that lists both', () => {
    const html = renderIndex([card('a.html', 'Alpha', 'Pick a colour; Size a gap'), card('b.html', 'Beta', 'pick a colour')], new Map())
    const rows = [...html.matchAll(/<tr><td>([^<]*)<\/td><td>(.*?)<\/td><\/tr>/g)].filter(m => /colour|gap/i.test(m[1]))
    expect(rows.map(m => [m[1], m[2]])).toEqual([
      ['Pick a colour', '<a href="a.html">Alpha</a>, <a href="b.html">Beta</a>'],
      ['Size a gap', '<a href="a.html">Alpha</a>']
    ])
  })
})

describe('readMarker', () => {
  it('reads a marker behind a byte-order mark', () => {
    expect(readMarker('﻿<!-- @card group="Foundations" name="X" status="proposed" reviewed="never" -->\n', 'x.html')).toMatchObject({ name: 'X' })
  })
})
