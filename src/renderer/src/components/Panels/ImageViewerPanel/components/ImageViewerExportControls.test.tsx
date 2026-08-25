// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link ImageViewerExportControls}.
 *
 * The finding these exist to prevent: a busy control implemented with the
 * `disabled` attribute. Chromium blurs a disabled control the moment it is
 * disabled, and the native save dialog then hands focus back to an element that
 * will not take it - so every export drops a keyboard user on `<body>`.
 *
 * @module ImageViewerExportControls.test
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import {
  ImageViewerExportControls,
  type ImageViewerExportControlsProps
} from './ImageViewerExportControls'
import { TEST_IDS } from '../../../../constants/testids'
import { IMAGE_EXPORT_COPY } from '../imageViewerStatus.logic'

/** Props with everything idle, so each test states only what it varies. */
function makeProps(
  overrides: Partial<ImageViewerExportControlsProps> = {}
): ImageViewerExportControlsProps {
  return {
    isExportingPng: false,
    isExportingPdf: false,
    isCopying: false,
    onExportPng: vi.fn(),
    onExportPdf: vi.fn(),
    onCopyImage: vi.fn(),
    onBusyClick: vi.fn(),
    ...overrides
  }
}

const BUTTONS = [
  { testId: TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG, copy: IMAGE_EXPORT_COPY.png },
  { testId: TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PDF, copy: IMAGE_EXPORT_COPY.pdf },
  { testId: TEST_IDS.IMAGE_VIEWER_BTN_COPY, copy: IMAGE_EXPORT_COPY.clipboard }
] as const

describe('ImageViewerExportControls', () => {
  describe('Rendering', () => {
    it('renders all three controls with their copy', () => {
      render(<ImageViewerExportControls {...makeProps()} />)

      for (const { testId, copy } of BUTTONS) {
        const button = screen.getByTestId(testId)
        expect(button).toHaveAttribute('title', copy.tooltip)
        expect(button).toHaveAttribute('aria-label', copy.ariaLabel)
      }
    })

    it('renders three controls in a plain container, like its sibling clusters', () => {
      render(<ImageViewerExportControls {...makeProps()} />)

      expect(screen.getAllByRole('button')).toHaveLength(3)
      // No `role="group"`: unnamed, it announces nothing, and `.toolbarControls`
      // and `.toolbarActions` beside it are plain divs.
      expect(screen.queryByRole('group')).not.toBeInTheDocument()
    })
  })

  describe('Activation', () => {
    it('calls the matching handler for each control', () => {
      const props = makeProps()
      render(<ImageViewerExportControls {...props} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG))
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PDF))
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY))

      expect(props.onExportPng).toHaveBeenCalledTimes(1)
      expect(props.onExportPdf).toHaveBeenCalledTimes(1)
      expect(props.onCopyImage).toHaveBeenCalledTimes(1)
    })

    it('ignores clicks on ANY control while one export is running', () => {
      const props = makeProps({ isExportingPng: true })
      render(<ImageViewerExportControls {...props} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG))
      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY))

      // `aria-disabled` does not stop a click by itself, so the guard has to be
      // real - otherwise the attribute would be a lie.
      expect(props.onExportPng).not.toHaveBeenCalled()
      expect(props.onCopyImage).not.toHaveBeenCalled()
    })

    it('reports a swallowed click instead of dropping it silently', () => {
      const props = makeProps({ isExportingPng: true })
      render(<ImageViewerExportControls {...props} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PDF))

      // Nothing about these buttons changes while another export runs - same
      // glyph, same colour, no dimming - so a refused click that also announces
      // nothing is indistinguishable from a click the app lost.
      expect(props.onBusyClick).toHaveBeenCalledTimes(1)
      expect(props.onExportPdf).not.toHaveBeenCalled()
    })

    it('leaves the busy path alone when nothing is running', () => {
      const props = makeProps()
      render(<ImageViewerExportControls {...props} />)

      fireEvent.click(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY))

      expect(props.onCopyImage).toHaveBeenCalledTimes(1)
      expect(props.onBusyClick).not.toHaveBeenCalled()
    })
  })

  describe('Busy state', () => {
    it('never uses the `disabled` attribute', () => {
      render(<ImageViewerExportControls {...makeProps({ isCopying: true })} />)

      for (const { testId } of BUTTONS) {
        const button = screen.getByTestId(testId)
        expect(button).not.toBeDisabled()
        expect(button).not.toHaveAttribute('disabled')
      }
    })

    it('marks all three controls busy, matching the single main-side lock', () => {
      render(<ImageViewerExportControls {...makeProps({ isExportingPdf: true })} />)

      for (const { testId } of BUTTONS) {
        expect(screen.getByTestId(testId)).toHaveAttribute('aria-disabled', 'true')
      }
    })

    it('marks only the invoked control as the one doing the work', () => {
      render(<ImageViewerExportControls {...makeProps({ isExportingPdf: true })} />)

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PDF)).toHaveAttribute(
        'aria-busy',
        'true'
      )
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG)).toHaveAttribute(
        'aria-busy',
        'false'
      )
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY)).toHaveAttribute(
        'aria-busy',
        'false'
      )
    })

    it('switches the running control to its busy accessible name AND tooltip', () => {
      render(<ImageViewerExportControls {...makeProps({ isCopying: true })} />)

      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY)).toHaveAttribute(
        'aria-label',
        IMAGE_EXPORT_COPY.clipboard.ariaLabelBusy
      )
      // The tooltip follows: left on the idle copy it promises a hovering mouse
      // user an action the click guard will refuse.
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_COPY)).toHaveAttribute(
        'title',
        IMAGE_EXPORT_COPY.clipboard.ariaLabelBusy
      )
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG)).toHaveAttribute(
        'title',
        IMAGE_EXPORT_COPY.png.tooltip
      )
      // The other two are unavailable, not working: their names do not change.
      expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_EXPORT_PNG)).toHaveAttribute(
        'aria-label',
        IMAGE_EXPORT_COPY.png.ariaLabel
      )
    })

    it('is idle-clean when nothing is running', () => {
      render(<ImageViewerExportControls {...makeProps()} />)

      for (const { testId } of BUTTONS) {
        const button = screen.getByTestId(testId)
        expect(button).toHaveAttribute('aria-disabled', 'false')
        expect(button).toHaveAttribute('aria-busy', 'false')
      }
    })
  })
})
