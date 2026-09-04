// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link ImageViewerBanner}.
 *
 * @module ImageViewerBanner.test
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ImageViewerBanner } from './ImageViewerBanner'
import { TEST_IDS } from '../../../../constants/testids'
import { VIEWER_BANNER_COPY } from '../imageViewerStatus.logic'

describe('ImageViewerBanner', () => {
  it('announces the deleted state with the agreed copy', () => {
    render(<ImageViewerBanner variant="deleted" onReload={vi.fn()} />)

    const banner = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveAttribute('data-variant', 'deleted')
    expect(banner).toHaveTextContent(VIEWER_BANNER_COPY.deleted)
  })

  it('states the cause and the remedy in VISIBLE text for the watcher cap', () => {
    render(
      <ImageViewerBanner variant="unavailable" unavailableReason="limit" onReload={vi.fn()} />
    )

    // QG-11a H3: this used to be an aria-label on the toolbar's status span, so
    // a sighted user pressed Reload against a cap that was still full and could
    // never learn that closing tabs is the fix.
    const banner = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
    expect(banner).toHaveAttribute('data-variant', 'unavailable')
    expect(banner).toHaveTextContent(VIEWER_BANNER_COPY.unavailableLimit)
    expect(banner).toHaveTextContent('100')
    expect(banner).toHaveTextContent('Close some tabs')
  })

  it('uses the watcher-fault wording when the cap is not to blame', () => {
    render(
      <ImageViewerBanner
        variant="unavailable"
        unavailableReason="watcher-error"
        onReload={vi.fn()}
      />
    )

    const banner = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
    expect(banner).toHaveTextContent(VIEWER_BANNER_COPY.unavailableWatcherError)
    expect(banner).not.toHaveTextContent('Close some tabs')
  })

  it('reports a failed re-read with its own copy', () => {
    render(<ImageViewerBanner variant="stale" onReload={vi.fn()} />)

    const banner = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)
    expect(banner).toHaveAttribute('data-variant', 'stale')
    expect(banner).toHaveTextContent(VIEWER_BANNER_COPY.stale)
  })

  it('offers one Reload action for both variants', () => {
    const onReload = vi.fn()
    render(<ImageViewerBanner variant="deleted" onReload={onReload} />)

    const button = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)
    expect(button).toHaveTextContent('Reload')
    expect(button).toHaveAccessibleName('Reload image from disk')

    fireEvent.click(button)
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('does not steal focus', () => {
    render(<ImageViewerBanner variant="deleted" onReload={vi.fn()} />)

    // A passive notification must not interrupt keyboard panning.
    expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)).not.toHaveFocus()
  })

  it('disables Reload while an attempt is in flight', () => {
    const onReload = vi.fn()
    render(<ImageViewerBanner variant="deleted" onReload={onReload} isReloadPending />)

    const button = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)
    expect(button).toBeDisabled()

    fireEvent.click(button)
    expect(onReload).not.toHaveBeenCalled()
  })
})
