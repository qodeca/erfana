// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Integration tests for the image viewer: the real panel over the real hooks
 * and the real freshness tracker, with only `window.api` and the watch layer
 * faked (the shared harness).
 *
 * `ImageViewerPanel.test.tsx` covers behaviour case by case; this file walks the
 * whole loop the user sees – mount, watch, change, re-read, repaint, settle –
 * and asserts the wiring between the layers rather than any one layer.
 *
 * @module ImageViewerPanel.integration.test
 */

import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { ImageViewerPanel } from './ImageViewerPanel'
import { TEST_IDS } from '../../../constants/testids'
import { INDICATOR_DURATION_MS } from '../../../constants/fileWatch'
import { installImageViewerHarness } from './__test__/testUtils'

const PATH = '/proj/icon.png'

const h = installImageViewerHarness()

describe('ImageViewerPanel integration', () => {
  it('walks the whole refresh loop: watch, change, re-read, repaint, settle', async () => {
    render(<ImageViewerPanel {...h.makeProps(PATH)} />)
    await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)
    await waitFor(() =>
      expect(h.fileWatch.subscribe).toHaveBeenCalledWith(expect.objectContaining({ filePath: PATH }))
    )

    h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
    h.emitChanged(PATH)

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
        'src',
        'data:image/png;base64,BBBB'
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveAttribute('data-state', 'reloading')
    })

    await waitFor(
      () => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveAttribute('data-state', 'idle')
      },
      { timeout: INDICATOR_DURATION_MS + 1500 }
    )
  })

  it('performs exactly one read per change and never triggers itself', async () => {
    render(<ImageViewerPanel {...h.makeProps(PATH)} />)
    await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)
    await waitFor(() => expect(h.fileWatch.subscribe).toHaveBeenCalled())

    for (let i = 0; i < 10; i += 1) {
      h.readBytes.mockResolvedValue(`data:image/png;base64,X${i}`)
      h.emitChanged(PATH)

      // The tracker throttles reads (250 ms), so each change gets its own read
      await waitFor(() => expect(h.readBytes).toHaveBeenCalledTimes(i + 2), { timeout: 2_000 })
    }

    // 1 initial + 10 changes. A self-triggered read would push this higher.
    expect(h.readBytes).toHaveBeenCalledTimes(11)
  })

  it('tears the watch down on unmount', async () => {
    const { unmount } = render(<ImageViewerPanel {...h.makeProps(PATH)} />)
    await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)
    await waitFor(() => expect(h.fileWatch.subscribe).toHaveBeenCalledTimes(1))
    const [{ watchId }] = h.fileWatch.subscribe.mock.calls[0]

    unmount()

    await waitFor(() => expect(h.fileWatch.unsubscribe).toHaveBeenCalledWith(watchId))
  })
})
