// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'

const { setTimeoutSpy } = vi.hoisted(() => ({ setTimeoutSpy: vi.fn((cb: () => void) => (cb(), 1)) }))
vi.mock('../utils/mainClock', () => ({ mainClock: { now: () => Date.UTC(2026, 10, 10), setTimeout: setTimeoutSpy } }))

import type { BrowserRuntime } from '../services/browser/browserAppSetup'
import { PickBench, PickFaults } from '../services/browser/pick/pickSupport'
import { createBrowserPickTestHook } from './browserPickHook'

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
  const picks = { forTab: vi.fn(() => pick as unknown), faults: new PickFaults(), bench: new PickBench(), store: { expire } }
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

  it('throws for a missing runtime, an unknown tab and a tab without a pick pipeline', () => {
    expect(() => createBrowserPickTestHook(() => null).highlight('browser-tab-1')).toThrow('The browser runtime is not installed')
    const { rt, picks } = runtime()
    const hook = createBrowserPickTestHook(() => rt)
    expect(() => hook.state('browser-tab-9')).toThrow('No browser tab browser-tab-9')
    picks.forTab.mockReturnValueOnce(null)
    expect(() => hook.state('browser-tab-1')).toThrow('has no pick pipeline')
  })
})
