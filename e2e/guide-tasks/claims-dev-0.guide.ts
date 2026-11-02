// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Claim checks for developer docs that only the running app can prove.
 *
 * docs/design-system/README.md says Erfana has no app-wide `::selection` rule.
 * The renderer loads two kinds: xterm's own, which hides selected text in the
 * terminal's screen-reader tree, and the Markdown preview's, which keeps a
 * selection apart from a comment mark (spec 024, C-12). This walks every
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
  test('::selection is declared only by xterm and the Markdown preview', async ({
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

    const others = selectors.filter(
      (selector) =>
        !selector
          .split(',')
          .every(
            (part) =>
              part.trim().startsWith('.xterm .xterm-accessibility-tree') ||
              part.trim() === '.markdown-preview-content ::selection'
          )
    )
    // The walk must see xterm's rule, or it proves nothing about the others.
    expect(selectors.some((selector) => selector.includes('.xterm'))).toBe(true)
    expect(others).toEqual([])
  })
})
