// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The kind's parse is the preview's pipeline, and its render signature sees
 * exactly the differences a browser renders (spec 024 architecture note 001
 * § 5, § 8 C19; design `markdown-format.md` § 4.5).
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_PIPELINE_STEPS, previewTree } from '../markdown/previewPipeline'
import { parseMarkdownBody, renderMarkdownBody, renderSignature } from './mdRender'
import { assignHeadingIds, renderedPage, slugifyHeading } from './mdHast'

const CASES = [
  '# One\n\nPara *em* and `code`.\n',
  '- a\n- b\n  - c\n\n1. x\n',
  '| a | b |\n|---|---|\n| 1 | 2 |\n',
  '> q\n>\n> - item\n',
  '```mermaid\ngraph TD\n```\n\n    indented\n',
  '<details><summary>More</summary>\n\nin\n\n</details>\n\n<script>x</script>\n',
  'a\nb\n\n---\n\n![i](p.png)\n'
]

describe('the kind parses with the preview pipeline', () => {
  it.each(CASES)('024-AC-037 its tree is previewTree\'s, breaks on and off: %j', body => {
    expect(JSON.stringify(parseMarkdownBody(body).hast)).toBe(JSON.stringify(previewTree(body, { breaks: false })))
    expect(JSON.stringify(renderMarkdownBody(body, true))).toBe(JSON.stringify(previewTree(body, { breaks: true })))
  })

  it('024-AC-036 the pinned steps are the pipeline the kind runs', () => {
    expect(PREVIEW_PIPELINE_STEPS).toEqual([
      'remark-parse',
      'remark-gfm',
      'remark-breaks (when the setting is on)',
      'remark-rehype (allowDangerousHtml)',
      'rehype-raw',
      'rehype-sanitize (PREVIEW_SANITIZE_SCHEMA)'
    ])
  })
})

describe('renderSignature', () => {
  const sig = (body: string, breaks = false): string => renderSignature(renderMarkdownBody(body, breaks))

  it('024-AC-037 a comment block between blocks, or as an item\'s last child, renders nothing', () => {
    expect(sig('# T\n<!-- c -->\npara\n')).toBe(sig('# T\npara\n'))
    expect(sig('- a\n  <!-- c -->\n- b\n')).toBe(sig('- a\n- b\n'))
  })

  it('024-AC-037 sees a list turned loose, a split list and changed text', () => {
    expect(sig('- a\n\n- b\n')).not.toBe(sig('- a\n- b\n'))
    expect(sig('- a\n<!-- c -->\n- b\n')).not.toBe(sig('- a\n- b\n'))
    expect(sig('para one\n')).not.toBe(sig('para two\n'))
  })

  it('024-AC-037 keeps whitespace inside pre and between inline elements', () => {
    expect(sig('```\na  b\n```\n')).not.toBe(sig('```\na b\n```\n'))
    expect(sig('*a* *b*\n')).not.toBe(sig('*a**b*\n'))
  })

  it('reads the breaks setting', () => {
    expect(sig('a\nb\n', true)).not.toBe(sig('a\nb\n', false))
  })
})

describe('heading ids and paths', () => {
  // The parity with the preview's own `rehypeHeadingIds` is pinned on the renderer side
  // (`previewHeadingIds.kindParity.test.ts`): shared code may not import the renderer.
  it('024-AC-003 duplicate headings get -2, -3, skipping ids a heading already earned', () => {
    const body = '# Example\n\n## Example\n\n### Example 2\n\n#### Example\n\n<h2>Café, ok?</h2>\n\n# !!!\n'
    const page = renderedPage(previewTree(body, { breaks: false }), 0)
    expect(page.records.filter(r => /^h[1-6]$/.test(r.tag)).map(r => r.id)).toEqual(['example', 'example-2', 'example-2-2', 'example-3', 'café-ok', ''])
    assignHeadingIds(page.records, page.visibleText)
    expect(page.records[0].id).toBe('example')
    expect(slugifyHeading('  Two  words  ')).toBe('two-words')
  })

  it('024-AC-003 paths count same-tag siblings below the root; elements without a source have no offset', () => {
    const page = renderedPage(previewTree('a\n\n- x\n- y\n\nb\n\n[^1]\n\n[^1]: note\n', { breaks: false }), 10)
    const paths = page.records.map(r => r.path)
    expect(paths).toContain('p:nth-of-type(2)')
    expect(paths).toContain('ul:nth-of-type(1) > li:nth-of-type(2)')
    expect(page.records.find(r => r.path === 'p:nth-of-type(1)')!.start).toBe(10)
    expect(page.records.some(r => r.start === -1)).toBe(true)
  })
})
