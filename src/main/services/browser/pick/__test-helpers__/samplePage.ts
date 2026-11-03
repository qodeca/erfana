// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page most pick tests use: a button with a label in the top document,
 * and a cross-site frame (its own target, session `S1`) holding a button.
 *
 * Top (session ''): html 1 › body 2 › div#outer 3 › button#save 4 › span#label 5;
 * iframe#cross 6 (at 400, 100, 300 × 150) holds frame `F1`.
 * `F1` (session `S1`): html 101 › button#inner 102 (at 10, 10, 50 × 20).
 */
import { FakePage } from './fakePage'

/** `beforeFrames` runs before the cross-site frame attaches: build listeners there, as a tab's pick pipeline exists before its page loads. */
export function samplePage(options: { crossSite?: boolean; beforeFrames?: (page: FakePage) => void } = {}): FakePage {
  const page = new FakePage()
  page
    .add({ id: 1, tag: 'html', box: [0, 0, 800, 600] })
    .add({ id: 2, tag: 'body', parent: 1, box: [0, 0, 800, 600] })
    .add({ id: 3, tag: 'div', parent: 2, attrs: { id: 'outer' }, box: [10, 10, 300, 200] })
    .add({ id: 4, tag: 'button', parent: 3, attrs: { id: 'save', 'data-source': 'src/Save.tsx:4' }, box: [20, 20, 100, 30] })
    .add({ id: 5, tag: 'span', parent: 4, attrs: { id: 'label' }, box: [30, 25, 40, 20] })
  options.beforeFrames?.(page)
  if (options.crossSite !== false) {
    page.add({ id: 6, tag: 'iframe', parent: 2, attrs: { id: 'cross' }, box: [400, 100, 300, 150], contentFrameId: 'F1' })
    page.addFrameTarget('S1', 'F1', 'top')
    page
      .add({ id: 101, tag: 'html', session: 'S1', frameId: 'F1', box: [0, 0, 300, 150] })
      .add({ id: 102, tag: 'button', session: 'S1', frameId: 'F1', parent: 101, attrs: { id: 'inner' }, box: [10, 10, 50, 20] })
  }
  return page
}
