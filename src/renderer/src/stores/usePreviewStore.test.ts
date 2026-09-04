// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for usePreviewStore (Issue #74, item 68).
 *
 * @see usePreviewStore.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { usePreviewStore } from './usePreviewStore'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailure } from '../../../shared/ipc/preview-schema'
import type { PreviewStillFrame } from '../../../shared/ipc/preview-types'

/** Builds a valid failure entry for a given panel scenario. */
const makeFailure = (id: string): PreviewFailure => ({
  id,
  type: 'blocked-host',
  resourceUrlOrHost: 'cdn.example.com',
  reasonCode: ErrorCode.PREVIEW_HOST_NOT_APPROVABLE,
  timestamp: 1_700_000_000_000
})

/** Builds a still frame for a given panel scenario. */
const makeFrame = (dataUrl: string): PreviewStillFrame => ({
  dataUrl,
  width: 800,
  height: 600,
  capturedAt: 1_700_000_000_000
})

describe('usePreviewStore', () => {
  beforeEach(() => {
    usePreviewStore.getState().reset()
  })

  describe('defaults', () => {
    it('returns idle/empty defaults for an unknown panel', () => {
      const s = usePreviewStore.getState()
      expect(s.getPanel('p1')).toBeUndefined()
      expect(s.getLoadState('p1')).toBe('idle')
      expect(s.getFailures('p1')).toEqual([])
      expect(s.getFailureCount('p1')).toBe(0)
      expect(s.getStillFrame('p1')).toBeNull()
      expect(s.holderPanelId).toBeNull()
    })
  })

  describe('load state', () => {
    it('sets load state and optional dropped count', () => {
      usePreviewStore.getState().setLoadState('p1', 'loading')
      expect(usePreviewStore.getState().getLoadState('p1')).toBe('loading')

      usePreviewStore.getState().setLoadState('p1', 'failed', 3)
      expect(usePreviewStore.getState().getLoadState('p1')).toBe('failed')
      expect(usePreviewStore.getState().getPanel('p1')?.dropped).toBe(3)

      // Omitting dropped preserves the prior value.
      usePreviewStore.getState().setLoadState('p1', 'ready')
      expect(usePreviewStore.getState().getPanel('p1')?.dropped).toBe(3)
    })
  })

  describe('failures', () => {
    it('pushes (replaces) and clears failures with badge count', () => {
      usePreviewStore.getState().pushFailures('p1', [makeFailure('a'), makeFailure('b')], true)
      expect(usePreviewStore.getState().getFailureCount('p1')).toBe(2)
      expect(usePreviewStore.getState().getPanel('p1')?.truncated).toBe(true)

      // REPLACE semantics: a subsequent push is the new authoritative snapshot.
      usePreviewStore.getState().pushFailures('p1', [makeFailure('c')])
      expect(usePreviewStore.getState().getFailures('p1').map((f) => f.id)).toEqual(['c'])
      expect(usePreviewStore.getState().getPanel('p1')?.truncated).toBe(false)

      usePreviewStore.getState().clearFailures('p1')
      expect(usePreviewStore.getState().getFailureCount('p1')).toBe(0)
      expect(usePreviewStore.getState().getPanel('p1')?.truncated).toBe(false)
    })
  })

  describe('still frame', () => {
    it('sets and clears the still frame', () => {
      const frame = makeFrame('data:image/png;base64,AAA')
      usePreviewStore.getState().setStillFrame('p1', frame)
      expect(usePreviewStore.getState().getStillFrame('p1')).toEqual(frame)

      usePreviewStore.getState().clearStillFrame('p1')
      expect(usePreviewStore.getState().getStillFrame('p1')).toBeNull()
    })
  })

  describe('holder', () => {
    it('sets and clears the limit-reached holder', () => {
      usePreviewStore.getState().setHolder('live-panel')
      expect(usePreviewStore.getState().holderPanelId).toBe('live-panel')

      usePreviewStore.getState().clearHolder()
      expect(usePreviewStore.getState().holderPanelId).toBeNull()
    })
  })

  describe('per-panel isolation', () => {
    it('keeps state separate across panels', () => {
      const s = usePreviewStore.getState()
      s.setLoadState('p1', 'ready')
      s.setLoadState('p2', 'failed', 1)
      s.pushFailures('p1', [makeFailure('a')])
      s.setStillFrame('p2', makeFrame('data:image/png;base64,BBB'))

      const now = usePreviewStore.getState()
      expect(now.getLoadState('p1')).toBe('ready')
      expect(now.getLoadState('p2')).toBe('failed')
      expect(now.getFailureCount('p1')).toBe(1)
      expect(now.getFailureCount('p2')).toBe(0)
      expect(now.getStillFrame('p1')).toBeNull()
      expect(now.getStillFrame('p2')).not.toBeNull()
    })

    it('removePanel forgets only the named panel', () => {
      const s = usePreviewStore.getState()
      s.setLoadState('p1', 'ready')
      s.setLoadState('p2', 'loading')

      s.removePanel('p1')
      const now = usePreviewStore.getState()
      expect(now.getPanel('p1')).toBeUndefined()
      expect(now.getLoadState('p2')).toBe('loading')
    })
  })
})
