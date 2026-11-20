// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the image viewer's pure status/copy helpers.
 *
 * @module imageViewerStatus.logic.test
 */

import { describe, it, expect } from 'vitest'

import {
  VIEWER_BANNER_COPY,
  VIEWER_RELOAD_BUTTON_COPY,
  VIEWER_STATUS_COPY,
  formatClockTime,
  formatUpdatedAccessibleName,
  formatUpdatedStamp,
  getBannerVariant,
  getStatusText,
  getStatusTone,
  getViewerStatus,
  type ViewerStatusInput
} from './imageViewerStatus.logic'

/** Nothing is wrong: the base every case below varies one field of. */
const IDLE: ViewerStatusInput = {
  isWatchUnavailable: false,
  isStale: false,
  isReloading: false,
  reloadFailure: null,
  bannerVariant: null
}

describe('getViewerStatus', () => {
  it.each([
    [{}, 'idle'],
    [{ isReloading: true }, 'reloading'],
    [{ isWatchUnavailable: true }, 'unavailable'],
    // A persistent degradation outranks a 1-second confirmation.
    [{ isWatchUnavailable: true, isReloading: true }, 'unavailable'],
    // A failed re-read is news in its own right, not silence.
    [{ isStale: true }, 'stale'],
    [{ isStale: true, isReloading: true }, 'stale']
  ])('resolves %j to %s', (overrides, expected) => {
    expect(getViewerStatus({ ...IDLE, ...overrides })).toBe(expected)
  })

  it('falls through when the banner is already saying the same thing', () => {
    // Otherwise the notice and the status slot announce one fact twice. The
    // freshness notice names a dead watch itself (#478 § 3.6).
    expect(getViewerStatus({ ...IDLE, isWatchUnavailable: true, bannerVariant: 'notice' })).toBe('idle')
    expect(getViewerStatus({ ...IDLE, isStale: true, bannerVariant: 'stale' })).toBe('idle')
  })

  it('still reports a failed paint while a notice is up', () => {
    // A stale image under a notice is explained by the notice (it outranks the
    // stale banner), so the slot stays quiet only for the stale banner itself
    expect(getViewerStatus({ ...IDLE, isStale: true, bannerVariant: 'notice' })).toBe('idle')
    expect(getViewerStatus({ ...IDLE, isWatchUnavailable: true, bannerVariant: 'stale' })).toBe('unavailable')
  })

  it('answers a failed Reload before anything else', () => {
    // Nothing else on screen changes when recovery fails, so this is the only
    // feedback the click gets.
    expect(
      getViewerStatus({
        ...IDLE,
        reloadFailure: 'missing',
        isWatchUnavailable: true,
        isStale: true,
        isReloading: true
      })
    ).toBe('reload-failed-missing')
    expect(getViewerStatus({ ...IDLE, reloadFailure: 'watch' })).toBe('reload-failed-watch')
  })
})

describe('getBannerVariant', () => {
  it.each([
    [{ hasNotice: false, isStale: false }, null],
    [{ hasNotice: true, isStale: false }, 'notice'],
    [{ hasNotice: false, isStale: true }, 'stale'],
    // The freshness notice outranks the viewer's own stale banner: it explains the failed paint too
    [{ hasNotice: true, isStale: true }, 'notice']
  ])('resolves %j to %s', (input, expected) => {
    expect(getBannerVariant(input)).toBe(expected)
  })
})

describe('getStatusTone', () => {
  it('paints the refresh confirmation positive and every degradation warning', () => {
    expect(getStatusTone('idle')).toBe('neutral')
    expect(getStatusTone('reloading')).toBe('positive')
    expect(getStatusTone('unavailable')).toBe('warning')
    expect(getStatusTone('stale')).toBe('warning')
    expect(getStatusTone('reload-failed-missing')).toBe('warning')
    expect(getStatusTone('reload-failed-watch')).toBe('warning')
  })
})

