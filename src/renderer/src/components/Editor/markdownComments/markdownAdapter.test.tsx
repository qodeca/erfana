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
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  describe('the target index (024-NFR-001)', () => {
    /** A fresh adapter on the same content: its first read is a full scan, the answer the index must give. */
    const scanned = (root: HTMLElement) => createMarkdownAdapter({ root: () => root, text: () => DOC })
    const lineScans = (spy: { mock: { calls: unknown[][] } }): number => spy.mock.calls.filter(([selector]) => selector === '[data-line-start]').length

    it('024-NFR-001 attaches every listed thread from one scan of the content, not one scan per thread', () => {
      const { root, adapter } = renderPreview(DOC)
      const spy = vi.spyOn(root, 'querySelectorAll')
      const placements = adapter.targetsInOrder().map((el, i) => ({ threadKey: `t${i}`, line: adapter.lineOf(el), tag: adapter.tagOf(el) }))
      for (let round = 0; round < 3; round += 1) for (const placement of placements) adapter.attach(placement)
      expect(lineScans(spy)).toBe(1)
      spy.mockRestore()
    })

    it('024-NFR-001 answers what a full scan answers: the first target of the line and tag in document order, and null for none', () => {
      const { root, adapter } = renderPreview(DOC)
      const reference = scanned(root)
      const asked = [
        ...reference.targetsInOrder().map(el => ({ threadKey: 'k', line: reference.lineOf(el), tag: reference.tagOf(el) })),
        { threadKey: 'k', line: 14, tag: 'th' },
        { threadKey: 'k', line: 99, tag: 'p' },
        { threadKey: 'k', line: 6, tag: 'li' },
        { threadKey: 'k', line: 1, tag: 'frontmatter' }
      ]
      for (const placement of asked) {
        const expected = reference.targetsInOrder().find(el => reference.lineOf(el) === placement.line && reference.tagOf(el) === placement.tag) ?? null
        expect(adapter.attach(placement), `${placement.tag}@${placement.line}`).toBe(expected)
      }
      expect(adapter.attach({ threadKey: 'k', line: 14, tag: 'th' })?.textContent).toBe('a')
    })

    it('024-NFR-001 sees a change made earlier in the same task: a removed, a re-stamped, a re-classed and an added block', () => {
      const { root, adapter } = renderPreview(DOC)
      expect(adapter.attach({ threadKey: 'k', line: 6, tag: 'p' })).not.toBeNull()

      // No await between the change and the read: the observer has not delivered its records yet.
      root.querySelector('p[data-line-start="6"]')!.remove()
      expect(adapter.attach({ threadKey: 'k', line: 6, tag: 'p' })).toBeNull()

      const heading = root.querySelector<HTMLElement>('h1[data-line-start="4"]')!
      heading.setAttribute('data-line-start', '5')
      expect(adapter.attach({ threadKey: 'k', line: 4, tag: 'h1' })).toBeNull()
      expect(adapter.attach({ threadKey: 'k', line: 5, tag: 'h1' })).toBe(heading)

      const wrapper = root.querySelector<HTMLElement>('div.table-wrapper')!
      wrapper.classList.remove('table-wrapper')
      expect(adapter.attach({ threadKey: 'k', line: 14, tag: 'table' })).toBeNull()

      const added = document.createElement('p')
      added.setAttribute('data-line-start', '40')
      added.textContent = 'added'
      root.append(added)
      expect(adapter.attach({ threadKey: 'k', line: 40, tag: 'p' })).toBe(added)
      expect(adapter.targetsInOrder()).toEqual(scanned(root).targetsInOrder())
    })

    it('024-NFR-001 keeps the index across the overlay\'s own writes into the content, and after the observer delivered', async () => {
      const { root, adapter } = renderPreview(DOC)
      const first = adapter.attach({ threadKey: 'k', line: 9, tag: 'li' })
      const spy = vi.spyOn(root, 'querySelectorAll')
      first!.setAttribute('aria-details', 'icon-1')
      first!.setAttribute('tabindex', '-1')
      await Promise.resolve()
      expect(adapter.attach({ threadKey: 'k', line: 9, tag: 'li' })).toBe(first)
      expect(lineScans(spy)).toBe(0)

      root.querySelector('hr')!.remove()
      await Promise.resolve()
      expect(adapter.attach({ threadKey: 'k', line: 22, tag: 'hr' })).toBeNull()
      expect(lineScans(spy)).toBe(1)
      spy.mockRestore()
    })

    it('024-NFR-001 reads a new content element afresh, and nothing while there is none', () => {
      const one = renderPreview(DOC)
      const two = renderPreview(DOC.replace('# Plan', '# Other'))
      let root: HTMLElement | null = one.root
      const adapter = createMarkdownAdapter({ root: () => root, text: () => DOC })
      expect(adapter.attach({ threadKey: 'k', line: 4, tag: 'h1' })?.textContent).toBe('Plan')
      root = two.root
      expect(adapter.attach({ threadKey: 'k', line: 4, tag: 'h1' })?.textContent).toBe('Other')
      root = null
      expect(adapter.attach({ threadKey: 'k', line: 4, tag: 'h1' })).toBeNull()
      expect(adapter.targetsInOrder()).toEqual([])
    })

    it('024-NFR-001 hiddenNow answers from the same scan as its line query did, and reads open or closed now', () => {
      const text = ['# Top', '', '<details><summary>More</summary>', '', 'Inside.', '', '</details>', '', 'After.', ''].join('\n')
      const { root, adapter } = renderPreview(text)
      const details = root.querySelector('details')!
      const inside = root.querySelector<HTMLElement>('p[data-line-start="5"]')!
      expect(inside.textContent).toBe('Inside.')
      const spy = vi.spyOn(root, 'querySelectorAll')
      const asked = [
        { threadKey: 'k', line: 5, tag: 'p' },
        { threadKey: 'k', line: 9, tag: 'p' },
        { threadKey: 'k', line: 1, tag: 'h1' },
        { threadKey: 'k', line: 5, tag: 'li' }
      ]
      expect(asked.map(p => adapter.hiddenNow!(p))).toEqual([true, false, false, false])
      details.open = true
      expect(adapter.hiddenNow!({ threadKey: 'k', line: 5, tag: 'p' })).toBe(false)
      expect(lineScans(spy)).toBe(1)
      spy.mockRestore()
    })

    it('024-NFR-001 hands out a copy of the order: a caller that changes it does not change the next answer', () => {
      const { adapter } = renderPreview(DOC)
      const order = adapter.targetsInOrder()
      const count = order.length
      order.splice(0, order.length)
      expect(adapter.targetsInOrder()).toHaveLength(count)
    })
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
