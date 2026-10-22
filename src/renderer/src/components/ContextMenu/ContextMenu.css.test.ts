// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "Disabled beats danger" - the precedence rule the decided Menu card
 * (design/system/components/menu) sets for a disabled destructive item.
 *
 * It shipped the other way round: `.disabled` was declared BEFORE `.danger`
 * at equal specificity, so a greyed-out Delete still rendered red - a colour
 * that promises an action the item will not perform. jsdom does not run the
 * cascade for these classes, so the guard reads the stylesheet: the disabled
 * rule must come after the danger rule, at the same specificity, and the
 * danger hover must exclude disabled items.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declared, parseRules } from '../../test-utils/cssAudit'

const FILE = 'src/renderer/src/components/ContextMenu/ContextMenu.css'
const RULES = parseRules({ file: FILE, css: readFileSync(resolve(__dirname, 'ContextMenu.css'), 'utf8') })

/** Index of the last rule whose selector list contains exactly `selector`. */
function lastIndexOf(selector: string): number {
  let at = -1
  RULES.forEach((rule, i) => {
    if (rule.selector.split(',').some((s) => s.trim() === selector)) at = i
  })
  return at
}

describe('ContextMenu.css: disabled beats danger', () => {
  it('declares the disabled colour after the danger colour', () => {
    const danger = lastIndexOf('.context-menu-item.danger')
    const disabled = lastIndexOf('.context-menu-item.disabled')
    expect(danger).toBeGreaterThanOrEqual(0)
    expect(disabled, 'the disabled rule must follow the danger rule').toBeGreaterThan(danger)
    expect(declared(RULES[disabled].body, 'color')).toBe('var(--color-text-disabled)')
  })

  it('never paints the danger hover on a disabled item', () => {
    const hover = RULES.filter((rule) => /\.danger:hover/.test(rule.selector))
    expect(hover.length).toBeGreaterThan(0)
    for (const rule of hover) {
      for (const selector of rule.selector.split(',')) {
        expect(selector.trim()).toMatch(/:not\(\.disabled\)/)
      }
    }
  })
})
