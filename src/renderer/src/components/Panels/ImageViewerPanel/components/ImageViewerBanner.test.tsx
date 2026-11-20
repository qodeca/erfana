// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link ImageViewerBanner}: the tab's freshness notice in the
 * viewer's slot (#478 § 3.6), or the viewer's own stale-bytes state.
 *
 * @module ImageViewerBanner.test
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ImageViewerBanner } from './ImageViewerBanner'
import { TEST_IDS } from '../../../../constants/testids'
import { VIEWER_BANNER_COPY, VIEWER_RELOAD_BUTTON_COPY } from '../imageViewerStatus.logic'
import {
  FRESHNESS_NOTICE_TEST_IDS,
  NOTICE_BUTTON_COPY,
  selectNotice
} from '../../../FileConflictNotification/freshnessNoticeCopy'
import type { FreshnessState } from '../../../../../../shared/freshness/freshnessTypes'

const ACTIVE = { kind: 'active', live: 'full' } as const

function notice(state: FreshnessState) {
  return selectNotice({ state, fileName: 'icon.png', tab: 'image' })
}

const banner = (): HTMLElement => screen.getByTestId(TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)

describe('ImageViewerBanner', () => {
  it('shows the deleted notice with Close tab only (no Restore – a viewer has nothing to save)', () => {
    const onClose = vi.fn()
    const model = notice({ watch: ACTIVE, content: { kind: 'deleted' } })
    render(<ImageViewerBanner variant="notice" notice={model} onReload={vi.fn()} onClose={onClose} />)

    expect(banner()).toHaveAttribute('data-variant', 'deleted')
    expect(banner()).toHaveTextContent(model?.message ?? '')
    expect(screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)).toBeNull()
    expect(screen.queryByTestId(FRESHNESS_NOTICE_TEST_IDS.restore)).toBeNull()

    fireEvent.click(screen.getByTestId(FRESHNESS_NOTICE_TEST_IDS.close))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('carries no live-region role: the panel status region announces (F13)', () => {
    render(
      <ImageViewerBanner
        variant="notice"
        notice={notice({ watch: ACTIVE, content: { kind: 'deleted' } })}
        onReload={vi.fn()}
      />
    )
    expect(banner()).not.toHaveAttribute('role')
  })

  it('states a stopped watch with a Reload that calls back', () => {
    const onReload = vi.fn()
    const model = notice({ watch: { kind: 'stopped', reason: 'restart-failed' }, content: { kind: 'fresh' } })
    render(<ImageViewerBanner variant="notice" notice={model} onReload={onReload} />)

    expect(banner()).toHaveAttribute('data-variant', 'unavailable')
    expect(banner()).toHaveTextContent(model?.message ?? '')
    const reload = screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)
    expect(reload).toHaveAccessibleName(VIEWER_RELOAD_BUTTON_COPY.ariaLabel)
    fireEvent.click(reload)
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('shows the watch-limit notice for a queued tab, without Reload (G9)', () => {
    const model = notice({ watch: { kind: 'queued' }, content: { kind: 'fresh' } })
    render(<ImageViewerBanner variant="notice" notice={model} onReload={vi.fn()} />)

    expect(banner()).toHaveTextContent('Too many files are open to follow this one live.')
    expect(screen.queryByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)).toBeNull()
  })

  it('gives the limited notice the neutral treatment and a Dismiss', () => {
    const onDismissLimited = vi.fn()
    const model = notice({ watch: { kind: 'active', live: 'limited' }, content: { kind: 'fresh' } })
    render(
      <ImageViewerBanner variant="notice" notice={model} onReload={vi.fn()} onDismissLimited={onDismissLimited} />
    )

    expect(banner()).toHaveAttribute('data-variant', 'info')
    fireEvent.click(screen.getByRole('button', { name: NOTICE_BUTTON_COPY.dismiss }))
    expect(onDismissLimited).toHaveBeenCalledTimes(1)
  })

  it('shows the stale state with its own copy and a Reload', () => {
    render(<ImageViewerBanner variant="stale" onReload={vi.fn()} />)

    expect(banner()).toHaveAttribute('data-variant', 'stale')
    expect(banner()).toHaveTextContent(VIEWER_BANNER_COPY.stale)
    expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)).toBeInTheDocument()
  })

  it('disables Reload while a reload is pending', () => {
    render(<ImageViewerBanner variant="stale" onReload={vi.fn()} isReloadPending />)
    expect(screen.getByTestId(TEST_IDS.IMAGE_VIEWER_BTN_RELOAD)).toBeDisabled()
  })
})
