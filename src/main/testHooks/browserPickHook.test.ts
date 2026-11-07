// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'

const { setTimeoutSpy } = vi.hoisted(() => ({ setTimeoutSpy: vi.fn((cb: () => void) => (cb(), 1)) }))
vi.mock('../utils/mainClock', () => ({ mainClock: { now: () => Date.UTC(2026, 10, 10), setTimeout: setTimeoutSpy } }))

import type { BrowserRuntime } from '../services/browser/browserAppSetup'
import { PickBench, PickFaults } from '../services/browser/pick/pickSupport'
import { BAND_DRAW_RECORDS, createBrowserPickTestHook } from './browserPickHook'

function runtime() {
  const tab = { id: 'browser-tab-1', contents: { capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from('png bytes') })) } }
  const capture = {
    id: 'c'.repeat(32),
    index: 2,
    firstIndex: 3,
    summary: () => ({ name: 'span#a' }),
    afterNavigation: false,
    written: ['a.md'],
    moment: { pickPoint: { x: 1, y: 2 } }
  }
  const pick = {
    highlight: {
      record: { label: 'span#a 1 × 1', box: { x: 0, y: 0, width: 1, height: 1 }, node: { sessionKey: '', backendNodeId: 5, frameId: 'top' } } as unknown,
      band: null as unknown
    },
    attachedTargets: () => [{ sessionKey: '', targetId: 't', type: 'page', url: 'u' }],
    isActive: true,
    isFrozen: false,
    capture: capture as unknown
  }
  const expire = vi.fn(async () => ['old.md'])
  const picks = {
    forTab: vi.fn(() => pick as unknown),
    faults: new PickFaults(),
    bench: new PickBench(),
    store: { expire },
    bandDrawn: null as ((tabId: string, box: unknown, state: { strips: readonly unknown[] }) => void) | null
  }
  const rt = { tabs: { list: () => [tab] }, picks } as unknown as BrowserRuntime
  return { rt, pick, picks, expire }
}

