// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import type { TimerHandle } from '../../../../shared/clock'
import { SENT_FLASH_MS, centre, flashThenHide, sameNode } from './pickFlash'

const NODE = { sessionKey: 's1', backendNodeId: 7, frameId: 'f1' }

function setup(shown: boolean) {
  const order: string[] = []
  const timers: Array<{ ms: number; run: () => void }> = []
  const highlight = {
    show: vi.fn(async () => {
      order.push('show')
      return shown ? { node: NODE, box: null, label: 'button' } : null
    }),
    hide: vi.fn(async () => {
      order.push('hide')
    })
  }
  const clock = {
    setTimeout: vi.fn((run: () => void, ms: number) => {
      timers.push({ ms, run })
      return 0 as unknown as TimerHandle
    })
  }
  return { highlight, clock, order, timers }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('flashThenHide (025-FR-060)', () => {
  it('outlines the sent element for one second on the live page, then hides it', async () => {
    const s = setup(true)
    const done = flashThenHide(s.highlight, NODE, s.clock, () => false)
    await tick()
    expect(s.highlight.show).toHaveBeenCalledWith(NODE)
    expect(s.highlight.hide).not.toHaveBeenCalled()
    expect(s.timers.map((t) => t.ms)).toEqual([SENT_FLASH_MS])
    s.timers[0].run()
    expect(await done).toBe(false)
    expect(s.order).toEqual(['show', 'hide'])
  })

  it('only hides when nothing was sent', async () => {
    const s = setup(true)
    expect(await flashThenHide(s.highlight, null, s.clock, () => false)).toBe(false)
    expect(s.order).toEqual(['hide'])
    expect(s.timers).toHaveLength(0)
  })

  it('skips the flash when the element is gone from the page', async () => {
    const s = setup(false)
    expect(await flashThenHide(s.highlight, NODE, s.clock, () => false)).toBe(false)
    expect(s.order).toEqual(['show', 'hide'])
    expect(s.timers).toHaveLength(0)
  })

  it('leaves the outline to a pick mode that came back during the flash', async () => {
    const s = setup(true)
    let on = false
    const done = flashThenHide(s.highlight, NODE, s.clock, () => on)
    await tick()
    on = true
    s.timers[0].run()
    expect(await done).toBe(true)
    expect(s.highlight.hide).not.toHaveBeenCalled()
  })
})

describe('sameNode and centre', () => {
  it('compares session and backend node id', () => {
    expect(sameNode(NODE, { ...NODE, frameId: 'other' })).toBe(true)
    expect(sameNode(NODE, { ...NODE, backendNodeId: 8 })).toBe(false)
    expect(sameNode(NODE, { ...NODE, sessionKey: 's2' })).toBe(false)
  })

  it('gives a box centre, or the origin without a box', () => {
    expect(centre({ x: 10, y: 20, width: 30, height: 40 })).toEqual({ x: 25, y: 40 })
    expect(centre(null)).toEqual({ x: 0, y: 0 })
  })
})
