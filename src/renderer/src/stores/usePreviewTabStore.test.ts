// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link usePreviewTabStore} (issue #124, part 3 §3.3–§3.4).
 *
 * The store holds UI state only – never the page a tab shows, which is
 * `params.filePath` – and an entry lives as long as the tab, not its React tree.
 *
 * @see usePreviewTabStore.ts
 */
import { beforeEach, describe, expect, it } from 'vitest'

import type { PreviewHistoryState } from '../../../shared/ipc/preview-types'
import {
  DEFAULT_PREVIEW_LINK_MODE,
  NO_PREVIEW_TAB,
  isPreviewLinkMode,
  usePreviewTabStore
} from './usePreviewTabStore'

/** A history report as main would send it for a tab two pages in. */
const HISTORY: PreviewHistoryState = {
  canGoBack: true,
  canGoForward: false,
  backTarget: { filePath: '/proj/site/index.html', anchor: null },
  forwardTarget: null,
  generation: 4
}

const store = (): ReturnType<typeof usePreviewTabStore.getState> => usePreviewTabStore.getState()

describe('usePreviewTabStore', () => {
  beforeEach(() => {
    store().reset()
  })

  describe('defaults', () => {
    it('reads an unknown tab as the shared default: new-tab mode, nowhere to go', () => {
      expect(store().getTab('preview-a')).toBe(NO_PREVIEW_TAB)
      expect(NO_PREVIEW_TAB).toMatchObject({
        linkMode: 'new-tab',
        canGoBack: false,
        canGoForward: false,
        generation: 0
      })
      expect(DEFAULT_PREVIEW_LINK_MODE).toBe('new-tab')
    })

    it('never lets a caller mutate the shared default', () => {
      expect(Object.isFrozen(NO_PREVIEW_TAB)).toBe(true)
    })
  })

  describe('seed', () => {
    it('creates a tab in new-tab mode when it was opened with none', () => {
      store().seed('preview-a')
      expect(store().tabs.get('preview-a')?.linkMode).toBe('new-tab')
    })

    it('creates a tab in the mode a link passed to it (inheritance)', () => {
      store().seed('preview-a', 'same-tab')
      expect(store().getTab('preview-a').linkMode).toBe('same-tab')
    })

    it('falls back to new-tab for a param that is not a link mode', () => {
      store().seed('preview-a', 'sideways')
      store().seed('preview-b', 42)
      expect(store().getTab('preview-a').linkMode).toBe('new-tab')
      expect(store().getTab('preview-b').linkMode).toBe('new-tab')
    })

    it('keeps an existing entry: a remount after a crash does not reset the mode', () => {
      store().seed('preview-a')
      store().setLinkMode('preview-a', 'same-tab')
      const before = store().tabs

      // The remounted panel seeds again from its original params.
      store().seed('preview-a', 'new-tab')

      expect(store().getTab('preview-a').linkMode).toBe('same-tab')
      expect(store().tabs).toBe(before)
    })
  })

  describe('setLinkMode', () => {
    it('switches the mode, creating the entry when needed', () => {
      store().setLinkMode('preview-a', 'same-tab')
      expect(store().getTab('preview-a').linkMode).toBe('same-tab')

      store().setLinkMode('preview-a', 'new-tab')
      expect(store().getTab('preview-a').linkMode).toBe('new-tab')
    })

    it('does not notify for a write that changes nothing', () => {
      store().setLinkMode('preview-a', 'same-tab')
      const before = store().tabs

      store().setLinkMode('preview-a', 'same-tab')

      expect(store().tabs).toBe(before)
    })

    it('writes the default mode for a tab that has no entry yet', () => {
      // A new-tab write on an unknown tab still creates it, so the toggle's
      // first press always leaves a record.
      store().setLinkMode('preview-a', 'new-tab')
      expect(store().tabs.has('preview-a')).toBe(true)
    })
  })

  describe('setHistory', () => {
    it("mirrors main's Back and Forward state and keeps the mode", () => {
      store().seed('preview-a', 'same-tab')
      store().setHistory('preview-a', HISTORY)

      // Changed on purpose (WI-19): an entry now also carries `announcement`
      // and `lastMove`, both null until a move writes them.
      expect(store().getTab('preview-a')).toEqual({
        ...NO_PREVIEW_TAB,
        linkMode: 'same-tab',
        ...HISTORY
      })
    })

    it('stores the history fields only, never the page or the panel id', () => {
      // A `pageChanged` payload carries the page too – which belongs in
      // `params.filePath`, never in a second copy here (RS3).
      const payload = {
        ...HISTORY,
        panelId: 'preview-a',
        filePath: '/proj/site/pricing.html',
        anchor: null,
        sameDocument: false,
        failed: false
      }
      store().setHistory('preview-a', payload)

      const entry = store().getTab('preview-a') as unknown as Record<string, unknown>
      expect(Object.keys(entry).sort()).toEqual(
        // Changed on purpose (WI-19): plus the move's `announcement` and `lastMove`.
        [
          'announcement',
          'backTarget',
          'canGoBack',
          'canGoForward',
          'forwardTarget',
          'generation',
          'lastMove',
          'linkMode'
        ].sort()
      )
    })

    it('creates an entry in the default mode when the report comes first', () => {
      store().setHistory('preview-a', HISTORY)
      expect(store().getTab('preview-a').linkMode).toBe('new-tab')
    })

    it('accepts a lower generation: a reopened view starts a fresh history', () => {
      store().setHistory('preview-a', HISTORY)
      store().setHistory('preview-a', { ...HISTORY, canGoBack: false, backTarget: null, generation: 0 })

      expect(store().getTab('preview-a')).toMatchObject({ canGoBack: false, generation: 0 })
    })
  })

  describe('announcement and lastMove (WI-19)', () => {
    const TARGET = { filePath: '/proj/site/pricing.html', anchor: null }
    const ANNOUNCEMENT = {
      origin: 'chrome' as const,
      closedCount: 1,
      target: TARGET,
      focusMoved: false
    }
    const LAST_MOVE = {
      action: 'open' as const,
      from: { filePath: '/proj/site/index.html', anchor: null },
      to: TARGET
    }

    it('starts empty', () => {
      store().seed('preview-a')
      expect(store().getTab('preview-a')).toMatchObject({ announcement: null, lastMove: null })
    })

    it('writes and clears the announcement, keeping everything else', () => {
      store().seed('preview-a', 'same-tab')

      store().setAnnouncement('preview-a', ANNOUNCEMENT)
      expect(store().getTab('preview-a')).toMatchObject({
        linkMode: 'same-tab',
        announcement: ANNOUNCEMENT
      })

      store().setAnnouncement('preview-a', null)
      expect(store().getTab('preview-a').announcement).toBeNull()
    })

    it('records and forgets the last move', () => {
      store().setLastMove('preview-a', LAST_MOVE)
      expect(store().getTab('preview-a').lastMove).toBe(LAST_MOVE)

      store().setLastMove('preview-a', null)
      expect(store().getTab('preview-a').lastMove).toBeNull()
    })

    it('a history report keeps the announcement and the last move', () => {
      store().setAnnouncement('preview-a', ANNOUNCEMENT)
      store().setLastMove('preview-a', LAST_MOVE)

      store().setHistory('preview-a', HISTORY)

      expect(store().getTab('preview-a')).toMatchObject({
        announcement: ANNOUNCEMENT,
        lastMove: LAST_MOVE,
        generation: HISTORY.generation
      })
    })

    it('a clear changes nothing for a tab with no entry or nothing to clear', () => {
      const empty = store().tabs
      store().setAnnouncement('preview-ghost', null)
      store().setLastMove('preview-ghost', null)
      expect(store().tabs).toBe(empty)
      expect(store().tabs.has('preview-ghost')).toBe(false)

      store().seed('preview-a')
      const seeded = store().tabs
      store().setAnnouncement('preview-a', null)
      expect(store().tabs).toBe(seeded)
    })
  })

  describe('removePanel', () => {
    it('forgets only the named tab', () => {
      store().seed('preview-a', 'same-tab')
      store().seed('preview-b', 'same-tab')

      store().removePanel('preview-a')

      expect(store().tabs.has('preview-a')).toBe(false)
      expect(store().getTab('preview-b').linkMode).toBe('same-tab')
    })

    it('does not notify for a tab it never held', () => {
      store().seed('preview-a')
      const before = store().tabs

      store().removePanel('preview-ghost')

      expect(store().tabs).toBe(before)
    })
  })

  it('isPreviewLinkMode accepts the two modes only', () => {
    expect(isPreviewLinkMode('new-tab')).toBe(true)
    expect(isPreviewLinkMode('same-tab')).toBe(true)
    expect(isPreviewLinkMode('by-mode')).toBe(false)
    expect(isPreviewLinkMode(undefined)).toBe(false)
  })
})
