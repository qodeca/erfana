// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * P2-AC5 cover: the Markdown preview renders no frames.
 *
 * Issue #124 lets HTML *pages* run `src` and `srcdoc` frames in the native
 * preview. The Markdown preview is a different surface – ordinary renderer DOM
 * with the app's privileges – and must stay frame-free: `MarkdownPreview.tsx`
 * sanitises with `rehype-sanitize`'s `defaultSchema`, which does not allow
 * `iframe` (design part 2 §2.11). These tests pin that, so a later edit to the
 * sanitisation schema cannot quietly let a frame in. Nothing else about the
 * preview changes, so each case also checks that the text around the frame
 * still renders.
 *
 * `<object>` and `<embed>` load a page the same way a frame does, so they are
 * pinned alongside.
 *
 * @module MarkdownPreview.frames.test
 * @see docs/design/design-issue-124-part2.md §2.11
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

import { MarkdownPreview } from './MarkdownPreview'
import { ToastProvider } from '../Toast/ToastContext'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'

const FILE_PATH = '/proj/notes.md'

/** Every element that can load another document into the preview. */
const FRAME_LIKE = 'iframe, frame, frameset, object, embed'

const renderPreview = (content: string): ReturnType<typeof render> =>
  render(
    <ToastProvider>
      <MarkdownPreview content={content} filePath={FILE_PATH} />
    </ToastProvider>
  )

/** Surrounds a raw HTML snippet with Markdown text that must survive. */
const between = (snippet: string): string =>
  `Text before the frame.\n\n${snippet}\n\nText after the frame.`

beforeEach(() => {
  // Extend window rather than replacing it (replacing kills React's DOM internals).
  ;(window as unknown as { api: unknown }).api = {
    file: {
      getProjectPath: vi.fn().mockResolvedValue('/proj'),
      getStats: vi.fn().mockRejectedValue(new Error('ENOENT'))
    }
  }

  Object.defineProperty(window, 'electron', {
    value: { shell: { openExternal: vi.fn() } },
    writable: true,
    configurable: true
  })

  const portalRoot = document.createElement('div')
  portalRoot.setAttribute('id', 'portal-root')
  document.body.appendChild(portalRoot)

  useGlobalSettingsStore.setState({
    settings: {
      logging: { level: 'info' },
      editor: { preserveLineBreaks: false }
    },
    isLoading: false,
    error: null,
    isInitialized: true,
    wasCorruptionRecovered: false
  } as Parameters<typeof useGlobalSettingsStore.setState>[0])
})

afterEach(() => {
  cleanup()
  document.getElementById('portal-root')?.remove()
  vi.clearAllMocks()
})

describe('MarkdownPreview renders no frames (P2-AC5)', () => {
  it('parses raw HTML, so the absence of frames below is the sanitiser at work', () => {
    // Control: if raw HTML stopped being parsed at all, every "no frame" check
    // below would pass for the wrong reason.
    const { container } = renderPreview(between('<b>allowed markup</b>'))

    expect(container.querySelector('b')?.textContent).toBe('allowed markup')
  })

  it.each([
    ['a remote src frame', '<iframe src="https://example.com/page.html"></iframe>'],
    ['a local src frame', '<iframe src="overview.html"></iframe>'],
    ['a srcdoc frame', '<iframe srcdoc="<b>inside the frame</b>"></iframe>'],
    ['a frame with both src and srcdoc', '<iframe src="overview.html" srcdoc="<b>inside</b>"></iframe>'],
    ['an upper-case IFRAME', '<IFRAME SRC="https://example.com/page.html"></IFRAME>'],
    ['a frame inside an HTML block', '<div>\n<iframe src="overview.html"></iframe>\n</div>'],
    ['a frame inside a Markdown paragraph', 'Inline <iframe src="overview.html"></iframe> frame'],
    ['a frameset', '<frameset><frame src="overview.html"></frameset>'],
    ['an object', '<object data="overview.html" type="text/html"></object>'],
    ['an embed', '<embed src="overview.html" type="text/html">']
  ])('renders %s as nothing', (_name, snippet) => {
    const { container } = renderPreview(between(snippet))

    expect(container.querySelector(FRAME_LIKE)).toBeNull()
    // No attribute that could load a document survives on any other element.
    expect(container.querySelector('[srcdoc], [src], [data]')).toBeNull()
    // Dropped, not escaped into visible source text.
    expect(container.textContent?.toLowerCase()).not.toMatch(/<(iframe|frame|object|embed)/)
    expect(container.textContent).toContain('Text before the frame.')
    expect(container.textContent).toContain('Text after the frame.')
  })

  it('does not parse the srcdoc document into the preview', () => {
    const { container } = renderPreview(
      between('<iframe srcdoc="<p id=&quot;inner&quot;>inside the frame</p>"></iframe>')
    )

    // The inline document is neither rendered as markup nor leaked as text.
    expect(container.querySelector('#inner, #user-content-inner')).toBeNull()
    expect(container.textContent).not.toContain('inside the frame')
  })

  it('still renders the page around several frames in one document', () => {
    const { container } = renderPreview(
      [
        '# Frames',
        '<iframe src="a.html"></iframe>',
        'Middle paragraph.',
        '<iframe srcdoc="<i>b</i>"></iframe>',
        '- list item'
      ].join('\n\n')
    )

    expect(container.querySelector(FRAME_LIKE)).toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('Frames')
    expect(container.textContent).toContain('Middle paragraph.')
    expect(container.querySelector('li')?.textContent).toBe('list item')
  })
})
