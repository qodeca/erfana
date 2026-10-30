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
 *
 * Every case runs as a normal case: the host has no known gaps. Should one
 * appear, it goes in `runOverlaySuite`'s `knownGaps`, with the defect and
 * where it lives.
 */
import { vi } from 'vitest'
import { runOverlaySuite } from '../../../../../shared/comments/__conformance__/overlay.suite'
import { createMarkdownOverlayDriver } from './__test-utils__/markdownOverlayDriver'

vi.mock('../../Comments/overlay/useHostPointerKeys', async importOriginal => {
  const real = await importOriginal<typeof import('../../Comments/overlay/useHostPointerKeys')>()
  const { recordPicks } = await import('./__test-utils__/pickRecorder')
  return { ...real, useHostPointerKeys: recordPicks(real.useHostPointerKeys) }
})

runOverlaySuite('Markdown', createMarkdownOverlayDriver)
