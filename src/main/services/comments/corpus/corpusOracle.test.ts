// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The corpus round trip's oracle and corpus rules catch what they exist to
 * catch (spec 024 024-NFR-003): a corpus run that reports 0 failures is only
 * worth something if a changed byte, a split paragraph or a non-permissive
 * licence would have been seen.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addOutsideRangeProblem,
  frozenCount,
  blockRangeOf,
  changeOutsideRangeProblem,
  firstMessageId,
  loadMarkdownIt,
  renderDifferences,
  renderPrint
} from './__test-helpers__/corpusOracle'
import { isPermissive, kindOfName } from './__test-helpers__/corpusSources'
import { chooseTargets, seededUnit } from './__test-helpers__/corpusTargets'

const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const ID = 'c-aaaaaaaaaaaaaaaa'
const BLOCK = `<!-- erfana:comment v1 id=${ID}\nstatus: open\n@data {"msgs":[{"id":"m\\u002dbbbbbbbbbbbbbbbb"}]}\n-->`
const BEFORE = '# Title\n\n- one\n- two\n\nText.\n'
const AFTER = `# Title\n\n- one\n  ${BLOCK.replaceAll('\n', '\n  ')}\n- two\n\nText.\n`

describe('corpus oracle', () => {
  it('accepts an add that inserts only the block, its indent and its line break', () => {
    expect(addOutsideRangeProblem(BEFORE, AFTER, ID)).toBeNull()
  })

  it('catches an add that also changed one character outside the block', () => {
    expect(addOutsideRangeProblem(BEFORE, AFTER.replace('Text.', 'Text!'), ID)).toBe('characters outside the inserted block changed')
    expect(addOutsideRangeProblem(BEFORE, AFTER.replace('- one', '- One'), ID)).toBe('characters outside the inserted block changed')
  })

  it('catches a missing block, a doubled id and a block holding a second comment', () => {
    expect(addOutsideRangeProblem(BEFORE, BEFORE, ID)).toMatch(/not found/)
    expect(blockRangeOf(`${AFTER}${AFTER}`, ID)).toBeUndefined()
    expect(addOutsideRangeProblem(BEFORE, AFTER.replace('status: open', 'status: <!-- x'), ID)).toMatch(/exactly one comment/)
  })

  it('accepts a rewrite inside the block and catches one outside it', () => {
    const replied = AFTER.replace('status: open', 'status: resolved')
    expect(changeOutsideRangeProblem(AFTER, replied, ID)).toBeNull()
    expect(changeOutsideRangeProblem(AFTER, replied.replace('Text.', 'Text?'), ID)).toBe('characters after the block changed')
    expect(changeOutsideRangeProblem(AFTER, replied.replace('# Title', '# Titel'), ID)).toBe('characters before the block changed')
  })

  it('reads the first message id from @data', () => {
    expect(firstMessageId(BLOCK)).toBe('m-bbbbbbbbbbbbbbbb')
    expect(firstMessageId('<!-- -->')).toBeUndefined()
  })

  it('sees a render change in both Markdown renderers: a block that splits a paragraph', () => {
    const md = loadMarkdownIt(ROOT)
    const before = renderPrint('Line one\nline two\n', 'markdown', md)
    const split = renderPrint('Line one\n\n<!-- x -->\n\nline two\n', 'markdown', md)
    expect(renderDifferences(before, split)).toEqual(md === null ? ['preview', 'preview-breaks'] : ['preview', 'preview-breaks', 'markdown-it'])
    expect(renderDifferences(renderPrint(BEFORE, 'markdown', md), renderPrint(AFTER, 'markdown', md))).toEqual([])
  })

  it('sees a DOM change in HTML and ignores a comment with its line break', () => {
    const page = '<!doctype html><body>\n<p>A</p>\n<p>B</p>\n</body>'
    const commented = page.replace('<p>B', '<!-- c -->\n<p>B')
    expect(renderDifferences(renderPrint(page, 'html', null), renderPrint(commented, 'html', null))).toEqual([])
    expect(renderDifferences(renderPrint(page, 'html', null), renderPrint(page.replace('<p>B</p>', '<div>B</div>'), 'html', null))).toEqual(['dom'])
  })

  it('knows where v0.23.1, reading a file as HTML, sees a comment and where the text before hides it', () => {
    const hidden = 'Use no `<script>` here.\n\n<!-- block -->\n'
    expect(frozenCount(hidden).commentStarts.has(hidden.indexOf('<!--'))).toBe(false)
    const seen = 'Plain words.\n\n<!-- block -->\n'
    expect(frozenCount(seen).commentStarts.has(seen.indexOf('<!--'))).toBe(true)
    expect(frozenCount(seen)).toMatchObject({ blocks: 0, ok: 0 })
  })
})

describe('corpus rules', () => {
  it('keeps permissive licences only, reading AND and OR', () => {
    expect(isPermissive('MIT')).toBe(true)
    expect(isPermissive('(MIT OR GPL-3.0-only)')).toBe(true)
    expect(isPermissive('MIT AND GPL-2.0-only')).toBe(false)
    expect(isPermissive('GPL-3.0-only')).toBe(false)
    expect(isPermissive('UNKNOWN')).toBe(false)
    expect(isPermissive('')).toBe(false)
  })

  it('reads .md, .markdown, .html and .htm, any case, and nothing else', () => {
    expect(['a.md', 'b.MARKDOWN', 'c.html', 'd.HTM', 'e.txt'].map(kindOfName)).toEqual(['markdown', 'markdown', 'html', 'html', undefined])
  })

  it('chooses the first and last target, then other kinds, at most five, the same for the same seed', () => {
    const targets = ['h1', 'p', 'p', 'li', 'p', 'code', 'table', 'li', 'quote', 'p'].map((kind, i) => ({ kind, i }))
    const chosen = chooseTargets(targets, t => t.kind, seededUnit(7))
    expect(chosen).toHaveLength(5)
    expect(chosen[0]).toBe(targets[0])
    expect(chosen[4]).toBe(targets[9])
    expect(new Set(chosen.map(t => t.kind)).size).toBe(5)
    expect(chooseTargets(targets, t => t.kind, seededUnit(7))).toEqual(chosen)
    expect(chooseTargets(targets.slice(0, 2), t => t.kind, seededUnit(7))).toEqual(targets.slice(0, 2))
    expect(chooseTargets([], t => String(t), seededUnit(7))).toEqual([])
  })
})
