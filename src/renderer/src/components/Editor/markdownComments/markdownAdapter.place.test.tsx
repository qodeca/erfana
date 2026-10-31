// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown picker names a block as main does (comments-v2 C-03; spec 024
 * 024-FR-007): the adapter reads a row's, a cell's and a diagram's place from
 * the real preview's table and Mermaid wrapper, and every target's place is
 * the one main's index gives the target it locates – so the picker, the menu,
 * the icons and the window say one noun for one block.
 */
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { indexMarkdown } from '../../../../../shared/markdownComments/mdIndex'
import { locateMarkdownTarget } from '../../../../../shared/markdownComments/mdLocate'
import { placeOf } from '../../../../../shared/markdownComments/mdPlace'
import { ToastProvider } from '../../Toast/ToastContext'
import { MarkdownPreview } from '../MarkdownPreview'
import { targetNounOf } from '../../Comments/overlay/previewAdapter'
import { createMarkdownAdapter } from './markdownAdapter'
import { installApi, resetStores, setSettings } from './__test-utils__/harness'

vi.mock('../MermaidDiagram', () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid-stub" data-code={code} />
}))

const DOC = [
  '# Team',
  '',
  '| Name | Task | Due |',
  '| --- | --- | --- |',
  '| Ada | Plan | Mon |',
  '| Piotr | Load test | Fri |',
  '',
  '```mermaid',
  'graph TD; A-->B',
  '```',
  '',
  '```js',
  'const x = 1',
  '```',
  ''
].join('\n')

function renderPreview(text: string) {
  const { container } = render(
    <ToastProvider>
      <MarkdownPreview content={text} filePath="/project/team.md" />
    </ToastProvider>
  )
  const root = container.querySelector<HTMLElement>('.markdown-preview-content')
  if (root === null) throw new Error('no preview content')
  return createMarkdownAdapter({ root: () => root, text: () => text })
}

describe('024-AC-008 C-03 the Markdown picker names rows, cells and diagrams as main does', () => {
  beforeEach(() => {
    resetStores()
    installApi()
    setSettings()
  })

  it('024-AC-008 C-03 every target\'s place is the place main gives the target it locates', () => {
    const adapter = renderPreview(DOC)
    const index = indexMarkdown(DOC, 0)
    for (const el of adapter.targetsInOrder()) {
      const found = locateMarkdownTarget(index, adapter.describe(el)!)
      if ('refused' in found) throw new Error(`not located: ${adapter.tagOf(el)}@${adapter.lineOf(el)}`)
      expect(adapter.placeOf?.(el), `${adapter.tagOf(el)}@${adapter.lineOf(el)}`).toEqual(placeOf(found as Parameters<typeof placeOf>[0]))
    }
  })

  it('024-AC-008 C-03 says "header row", "row 2", "row 2, column 3", "header row, column 1", "diagram" and "code block"', () => {
    const adapter = renderPreview(DOC)
    const nouns = adapter.targetsInOrder().map(el => targetNounOf(adapter, el))
    expect(nouns).toEqual([
      'H1 heading',
      'table',
      'header row',
      'header row, column 1',
      'header row, column 2',
      'header row, column 3',
      'row 1',
      'row 1, column 1',
      'row 1, column 2',
      'row 1, column 3',
      'row 2',
      'row 2, column 1',
      'row 2, column 2',
      'row 2, column 3',
      'diagram',
      'code block'
    ])
  })
})
