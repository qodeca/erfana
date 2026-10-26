// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The top-frame scripts (docs/designs/html-preview-comments.md §7.5 steps 3
 * and 6; M-041): what they do in a stand-in window, and the parsers main
 * trusts their results through.
 */
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  parseFrameOffset,
  parseTopScroll,
  READ_SCROLL_SCRIPT,
  restoreScrollScript,
  waitFramesScript
} from './commentScripts'

/** A window that scrolls to what it is asked, up to `maxY`, and runs frames on demand. */
function fakeWindow(maxY: number, frames: unknown[] = []) {
  const queued: Array<() => void> = []
  let clock = 0
  const listeners = new Map<string, (event: { isTrusted: boolean }) => void>()
  const win = {
    scrollX: 0,
    scrollY: 0,
    scrollTo(x: number, y: number) {
      win.scrollX = x
      win.scrollY = Math.min(y, maxY)
    },
    addEventListener: (kind: string, listener: (event: { isTrusted: boolean }) => void) => listeners.set(kind, listener),
    removeEventListener: (kind: string) => listeners.delete(kind),
    ...Object.fromEntries(frames.map((frame, index) => [index, frame]))
  }
  const context = {
    window: win,
    location: { hash: '' },
    performance: { now: () => clock },
    requestAnimationFrame: (run: () => void) => queued.push(run),
    document: {
      querySelectorAll: () =>
        frames.map(contentWindow => ({
          contentWindow,
          clientLeft: 2,
          clientTop: 3,
          getBoundingClientRect: () => ({ left: 100, top: 50 })
        }))
    },
    getComputedStyle: () => ({ paddingLeft: '4px', paddingTop: '' }),
    Promise
  }
  const runFrames = (count: number, step = 16): void => {
    for (let i = 0; i < count && queued.length > 0; i++) {
      clock += step
      queued.splice(0).forEach(run => run())
    }
  }
  return { context, win, listeners, runFrames, setMaxY: (y: number) => (maxY = y) }
}

describe('commentScripts', () => {
  it('READ_SCROLL_SCRIPT reads the scroll and hash', () => {
    const { context, win } = fakeWindow(5000)
    win.scrollY = 300
    context.location.hash = '#a'
    expect(runInNewContext(READ_SCROLL_SCRIPT, context)).toEqual({ x: 0, y: 300, hash: '#a' })
  })

  it('M-041 the restore sets the hash and scrolls until the page is tall enough', async () => {
    const fake = fakeWindow(100)
    const done = runInNewContext(restoreScrollScript({ x: 0, y: 900, hash: '#pricing' }), fake.context) as Promise<boolean>
    expect(fake.context.location.hash).toBe('#pricing')
    fake.runFrames(3)
    fake.setMaxY(5000)
    fake.runFrames(1)
    expect(await done).toBe(true)
    expect(fake.win.scrollY).toBe(900)
    expect(fake.listeners.size).toBe(0)
  })

  it('M-041 the restore gives up when the reader scrolls, or after its budget', async () => {
    const stopped = fakeWindow(100)
    const byReader = runInNewContext(restoreScrollScript({ x: 0, y: 900, hash: '' }), stopped.context) as Promise<boolean>
    stopped.listeners.get('wheel')?.({ isTrusted: false })
    stopped.runFrames(1)
    stopped.listeners.get('wheel')?.({ isTrusted: true })
    stopped.runFrames(1)
    expect(await byReader).toBe(false)

    const short = fakeWindow(100)
    const byBudget = runInNewContext(restoreScrollScript({ x: 0, y: 900, hash: '' }), short.context) as Promise<boolean>
    short.runFrames(100, 50)
    expect(await byBudget).toBe(false)
  })

  it('the frame wait reports a child frame\'s content origin, or null when it is gone', async () => {
    const child = {}
    const fake = fakeWindow(0, [child])
    const offset = runInNewContext(waitFramesScript(0), fake.context) as Promise<unknown>
    fake.runFrames(2)
    expect(await offset).toEqual({ x: 106, y: 53 })

    const top = fakeWindow(0)
    const none = runInNewContext(waitFramesScript(-1), top.context) as Promise<unknown>
    top.runFrames(2)
    expect(await none).toEqual({ x: 0, y: 0 })

    const missing = runInNewContext(waitFramesScript(3), top.context) as Promise<unknown>
    top.runFrames(2)
    expect(await missing).toBeNull()
    expect(waitFramesScript(1.5)).toContain('const index = -1')
  })

  it('parses only well-formed, bounded results', () => {
    expect(parseTopScroll({ x: -3, y: 10, hash: '' })).toEqual({ x: 0, y: 10, hash: '' })
    for (const bad of [null, 'x', { x: 1, y: Number.POSITIVE_INFINITY, hash: '' }, { x: 1, y: 2 }, { x: 1, y: 2, hash: 'h'.repeat(513) }, { x: 2e7, y: 0, hash: '' }]) {
      expect(parseTopScroll(bad)).toBeUndefined()
    }
    expect(parseFrameOffset({ x: 1.5, y: -2 })).toEqual({ x: 1.5, y: -2 })
    for (const bad of [null, 7, { x: 'a', y: 1 }, { x: 1, y: Number.NaN }]) {
      expect(parseFrameOffset(bad)).toBeUndefined()
    }
  })
})
