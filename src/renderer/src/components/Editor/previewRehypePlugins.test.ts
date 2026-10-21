// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Heading ids and line shifting, done in the parse rather than the renderers.
 */

import { describe, it, expect } from 'vitest'
import { slugifyHeading, rehypeHeadingIds, rehypeShiftLines } from './previewRehypePlugins'

interface Node {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: Node[]
  position?: { start: { line: number }; end: { line: number } }
}

const text = (value: string): Node => ({ type: 'text', value })
const el = (tagName: string, children: Node[], line?: number): Node => ({
  type: 'element',
  tagName,
  properties: {},
  children,
  ...(line ? { position: { start: { line }, end: { line } } } : {})
})
const root = (...children: Node[]): Node => ({ type: 'root', children })

/** Fresh tree per call – the plugins mutate in place, like any rehype plugin. */
function withIds(tree: Node): Node {
  rehypeHeadingIds()(tree)
  return tree
}

function elements(tree: Node, tag: string): Node[] {
  const out: Node[] = []
  const walk = (n: Node): void => {
    if (n.type === 'element' && n.tagName === tag) out.push(n)
    n.children?.forEach(walk)
  }
  walk(tree)
  return out
}

describe('slugifyHeading', () => {
  it.each([
    ['Hello World!', 'hello-world'],
    ['Hello, World?', 'hello-world'],
    ['Café', 'café'],
    ['  spaced   out  ', 'spaced-out'],
    ['a -- b', 'a-b'],
    ['!!!', '']
  ])('%j -> %j', (input, expected) => {
    expect(slugifyHeading(input)).toBe(expected)
  })
})

describe('rehypeHeadingIds', () => {
  it('numbers duplicates in document order across heading levels', () => {
    const tree = withIds(root(el('h1', [text('Example')]), el('h2', [text('Example')]), el('h3', [text('Example')])))
    const ids = ['h1', 'h2', 'h3'].map((t) => elements(tree, t)[0].properties?.id)
    expect(ids).toEqual(['example', 'example-2', 'example-3'])
  })

  it('gives the same ids every time the same document is parsed', () => {
    // A counter shared across parses would produce example-3 / example-4
    // the second time and break every anchor.
    const doc = (): Node => root(el('h1', [text('Example')]), el('h1', [text('Example')]))
    const first = elements(withIds(doc()), 'h1').map((h) => h.properties?.id)
    const second = elements(withIds(doc()), 'h1').map((h) => h.properties?.id)
    expect(second).toEqual(first)
    expect(first).toEqual(['example', 'example-2'])
  })

  it('never hands out an id a heading already earned by its own text', () => {
    const ids = (...texts: string[]): unknown[] =>
      elements(withIds(root(...texts.map((t) => el('h2', [text(t)])))), 'h2').map((h) => h.properties?.id)

    // "Example 2" slugs to example-2, which the second "Example" already holds.
    expect(ids('Example', 'Example', 'Example 2')).toEqual(['example', 'example-2', 'example-2-2'])
    // The other way round: the duplicate skips the taken example-2.
    expect(ids('Example 2', 'Example', 'Example')).toEqual(['example-2', 'example', 'example-3'])
    // And every id is unique in a longer mix.
    const mixed = ids('A', 'A 2', 'A', 'A', 'A 3', 'A 2')
    expect(new Set(mixed).size).toBe(mixed.length)
  })

  it('slugs the full text of headings that contain inline markup', () => {
    const tree = withIds(root(el('h2', [text('Use '), el('code', [text('npm ci')]), text(' '), el('em', [text('always')])])))
    expect(elements(tree, 'h2')[0].properties?.id).toBe('use-npm-ci-always')
  })
})

describe('rehypeShiftLines', () => {
  it('adds the offset to start and end lines', () => {
    const tree = root(el('p', [text('para one')], 1), el('p', [text('para two')], 3))
    rehypeShiftLines({ offset: 4 })(tree)
    const lines = elements(tree, 'p').map((p) => [p.position?.start.line, p.position?.end.line])
    expect(lines).toEqual([
      [5, 5],
      [7, 7]
    ])
  })

  it('skips nodes without a position', () => {
    const tree = root(el('p', [text('no position')]))
    rehypeShiftLines({ offset: 4 })(tree)
    expect(elements(tree, 'p')[0].position).toBeUndefined()
  })

  it('leaves positions alone for a zero offset', () => {
    const tree = root(el('p', [text('para')], 1))
    rehypeShiftLines({ offset: 0 })(tree)
    expect(elements(tree, 'p')[0].position?.start.line).toBe(1)
  })
})
