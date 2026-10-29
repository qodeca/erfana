// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Claim checks for developer docs that only the running app can prove.
 *
 * docs/design-system/README.md says no Erfana stylesheet declares
 * `::selection` – the one such rule the renderer loads is xterm's own, which
 * hides selected text in the terminal's screen-reader tree. This walks every
 * stylesheet the real renderer has loaded (with a project open, so the
 * editor, preview and terminal styles are in) and checks that claim.
 */

import { test, expect } from '../fixtures'

test.use({
  testProjectFiles: {
    'test.md': '# Test project\n\nSeed file.\n'
  }
})

test.describe('Developer-doc claims (dev-0)', () => {
  test('no Erfana stylesheet declares ::selection; only xterm does', async ({
    windowWithTestProject: window
  }) => {
    // The terminal panel mounts with the project; its xterm element proves its CSS is in.
    await expect(window.locator('.xterm').first()).toBeVisible({ timeout: 30_000 })

    const selectors = await window.evaluate(() => {
      const found: string[] = []
      const walk = (rules: CSSRuleList): void => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && rule.selectorText.includes('::selection')) {
            found.push(rule.selectorText)
          }
          if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
            walk((rule as CSSGroupingRule).cssRules)
          }
        }
      }
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules)
        } catch {
          // A cross-origin sheet cannot be read; the renderer loads none.
          found.push(`(unreadable sheet ${sheet.href ?? 'inline'})`)
        }
      }
      return found
    })

    const notXterm = selectors.filter(
      (selector) =>
        !selector.split(',').every((part) => part.trim().startsWith('.xterm .xterm-accessibility-tree'))
    )
    // The walk must see xterm's rule, or it proves nothing about the others.
    expect(selectors.length).toBeGreaterThan(0)
    expect(notXterm).toEqual([])
  })
})
