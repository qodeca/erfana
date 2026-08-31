// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Guards the one-source-of-truth property that `design/` was given.
 *
 * Before this, `docs/ui-style-guide.md` was mandatory reading and specified the
 * focus ring THREE different ways — a 2px border, a 3px glow and a 1px outline,
 * all normative, with no rule for which applied where. A second file,
 * `docs/ui-style-guide-reference.md`, held a fourth set of component patterns.
 * Nothing pointed at `design/` at all, so anyone following the project's own
 * instructions read the documents the cards contradict.
 *
 * The visual sections were RETIRED TO STUBS rather than deleted: a stub keeps
 * its heading, so the anchors other docs and tests link to still resolve, and it
 * holds no rule, so it cannot contradict a card. That property is only stable if
 * something checks it — a stub with a code fence in it is a rule again, and the
 * two-sources-of-truth problem is back.
 *
 * The original plan proposed `grep -n "focus" docs/ui-style-guide.md` as the
 * check. That is not a check: it returns eight hits and cannot tell a normative
 * statement from prose.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const GUIDES = ['docs/ui-style-guide.md', 'docs/ui-style-guide-reference.md']

/** Split a markdown file into H2 sections. */
function sections(file) {
  const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n')
  const heads = lines
    .map((line, i) => (line.startsWith('## ') ? i : -1))
    .filter(i => i !== -1)
  return heads.map((start, n) => ({
    file,
    heading: lines[start].slice(3).trim(),
    body: lines.slice(start + 1, heads[n + 1] ?? lines.length).join('\n')
  }))
}

const ALL = GUIDES.flatMap(sections)
const STUBS = ALL.filter(s => s.body.includes('Decided by'))

describe('design system authority', () => {
  it('found both guides', () => {
    for (const g of GUIDES) expect(existsSync(path.join(ROOT, g)), `${g} is missing`).toBe(true)
    expect(ALL.length).toBeGreaterThan(5)
  })

  it('retired something from each guide', () => {
    // If a whole guide reverts to holding rules, this notices.
    for (const g of GUIDES) {
      expect(
        STUBS.filter(s => s.file === g).length,
        `${g} has no retired sections — has it grown its rules back?`
      ).toBeGreaterThan(0)
    }
  })

  describe('a retired section holds no rules', () => {
    it.each(STUBS.map(s => [`${s.file} § ${s.heading}`, s]))('%s', (_label, section) => {
      // A CSS fence in a stub is a rule, and a rule here is a second opinion.
      expect(
        section.body,
        `"${section.heading}" in ${section.file} is a stub but contains a css code block. ` +
          `Put it on the card instead — a stub that holds a rule can contradict one.`
      ).not.toMatch(/```css/)

      expect(
        section.body,
        `"${section.heading}" in ${section.file} must name the card that decides it.`
      ).toMatch(/design\/\S+\.html/)
    })

    it.each(STUBS.map(s => [`${s.file} § ${s.heading}`, s]))(
      '%s points at a card that exists',
      (_label, section) => {
        const cards = [...section.body.matchAll(/(design\/[\w/-]+\.html)/g)].map(m => m[1])
        expect(cards.length, 'no card path found').toBeGreaterThan(0)
        for (const card of new Set(cards)) {
          expect(existsSync(path.join(ROOT, card)), `${section.file} points at missing ${card}`).toBe(
            true
          )
        }
      }
    )
  })

  describe('the mandate points at the design system', () => {
    const CLAUDE_MD = readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8')

    it('CLAUDE.md sends UI work to design/ first', () => {
      expect(CLAUDE_MD).toMatch(/design\/index\.html/)
    })

    it('CONTRIBUTING.md agrees with it', () => {
      expect(readFileSync(path.join(ROOT, 'CONTRIBUTING.md'), 'utf8')).toMatch(/design\/index\.html/)
    })
  })

  describe('links into the guides still resolve', () => {
    // Six references across docs, tests and source point at
    // #text-selection-policy. Retiring by stub rather than deletion is what keeps
    // them working; this is the assertion that says so out loud.
    const ANCHORED = [
      ['docs/CHANGELOG.md', 'text-selection-policy'],
      ['docs/development-tasks.md', 'text-selection-policy']
    ]

    it.each(ANCHORED)('%s § %s still has a target', (file, anchor) => {
      const source = readFileSync(path.join(ROOT, file), 'utf8')
      expect(source, `${file} no longer references #${anchor}`).toContain(`#${anchor}`)

      const heading = anchor.replace(/-/g, ' ')
      const guide = readFileSync(path.join(ROOT, 'docs/ui-style-guide.md'), 'utf8').toLowerCase()
      expect(guide, `#${anchor} has no heading to land on`).toContain(`## ${heading}`)
    })

    it('keeps the text selection policy as real content, not a stub', () => {
      const policy = ALL.find(s => s.heading.toLowerCase() === 'text selection policy')
      expect(policy, 'the text selection policy section is gone').toBeDefined()
      // It is a dockview cascade fact with a test behind it, not a visual
      // decision — so it is the one section that must NOT move to a card.
      expect(policy.body).not.toContain('Decided by')
      expect(policy.body.length).toBeGreaterThan(500)
    })
  })
})
