// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * {@link ImageViewerPanel} – an image tab in the deleted state shows the file
 * again, on its own, once it is back on disk (issue #450).
 *
 * `useFileChangeSubscription.recovery.test.ts` stops at "the hook reported a
 * change"; this suite follows that through the panel: the image is read again
 * and the new bytes are what the `<img>` shows.
 *
 * Split from `ImageViewerPanel.deleted.test.tsx` (docs/windows/contributing.md
 * "Test-file split policy"): this suite runs the probe on fake timers.
 *
 * @module ImageViewerPanel.recover.test
 */

import { act, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DELETED_FILE_PROBE_INTERVAL_MS } from '../../../../../shared/deletedFileProbe'
import { TEST_IDS } from '../../../constants/testids'
import { installImageViewerHarness, DEFAULT_IMAGE_PATH } from './__test__/testUtils'

const h = installImageViewerHarness()

/** Lets `ms` of fake time pass and everything it started settle. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const image = (): HTMLElement => screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)
const deletedBanner = (): HTMLElement | null => screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)

/** Loaded, then deleted for real: the banner is up and the old image stays on screen. */
async function renderDeleted(): Promise<void> {
  await h.renderAndSettle(DEFAULT_IMAGE_PATH)
  vi.useFakeTimers()
  h.getStats.mockRejectedValue(new Error('ENOENT'))
  act(() => h.emitDeleted(DEFAULT_IMAGE_PATH))
  await advance(0)
  expect(deletedBanner()).toBeInTheDocument()
  expect(image()).toHaveAttribute('src', 'data:image/png;base64,AAAA')
  h.readImage.mockClear()
}

describe('ImageViewerPanel – a deleted image that comes back (#450)', () => {
  it('reads the image again and shows the returned bytes, without the banner', async () => {
    await renderDeleted()

    h.getStats.mockResolvedValue({ size: 4096 })
    h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
    await advance(DELETED_FILE_PROBE_INTERVAL_MS)
    await advance(0)

    expect(h.readImage).toHaveBeenCalledWith(expect.objectContaining({ filePath: DEFAULT_IMAGE_PATH }))
    expect(image()).toHaveAttribute('src', 'data:image/png;base64,BBBB')
    expect(deletedBanner()).not.toBeInTheDocument()
  })

  it('keeps the banner and the last image, and reads nothing, while the file stays gone', async () => {
    await renderDeleted()

    await advance(DELETED_FILE_PROBE_INTERVAL_MS * 3)

    expect(h.readImage).not.toHaveBeenCalled()
    expect(deletedBanner()).toBeInTheDocument()
    expect(image()).toHaveAttribute('src', 'data:image/png;base64,AAAA')
  })
})
