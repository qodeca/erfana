// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared pipeline builds the same tree the Markdown Preview renders
 * (spec 024, architecture note § 6 commit 10, § 8 C11): react-markdown fed
 * the shared plugins and the shared chain on its own give the same markup for
 * every case, BOM, CR-only, CRLF and frontmatter files included.
 */
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { createElement } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'
import {
  PREVIEW_PIPELINE_STEPS,
  PREVIEW_REHYPE_CORE,
  previewRemarkPlugins,
  previewTree,
  splitFrontmatter
} from './previewPipeline'

const BOM = '﻿'

/** Spike cases: every block kind, raw HTML (kept and stripped), comments, line-ending styles. */
const CASES: Record<string, string> = {
  paragraphs: 'One line\nsecond line\n\nAnother paragraph.\n',
  headings: '# One\n\n## Two\n\nSetext\n======\n',
  lists: '- a\n- b\n  - nested\n\n1. one\n2. two\n',
  'task list': '- [ ] open\n- [x] done\n',
  table: '| a | b |\n|---|---|\n| 1 | 2 |\n',
  quote: '> quoted\n>\n> - item\n',
  code: '```ts\nconst x = 1\n```\n\n    indented code\n',
  mermaid: '```mermaid\ngraph TD; A-->B\n```\n',
  'image and link': '![alt](pic.png "t") and [link](https://example.com) and <https://auto.example>\n',
  divider: 'a\n\n---\n\nb\n',
  'raw html kept and stripped': '<div class="x"><b>bold</b></div>\n\n<script>alert(1)</script>\n\n<p onclick="x()">p</p>\n',
  'comment blocks': '<!-- erfana:comment v1 id=c-1\nstatus: open\n-->\nTarget paragraph.\n\n- item\n  <!-- inner -->\n- item 2\n',
  'comment-shaped text in code': '`<!-- erfana:comment v1 -->`\n\n```\n<!-- erfana:comment v1 -->\n```\n',
  crlf: '# Title\r\n\r\nA\r\nB\r\n\r\n- x\r\n',
  'cr only': '# Title\r\rA\rB\r',
  mixed: '# Title\r\n\nA\rB\n',
  footnote: 'Text[^1]\n\n[^1]: note\n',
  strike: '~~gone~~ and www.example.com\n'
}

function viaReactMarkdown(body: string, breaks: boolean): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: previewRemarkPlugins(breaks), rehypePlugins: PREVIEW_REHYPE_CORE }, body)
  )
}

function viaSharedChain(body: string, breaks: boolean): string {
  return renderToStaticMarkup(toJsxRuntime(previewTree(body, { breaks }), { Fragment, jsx, jsxs }))
}

describe('shared Markdown preview pipeline', () => {
  for (const breaks of [false, true]) {
    for (const [name, text] of Object.entries(CASES)) {
      it(`024-AC-003 the preview and the shared chain build the same tree: ${name}, breaks ${breaks ? 'on' : 'off'}`, () => {
        expect(viaSharedChain(text, breaks)).toBe(viaReactMarkdown(text, breaks))
      })
    }
  }

  it('splits frontmatter like the preview, and the body renders the same through both', () => {
    const text = '---\ntitle: x\nlist:\n  - a\n---\n# Body\n\nText.\n'
    const split = splitFrontmatter(text)
    expect(split.yaml).toBe('title: x\nlist:\n  - a')
    expect(split.frontmatterLineCount).toBe(5)
    expect(text.slice(split.bodyOffset)).toBe(split.body)
    expect(split.body).toBe('# Body\n\nText.\n')
    expect(viaSharedChain(split.body, false)).toBe(viaReactMarkdown(split.body, false))
  })

  it('keeps one coordinate system with a BOM: the caller strips it and offsets shift by its length', () => {
    const text = `${BOM}---\r\na: 1\r\n---\r\nBody\r\n`
    expect(splitFrontmatter(text).yaml).toBeNull()
    const split = splitFrontmatter(text.slice(BOM.length))
    expect(split.yaml).toBe('a: 1')
    expect(text.slice(BOM.length + split.bodyOffset)).toBe('Body\r\n')
  })

  it('a file without frontmatter is all body at offset 0', () => {
    expect(splitFrontmatter('# x\n')).toEqual({ yaml: null, body: '# x\n', bodyOffset: 0, frontmatterLineCount: 0 })
  })

  it('pins the plugin list (a change needs review – architecture note § 8 C19)', () => {
    expect(PREVIEW_PIPELINE_STEPS).toEqual([
      'remark-parse',
      'remark-gfm',
      'remark-breaks (when the setting is on)',
      'remark-rehype (allowDangerousHtml)',
      'rehype-raw',
      'rehype-sanitize (PREVIEW_SANITIZE_SCHEMA)'
    ])
    expect(PREVIEW_REHYPE_CORE).toHaveLength(2)
    expect(previewRemarkPlugins(false)).toHaveLength(1)
    expect(previewRemarkPlugins(true)).toHaveLength(2)
    expect(previewRemarkPlugins(true)).toBe(previewRemarkPlugins(true))
  })

  it('sanitizes: no script, no event handler in the tree', () => {
    const html = viaSharedChain(CASES['raw html kept and stripped'], false)
    expect(html).not.toMatch(/<script|onclick/)
    expect(html).toContain('<b>bold</b>')
  })
})
