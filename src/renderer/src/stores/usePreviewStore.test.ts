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

  describe('resetPage (issue #124, part 3 §3.4)', () => {
    /** A panel that has lived on page A for a while. */
    function seedPageA(): void {
      const s = usePreviewStore.getState()
      s.setLoadState('p1', 'ready', 2)
      s.setBackdrop('p1', '#FFFFFF')
      s.setAllowedHosts('p1', ['https://fonts.example'])
      s.recordBlockedHost('p1', { host: 'https://cdn.example', kinds: ['script'], approvable: true })
      s.markBlockedHostsTruncated('p1')
      s.setStillFrame('p1', makeFrame('data:image/png;base64,AAA'))
    }

    it("drops the old page's blocked hosts, still frame and dropped count", () => {
      seedPageA()

      usePreviewStore.getState().resetPage('p1')

      const panel = usePreviewStore.getState().getPanel('p1')
      expect(panel?.blockedHosts).toEqual([])
      expect(panel?.blockedHostsTruncated).toBe(false)
      expect(panel?.stillFrame).toBeNull()
      expect(panel?.dropped).toBe(0)
    })

    it('keeps the load state, backdrop and allowed hosts – they describe the view or the project', () => {
      seedPageA()

      usePreviewStore.getState().resetPage('p1')

      const panel = usePreviewStore.getState().getPanel('p1')
      expect(panel?.loadState).toBe('ready')
      expect(panel?.backdrop).toBe('#FFFFFF')
      expect(panel?.allowedHosts).toEqual(['https://fonts.example'])
    })

    it("keeps a failure snapshot that arrived before pageChanged – it is the new page's (RS2-3)", () => {
      seedPageA()
      // Main commits B, sends B's snapshot, THEN emits pageChanged.
      usePreviewStore.getState().pushFailures('p1', [makeFailure('b-1')], true)

      usePreviewStore.getState().resetPage('p1')

      expect(usePreviewStore.getState().getFailures('p1').map((f) => f.id)).toEqual(['b-1'])
      expect(usePreviewStore.getState().getPanel('p1')?.truncated).toBe(true)
    })

    it('is a no-op for a panel with no state', () => {
      const before = usePreviewStore.getState().panels

      usePreviewStore.getState().resetPage('ghost')

      expect(usePreviewStore.getState().panels).toBe(before)
      expect(usePreviewStore.getState().getPanel('ghost')).toBeUndefined()
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

  describe('drag freeze flags (issue #124, part 1 §1.5)', () => {
    const flags = (panelId = 'p1') => {
      const panel = usePreviewStore.getState().getPanel(panelId)
      return { resizeHeld: panel?.resizeHeld, dragHideLatched: panel?.dragHideLatched }
    }

    beforeEach(() => {
      usePreviewStore.getState().setLoadState('p1', 'ready')
    })

    it('starts with neither flag set', () => {
      expect(flags()).toEqual({ resizeHeld: false, dragHideLatched: false })
    })

    it('latches a splitter drag, and a hold sets both flags', () => {
      usePreviewStore.getState().latchDragHide('p1')
      expect(flags()).toEqual({ resizeHeld: false, dragHideLatched: true })

      usePreviewStore.getState().beginResizeHold('p1')
      expect(flags()).toEqual({ resizeHeld: true, dragHideLatched: true })
    })

    it('ends the hold on visibilityApplied(false) but keeps the latch (RU3-2)', () => {
      usePreviewStore.getState().beginResizeHold('p1')
      usePreviewStore.getState().applyVisibility('p1', false)
      expect(flags()).toEqual({ resizeHeld: false, dragHideLatched: true })
    })

    it('ends both on visibilityApplied(true)', () => {
      usePreviewStore.getState().beginResizeHold('p1')
      usePreviewStore.getState().applyVisibility('p1', true)
      expect(flags()).toEqual({ resizeHeld: false, dragHideLatched: false })
    })

    it('splitter sequence: latched through the hide confirmation, cleared only by the show', () => {
      const s = usePreviewStore.getState()
      s.latchDragHide('p1')
      s.applyVisibility('p1', false)
      expect(flags().dragHideLatched).toBe(true)
      s.applyVisibility('p1', true)
      expect(flags().dragHideLatched).toBe(false)
    })

    it('clears the hold, not the latch, when the view is suspended', () => {
      usePreviewStore.getState().beginResizeHold('p1')
      usePreviewStore.getState().setLoadState('p1', 'suspended')
      expect(flags()).toEqual({ resizeHeld: false, dragHideLatched: true })
    })

    it('clears the hold when the event feed unmounts', () => {
      usePreviewStore.getState().beginResizeHold('p1')
      usePreviewStore.getState().clearResizeHeld('p1')
      expect(flags().resizeHeld).toBe(false)
    })

    it('does not notify for a write that changes nothing', () => {
      const before = usePreviewStore.getState().panels
      usePreviewStore.getState().applyVisibility('p1', true)
      usePreviewStore.getState().clearResizeHeld('p1')
      expect(usePreviewStore.getState().panels).toBe(before)
    })

    it('never creates an entry for a panel with no state', () => {
      const s = usePreviewStore.getState()
      const before = s.panels
      s.latchDragHide('ghost')
      s.beginResizeHold('ghost')
      s.applyVisibility('ghost', true)
      s.clearResizeHeld('ghost')
      expect(usePreviewStore.getState().panels).toBe(before)
      expect(usePreviewStore.getState().getPanel('ghost')).toBeUndefined()
    })
  })
})