describe('getStatusText', () => {
  it('renders an empty string when idle so the live region stays mounted', () => {
    expect(getStatusText('idle')).toBe('')
  })

  it('uses the shared copy constants', () => {
    expect(getStatusText('reloading')).toBe(VIEWER_STATUS_COPY.reloading)
    expect(getStatusText('unavailable')).toBe(VIEWER_STATUS_COPY.unavailable)
    expect(getStatusText('stale')).toBe(VIEWER_STATUS_COPY.stale)
    expect(getStatusText('reload-failed-missing')).toBe(VIEWER_STATUS_COPY.reloadFailedMissing)
    expect(getStatusText('reload-failed-watch')).toBe(VIEWER_STATUS_COPY.reloadFailedWatch)
  })
})

describe('formatClockTime', () => {
  it('formats a 24-hour clock with zero padding', () => {
    expect(formatClockTime(new Date(2026, 0, 1, 14, 32, 5).getTime())).toBe('14:32:05')
    expect(formatClockTime(new Date(2026, 0, 1, 9, 4, 0).getTime())).toBe('09:04:00')
    expect(formatClockTime(new Date(2026, 0, 1, 0, 0, 0).getTime())).toBe('00:00:00')
  })

  it('returns an empty string when there is no timestamp yet', () => {
    expect(formatClockTime(Number.NaN)).toBe('')
    expect(formatClockTime(Number.POSITIVE_INFINITY)).toBe('')
    // 0 is the "never loaded" sentinel, not midnight in 1970.
    expect(formatClockTime(0)).toBe('')
  })
})

describe('formatUpdatedStamp', () => {
  it('prefixes the clock', () => {
    expect(formatUpdatedStamp(new Date(2026, 0, 1, 14, 32, 5).getTime())).toBe('Updated 14:32:05')
  })

  it('renders nothing before the first load', () => {
    expect(formatUpdatedStamp(0)).toBe('')
    expect(formatUpdatedStamp(Number.NaN)).toBe('')
  })
})

describe('formatUpdatedAccessibleName', () => {
  it('reads as a sentence fragment', () => {
    expect(formatUpdatedAccessibleName(new Date(2026, 0, 1, 14, 32, 5).getTime())).toBe(
      'Last updated at 14:32:05'
    )
  })

  it('renders nothing before the first load', () => {
    expect(formatUpdatedAccessibleName(0)).toBe('')
    expect(formatUpdatedAccessibleName(Number.NaN)).toBe('')
  })
})

describe('copy constants', () => {
  it('pins the exact user-facing strings', () => {
    // These are contract, not decoration: the design and the e2e suite both
    // quote them. Changing one is a deliberate copy change, not a refactor.
    expect(VIEWER_STATUS_COPY).toEqual({
      reloading: 'Reloaded from disk',
      unavailable: 'Auto-refresh unavailable',
      stale: 'Could not load the latest version',
      reloadFailedMissing: 'Still missing on disk',
      reloadFailedWatch: 'Auto-refresh could not be restarted'
    })
    // The deleted, unavailable and watch-limit copy is the freshness notice's
    // now (`freshnessNoticeCopy.ts`, #478 § 3.6); the viewer keeps only its own
    expect(VIEWER_BANNER_COPY).toEqual({
      stale:
        'Could not load the latest version of this file. Showing the version that was ' +
        'loaded. Choose Reload to try again.'
    })
    expect(VIEWER_RELOAD_BUTTON_COPY).toEqual({
      label: 'Reload',
      ariaLabel: 'Reload image from disk'
    })
  })

  it('uses en dashes, never em dashes', () => {
    const allCopy = [
      ...Object.values(VIEWER_STATUS_COPY),
      ...Object.values(VIEWER_BANNER_COPY),
      ...Object.values(VIEWER_RELOAD_BUTTON_COPY)
    ].join(' ')
    expect(allCopy).not.toContain('—')
  })
})
