// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * WCAG 1.4.3 guard for every label drawn on a violet fill, in EVERY renderer
 * stylesheet.
 *
 * `Dialog.contrast.test.ts` already guarded the dialog buttons, which is why
 * they were fixed (#42) while the same defect kept shipping elsewhere: the
 * Save button, the view-mode toggles, the welcome screen's action button, the
 * diagram chat buttons and the activity-bar badge all drew `--color-white` on
 * the brand violet - 2.20:1, under both the 4.5:1 text bar and the 3:1 icon
 * bar (#231). One stylesheet was guarded, so one stylesheet was right.
 *
 * This test therefore scans the whole tree. Any rule whose background resolves
 * to one of the three violet fills must have a foreground - its own `color`, or
 * the `color` of its base rule (the selector with its state pseudo-classes
 * stripped) - that clears 4.5:1 on that fill. A rule that paints violet behind
 * no text at all (a progress fill, a checked checkbox) has to say so in
 * {@link NO_TEXT}, so "I could not find a foreground" is a failure, never a
 * silent pass.
 *
 * @see WCAG 2.2 SC 1.4.3 Contrast (Minimum), SC 1.4.11 Non-text Contrast
 */
import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  declared,
  designTokens,
  parseRules,
  rendererStylesheets,
  resolveToken,
  type CssRule
} from '../test-utils/cssAudit'

const WCAG_AA_NORMAL_TEXT = 4.5

const SHEETS = rendererStylesheets()
const ALL_RULES = SHEETS.flatMap(parseRules)

/** Token file first, then component-level aliases such as `--dialog-btn-primary-bg`. */
const tokens = designTokens()
for (const rule of ALL_RULES.filter((r) => r.selector === ':root')) {
  for (const m of rule.body.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+)/g)) {
    if (!tokens.has(m[1])) tokens.set(m[1], m[2].trim())
  }
}

/** The violet fills: resting, hover and pressed. */
const VIOLET_FILLS = ['--color-btn-primary-bg', '--color-btn-primary-hover', '--color-btn-primary-active']
const FILL_HEX = new Map(
  VIOLET_FILLS.map((name) => [(resolveToken(`var(${name})`, tokens) ?? '').toLowerCase(), name])
)

/**
 * Rules that paint a violet fill behind no text or icon - or whose foreground
 * is declared in another stylesheet that has its own guard - keyed
 * `file :: selector`. Each needs a reason; a new entry is a claim a reviewer
 * should check.
 */
const NO_TEXT: Record<string, string> = {
  'src/renderer/src/components/Settings/SettingsOverlay.css :: .settings-checkbox:checked':
    'checkmark is a data-URI SVG stroked in brand black (#161312), not a CSS colour',
  'src/renderer/src/components/Settings/SettingsOverlay.css :: .settings-checkbox:checked:hover:not(:disabled)':
    'same checkbox, same SVG checkmark',
  'src/renderer/src/components/DocumentImport/DocumentImportDialog.css :: .doc-import-progress-fill':
    'progress bar fill, no content',
  'src/renderer/src/components/Transcription/TranscriptionDialog.css :: .transcription-progress-fill':
    'progress bar fill, no content',
  'src/renderer/src/components/ProjectTree/ProjectTree.css :: .git-status-dot[data-git-status="staged"]::before':
    'a status dot, no content',
  "src/renderer/src/components/RootErrorBoundary/RootErrorBoundary.css :: .root-error-actions button[aria-disabled='true']:hover":
    'the button is a .dialog-btn-primary; its foreground lives in Dialog.css and is guarded by Dialog.contrast.test.ts'
}

/**
 * The selector of the rule a state rule inherits its foreground from:
 * `.save-btn:hover:not(:disabled)` -> `.save-btn`.
 *
 * @param selector - One simple selector list entry
 * @returns The selector with state pseudo-classes removed
 */
