// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preview body's parse reuse (spec 024 024-NFR-001): a render React
 * throws away and restarts reuses the parse of the same inputs, and anything
 * else parses afresh.
 */
import { render } from '@testing-library/react'
import Markdown, { type Components } from 'react-markdown'
import type { PluggableList } from 'unified'
import { describe, expect, it, vi } from 'vitest'
import { ParsedMarkdown, reuseOrParse, type BodyParseInputs } from './markdownBodyParse'

const remarkPlugins: PluggableList = []
const rehypePlugins: PluggableList = []
const components: Components = {}
const inputs: BodyParseInputs = { source: '# Title\n\nText.', remarkPlugins, rehypePlugins, components }

describe('reuseOrParse', () => {
  it('024-NFR-001 reuses the last parse of the same text, plugins and components, without parsing', () => {
    const first = reuseOrParse(null, inputs, () => <p>one</p>)
    const parse = vi.fn(() => <p>two</p>)
    expect(reuseOrParse(first, { ...inputs }, parse)).toBe(first)
    expect(parse).not.toHaveBeenCalled()
  })

  it('024-NFR-001 parses afresh for a new text, or new plugins or components by identity', () => {
    const first = reuseOrParse(null, inputs, () => <p>one</p>)
    const changes: BodyParseInputs[] = [
      { ...inputs, source: `${inputs.source} ` },
      { ...inputs, remarkPlugins: [] },
      { ...inputs, rehypePlugins: [] },
      { ...inputs, components: {} }
    ]
    for (const changed of changes) {
      const parse = vi.fn(() => <p>two</p>)
      const next = reuseOrParse(first, changed, parse)
      expect(parse).toHaveBeenCalledTimes(1)
      expect(next).not.toBe(first)
      expect(next).toMatchObject(changed)
    }
  })
})

describe('ParsedMarkdown', () => {
  /** A rehype plugin that counts the parses it runs in. */
  function counting(): { plugins: PluggableList; runs: () => number } {
    let runs = 0
    return { plugins: [() => () => void (runs += 1)], runs: () => runs }
  }

  it('024-NFR-001 renders what react-markdown renders', () => {
    const own = render(<ParsedMarkdown {...inputs} />)
    const reference = render(<Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>{inputs.source}</Markdown>)
    expect(own.container.innerHTML).toBe(reference.container.innerHTML)
    expect(own.container.querySelector('h1')?.textContent).toBe('Title')
  })

  it('024-NFR-001 a render again with the same inputs reuses the parse; a new text parses once more', () => {
    const counter = counting()
    const props = { ...inputs, rehypePlugins: counter.plugins }
    const view = render(<ParsedMarkdown {...props} />)
    expect(counter.runs()).toBe(1)
    view.rerender(<ParsedMarkdown {...props} />)
    expect(counter.runs()).toBe(1)
    view.rerender(<ParsedMarkdown {...props} source="# Other" />)
    expect(counter.runs()).toBe(2)
    expect(view.container.querySelector('h1')?.textContent).toBe('Other')
  })

  it('024-AC-024 a saved file\'s new text always draws the new text: no parse of another text is kept, back and forth', () => {
    const view = render(<ParsedMarkdown {...inputs} source={'- item\n'} />)
    // The text a comment save wrote: a new block above the item, so the item moves down.
    view.rerender(<ParsedMarkdown {...inputs} source={'<!-- c -->\n\n- item\n'} />)
    expect(view.container.querySelectorAll('li')).toHaveLength(1)
    // Back to the first text (a discarded render of the old text), then forward again.
    view.rerender(<ParsedMarkdown {...inputs} source={'- item\n'} />)
    view.rerender(<ParsedMarkdown {...inputs} source={'- other\n'} />)
    expect(view.container.querySelector('li')?.textContent).toBe('other')
  })
})
