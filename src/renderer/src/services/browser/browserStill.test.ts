// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import type { StillResponse } from '../../../../shared/ipc/browser-tab-pick-schema'
import { createBrowserStill, type BrowserStillDeps } from './browserStill'

const TAB = 'browser-tab-1'
const PANEL = 'browser-panel-1'
const BITMAP = { data: new Uint8Array(16), width: 2, height: 2 }
const OK: StillResponse = { still: BITMAP.data, width: 2, height: 2 }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

function setup(over: Partial<BrowserStillDeps> = {}) {
  const log: string[] = []
  let shown: (() => void) | null = null
  const deps: BrowserStillDeps = {
    capture: vi.fn(async () => OK),
    nextFrame: vi.fn(async () => {
      log.push('frame')
    }),
    panelOf: vi.fn(() => ({ panelId: PANEL, live: true })),
    setImage: vi.fn((_tab, image, source) => {
      log.push(image === null ? 'image:none' : `image:${source}`)
    }),
    setCover: vi.fn((_panel, covered) => {
      log.push(`cover:${covered}`)
    }),
    whenShown: vi.fn((_tab, done) => {
      shown = done
      return () => log.push('cancelReturn')
    }),
    ...over
  }
  return { still: createBrowserStill(deps), deps, log, pageBack: () => shown?.() }
}

describe('browserStill', () => {
  it('shows the picture, waits two frames, then covers the page; returns it before dropping the picture', async () => {
    const { still, log, pageBack } = setup()
    expect(await still.hold(TAB, 'more')).toBe(true)
    expect(log).toEqual(['image:page', 'frame', 'frame', 'cover:true'])
    still.release(TAB, 'more')
    expect(log.slice(4)).toEqual(['cover:false'])
    pageBack()
    expect(log.slice(5)).toEqual(['image:none'])
    expect(still.holds(TAB, 'more')).toBe(false)
  })

  it('keeps the picture while another holder holds it', async () => {
    const { still, deps } = setup()
    await still.hold(TAB, 'more')
    await still.hold(TAB, 'suggestions')
    still.release(TAB, 'more')
    expect(deps.setCover).not.toHaveBeenCalledWith(PANEL, false)
    still.release(TAB, 'suggestions')
    expect(deps.setCover).toHaveBeenLastCalledWith(PANEL, false)
    still.release(TAB, 'suggestions')
    still.release('browser-tab-9', 'x')
    expect(deps.setCover).toHaveBeenCalledTimes(3)
  })

  it('answers false and takes nothing for an Erfana page or an unknown tab', async () => {
    const erfana = setup({ panelOf: () => ({ panelId: PANEL, live: false }) })
    expect(await erfana.still.hold(TAB, 'more')).toBe(false)
    expect(erfana.deps.capture).not.toHaveBeenCalled()
    const unknown = setup({ panelOf: () => null })
    expect(await unknown.still.hold(TAB, 'more')).toBe(false)
    expect(await unknown.still.showPick(TAB, 'pick', BITMAP)).toBe(false)
  })

  it('answers false for a refused or failed capture, without covering', async () => {
    const refused = setup({ capture: async () => ({ error: 'The page is gone' }) })
    expect(await refused.still.hold(TAB, 'more')).toBe(false)
    const failed = setup({ capture: async () => Promise.reject(new Error('ipc')) })
    expect(await failed.still.hold(TAB, 'more')).toBe(false)
    expect(refused.deps.setCover).not.toHaveBeenCalled()
    expect(failed.deps.setImage).not.toHaveBeenCalled()
  })

  it('throws away a capture whose holder let go before it arrived', async () => {
    const pending = deferred<StillResponse>()
    const { still, deps } = setup({ capture: () => pending.promise })
    const held = still.hold(TAB, 'more')
    still.release(TAB, 'more')
    pending.resolve(OK)
    expect(await held).toBe(false)
    expect(deps.setImage).not.toHaveBeenCalledWith(TAB, BITMAP, 'page')
  })

  it('does not cover when the holder lets go during the two frames', async () => {
    const frame = deferred<void>()
    const { still, deps } = setup({ nextFrame: () => frame.promise })
    const shown = still.showPick(TAB, 'pick', BITMAP)
    still.release(TAB, 'pick')
    frame.resolve()
    expect(await shown).toBe(false)
    expect(deps.setCover).not.toHaveBeenCalledWith(PANEL, true)
  })

  it('a new picture cancels a pending return, so the page stays covered', async () => {
    const { still, log } = setup()
    await still.hold(TAB, 'more')
    still.release(TAB, 'more')
    expect(await still.showPick(TAB, 'pick', BITMAP)).toBe(true)
    expect(log).toContain('cancelReturn')
    expect(log.at(-1)).toBe('cover:true')
  })

  it('keeps the picture when a holder arrived before the page came back', async () => {
    const { still, deps, pageBack } = setup()
    await still.hold(TAB, 'more')
    still.release(TAB, 'more')
    // A holder that is still taking its picture: the return must not drop the one shown.
    const slow = deferred<StillResponse>()
    vi.mocked(deps.capture).mockReturnValueOnce(slow.promise)
    const second = still.hold(TAB, 'suggestions')
    pageBack()
    expect(deps.setImage).not.toHaveBeenCalledWith(TAB, null, 'page')
    slow.resolve(OK)
    expect(await second).toBe(true)
  })
})
