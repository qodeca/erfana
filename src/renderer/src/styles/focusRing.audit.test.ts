// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One focus ring, everywhere: the decided Focus card
 * (design/system/foundations/focus.html) says a focus ring is a
 * `--border-width-thick` outline in `--color-border-focus`, offset
 * `--space-1` outward - or the same distance inward inside a scroller.
 *
 * The app drifted from it in two directions at once (#230, #82 follow-up):
 * tabs, the activity bar and a dozen toolbar buttons drew a 1px ring, and the
 * search bar and most dialog inputs drew the retired `--shadow-focus` glow
 * (1.63:1 against the 3:1 that SC 1.4.11 asks of a focus indicator). The
 * glow is now banned by stylelint in src/; this test covers the part a value
 * ban cannot see - the WIDTH and OFFSET of every ring that is drawn.
 *
 * A rule may depart from the card only with a `deviates: design/system/
 * foundations/focus.html` comment directly above it, which is the format the
 * card's Exceptions section is keyed to.
 */
import { describe, expect, it } from 'vitest'
import { declared, parseRules, rendererStylesheets, stripComments } from '../test-utils/cssAudit'

const THICK = 'var(--border-width-thick)'
const OFFSETS = new Set(['var(--space-1)', 'calc(var(--space-1) * -1)'])

const SHEETS = rendererStylesheets()

/** A rule that draws a visible outline in a focus state. */
interface Ring {
  key: string
  outline: string
  offset: string | null
  deviates: boolean
  outlineColor: string | null
  colourIsFocusToken: boolean
}

const FOCUS_COLOUR = 'var(--color-border-focus)'

/**
 * Whether the rule with this selector is directly preceded by a `deviates:`
 * comment naming the Focus card.
 *
 * @param css - Raw stylesheet source
 * @param selector - Selector text as parsed (whitespace-collapsed)
 * @returns True when a focus.html deviation marker sits right above it
 */
function hasDeviationMarker(css: string, selector: string): boolean {
  const escaped = selector
    .split(' ')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  const re = new RegExp(`/\\*([\\s\\S]*?)\\*/\\s*${escaped}\\s*\\{`)
  const match = re.exec(css)
  return match !== null && match[1].includes('deviates: design/system/foundations/focus.html')
}

const RINGS: Ring[] = SHEETS.flatMap((sheet) =>
  parseRules(sheet).flatMap((rule) => {
    if (!/:focus(?:-visible|-within)?\b/.test(rule.selector)) return []
    const outline = declared(rule.body, 'outline')
    if (outline === null || /^(none|0)$/.test(outline)) return []
    // `outline-color` declared after the shorthand wins; otherwise the
    // shorthand's colour (its last component) is what paints.
    const outlineColor = declared(rule.body, 'outline-color')
    const colourIsFocusToken =
      outlineColor !== null ? outlineColor === FOCUS_COLOUR : outline.endsWith(FOCUS_COLOUR)
    return [
      {
        key: `${sheet.file} :: ${rule.selector}`,
        outline,
        offset: declared(rule.body, 'outline-offset'),
        deviates: hasDeviationMarker(sheet.css, rule.selector),
        outlineColor,
        colourIsFocusToken
      }
    ]
  })
)

describe('focus rings follow the Focus card (every stylesheet)', () => {
  it('finds the rings it is meant to guard', () => {
    // An empty scan passes everything. Dialogs, tabs, the activity bar and the
    // search bar alone contribute well over twenty.
    expect(RINGS.length).toBeGreaterThanOrEqual(30)
  })

  it('reads stylesheets with comments stripped', () => {
    expect(stripComments('/* .x:focus { outline: 1px solid red } */')).toBe('')
  })

  it.each(RINGS.filter((ring) => !ring.deviates).map((ring) => [ring.key, ring] as const))(
    '%s',
    (key, ring) => {
      expect(
        ring.outline.startsWith(THICK),
        `${key} draws "${ring.outline}". The ring is ${THICK} wide (SC 2.4.13 asks ` +
          `for at least 2px); a thinner one needs a deviates: marker and an Exceptions row.`
      ).toBe(true)
      expect(
        ring.offset !== null && OFFSETS.has(ring.offset),
        `${key} offsets the ring by "${ring.offset}". Use var(--space-1) outward, or ` +
          `calc(var(--space-1) * -1) inside a scroller - the only permitted variation.`
      ).toBe(true)
    }
  )

  it('paints every ring in --color-border-focus unless a deviates: marker says otherwise', () => {
    // Colour drifted the same way width did: a white ring on the diagram chat
    // buttons and the welcome action, --color-accent-primary on preview links.
    // Same violet today in the second case, but it MEANS "accent", and
    // repointing the accent would silently move the ring.
    const offColour = RINGS.filter(
      (ring) => !ring.deviates && !ring.colourIsFocusToken
    ).map((ring) => `${ring.key} -> ${ring.outline}${ring.outlineColor ? ` / ${ring.outlineColor}` : ''}`)
    expect(offColour).toEqual([])
  })

  it('uses :focus-visible, never bare :focus, for a drawn ring', () => {
    const bare = RINGS.filter((ring) => /:focus(?![-\w])/.test(ring.key)).map((ring) => ring.key)
    expect(
      bare,
      'Bare :focus paints the ring after a mouse click too (Focus card rule 1).'
    ).toEqual([])
  })
})
