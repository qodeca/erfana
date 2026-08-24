// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Characterization tests for {@link ImageViewerPanel}.
 *
 * Written **before** the issue #70 refactor against the original 901-line
 * component, which had zero component tests. Everything in the
 * `Characterization` describe block documents behaviour that must survive the
 * move into `ImageViewerPanel/` unchanged – do not "fix" an assertion here to
 * make a refactor pass; the assertion is the contract.
 *
 * The `Zoom across full screen (H-2)` block pins the shared-`imageRef` defect:
 * `renderImageContent` passed one ref to two `<img>` elements (panel +
 * full-screen portal), so after a full-screen round trip the panel image never
 * re-attached the ref and `handleImageLoad` early-returned forever. It was
 * written as `it.fails` against the pre-refactor component and flipped to a
 * passing `it` by the decode-first refresh.
 *
 * Live-refresh behaviour lives in the sibling `.refresh`, `.status` and
 * `.deleted` suites; the shared harness lives in `__test__/testUtils.tsx`.
 *
 * @module ImageViewerPanel.test
 * @see temp/design-70.md § 6 commit 1
 */

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { ImageViewerPanel } from './ImageViewerPanel'
import { TEST_IDS } from '../../../constants/testids'
import { VIEWER_STATUS_COPY } from './imageViewerStatus.logic'
import { alertsExcludingExportRegion, installImageViewerHarness } from './__test__/testUtils'

const h = installImageViewerHarness()

// =========================================================================
// Characterization
// =========================================================================

describe('ImageViewerPanel – characterization', () => {
  describe('Load states', () => {
    it('shows the loading state before the data URL arrives', () => {
      let resolveRead: (value: string) => void = () => {}
      h.readBytes.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveRead = resolve
        })
      )

      render(<ImageViewerPanel {...h.makeProps('/proj/icon.png')} />)

      expect(screen.getByText('Loading image...')).toBeInTheDocument()
      resolveRead('data:image/png;base64,AAAA')
    })

    it('renders the image once the data URL resolves', async () => {
      await h.renderAndSettle()

      const img = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)
      expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA')
      expect(img).toHaveAttribute('alt', 'Preview of icon.png')
    })

    it('shows the error state when the read fails', async () => {
      h.readBytes.mockRejectedValue(new Error('File too large'))

      render(<ImageViewerPanel {...h.makeProps('/proj/icon.png')} />)

      expect(await screen.findByRole('alert')).toHaveTextContent('File too large')
    })

    it('shows the error state when no file path is supplied', async () => {
      render(<ImageViewerPanel {...h.makeProps('')} />)

      expect(await screen.findByRole('alert')).toHaveTextContent('No file path provided')
    })

    it('offers a Reload action on the error screen (QG-11a H1)', async () => {
      // A first load that lost a race with an agent's half-written file used to
      // latch: no toolbar, no status slot, no button - only close and reopen,
      // which is the workaround issue #70 exists to delete.
      h.readBytes.mockRejectedValueOnce(new Error('truncated'))

      render(<ImageViewerPanel {...h.makeProps('/proj/icon.png')} />)
      await screen.findByRole('alert')

      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD))

      const image = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)
      expect(image).toHaveAttribute('src', 'data:image/png;base64,BBBB')
      // The export live regions are always mounted and empty (issue #73), so
      // the error screen is what has to be gone, not every `role="alert"`.
      expect(alertsExcludingExportRegion()).toHaveLength(0)
    })

    it('reports a Reload that fails on the error screen (QG-11a H4)', async () => {
      // The error screen renders no toolbar, so the status slot cannot carry
      // the verdict here - and a silent button is the whole finding.
      h.readBytes.mockRejectedValue(new Error('truncated'))
      h.getStats.mockRejectedValue(new Error('ENOENT'))

      render(<ImageViewerPanel {...h.makeProps('/proj/icon.png')} />)
      const alert = await screen.findByRole('alert')

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD))

      await waitFor(() => expect(alert).toHaveTextContent(VIEWER_STATUS_COPY.reloadFailedMissing))
    })

    it('recovers from a failed first load on the next watcher event', async () => {
      // Same defect from the other side: the error was cleared only by an
      // `initial` load, so a successful refresh committed the bytes behind an
      // error screen the user could not dismiss.
      h.readBytes.mockRejectedValueOnce(new Error('truncated'))

      render(<ImageViewerPanel {...h.makeProps('/proj/icon.png')} />)
      await screen.findByRole('alert')

      h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
      h.emitChanged('/proj/icon.png')

      const image = await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)
      expect(image).toHaveAttribute('src', 'data:image/png;base64,BBBB')
    })

    it('treats a failed getStats as non-fatal', async () => {
      h.getStats.mockRejectedValue(new Error('EACCES'))

      await h.renderAndSettle()

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toBeInTheDocument()
    })
  })

  describe('Toolbar', () => {
    it('exposes the controls toolbar with an accessible name', async () => {
      await h.renderAndSettle()

      const toolbar = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_TOOLBAR)
      expect(toolbar).toHaveAttribute('role', 'toolbar')
      expect(toolbar).toHaveAccessibleName('Image viewer controls')
    })

    it('shows the file format, size and intrinsic dimensions', async () => {
      await h.renderAndSettle('/proj/icon.png')
      fireEvent.load(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE))

      expect(await screen.findByText('800 x 600')).toBeInTheDocument()
      expect(screen.getByText('2.0 KB')).toBeInTheDocument()
      expect(screen.getByText('PNG')).toBeInTheDocument()
    })

    it('starts at 100% zoom', async () => {
      await h.renderAndSettle()

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('100%')
    })
  })

  describe('Zoom controls', () => {
    it('steps up through the discrete zoom levels', async () => {
      await h.renderAndSettle()
      const zoomIn = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN)

      fireEvent.click(zoomIn)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('125%')

      fireEvent.click(zoomIn)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('150%')
    })

    it('steps down through the discrete zoom levels', async () => {
      await h.renderAndSettle()

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_OUT))
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('75%')
    })

    it('resets to 100% when the zoom level button is clicked', async () => {
      await h.renderAndSettle()
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN))

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL))

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('100%')
    })

    it('applies the fit scale when Fit to view is pressed', async () => {
      // 2400x1800 in a 1000x800 box (40px padding) fits at ~0.383.
      h.setNaturalSize(2400, 1800)
      await h.renderAndSettle()
      fireEvent.load(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE))

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FIT))

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('38%')
      })
    })

    it('writes the zoom into the image transform style', async () => {
      await h.renderAndSettle()

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN))

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveStyle({
        transform: 'translate(0px, 0px) scale(1.25)'
      })
    })
  })

  describe('Full screen', () => {
    it('opens the portal overlay and renders a second image', async () => {
      await h.renderAndSettle()

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN))

      const overlay = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_FULLSCREEN)
      expect(overlay).toHaveAttribute('role', 'dialog')
      expect(overlay).toHaveAttribute('aria-modal', 'true')
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_FULLSCREEN_CONTENT)).toBeInTheDocument()
      expect(screen.getAllByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveLength(2)
    })

    it('closes the overlay again', async () => {
      await h.renderAndSettle()
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN))

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_CLOSE))

      expect(screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_FULLSCREEN)).not.toBeInTheDocument()
      expect(screen.getAllByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveLength(1)
    })

    it('refuses to open when portal-root is missing', async () => {
      await h.renderAndSettle()
      document.getElementById('portal-root')?.remove()

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN))

      expect(screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_FULLSCREEN)).not.toBeInTheDocument()
    })
  })

  describe('Keyboard shortcuts', () => {
    it('zooms in on "+" while the panel holds focus', async () => {
      await h.renderAndSettle()
      screen.getByTestId(TEST_IDS.IMAGE_VIEWER_PANEL).focus()

      fireEvent.keyDown(document, { key: '+' })

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('125%')
    })

    it('ignores shortcuts while focus sits outside the panel', async () => {
      await h.renderAndSettle()
      document.body.focus()

      fireEvent.keyDown(document, { key: '+' })

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('100%')
    })
  })
})