function baseSelector(selector: string): string {
  return selector
    .replace(/:not\([^)]*\)/g, '')
    .replace(/:(hover|active|focus-visible|focus|checked|disabled)\b/g, '')
    .trim()
}

/** A violet-filled rule, flattened to one selector of its list. */
interface FilledRule {
  file: string
  selector: string
  fill: string
  rule: CssRule
}

const FILLED: FilledRule[] = ALL_RULES.flatMap((rule) => {
  const bg = declared(rule.body, 'background-color') ?? declared(rule.body, 'background')
  if (bg === null) return []
  const hex = resolveToken(bg, tokens)?.toLowerCase()
  if (hex === undefined || !FILL_HEX.has(hex)) return []
  return rule.selector.split(',').map((selector) => ({
    file: rule.file,
    selector: selector.trim(),
    fill: hex,
    rule
  }))
})

/**
 * The foreground a filled rule shows: its own `color`, else its base rule's.
 *
 * @param entry - The filled rule
 * @returns The declared value, or `null` when none can be found
 */
function foregroundOf(entry: FilledRule): string | null {
  const own = declared(entry.rule.body, 'color')
  if (own !== null) return own
  const base = baseSelector(entry.selector)
  const baseRules = ALL_RULES.filter(
    (rule) =>
      rule.file === entry.file &&
      rule.selector.split(',').some((s) => s.trim() === base) &&
      declared(rule.body, 'color') !== null
  )
  if (baseRules.length === 0) return null
  return declared(baseRules[baseRules.length - 1].body, 'color')
}

describe('WCAG contrast: labels on a violet fill (every stylesheet)', () => {
  it('finds the violet fills it is meant to guard', () => {
    // An empty scan also passes "no failures". The welcome button, the Save
    // button and the dialog primary are three known fills; fewer means the
    // scan is broken, not that the app is clean.
    expect(FILL_HEX.size).toBe(3)
    expect(FILLED.length).toBeGreaterThanOrEqual(10)
  })

  it('pairs the primary-button text token with every violet fill at 4.5:1 or more', () => {
    const text = resolveToken('var(--color-btn-primary-text)', tokens) ?? ''
    for (const [hex, name] of FILL_HEX) {
      expect(contrastRatio(text, hex), `--color-btn-primary-text on ${name}`).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT
      )
    }
  })

  it('reproduces the white-on-violet failure this guard exists for', () => {
    // Historical pairing, kept literal on purpose.
    expect(contrastRatio('#ffffff', '#A0A8FF')).toBeLessThan(3)
  })

  it.each(FILLED.map((entry) => [`${entry.file} :: ${entry.selector}`, entry] as const))(
    '%s',
    (key, entry) => {
      if (key in NO_TEXT) return
      const declaredFg = foregroundOf(entry)
      expect(
        declaredFg,
        `${key} paints a violet fill but no foreground could be found on it or on ` +
          `its base rule. Declare color: var(--color-btn-primary-text), or - if it ` +
          `carries no text or icon - add it to NO_TEXT with the reason.`
      ).not.toBeNull()
      const fg = resolveToken(declaredFg ?? '', tokens)
      expect(fg, `${key}: foreground ${declaredFg} does not resolve to a token literal`).toMatch(
        /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i
      )
      const ratio = contrastRatio(fg ?? '', entry.fill)
      expect(
        ratio,
        `${key}: ${declaredFg} on ${FILL_HEX.get(entry.fill)} = ${ratio.toFixed(2)}:1, ` +
          `under WCAG 1.4.3's ${WCAG_AA_NORMAL_TEXT}:1. Use var(--color-btn-primary-text).`
      ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT)
    }
  )

  it('lists no NO_TEXT entry that no longer exists', () => {
    const live = new Set(FILLED.map((entry) => `${entry.file} :: ${entry.selector}`))
    expect(Object.keys(NO_TEXT).filter((key) => !live.has(key))).toEqual([])
  })
})
