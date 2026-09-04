// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for PreviewPageSearchProvider (Issue #74, work item 55).
 *
 * The count-only provider wraps Chromium's find-in-page over the preview IPC
 * bridge. Tests use a fake bridge that captures the find-result callback so they
 * can push results, and asserts the provider's find/stopFind calls and the
 * counts it pushes to onCountChange subscribers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PreviewPageSearchProvider } from './PreviewPageSearchProvider'
import type { PreviewBridge } from '../../../../shared/ipc/preview-schema'
import type { PreviewFindResult } from '../../../../shared/ipc/preview-types'
import type { SearchCount } from './SearchProvider'

// Mock logger to keep test output clean.
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

type FindBridge = Pick<PreviewBridge, 'find' | 'stopFind' | 'onFindResult'>

const PANEL_ID = 'panel-1'
const OPTIONS = { caseSensitive: false, wholeWord: false }

describe('PreviewPageSearchProvider', () => {
  let bridge: FindBridge
  let findResultCb: ((r: PreviewFindResult) => void) | null
  let unsubscribe: ReturnType<typeof vi.fn>
  let provider: PreviewPageSearchProvider

  beforeEach(() => {
    vi.clearAllMocks()
    findResultCb = null
    unsubscribe = vi.fn()
    bridge = {
      find: vi.fn(async () => {}),
      stopFind: vi.fn(async () => {}),
      onFindResult: vi.fn((cb: (r: PreviewFindResult) => void) => {
        findResultCb = cb
        return unsubscribe
      })
    }
    provider = new PreviewPageSearchProvider(PANEL_ID, bridge)
  })

  it('declares count-only capabilities', () => {
    expect(provider.capabilities).toEqual({
      randomAccess: false,
      matchList: false,
      wholeWord: false
    })
  })

  it('subscribes to find results in the constructor', () => {
    expect(bridge.onFindResult).toHaveBeenCalledTimes(1)
  })

  it('search() issues a fresh find (findNext:false) and returns []', async () => {
    const result = await provider.search('hello', OPTIONS)
    expect(result).toEqual([])
    expect(bridge.find).toHaveBeenCalledWith({
      panelId: PANEL_ID,
      text: 'hello',
      forward: true,
      findNext: false,
      matchCase: false
    })
  })

  it('search() forwards case sensitivity as matchCase', async () => {
    await provider.search('Hello', { caseSensitive: true, wholeWord: false })
    expect(bridge.find).toHaveBeenCalledWith(
      expect.objectContaining({ matchCase: true })
    )
  })

  it('search() with an empty query clears instead of issuing find', async () => {
    await provider.search('', OPTIONS)
    expect(bridge.find).not.toHaveBeenCalled()
    expect(bridge.stopFind).toHaveBeenCalledWith(PANEL_ID)
  })

  it('pushes counts from find results to subscribers, filtered by panel', async () => {
    const counts: SearchCount[] = []
    provider.onCountChange((c) => counts.push(c))

    // A result for another panel is ignored.
    findResultCb?.({ panelId: 'other', requestId: 1, matches: 99, activeMatchOrdinal: 9 })
    // A result for our panel is forwarded.
    findResultCb?.({ panelId: PANEL_ID, requestId: 2, matches: 5, activeMatchOrdinal: 2 })

    expect(counts).toEqual([{ total: 5, activeOrdinal: 2 }])
  })

  it('nextMatch issues a forward findNext with the active query', async () => {
    await provider.search('term', OPTIONS)
    ;(bridge.find as ReturnType<typeof vi.fn>).mockClear()

    provider.nextMatch()
    expect(bridge.find).toHaveBeenCalledWith({
      panelId: PANEL_ID,
      text: 'term',
      forward: true,
      findNext: true,
      matchCase: false
    })
  })

  it('previousMatch issues a backward findNext', async () => {
    await provider.search('term', OPTIONS)
    ;(bridge.find as ReturnType<typeof vi.fn>).mockClear()

    provider.previousMatch()
    expect(bridge.find).toHaveBeenCalledWith(
      expect.objectContaining({ forward: false, findNext: true })
    )
  })

  it('nextMatch is a no-op when there is no active query', () => {
    provider.nextMatch()
    expect(bridge.find).not.toHaveBeenCalled()
  })

  it('clearHighlights pushes a zero count BEFORE issuing stop', () => {
    const order: string[] = []
    provider.onCountChange((c) => {
      order.push(`count:${c.total}:${c.activeOrdinal}`)
    })
    ;(bridge.stopFind as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('stop')
    })

    provider.clearHighlights()

    // The zero-count push happens synchronously before stopFind resolves; assert
    // the count landed first and with the zero value.
    expect(order[0]).toBe('count:0:0')
    expect(bridge.stopFind).toHaveBeenCalledWith(PANEL_ID)
  })

  it('dispose unsubscribes from the find-result stream and drops listeners', () => {
    const listener = vi.fn()
    provider.onCountChange(listener)

    provider.dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    // After dispose, further results are not delivered to old listeners.
    findResultCb?.({ panelId: PANEL_ID, requestId: 3, matches: 1, activeMatchOrdinal: 1 })
    expect(listener).not.toHaveBeenCalled()
  })

  it('onCountChange returns an unsubscribe that stops delivery', () => {
    const listener = vi.fn()
    const unsub = provider.onCountChange(listener)
    unsub()

    findResultCb?.({ panelId: PANEL_ID, requestId: 4, matches: 2, activeMatchOrdinal: 1 })
    expect(listener).not.toHaveBeenCalled()
  })
})
