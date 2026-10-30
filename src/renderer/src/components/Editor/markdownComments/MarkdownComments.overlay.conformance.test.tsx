// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown Preview against the shared overlay behaviour suite (spec 024,
 * 024-AC-001; architecture note 001 § 2 option C: one behaviour, two hosts).
 *
 * The HTML Preview runs the same suite in its page preload
 * (`src/preload/previewPageComments/overlay.conformance.test.ts`). Pin
 * placement and the underline run in Playwright
 * (`e2e/markdown-preview-comments.e2e.ts`).
 *
 * The overlay's asks of its host are recorded by wrapping the real
 * `useHostPointerKeys` (`__test-utils__/pickRecorder.ts`); everything else is
 * the real preview, host and window, with the comment bridge mocked.
 */
import { vi } from 'vitest'
import { runOverlaySuite } from '../../../../../shared/comments/__conformance__/overlay.suite'
import { createMarkdownOverlayDriver } from './__test-utils__/markdownOverlayDriver'

vi.mock('../../Comments/overlay/useHostPointerKeys', async importOriginal => {
  const real = await importOriginal<typeof import('../../Comments/overlay/useHostPointerKeys')>()
  const { recordPicks } = await import('./__test-utils__/pickRecorder')
  return { ...real, useHostPointerKeys: recordPicks(real.useHostPointerKeys) }
})

/** In comment mode the host stops only `click` and `contextmenu` at the scroller (useHostPointerKeys.ts). */
const PRESS_RELEASE_LEAK =
  'in comment mode the preview’s own listeners still see pointerdown, mousedown, pointerup and mouseup – the host stops only click and contextmenu (useHostPointerKeys.ts); no differences-table row covers it'

/**
 * Where the Markdown host does not yet behave as the suite pins it. Each is a
 * host defect or an undecided difference, reported to the owner – not a
 * design row. Remove an entry when the host passes the case.
 */
const MARKDOWN_KNOWN_GAPS: Readonly<Record<string, string>> = {
  'OVL-M-03': PRESS_RELEASE_LEAK,
  'OVL-G-01': 'a pointer pick does not paint the picked state: the click opens the window without making the block the pick, so no ring is on it (D-06; useHostPointerKeys.ts onClick)',
  'OVL-G-03': `${PRESS_RELEASE_LEAK}; dblclick is not stopped either`,
  'OVL-G-04': `${PRESS_RELEASE_LEAK}; dblclick is not stopped either`,
  'OVL-G-06': PRESS_RELEASE_LEAK,
  'OVL-G-09': PRESS_RELEASE_LEAK,
  'OVL-G-10': `${PRESS_RELEASE_LEAK}; auxclick is not stopped either`,
  'OVL-G-11':
    'a middle click in comment mode reaches the preview: auxclick is not stopped, so on a link MarkdownPreview’s onAuxClick follows it',
  'OVL-E-01': 'the host keeps Esc’s keydown from the preview but not its keyup'
}

runOverlaySuite('Markdown', createMarkdownOverlayDriver, { knownGaps: MARKDOWN_KNOWN_GAPS })
