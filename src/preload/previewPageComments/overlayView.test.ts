// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the overlay draws holds no text Find in page could count
 * (docs/designs/html-preview-comments.md §10.2, §10.8; test E-022).
 */
import { describe, expect, it } from 'vitest'
import { MODE_TAB_TEXT, OverlayView } from './overlayView'
import { drawnText } from './__test-helpers__/harness'

/** Every text node under `root`. */
function textNodes(root: Node): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const out: string[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) out.push(node.nodeValue ?? '')
  return out
}

describe('OverlayView text', () => {
  it('E-022 draws every word as generated content, with no text node and no live region', () => {
    const root = document.createElement('div').attachShadow({ mode: 'open' })
    const view = new OverlayView(document, root, 17)
    view.render(
      {
        outline: { box: { left: 10, top: 40, width: 491, height: 24 }, selected: true, label: { tag: 'p', rest: '#team-copy', size: '491×24' } },
        pins: [{ key: 'k', count: 3, status: 'open', element: document.body, content: '3', box: { left: 500, top: 20, width: 24, height: 24 } }],
        pinLabel: () => 'p#team-copy',
        selected: null,
        shields: [],
        indicator: { visible: true, bottom: false },
        flash: null
      },
      { width: 1024, height: 768 }
    )
    expect(textNodes(root)).toEqual([])
    expect(root.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull()
    expect(drawnText(root.querySelector('.erf-hpc-label'))).toBe('p#team-copy491×24')
    expect(drawnText(root.querySelector('.erf-hpc-tab'))).toBe(MODE_TAB_TEXT)
    expect(drawnText(root.querySelector('.erf-hpc-pin'))).toBe('3')
  })
})
