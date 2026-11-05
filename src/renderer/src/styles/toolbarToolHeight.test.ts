// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Every toolbar tool reads one size, `--toolbar-tool-height` (#433).
 *
 * The 28px tool height used to be typed by hand in several stylesheets, so one
 * copy could change and the others drift. This guard reads the token from
 * `design-tokens.css` and the toolbar stylesheets from disk.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(__dirname, '..')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf-8')

/** The toolbar stylesheets and the rules that size a tool. */
const TOOLBAR_SHEETS = [
  'components/Editor/MarkdownEditorPanel/components/MarkdownToolbar.css',
  'components/Editor/MermaidToolbar/MermaidToolbar.css',
  'components/Toolbar/Toolbar.css',
  'components/Panels/MarkdownEditorPanel.css',
  'components/Panels/HtmlPreviewPanel/components/PreviewChromeBand.css'
]

describe('--toolbar-tool-height (#433)', () => {
  it('is a design token equal to --input-height-sm, so a find field shares the tools’ edges', () => {
    expect(read('styles/design-tokens.css')).toMatch(/--toolbar-tool-height:\s*var\(--input-height-sm\);/)
  })

  it.each(TOOLBAR_SHEETS)('%s sizes its tools with the token and types no 28px', (sheet) => {
    const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, '') // comments may say 28px
    expect(css).toContain('var(--toolbar-tool-height)')
    expect(css).not.toMatch(/\b28px\b/)
    expect(css).not.toMatch(/(?:^|[\s;{])(?:height|min-width|width):\s*var\(--space-14\)/m)
  })
})
