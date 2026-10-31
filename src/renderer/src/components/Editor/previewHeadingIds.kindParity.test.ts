// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown comment kind names a heading by the id the preview gives it
 * (spec 024 design `markdown-format.md` § 5, `anchor.id`). The kind runs in
 * main's parse worker and may not import the renderer, so it mirrors
 * `slugifyHeading` and `rehypeHeadingIds` (`shared/markdownComments/mdHast.ts`);
 * this test pins the two together.
 */
import { describe, expect, it } from 'vitest'
import { previewTree } from '../../../../shared/markdown/previewPipeline'
import { renderedPage, slugifyHeading as kindSlug } from '../../../../shared/markdownComments/mdHast'
import { rehypeHeadingIds, slugifyHeading as previewSlug } from './previewRehypePlugins'

interface Node {
  type: string
  tagName?: string
  properties?: { id?: unknown }
  children?: Node[]
}

describe('the Markdown comment kind and the preview agree on heading ids', () => {
  it('024-AC-003 the same slug for every heading text', () => {
    for (const text of ['Hello, World?', 'Café', '  Two  words  ', 'a--b', '😀 Emoji', 'Ünïcödé 2', '']) {
      expect(kindSlug(text)).toBe(previewSlug(text))
    }
  })

  it('024-AC-003 the same id for every heading of a document, duplicates and raw HTML headings included', () => {
    const body = '# Example\n\n## Example\n\n### Example 2\n\n#### Example\n\n<h2>Example</h2>\n\n> # Example\n'
    const tree = previewTree(body, { breaks: false })
    const kind = renderedPage(tree, 0).records.filter(r => /^h[1-6]$/.test(r.tag)).map(r => r.id)
    rehypeHeadingIds()(tree as unknown as Parameters<ReturnType<typeof rehypeHeadingIds>>[0])
    const preview: string[] = []
    const walk = (node: Node): void => {
      if (node.type === 'element' && /^h[1-6]$/.test(node.tagName ?? '')) preview.push(String(node.properties?.id))
      for (const child of node.children ?? []) walk(child)
    }
    walk(tree as unknown as Node)
    expect(kind).toEqual(preview)
  })
})
