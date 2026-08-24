// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link ImageViewerToolbar}.
 *
 * @module ImageViewerToolbar.test
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ImageViewerToolbar, type ImageViewerToolbarProps } from './ImageViewerToolbar'
import { TEST_IDS } from '../../../../constants/testids'
import { VIEWER_STATUS_COPY } from '../imageViewerStatus.logic'

/** Builds toolbar props with sensible defaults so each test states only what it cares about. */
function makeProps(overrides: Partial<ImageViewerToolbarProps> = {}): ImageViewerToolbarProps {
  return {
    imageSize: { width: 800, height: 600 },
    fileSize: 2048,
    format: 'PNG',
    updatedAt: new Date(2026, 0, 1, 14, 32, 5).getTime(),
    status: 'idle',
    scale: 1,
    canZoomIn: true,
    canZoomOut: true,
    isFullScreen: false,
    isExportingPng: false,
    isExportingPdf: false,
    isCopying: false,
    onExportPng: vi.fn(),
    onExportPdf: vi.fn(),
    onCopyImage: vi.fn(),
    onBusyClick: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    onFit: vi.fn(),
    onEnterFullScreen: vi.fn(),
    onExitFullScreen: vi.fn(),
    ...overrides
  }
}

describe('ImageViewerToolbar', () => {
  describe('Status slot', () => {
    it('is mounted with role="status" even when idle', () => {
      render(<ImageViewerToolbar {...makeProps({ status: 'idle' })} />)

      // A live region added to the DOM at the same moment its text appears is
      // never announced, so the slot must exist before there is news.
      const slot = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)
      expect(slot).toHaveAttribute('role', 'status')
      expect(slot).toHaveAttribute('aria-live', 'polite')
      expect(slot).toHaveAttribute('data-state', 'idle')
      expect(slot).toHaveTextContent('')
    })

    it('shows the transient reload confirmation', () => {
      render(<ImageViewerToolbar {...makeProps({ status: 'reloading' })} />)

      const slot = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)
      expect(slot).toHaveAttribute('data-state', 'reloading')
      expect(slot).toHaveTextContent(VIEWER_STATUS_COPY.reloading)
    })

    it('announces exactly its visible text, with no author-supplied name', () => {
      render(<ImageViewerToolbar {...makeProps({ status: 'unavailable' })} />)

      // QG-11a H3: an aria-label on an aria-atomic live region can replace what
      // is announced, and it hid the cause from every sighted user. The cause
      // and remedy are visible text in the banner instead.
      const slot = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)
      expect(slot).toHaveTextContent(VIEWER_STATUS_COPY.unavailable)
      expect(slot).not.toHaveAttribute('aria-label')
      expect(slot).not.toHaveAttribute('title')
      // A live region announces its CONTENTS; with no author-supplied name
      // there is nothing that can shadow them.
      expect(slot.textContent).toBe(VIEWER_STATUS_COPY.unavailable)
    })

    it('reports a failed re-read and a failed Reload', () => {
      const { rerender } = render(<ImageViewerToolbar {...makeProps({ status: 'stale' })} />)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveTextContent(
        VIEWER_STATUS_COPY.stale
      )

      rerender(<ImageViewerToolbar {...makeProps({ status: 'reload-failed-missing' })} />)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveTextContent(
        VIEWER_STATUS_COPY.reloadFailedMissing
      )

      rerender(<ImageViewerToolbar {...makeProps({ status: 'reload-failed-watch' })} />)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).toHaveTextContent(
        VIEWER_STATUS_COPY.reloadFailedWatch
      )
    })

    it('shows the status text in the overlay instance without a second live region', () => {
      // The full-screen toolbar used to render an empty aria-hidden spacer, so
      // a full-screen user got no refresh feedback at all (QG-11a).
      render(
        <ImageViewerToolbar
          {...makeProps({ status: 'reloading', showStatus: false, isFullScreen: true })}
        />
      )

      expect(screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_STATUS)).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByText(VIEWER_STATUS_COPY.reloading)).toHaveAttribute(
        'aria-hidden',
        'true'
      )
    })
  })

  describe('Metadata', () => {
    it('shows dimensions, size, format and the update stamp', () => {
      render(<ImageViewerToolbar {...makeProps()} />)

      expect(screen.getByText('800 x 600')).toBeInTheDocument()
      expect(screen.getByText('2.0 KB')).toBeInTheDocument()
      expect(screen.getByText('PNG')).toBeInTheDocument()
      expect(screen.getByText('Updated 14:32:05')).toBeInTheDocument()
    })

    it('omits dimensions before the first decode', () => {
      render(<ImageViewerToolbar {...makeProps({ imageSize: null })} />)

      expect(screen.queryByText('800 x 600')).not.toBeInTheDocument()
    })

    it('omits the size and the stamp when there is nothing to report', () => {
      render(<ImageViewerToolbar {...makeProps({ fileSize: 0, updatedAt: 0 })} />)

      expect(screen.queryByText('2.0 KB')).not.toBeInTheDocument()
      expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument()
    })
  })

  describe('Controls', () => {
    it('wires the zoom actions', () => {
      const props = makeProps()
      render(<ImageViewerToolbar {...props} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN))
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_OUT))
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL))
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FIT))

      expect(props.onZoomIn).toHaveBeenCalledTimes(1)
      expect(props.onZoomOut).toHaveBeenCalledTimes(1)
      expect(props.onReset).toHaveBeenCalledTimes(1)
      expect(props.onFit).toHaveBeenCalledTimes(1)
    })

    it('disables the zoom buttons at the limits', () => {
      render(<ImageViewerToolbar {...makeProps({ canZoomIn: false, canZoomOut: false })} />)

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN)).toBeDisabled()
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_OUT)).toBeDisabled()
    })

    it('shows Enter full screen in the panel and Exit inside the overlay', () => {
      const props = makeProps()
      const { rerender } = render(<ImageViewerToolbar {...props} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN))
      expect(props.onEnterFullScreen).toHaveBeenCalledTimes(1)

      rerender(<ImageViewerToolbar {...props} isFullScreen />)
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_CLOSE))
      expect(props.onExitFullScreen).toHaveBeenCalledTimes(1)
    })

    it('reports the current zoom level in the accessible name', () => {
      render(<ImageViewerToolbar {...makeProps({ scale: 3 })} />)

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL)).toHaveAccessibleName(
        'Zoom level 300%, click to reset'
      )
    })
  })
  describe('Export controls (issue #73)', () => {
    it('renders all three export controls', () => {
      render(<ImageViewerToolbar {...makeProps()} />)

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PDF)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY)).toBeInTheDocument()
    })

    it('renders them in the full-screen instance too', () => {
      // Requirement 14: the overlay covers the panel, so an export group only
      // the panel carried would be unreachable exactly where a user is most
      // likely to want it.
      render(<ImageViewerToolbar {...makeProps({ isFullScreen: true })} />)

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY)).toBeInTheDocument()
    })

    it('places the export group between the zoom cluster and the actions group', () => {
      render(<ImageViewerToolbar {...makeProps()} />)

      const order = [
        TEST_IDS.IMAGE_VIEWER_BTN_FIT,
        TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG,
        TEST_IDS.IMAGE_VIEWER_BTN_COPY,
        TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN
      ].map((id) => screen.getByTestId(id))

      // DOM order is tab order: how I look at it, what I take away, where I
      // look at it - with the corner left as the full-screen affordance.
      for (let i = 0; i < order.length - 1; i += 1) {
        expect(
          order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy()
      }
    })

    it('passes the busy state straight through, holding none of its own', () => {
      const { rerender } = render(<ImageViewerToolbar {...makeProps()} />)
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG)).toHaveAttribute(
        'aria-disabled',
        'false'
      )

      rerender(<ImageViewerToolbar {...makeProps({ isExportingPng: true })} />)

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG)).toHaveAttribute(
        'aria-busy',
        'true'
      )
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY)).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })

    it('forwards a click to the handler the panel supplied', () => {
      const props = makeProps()
      render(<ImageViewerToolbar {...props} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PDF))

      expect(props.onExportPdf).toHaveBeenCalledTimes(1)
    })
  })
})