// =========================================================================
// H-2: the shared-ref defect
// =========================================================================

describe('ImageViewerPanel – zoom across full screen (H-2)', () => {
  /**
   * The panel and the full-screen portal shared one `imageRef`. The portal
   * `<img>` won it; on exit React nulled it and the still-mounted panel `<img>`
   * never re-attached, so every later decode early-returned and the toolbar
   * dimensions froze at the pre-full-screen value.
   *
   * The fix (decode-first refresh in `useImageSource`) removes the ref
   * entirely, so this becomes a passing `it`.
   */
  it('keeps the toolbar dimensions current after a full-screen round trip', async () => {
    await h.renderAndSettle('/proj/icon.png')
    fireEvent.load(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE))
    await screen.findByText('800 x 600')

    // Zoom to 300%: 100 -> 125 -> 150 -> 200 -> 300.
    const zoomIn = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN)
    for (let i = 0; i < 4; i += 1) fireEvent.click(zoomIn)
    expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveTextContent('300%')

    // Round trip through full screen: the portal image steals the ref.
    fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN))
    await screen.findByTestId(TEST_IDS.IMAGE_VIEWER_FULLSCREEN)
    fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_CLOSE))

    // The file is rewritten on disk at a different intrinsic size.
    h.setNaturalSize(400, 300)
    h.readBytes.mockResolvedValue('data:image/png;base64,BBBB')
    h.emitChanged('/proj/icon.png')

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE)).toHaveAttribute(
        'src',
        'data:image/png;base64,BBBB'
      )
    })
    fireEvent.load(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_IMAGE))

    expect(await screen.findByText('400 x 300')).toBeInTheDocument()
  })
})
