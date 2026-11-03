// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import { PickReader } from './pickCdp'
import { watchFrameGone } from './pickFrameGone'
import { PickFrames } from './pickFrames'
import type { HighlightRecord } from './pickHighlight'
import { samplePage } from './__test-helpers__/samplePage'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function setup(record: HighlightRecord | null) {
  const page = samplePage()
  const reader = new PickReader(page.cdp)
  const frames = new PickFrames(page.cdp, reader)
  let live = record
  const end = vi.fn(async () => {
    live = null
  })
  const stop = watchFrameGone(page.cdp, frames, () => live, end)
  const detached = (params: unknown) => page.cdp.emit('protocolEvent', { target: page.cdp.targets[0], method: 'Page.frameDetached', params })
  return { page, end, stop, detached, setLive: (r: HighlightRecord | null) => (live = r) }
}

const inFrame = (sessionKey: string, frameId: string): HighlightRecord => ({ node: { sessionKey, backendNodeId: 9, frameId }, box: null, label: 'button 1 × 1' })

describe('watchFrameGone (025-FR-029)', () => {
  it('ends the highlight when its same-process frame left the tree', async () => {
    const s = setup(inFrame('', 'sub'))
    s.detached({ frameId: 'sub', reason: 'remove' })
    await settle()
    expect(s.end).toHaveBeenCalledTimes(1)
  })

  it('ends it when its out-of-process frame target detached', async () => {
    const s = setup(inFrame('S1', 'F1'))
    const target = s.page.cdp.targets.find((t) => t.sessionKey === 'S1')!
    s.page.cdp.targets = s.page.cdp.targets.filter((t) => t !== target)
    s.page.cdp.emit('targetDetached', target)
    await settle()
    expect(s.end).toHaveBeenCalledTimes(1)
  })

  it('keeps it for a frame still there, a process swap, other events, or no live highlight', async () => {
    const s = setup(inFrame('', 'top'))
    s.detached({ frameId: 'top', reason: 'remove' })
    s.detached({ frameId: 'sub', reason: 'swap' })
    s.page.cdp.emit('protocolEvent', { target: s.page.cdp.targets[0], method: 'Page.frameNavigated', params: {} })
    s.setLive(null)
    s.page.cdp.emit('targetDetached', s.page.cdp.targets[0])
    await settle()
    expect(s.end).not.toHaveBeenCalled()
  })

  it('does not end a newer highlight that replaced the one checked', async () => {
    const s = setup(inFrame('', 'sub'))
    s.detached({ frameId: 'sub', reason: 'remove' })
    s.setLive(inFrame('', 'top'))
    await settle()
    expect(s.end).not.toHaveBeenCalled()
  })

  it('stops listening', () => {
    const s = setup(null)
    s.stop()
    expect(s.page.cdp.listenerCount('protocolEvent')).toBe(1) // PickFrames' own
    expect(s.page.cdp.listenerCount('targetDetached')).toBe(0)
  })
})
