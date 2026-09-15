// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the pure HTML preview panel logic (Issue #74, work item 71).
 *
 * @see htmlPreview.logic.ts
 */

import { describe, it, expect } from 'vitest'
import type { PreviewFailure } from '../../../../../shared/ipc/preview-schema'
import type { PreviewFailureType } from '../../../../../shared/ipc/preview-types'
import { ErrorCode } from '../../../../../shared/errors'
import { SRCDOC_TOO_DEEP_ENTRY } from '../../../../../shared/previewFrameBadgeText'
import {
  deriveBounds,
  previewPlaceholderLabel,
  selectPanelView,
  selectFallback,
  summarizeFailures,
  FAILURE_TYPE_LABELS
} from './htmlPreview.logic'

/** Builds a minimal failure entry for tests. */
function makeFailure(
  type: PreviewFailureType,
  resourceUrlOrHost: string,
  id = `${type}-${resourceUrlOrHost}`
): PreviewFailure {
  return {
    id,
    type,
    resourceUrlOrHost,
    reasonCode: ErrorCode.PREVIEW_HOST_NOT_APPROVABLE,
    timestamp: 1
  }
}

describe('deriveBounds', () => {
  it('reshapes a rect into bounds', () => {
    expect(deriveBounds({ left: 10, top: 20, width: 300, height: 200 })).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200
    })
  })

  it('returns null for a zero-width rect', () => {
    expect(deriveBounds({ left: 0, top: 0, width: 0, height: 200 })).toBeNull()
  })

  it('returns null for a zero-height rect', () => {
    expect(deriveBounds({ left: 0, top: 0, width: 200, height: 0 })).toBeNull()
  })

  it('returns null for a negative dimension', () => {
    expect(deriveBounds({ left: 5, top: 5, width: -1, height: 200 })).toBeNull()
  })

  it('insets the top by the search-bar strip when open (UX-002)', () => {
    expect(deriveBounds({ left: 10, top: 20, width: 300, height: 200 }, 48)).toEqual({
      x: 10,
      y: 68,
      width: 300,
      height: 152
    })
  })

  it('treats a zero or negative inset as no inset', () => {
    const rect = { left: 10, top: 20, width: 300, height: 200 }
    const expected = { x: 10, y: 20, width: 300, height: 200 }
    expect(deriveBounds(rect, 0)).toEqual(expected)
    expect(deriveBounds(rect, -10)).toEqual(expected)
  })

  it('returns null when the inset leaves no vertical area', () => {
    expect(deriveBounds({ left: 0, top: 0, width: 300, height: 40 }, 48)).toBeNull()
    expect(deriveBounds({ left: 0, top: 0, width: 300, height: 48 }, 48)).toBeNull()
  })
})

describe('selectPanelView', () => {
  it('prefers limit-reached over every load state', () => {
    expect(selectPanelView({ limitReached: true, loadState: 'ready' })).toBe('limit-reached')
    expect(selectPanelView({ limitReached: true, loadState: 'failed' })).toBe('limit-reached')
  })

  it('returns failed when the load state is failed', () => {
    expect(selectPanelView({ limitReached: false, loadState: 'failed' })).toBe('failed')
  })

  it('returns normal otherwise', () => {
    expect(selectPanelView({ limitReached: false, loadState: 'ready' })).toBe('normal')
    expect(selectPanelView({ limitReached: false, loadState: 'idle' })).toBe('normal')
    expect(selectPanelView({ limitReached: false, loadState: 'loading' })).toBe('normal')
  })
})

describe('selectFallback', () => {
  it('shows the frame only when hidden AND a frame is cached', () => {
    expect(selectFallback({ hasFrame: true, isViewHidden: true })).toBe('frame')
  })

  it('shows the placeholder when visible even with a cached frame', () => {
    expect(selectFallback({ hasFrame: true, isViewHidden: false })).toBe('placeholder')
  })

  it('shows the placeholder when hidden with no cached frame', () => {
    expect(selectFallback({ hasFrame: false, isViewHidden: true })).toBe('placeholder')
  })

  it('shows the placeholder when visible with no frame', () => {
    expect(selectFallback({ hasFrame: false, isViewHidden: false })).toBe('placeholder')
  })
})

describe('summarizeFailures', () => {
  it('returns an empty summary for no failures', () => {
    expect(summarizeFailures([])).toEqual({ count: 0, groups: [], blockedHosts: [] })
  })

  it('counts total failures for the badge', () => {
    const failures = [
      makeFailure('blocked-host', 'cdn.example'),
      makeFailure('script-error', 'app.js'),
      makeFailure('network-error', 'api.example')
    ]
    expect(summarizeFailures(failures).count).toBe(3)
  })

  it('groups by type in first-seen order and preserves entry order', () => {
    const failures = [
      makeFailure('blocked-host', 'cdn.example', 'a'),
      makeFailure('script-error', 'app.js', 'b'),
      makeFailure('blocked-host', 'fonts.example', 'c')
    ]
    const { groups } = summarizeFailures(failures)
    expect(groups.map((g) => g.type)).toEqual(['blocked-host', 'script-error'])
    expect(groups[0].entries.map((e) => e.id)).toEqual(['a', 'c'])
    expect(groups[0].label).toBe(FAILURE_TYPE_LABELS['blocked-host'])
  })

  it('collects distinct blocked hosts in first-seen order', () => {
    const failures = [
      makeFailure('blocked-host', 'cdn.example', '1'),
      makeFailure('blocked-host', 'cdn.example', '2'),
      makeFailure('blocked-host', 'fonts.example', '3'),
      makeFailure('script-error', 'app.js', '4')
    ]
    expect(summarizeFailures(failures).blockedHosts).toEqual(['cdn.example', 'fonts.example'])
  })
})

describe('frame failure labels (issue #124, part 2 §2.12)', () => {
  it.each([
    ['frame-remote', 'Blocked remote frame'],
    ['frame-escape', 'Frame escaped the project'],
    ['frame-excluded', 'Excluded frame'],
    ['frame-too-deep', 'Frame nested too deep'],
    ['frame-over-limit', 'Too many frames'],
    ['frame-link-blocked', 'Blocked link in frame']
  ] as const)('labels %s "%s"', (type, label) => {
    expect(FAILURE_TYPE_LABELS[type]).toBe(label)
  })

  it('groups frame refusals under their own labels', () => {
    const { groups } = summarizeFailures([
      makeFailure('frame-remote', 'https://cdn.example/frame.html', 'a'),
      makeFailure('frame-too-deep', SRCDOC_TOO_DEEP_ENTRY, 'b'),
      makeFailure('frame-remote', 'data:', 'c')
    ])
    expect(groups.map((g) => [g.label, g.entries.length])).toEqual([
      ['Blocked remote frame', 2],
      ['Frame nested too deep', 1]
    ])
  })
})

describe('previewPlaceholderLabel (issue #124, QG-8 U1)', () => {
  it('is the panel identity alone while the page cannot be entered', () => {
    expect(previewPlaceholderLabel('page.html', false)).toBe('HTML preview of page.html')
  })

  it('states the way in and the way back out while it can', () => {
    expect(previewPlaceholderLabel('page.html', true)).toBe(
      'HTML preview of page.html – press Enter to enter the page, Escape to come back'
    )
  })

  it('keeps the identity as a prefix, which the e2e locators find a preview by', () => {
    expect(previewPlaceholderLabel('index.html', true).startsWith('HTML preview of index.html – ')).toBe(
      true
    )
  })
})
