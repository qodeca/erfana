// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Live-refresh tests for {@link ImageViewerPanel} (issue #70).
 *
 * Covers the watch lifecycle, the decode-first refresh itself, the conditional
 * reset-to-fit rule (AC4) and the hidden-tab deferral (M-5). Status-slot and
 * deleted-banner behaviour live in the sibling `.status` and `.deleted` suites.
 *
 * @module ImageViewerPanel.refresh.test
 * @see temp/design-70.md § 2
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

import { ImageViewerPanel } from './ImageViewerPanel'
import { TEST_IDS } from '../../../constants/testids'
import { VIEWER_BANNER_COPY } from './imageViewerStatus.logic'
import { installImageViewerHarness } from './__test__/testUtils'

const h = installImageViewerHarness()

describe('ImageViewerPanel – live refresh', () => {
  describe('Watch lifecycle', () => {
    it('starts a watch on mount and stops it on unmount', async () => {
      const { unmount } = await h.renderAndSettle('/proj/icon.png')
      expect(h.fileWatch.start).toHaveBeenCalledWith('/proj/icon.png')

      unmount()

      // Queued behind the start, so it settles a tick later.
      await waitFor(() => expect(h.fileWatch.stop).toHaveBeenCalledWith('/proj/icon.png'))
      // One start, one stop: no residual subscriber count main-side.
      expect(h.fileWatch.stop).toHaveBeenCalledTimes(h.fileWatch.start.mock.calls.length)
    })

    it('never pauses or resumes the watch', async () => {
      await h.renderAndSettle('/proj/icon.png')
      h.emitChanged('/proj/icon.png')
      await waitFor(() => expect(h.readBytes).toHaveBeenCalledTimes(2))

      expect(h.fileWatch.pause).not.toHaveBeenCalled()
      expect(h.fileWatch.resume).not.toHaveBeenCalled()
    })

    it('ignores change events for other paths', async () => {
      await h.renderAndSettle('/proj/icon.png')

      h.emitChanged('/proj/other.png')

      expect(h.readBytes).toHaveBeenCalledTimes(1)
    })
  })

  describe('Refresh', () => {
    it('swaps the src and re-reads the file size', async () => {
      await h.renderAndSettle('/proj/icon.png')
      expect(await screen.findByText('2.0 KB')).toBeInTheDocument()

      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.getStats.mockResolvedValue({ size: 5120 })
      h.emitChanged('/proj/icon.png')

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
          'src',
          'data:image/png;base64,BBBB'
        )
      })
      expect(await screen.findByText('5.0 KB')).toBeInTheDocument()
    })

    it('never unmounts the image or blanks its src while refreshing', async () => {
      await h.renderAndSettle('/proj/icon.png')
      const before = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)

      const seen: (string | null)[] = []
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.attributeName === 'src') {
            seen.push((record.target as HTMLImageElement).getAttribute('src'))
          }
        }
      })
      observer.observe(before, { attributes: true, attributeFilter: ['src', 'style'] })

      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.emitChanged('/proj/icon.png')

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
          'src',
          'data:image/png;base64,BBBB'
        )
      })
      observer.disconnect()

      // Same element throughout, and no intermediate empty src.
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toBe(before)
      expect(seen).not.toContain('')
      expect(seen).not.toContain(null)
      expect(screen.queryByText('Loading image...')).not.toBeInTheDocument()
    })

    it('keeps the last good image when a refresh fails, and says it is behind disk', async () => {
      await h.renderAndSettle('/proj/icon.png')

      h.readBytes.mockRejectedValue(new Error('truncated'))
      h.emitChanged('/proj/icon.png')
      await waitFor(() => expect(h.readBytes).toHaveBeenCalledTimes(2))

      // The pixels are still the last good ones - the tab is never blanked.
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
        'src',
        'data:image/png;base64,AAAA'
      )

      // ...but it is NOT silent. A silent failed refresh reads as "the agent's
      // edit did nothing" (QG-11a H2).
      const banner = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      expect(banner).toHaveAttribute('data-variant', 'stale')
      expect(banner).toHaveTextContent(VIEWER_BANNER_COPY.stale)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)).toBeInTheDocument()
    })

    it('clears the stale banner as soon as a later refresh succeeds', async () => {
      await h.renderAndSettle('/proj/icon.png')

      h.readBytes.mockRejectedValue(new Error('truncated'))
      h.emitChanged('/proj/icon.png')
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)

      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.emitChanged('/proj/icon.png')

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
          'src',
          'data:image/png;base64,BBBB'
        )
      })
      expect(
        screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      ).not.toBeInTheDocument()
    })

    it('reads nothing and announces nothing when the file has not changed', async () => {
      // A watcher event does not prove the bytes moved: a touch, a same-content
      // rewrite or a second event for one save all land here. The main process
      // answers `unchanged`, which costs no base64 encode and no multi-MB IPC
      // payload - and must stay invisible, because "Reloaded from disk" for a
      // refresh that changed nothing is a lie (#70).
      await h.renderAndSettle('/proj/icon.png')
      expect(h.readBytes).toHaveBeenCalledTimes(1)

      h.serveUnchanged()
      h.emitChanged('/proj/icon.png')
      await waitFor(() => expect(h.readImage).toHaveBeenCalledTimes(2))

      // The read was answered without touching the file...
      expect(h.readBytes).toHaveBeenCalledTimes(1)
      // ...the same pixels stay on screen...
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
        'src',
        'data:image/png;base64,AAAA'
      )
      // ...and the status slot never claims a reload happened.
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveAttribute(
        'data-state',
        'idle'
      )
      expect(
        screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
      ).not.toBeInTheDocument()
    })

    it('still swaps the image on the first real change after a skip', async () => {
      // The skip must not latch: the version the viewer echoes back has to stay
      // the one it is actually displaying.
      await h.renderAndSettle('/proj/icon.png')

      h.serveUnchanged()
      h.emitChanged('/proj/icon.png')
      await waitFor(() => expect(h.readImage).toHaveBeenCalledTimes(2))

      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.serveChanged()
      h.emitChanged('/proj/icon.png')

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
          'src',
          'data:image/png;base64,BBBB'
        )
      })
      expect(h.readBytes).toHaveBeenCalledTimes(2)
    })

    it('produces exactly one read per change event (no refresh loop)', async () => {
      await h.renderAndSettle('/proj/icon.png')

      for (let i = 0; i < 10; i += 1) {
        h.readBytes.mockResolvedValue(`data:image/png;base64,X${i}`)
        h.emitChanged('/proj/icon.png')

        await waitFor(() => expect(h.readBytes).toHaveBeenCalledTimes(i + 2))
      }

      expect(h.readBytes).toHaveBeenCalledTimes(11)
    })
  })

  describe('View state (AC4)', () => {
    it('preserves zoom when the intrinsic dimensions are unchanged', async () => {
      await h.renderAndSettle('/proj/icon.png')

      const zoomIn = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN)
      for (let i = 0; i < 4; i += 1) fireEvent.click(zoomIn)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('300%')

      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.emitChanged('/proj/icon.png')

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
          'src',
          'data:image/png;base64,BBBB'
        )
      })
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('300%')
    })

    it('re-fits when the dimensions changed and the user was fitting', async () => {
      await h.renderAndSettle('/proj/icon.png')
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FIT))

      // 2400x1800 in a 1000x800 box fits at ~38 %.
      h.setNaturalSize(2400, 1800)
      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.emitChanged('/proj/icon.png')

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('38%')
      })
    })

    it('keeps a deliberate zoom when the dimensions changed', async () => {
      // QG-11a: an agent rewriting an SVG's width/height must not cost the user
      // the magnification they chose; the view is still made valid by
      // recentring the pan.
      await h.renderAndSettle('/proj/icon.png')

      const zoomIn = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN)
      for (let i = 0; i < 4; i += 1) fireEvent.click(zoomIn)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('300%')

      h.setNaturalSize(2400, 1800)
      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.emitChanged('/proj/icon.png')

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
          'src',
          'data:image/png;base64,BBBB'
        )
      })
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('300%')
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveStyle({
        transform: 'translate(0px, 0px) scale(3)'
      })
    })
  })

  describe('Commit ordering (UX-4)', () => {
    it('mutates src and style in one MutationObserver batch on a resizing refresh', async () => {
      await h.renderAndSettle('/proj/icon.png')
      const image = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)

      // Fit mode, so the refresh below re-fits. 800x600 in a 1000x800 box is
      // already fully visible, so the fit itself changes nothing - but the
      // refreshed 2400x1800 lands at ~38 %, and that difference is what makes a
      // missing style write visible.
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FIT))
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('100%')

      // One entry per observer callback. Attributes mutated inside the same
      // task arrive in a single batch, so "same batch" is the closest a unit
      // test can get to "the browser never painted in between".
      const batches: string[][] = []
      const observer = new MutationObserver((records) => {
        batches.push(records.map((record) => record.attributeName ?? ''))
      })
      observer.observe(image, { attributes: true, attributeFilter: ['src', 'style'] })

      // 2400x1800 in a 1000x800 box: the dimensions changed, so this refresh
      // resets to fit (~38 %) - the case that can flash the old zoom.
      h.setNaturalSize(2400, 1800)
      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.emitChanged('/proj/icon.png')

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('38%')
      })
      observer.disconnect()

      const srcBatch = batches.find((batch) => batch.includes('src'))
      expect(srcBatch).toBeDefined()
      // UX-4: the new bytes and their transform land together, or the user sees
      // one frame of the refreshed image at the previous zoom and pan.
      expect(srcBatch).toContain('style')
    })
  })

  describe('Visibility deferral (M-5)', () => {
    it('defers the re-read while hidden and runs it when the panel is shown', async () => {
      let emitVisibility: (event: { isVisible: boolean }) => void = () => {}
      const props = h.makeProps('/proj/icon.png')
      ;(props.api as unknown as { onDidVisibilityChange: unknown }).onDidVisibilityChange = vi.fn(
        (cb: (event: { isVisible: boolean }) => void) => {
          emitVisibility = cb
          return { dispose: vi.fn() }
        }
      )

      render(<ImageViewerPanel {...props} />)
      await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)

      act(() => emitVisibility({ isVisible: false }))

      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.emitChanged('/proj/icon.png')

      // Hidden: the watch fired, but the multi-MB pull did not.
      await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalled())
      expect(h.readBytes).toHaveBeenCalledTimes(1)

      act(() => emitVisibility({ isVisible: true }))

      await waitFor(() => expect(h.readBytes).toHaveBeenCalledTimes(2))
      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
          'src',
          'data:image/png;base64,BBBB'
        )
      })
    })
  })
})
