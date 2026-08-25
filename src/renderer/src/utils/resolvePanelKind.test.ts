// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link resolvePanelKind}.
 *
 * @module resolvePanelKind.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { resolvePanelKind } from './resolvePanelKind'

/** The eligibility check double the resolver reaches through `window.api.preview`. */
const checkEligibility = vi.fn()

beforeEach(() => {
  checkEligibility.mockReset()
  // Minimal preview bridge: only the method the resolver uses.
  ;(globalThis as unknown as { window: { api: { preview: { checkEligibility: typeof checkEligibility } } } }).window = {
    api: { preview: { checkEligibility } }
  }
})

describe('resolvePanelKind', () => {
  it('resolves images to "image" without any IPC', async () => {
    await expect(resolvePanelKind('/proj/logo.png')).resolves.toBe('image')
    await expect(resolvePanelKind('/proj/PHOTO.JPG')).resolves.toBe('image')
    expect(checkEligibility).not.toHaveBeenCalled()
  })

  it('resolves non-HTML, non-image files to "editor" without any IPC', async () => {
    await expect(resolvePanelKind('/proj/notes.md')).resolves.toBe('editor')
    await expect(resolvePanelKind('/proj/script.ts')).resolves.toBe('editor')
    expect(checkEligibility).not.toHaveBeenCalled()
  })

  it('resolves an eligible .html file to "preview"', async () => {
    checkEligibility.mockResolvedValue({ eligible: true })

    await expect(resolvePanelKind('/proj/page.html')).resolves.toBe('preview')
    expect(checkEligibility).toHaveBeenCalledWith('/proj/page.html')
  })

  it('resolves an eligible .htm file to "preview"', async () => {
    checkEligibility.mockResolvedValue({ eligible: true })

    await expect(resolvePanelKind('/proj/index.HTM')).resolves.toBe('preview')
  })

  it('resolves an ineligible .html file to "editor"', async () => {
    checkEligibility.mockResolvedValue({ eligible: false, reason: 'gitignored' })

    await expect(resolvePanelKind('/proj/ignored.html')).resolves.toBe('editor')
  })

  it('degrades to "editor" when the eligibility check throws', async () => {
    checkEligibility.mockRejectedValue(new Error('IPC down'))

    await expect(resolvePanelKind('/proj/page.html')).resolves.toBe('editor')
  })

  describe('double-click safety (in-flight map)', () => {
    it('collapses two concurrent calls for the same path into ONE resolution', async () => {
      // A deferred eligibility check so both clicks are in flight at once.
      let settle: (v: { eligible: boolean }) => void = () => {}
      checkEligibility.mockReturnValue(
        new Promise<{ eligible: boolean }>((resolve) => {
          settle = resolve
        })
      )

      const first = resolvePanelKind('/proj/page.html')
      const second = resolvePanelKind('/proj/page.html')

      // Same in-flight promise handed to both callers.
      expect(first).toBe(second)

      settle({ eligible: true })

      expect(await first).toBe('preview')
      expect(await second).toBe('preview')
      // The round-trip fired exactly once despite the double click.
      expect(checkEligibility).toHaveBeenCalledTimes(1)
    })

    it('re-resolves once a prior resolution has settled', async () => {
      checkEligibility.mockResolvedValue({ eligible: true })

      await resolvePanelKind('/proj/page.html')
      await resolvePanelKind('/proj/page.html')

      // Map entry cleared on settle, so a later click asks again.
      expect(checkEligibility).toHaveBeenCalledTimes(2)
    })
  })
})
