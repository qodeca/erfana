// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * G-005 (docs/designs/html-preview-comments.md §12, decision 22): a v1
 * comment block inside a Markdown file stays hidden in the Markdown preview.
 *
 * The block is an HTML comment, and the preview's pipeline (rehype-raw, then
 * rehype-sanitize with comments not allowed) drops comments. The other golden
 * cases (G-001–G-004) live with the format in
 * `src/shared/htmlComments/htmlComments.golden.test.ts`; this one lives here
 * because the pipeline it checks is the renderer's.
 */
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GOLDEN_CASES } from '../../../../shared/htmlComments/__fixtures__/v1/cases'
import { AGENT_NOTE_LINES, serializeBlock } from '../../../../shared/htmlComments/format'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import { globalSettings } from '../../test-utils/globalSettings'
import { ToastProvider } from '../Toast/ToastContext'
import { MarkdownPreview } from './MarkdownPreview'

/** Every golden block, serialized as Erfana writes it (G-001 pins these bytes). */
const BLOCKS = GOLDEN_CASES.map(({ name, layout, data }) => {
  const result = serializeBlock(data, layout)
  if (!result.ok) throw new Error(`${name}: ${result.reason}`)
  return { name, block: result.block, text: data.msgs[0].text }
})

function renderMarkdown(markdown: string): HTMLElement {
  const { container } = render(
    <ToastProvider>
      <MarkdownPreview content={markdown} filePath="/test/notes.md" />
    </ToastProvider>
  )
  return container
}

/** The block left no trace the reader can see: no marker, no note, no comment text. */
function expectHidden(container: HTMLElement, name: string, text: string): void {
  const shown = container.textContent ?? ''
  expect(shown, name).not.toContain('erfana:comment')
  expect(shown, name).not.toContain('@data')
  for (const line of AGENT_NOTE_LINES) expect(shown, name).not.toContain(line.trim())
  if (text.trim().length > 3) expect(shown, name).not.toContain(text.trim())
  expect(container.innerHTML, name).not.toContain('erfana:comment')
}

describe('G-005 a v1 block inside a Markdown file stays hidden in the Markdown preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api = {
      file: {
        getProjectPath: vi.fn().mockResolvedValue('/test/project'),
        getStats: vi.fn().mockRejectedValue(new Error('ENOENT'))
      }
    } as unknown as typeof window.api
    useGlobalSettingsStore.setState({
      settings: globalSettings({ logging: { level: 'info' }, editor: { preserveLineBreaks: false } }),
      isLoading: false,
      error: null,
      isInitialized: true,
      wasCorruptionRecovered: false
    })
  })

  it.each(BLOCKS)('$name on its own lines, between paragraphs', ({ name, block, text }) => {
    const container = renderMarkdown(`Before the block.\n\n${block}\n\nAfter the block.\n`)
    expectHidden(container, name, text)
    expect(container.textContent).toContain('Before the block.')
    expect(container.textContent).toContain('After the block.')
  })

  // Mid-line, the block is inline HTML inside a paragraph, and CommonMark ends
  // a paragraph at a blank line: a comment whose text has one never closes
  // there, and its opener shows as text. On its own lines (above) it is an
  // HTML block, which a blank line does not end. Erfana writes blocks only into
  // HTML files, so a block in Markdown was put there by hand; the one golden
  // case with a blank line is named here so the exception cannot widen silently.
  const hasBlankLine = (block: string): boolean => block.split(/\r\n|\r|\n/).some(line => line.trim() === '')
  it('names the golden cases with a blank line in their text', () => {
    expect(BLOCKS.filter(({ block }) => hasBlankLine(block)).map(({ name }) => name)).toEqual(['03-crlf-tab'])
  })

  it.each(BLOCKS.filter(({ block }) => !hasBlankLine(block)))('$name mid-line, before inline HTML', ({ name, block, text }) => {
    const container = renderMarkdown(`Press ${block}<em>this</em> to buy.\n\nNext paragraph.\n`)
    expectHidden(container, name, text)
    expect(container.querySelector('em')?.textContent).toBe('this')
    expect(container.textContent).toContain('Next paragraph.')
  })
})
