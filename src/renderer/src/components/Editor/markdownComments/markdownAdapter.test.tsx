// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown adapter against the real preview and main's own parse (spec
 * 024 architecture note 001 § 3, § 8 C7; 024-FR-003): every target the
 * preview offers is described so that main's `locateMarkdownTarget` finds
 * that very target – by line while the text hash matches, by quote after an
 * edit moved it – and a listed thread re-attaches to its element.
 */
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { indexMarkdown } from '../../../../../shared/markdownComments/mdIndex'
import { locateMarkdownTarget, markdownTextHash } from '../../../../../shared/markdownComments/mdLocate'
import { ToastProvider } from '../../Toast/ToastContext'
import { MarkdownPreview } from '../MarkdownPreview'
import { collapsedText, createMarkdownAdapter } from './markdownAdapter'
import { installApi, resetStores, setSettings } from './__test-utils__/harness'

const DOC = [
  '---',
  'title: Notes',
  '---',
  '# Plan',
  '',
  'First paragraph with a [link](https://example.com).',
  '',
  '- one',
  '- two',
  '  - nested',
  '',
  '> quoted paragraph',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 1',
  '```',
  '',
  '---',
  '',
  '<div>',
  '',
  'raw *inner*',
  '',
  '</div>',
  ''
].join('\n')

function renderPreview(text: string) {
  const { container } = render(
    <ToastProvider>
      <MarkdownPreview content={text} filePath="/project/notes.md" />
    </ToastProvider>
  )
  const root = container.querySelector<HTMLElement>('.markdown-preview-content')
  if (root === null) throw new Error('no preview content')
  return { root, adapter: createMarkdownAdapter({ root: () => root, text: () => text }) }
}

describe('markdownAdapter', () => {
  beforeEach(() => {
    resetStores()
    installApi()
    setSettings()
  })

  it('offers the blocks main indexes, in document order, and never the frontmatter', () => {
    const { adapter } = renderPreview(DOC)
    const tags = adapter.targetsInOrder().map(el => `${adapter.tagOf(el)}@${adapter.lineOf(el)}`)
    expect(tags).toEqual([
      'h1@4',
      'p@6',
      'ul@8',
      'li@8',
      'li@9',
      'ul@10',
      'li@10',
      'blockquote@12',
      'p@12',
      'table@14',
      'tr@14',
      'th@14',
      'th@14',
      'tr@16',
      'td@16',
      'td@16',
      'pre@18',
      'hr@22',
      'div@24'
    ])
  })

  it('every target it describes is the one main locates, by line while the hash matches', () => {
    const { adapter } = renderPreview(DOC)
    const index = indexMarkdown(DOC, 0)
    for (const el of adapter.targetsInOrder()) {
      const pick = adapter.describe(el)
      expect(pick).not.toBeNull()
      expect(pick?.baseHash).toBe(markdownTextHash(DOC))
      const found = locateMarkdownTarget(index, pick!)
      expect('refused' in found, `${pick?.tag}@${pick?.lineStart}`).toBe(false)
      if (!('refused' in found)) {
        expect(found.tag).toBe(pick?.tag)
        expect(found.line).toBe(pick?.lineStart)
      }
    }
  })

  it('a target moved by an edit above it is still found by its quote (C7)', () => {
    const { adapter } = renderPreview(DOC)
    const paragraph = adapter.targetsInOrder().find(el => el.tagName === 'P')!
    const pick = adapter.describe(paragraph)!
    const edited = DOC.replace('# Plan\n', '# Plan\n\nA new paragraph above.\n')
    const found = locateMarkdownTarget(indexMarkdown(edited, 0), pick)
    expect('refused' in found).toBe(false)
    if (!('refused' in found)) expect(found.line).toBe(pick.lineStart + 2)
  })

  it('climbs from text to its target: a link is its paragraph, raw HTML its outermost section', () => {
    const { root, adapter } = renderPreview(DOC)
    const link = root.querySelector('a')!
    expect(adapter.targetAt(link.firstChild)?.tagName).toBe('P')
    const inner = root.querySelector('em')!
    expect(adapter.targetAt(inner)?.tagName).toBe('DIV')
    expect(adapter.targetAt(root)).toBeNull()
  })

  it('names the frontmatter for its menu, but refuses a comment on it (M-18)', () => {
    const { root, adapter } = renderPreview(DOC)
    const frontmatter = root.querySelector<HTMLElement>('.frontmatter-wrapper, .frontmatter-error-wrapper')!
    const target = adapter.targetAt(frontmatter.querySelector('td') ?? frontmatter)!
    expect(adapter.tagOf(target)).toBe('frontmatter')
    expect(adapter.canComment(target)).toEqual({ ok: false, reason: "Comments can't be added to the frontmatter." })
    expect(adapter.describe(target)).toBeNull()
  })

  it('counts an ordinal among same-tag targets on one line, and steps parent and child', () => {
    const { adapter } = renderPreview(DOC)
    const cells = adapter.targetsInOrder().filter(el => adapter.tagOf(el) === 'th')
    expect(cells.map(el => adapter.describe(el)?.ordinal)).toEqual([1, 2])
    const nested = adapter.targetsInOrder().find(el => adapter.tagOf(el) === 'li' && adapter.lineOf(el) === 10)!
    expect(adapter.parentOf(nested)?.tagName).toBe('UL')
    const quote = adapter.targetsInOrder().find(el => adapter.tagOf(el) === 'blockquote')!
    expect(adapter.childOf(quote)?.tagName).toBe('P')
    expect(adapter.parentOf(adapter.targetsInOrder()[0])).toBeNull()
  })

  it('re-attaches a listed thread to its element by line and tag', () => {
    const { adapter } = renderPreview(DOC)
    expect(adapter.attach({ threadKey: 't1', line: 9, tag: 'li' })?.textContent).toMatch(/^two\s+nested/)
    expect(adapter.attach({ threadKey: 't2', line: 99, tag: 'p' })).toBeNull()
  })

  it('collapses a quote as main reads one: whitespace runs, NFC, the 200-character cut', () => {
    expect(collapsedText('  a\n\t b  ')).toBe('a b')
    expect(collapsedText('é')).toBe('é')
    expect(collapsedText('x'.repeat(250))).toHaveLength(200)
  })

  it('C-19 (Markdown) W-08 a block inside a generated START/END region is refused at the pick, as main refuses it; one outside is not', () => {
    const text = ['# Top', '', '<!-- START toc -->', '', 'Generated line.', '', '<!-- END toc -->', '', 'Own words.', ''].join('\n')
    const { adapter, root } = renderPreview(text)
    const generated = root.querySelector<HTMLElement>('p[data-line-start="5"]')!
    const own = root.querySelector<HTMLElement>('p[data-line-start="9"]')!
    expect(adapter.refusalOf?.(generated)).toBe('generated-region')
    expect(locateMarkdownTarget(indexMarkdown(text, 0), adapter.describe(generated)!)).toEqual({ refused: 'generated-region' })
    expect(adapter.refusalOf?.(own)).toBeNull()
    expect(adapter.root?.()).toBe(root)
  })
})