describe('createBrowserPickTestHook', () => {
  it('reads the highlight Erfana asked for, the targets and the pick state', () => {
    const { rt, pick } = runtime()
    const hook = createBrowserPickTestHook(() => rt)
    expect(hook.highlight('browser-tab-1')).toEqual({ label: 'span#a 1 × 1', box: { x: 0, y: 0, width: 1, height: 1 }, sessionKey: '', backendNodeId: 5, frameId: 'top' })
    expect(hook.attachedTargets('browser-tab-1')).toEqual([{ sessionKey: '', targetId: 't', type: 'page', url: 'u' }])
    expect(hook.state('browser-tab-1')).toEqual({
      active: true,
      frozen: false,
      capture: { id: 'c'.repeat(32), index: 2, firstIndex: 3, summary: { name: 'span#a' }, afterNavigation: false, written: ['a.md'], pickPoint: { x: 1, y: 2 } }
    })
    pick.highlight.record = null
    pick.capture = null
    expect(hook.highlight('browser-tab-1')).toBeNull()
    expect(hook.state('browser-tab-1').capture).toBeNull()
  })

  it('arms and resets the faults, the slow hint lookup on the main clock included', async () => {
    const { rt, picks } = runtime()
    const hook = createBrowserPickTestHook(() => rt)
    hook.armEmptyCaptures(1)
    hook.armCaptureFailures(1)
    hook.armWriteFailures(1)
    hook.armHints({ delayMs: 50 })
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 50)
    await picks.faults.hintsHook()
    hook.armHints({ throws: true })
    await expect(picks.faults.hintsHook()).rejects.toThrow()
    expect(picks.faults.takeEmptyCapture()).toBe(true)
    hook.resetFaults()
    expect(picks.faults.takeCaptureFailure()).toBe(false)
  })

  it('025-AC-034 sets and clears the live outline’s test colours, reads the band as drawn, and gives the page as painted now', async () => {
    const { rt, picks, pick } = runtime()
    const hook = createBrowserPickTestHook(() => rt)
    const pair = { ink: { r: 255, g: 0, b: 255, a: 1 }, paper: { r: 255, g: 255, b: 0, a: 1 } }
    hook.setHighlightColours(pair)
    expect(picks.faults.highlightColours()).toEqual(pair)
    hook.setHighlightColours(null)
    expect(picks.faults.highlightColours()).toBeNull()
    hook.setHighlightColours(pair)
    hook.resetFaults()
    expect(picks.faults.highlightColours()).toBeNull()
    expect(hook.band('browser-tab-1')).toBeNull()
    const state = { bounds: { x: 1, y: 2, width: 3, height: 4 }, strips: [{ tone: 'ink', rect: { x: 0, y: 0, width: 3, height: 1 } }], colours: { ink: '#ff00ff', paper: '#ffff00' } }
    pick.highlight.band = state
    const read = hook.band('browser-tab-1')
    expect(read).toEqual(state)
    // A copy: the test cannot reach into the band's own record.
    expect(read).not.toBe(state)
    expect(read?.strips[0].rect).not.toBe(state.strips[0].rect)
    expect(await hook.pagePng('browser-tab-1')).toBe(Buffer.from('png bytes').toString('base64'))
    await expect(hook.pagePng('browser-tab-9')).rejects.toThrow('No browser tab browser-tab-9')
  })

  it('runs the expiry sweep on the main clock and reads and clears the bench', async () => {
    const { rt, picks, expire } = runtime()
    const hook = createBrowserPickTestHook(() => rt)
    expect(await hook.expire('/p')).toEqual(['old.md'])
    expect(expire).toHaveBeenCalledWith('/p', new Date(Date.UTC(2026, 10, 10)))
    picks.bench.record('send', 5)
    expect(hook.bench('send')).toEqual([5])
    hook.clearBench()
    expect(hook.bench('send')).toEqual([])
  })

  it('025-AC-049 records each band draw per tab on its clock, from the latest recordBandDraws on', () => {
    const { rt, picks } = runtime()
    let now = 1_000
    const hook = createBrowserPickTestHook(() => rt, () => now)
    expect(picks.bandDrawn).toBeNull()
    hook.recordBandDraws()
    const box = { x: 1, y: 2, width: 3, height: 4 }
    picks.bandDrawn!('browser-tab-1', box, { strips: [1, 2, 3, 4, 5, 6, 7, 8] })
    now = 1_250
    picks.bandDrawn!('browser-tab-2', { x: 0, y: 0, width: 1, height: 1 }, { strips: [1] })
    picks.bandDrawn!('browser-tab-1', { x: 5, y: 6, width: 7, height: 8 }, { strips: [1, 2] })
    const draws = hook.bandDraws('browser-tab-1')
    expect(draws).toEqual([
      { atUs: 1_000, box, strips: 8 },
      { atUs: 1_250, box: { x: 5, y: 6, width: 7, height: 8 }, strips: 2 }
    ])
    // Copies: neither the band's box nor the hook's own record can be changed from outside.
    expect(draws[0].box).not.toBe(box)
    ;(draws[0].box as { x: number }).x = 99
    expect(hook.bandDraws('browser-tab-1')[0].box.x).toBe(1)
    expect(hook.bandDraws('browser-tab-2')).toHaveLength(1)
    expect(hook.bandDraws('browser-tab-9')).toEqual([])
    // A new recording forgets the earlier draws.
    hook.recordBandDraws()
    expect(hook.bandDraws('browser-tab-1')).toEqual([])
  })

  it('025-AC-049 keeps the latest BAND_DRAW_RECORDS band draws, oldest dropped first', () => {
    const { rt, picks } = runtime()
    let now = 0
    const hook = createBrowserPickTestHook(() => rt, () => now++)
    hook.recordBandDraws()
    for (let i = 0; i < BAND_DRAW_RECORDS + 1; i++) picks.bandDrawn!('browser-tab-1', { x: i, y: 0, width: 1, height: 1 }, { strips: [] })
    const draws = hook.bandDraws('browser-tab-1')
    expect(draws).toHaveLength(BAND_DRAW_RECORDS)
    expect(draws[0].box.x).toBe(1)
    expect(draws.at(-1)?.box.x).toBe(BAND_DRAW_RECORDS)
  })

  it('025-AC-049 stamps band draws on process.hrtime in µs by default', () => {
    const { rt, picks } = runtime()
    const hrtime = vi.spyOn(process.hrtime, 'bigint').mockReturnValue(123_456_789n)
    try {
      const hook = createBrowserPickTestHook(() => rt)
      hook.recordBandDraws()
      picks.bandDrawn!('browser-tab-1', { x: 0, y: 0, width: 1, height: 1 }, { strips: [] })
      expect(hook.bandDraws('browser-tab-1')[0].atUs).toBe(123_456)
    } finally {
      hrtime.mockRestore()
    }
  })

  it('throws for a missing runtime, an unknown tab and a tab without a pick pipeline', () => {
    expect(() => createBrowserPickTestHook(() => null).recordBandDraws()).toThrow('The browser runtime is not installed')
    expect(() => createBrowserPickTestHook(() => null).highlight('browser-tab-1')).toThrow('The browser runtime is not installed')
    const { rt, picks } = runtime()
    const hook = createBrowserPickTestHook(() => rt)
    expect(() => hook.state('browser-tab-9')).toThrow('No browser tab browser-tab-9')
    picks.forTab.mockReturnValueOnce(null)
    expect(() => hook.state('browser-tab-1')).toThrow('has no pick pipeline')
  })
})
