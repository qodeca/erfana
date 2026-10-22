// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * WCAG 1.4.3 guard for the front-matter block in the Markdown preview.
 *
 * Its keys, labels and placeholders were drawn in --color-text-secondary
 * (3.72:1 on the block's panel) and --color-text-muted (2.69:1) at 10-14px,
 * under the 4.5:1 normal text needs (#231). The block sits on
 * --color-bg-secondary and its header on --color-bg-tertiary, so every
 * `.frontmatter-*` text colour is measured against the panel: the lighter of
 * the two, so the stricter bar. Opacity is not composited (`.frontmatter-
 * truncated` adds 0.8; measured by hand at 4.65:1).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, declared, designTokens, parseRules, resolveToken } from '../../test-utils/cssAudit'

const tokens = designTokens()
const PANEL = resolveToken('var(--color-bg-secondary)', tokens) ?? ''
const RULES = parseRules({
  file: 'src/renderer/src/components/Editor/MarkdownPreview.css',
  css: readFileSync(resolve(__dirname, 'MarkdownPreview.css'), 'utf8')
})

/** Text rules: a `.frontmatter-*` selector that declares a token colour. */
const TEXT = RULES.filter((rule) => /^\.frontmatter-[\w-]+$/.test(rule.selector))
  .map((rule) => ({ selector: rule.selector, color: declared(rule.body, 'color') }))
  .filter((rule): rule is { selector: string; color: string } => rule.color?.startsWith('var(--color-text') ?? false)

describe('front-matter text contrast (WCAG 1.4.3)', () => {
  it('finds the front-matter text rules', () => {
    expect(TEXT.length).toBeGreaterThanOrEqual(8)
  })

  it.each(TEXT.map((rule) => [rule.selector, rule.color] as const))('%s (%s)', (selector, color) => {
    const fg = resolveToken(color, tokens) ?? ''
    const ratio = contrastRatio(fg, PANEL)
    expect(ratio, `${selector}: ${color} on --color-bg-secondary = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })
})
