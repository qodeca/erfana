// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The drawn mark of the active tab's file in the project tree (#453).
 *
 * The reveal marks the row with `aria-current="true"`; `ProjectTree.css` draws
 * the decided card's mark from that attribute – the tab's own 2px lime
 * underline under the name, one unbroken line, padded so the name's overflow
 * clip does not cut it, at full strength on a hidden file. jsdom applies no
 * stylesheet, so the rule is pinned against the stylesheet TEXT, as
 * ImageViewerPanel.toolbarOverflow.test.ts does. Every length and colour must
 * be a token defined in design-tokens.css.
 *
 * @see docs/design-system/system/components/tree-active-file/index.html
 * @see docs/designs/project-tree/453-follow-active-tab.md § The mark
 */
import { describe, expect, it } from 'vitest'

import css from './ProjectTree.css?raw'
import tokens from '../../styles/design-tokens.css?raw'

const MARKED_NAME = ".project-tree-item[aria-current='true'] .file-name"
const MARKED_HIDDEN_NAME = ".project-tree-item[aria-current='true'] .file-name.hidden-file"

/** Stylesheet with block comments removed, so prose cannot satisfy a rule. */
const CLEAN_CSS = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Declarations of the rules whose selector list holds EXACTLY `selector` (quotes normalised). */
function declarationsFor(selector: string): string {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g
  const bodies: string[] = []
  let match: RegExpExecArray | null
  while ((match = rulePattern.exec(CLEAN_CSS)) !== null) {
    const parts = match[1].split(',').map((part) => part.trim().replace(/\s+/g, ' ').replace(/"/g, "'"))
    if (parts.includes(selector)) bodies.push(match[2])
  }
  return bodies.join(';')
}

/** Value of `property` in a declaration block, last declaration winning; `null` when absent. */
function declaredValue(body: string, property: string): string | null {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'gi')
  let value: string | null = null
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) value = match[1].trim()
  return value
}

/** Asserts `value` is exactly one `var(--<prefix>…)` token that design-tokens.css defines. */
function expectToken(value: string | null, prefix: string): void {
  const name = value?.match(new RegExp(`^var\\((--${prefix}[\\w-]*)\\)$`))?.[1]
  expect(name, `${value} is not a single var(--${prefix}…) token`).toBeDefined()
  expect(tokens).toMatch(new RegExp(`${name}\\s*:`))
}

describe('ProjectTree.css – the active file mark (#453)', () => {
  const body = declarationsFor(MARKED_NAME)

  it('draws the mark from the row’s aria-current, on the name only', () => {
    expect(body).not.toBe('')
    expect(declaredValue(body, 'text-decoration-line')).toBe('underline')
  })

  it('is one solid, unbroken line, like the active tab’s', () => {
    expect(declaredValue(body, 'text-decoration-style')).toBe('solid')
    expect(declaredValue(body, 'text-decoration-skip-ink')).toBe('none')
  })

  it('takes its colour, thickness, offset and padding from design tokens', () => {
    expectToken(declaredValue(body, 'text-decoration-color'), 'color-')
    expect(declaredValue(body, 'text-decoration-color')).toBe('var(--color-accent-secondary)')
    expectToken(declaredValue(body, 'text-decoration-thickness'), 'border-width-')
    expectToken(declaredValue(body, 'text-underline-offset'), 'space-')
    expectToken(declaredValue(body, 'padding-block'), 'space-')
  })

  it('shows a hidden file’s mark at full strength', () => {
    expect(declaredValue(declarationsFor(MARKED_HIDDEN_NAME), 'opacity')).toBe('1')
  })
})
