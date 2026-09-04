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
  getBannerMessage,
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
    // Otherwise role="alert" and role="status" announce one sentence twice.
    expect(
      getViewerStatus({ ...IDLE, isWatchUnavailable: true, bannerVariant: 'unavailable' })
    ).toBe('idle')
    expect(getViewerStatus({ ...IDLE, isStale: true, bannerVariant: 'stale' })).toBe('idle')
  })

  it('still reports a dead watch while the banner reports a DIFFERENT fact', () => {
    // A deleted file and a dead watch are two facts. Suppressing on a bare
    // "the banner is visible" boolean would lose the second one entirely.
    expect(
      getViewerStatus({ ...IDLE, isWatchUnavailable: true, bannerVariant: 'deleted' })
    ).toBe('unavailable')
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
    [{ isFileDeleted: false, isWatchUnavailable: false, isStale: false }, null],
    [{ isFileDeleted: true, isWatchUnavailable: false, isStale: false }, 'deleted'],
    [{ isFileDeleted: false, isWatchUnavailable: true, isStale: false }, 'unavailable'],
    [{ isFileDeleted: false, isWatchUnavailable: false, isStale: true }, 'stale'],
    // Most specific cause wins: a deleted file explains both of the others.
    [{ isFileDeleted: true, isWatchUnavailable: true, isStale: true }, 'deleted'],
    [{ isFileDeleted: false, isWatchUnavailable: true, isStale: true }, 'unavailable']
  ])('resolves %j to %s', (input, expected) => {
    expect(getBannerVariant(input)).toBe(expected)
  })
})

describe('getBannerMessage', () => {
  it('names the cap and the remedy for the limit case', () => {
    // The whole point of moving this out of an aria-label: a sighted user has
    // to be able to learn that closing tabs is what fixes it.
    const message = getBannerMessage('unavailable', 'limit')
    expect(message).toBe(VIEWER_BANNER_COPY.unavailableLimit)
    expect(message).toContain('100')
    expect(message).toContain('Close some tabs')
  })

  it('does not blame the cap for a watcher fault', () => {
    const message = getBannerMessage('unavailable', 'watcher-error')
    expect(message).toBe(VIEWER_BANNER_COPY.unavailableWatcherError)
    expect(message).not.toContain('Close some tabs')
  })

  it('reports an unattributed refusal as a watcher fault', () => {
    expect(getBannerMessage('unavailable', null)).toBe(
      VIEWER_BANNER_COPY.unavailableWatcherError
    )
  })

  it('ignores the reason for the variants it cannot apply to', () => {
    expect(getBannerMessage('deleted', 'limit')).toBe(VIEWER_BANNER_COPY.deleted)
    expect(getBannerMessage('stale', 'limit')).toBe(VIEWER_BANNER_COPY.stale)
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
    expect(VIEWER_BANNER_COPY).toEqual({
      deleted: 'This file was deleted on disk. Showing the last version that was loaded.',
      // The cap figure is `MAX_WATCHED_FILES`, guarded against drift in
      // `constants/fileWatch.test.ts`. It is spelled out here because this
      // assertion is the copy contract, not a re-derivation of it.
      unavailableLimit:
        'Auto-refresh is unavailable – Erfana is watching its maximum of 100 files. ' +
        'Close some tabs, then choose Reload.',
      unavailableWatcherError:
        'Auto-refresh is unavailable – the file watcher stopped. Showing the version that ' +
        'was loaded. Choose Reload to try again.',
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
