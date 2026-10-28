// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment overlay's page channels (docs/designs/html-preview-comments.md §8)
 * beside the page's other channels. Lives in `src/main` because it reads the
 * main-side link and CSP channel names (`src/shared` must not import `src/main`).
 * The preload's copies are pinned by `src/preload/previewPageComments/contract.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { PreviewCommentPageChannels } from '../../../shared/ipc/preview-comment-channels'
import { PreviewChannels, PreviewEvents } from '../../../shared/ipc/preview-channels'
import { PREVIEW_PAGE_CSP_VIOLATION_CHANNEL } from './previewCspViolationBridge'
import { PREVIEW_PAGE_LINK_CHANNEL, PREVIEW_PAGE_LINK_NOTE_CHANNEL } from './previewLinkBridge'

describe('PreviewCommentPageChannels', () => {
  const names = Object.values(PreviewCommentPageChannels)

  it('names four distinct page channels in the preview-page namespace', () => {
    expect(new Set(names).size).toBe(4)
    for (const name of names) expect(name).toMatch(/^preview-page:comment[A-Z][A-Za-z]+$/)
  })

  it('shares no name with the page’s link and CSP channels or the renderer’s preview channels', () => {
    const taken = new Set<string>([
      PREVIEW_PAGE_LINK_CHANNEL,
      PREVIEW_PAGE_LINK_NOTE_CHANNEL,
      PREVIEW_PAGE_CSP_VIOLATION_CHANNEL,
      ...Object.values(PreviewChannels),
      ...Object.values(PreviewEvents)
    ])
    for (const name of names) expect(taken.has(name), name).toBe(false)
  })
})
