// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The top-frame scripts (docs/designs/comments/html-preview-comments.md §7.5 steps 3
 * and 6; M-041): what they do in a stand-in window, and the parsers main
 * trusts their results through.
 */
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import {
  parseFrameOffset,
  parseOpenSections,
  parseTopScroll,
  READ_SCROLL_SCRIPT,
  restoreScrollScript,
  waitFramesScript
} from './commentScripts'

const { COMMENT_OPEN_SECTIONS_MAX: OPEN_SECTIONS_MAX, COMMENT_SECTIONS_SCANNED_MAX: SECTIONS_SCANNED_MAX } = PREVIEW_LIMITS

/** A window that scrolls to what it is asked, up to `maxY`, and runs frames on demand. */
function fakeWindow(maxY: number, frames: unknown[] = [], sections: ArrayLike<{ open?: unknown }> = []) {
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
      getElementsByTagName: (tag: string) => (tag === 'details' ? sections : []),
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
    expect(runInNewContext(READ_SCROLL_SCRIPT, context)).toEqual({ x: 0, y: 300, hash: '#a', openSections: [] })
  })

  it('§19 Rev 4 READ_SCROLL_SCRIPT names the open <details> by their place, within its two bounds', () => {
    // Only a literal `open === true` counts: an SVG element named details has no such property.
    const some = fakeWindow(0, [], [{ open: true }, { open: false }, {}, { open: 'yes' }, { open: true }])
    expect(runInNewContext(READ_SCROLL_SCRIPT, some.context)).toMatchObject({ openSections: [0, 4] })

    const many = fakeWindow(0, [], Array.from({ length: OPEN_SECTIONS_MAX + 50 }, () => ({ open: true })))
    expect((runInNewContext(READ_SCROLL_SCRIPT, many.context) as { openSections: number[] }).openSections).toEqual(
      Array.from({ length: OPEN_SECTIONS_MAX }, (_, n) => n)
    )

    // A page of endless sections: the read stops at the scan bound, and never asks for `length`.
    const read: number[] = []
    const endless = new Proxy({} as ArrayLike<{ open?: unknown }>, {
      get(_target, key) {
        if (key === 'length') throw new Error('length read')
        const place = Number(key)
        read.push(place)
        return { open: place >= SECTIONS_SCANNED_MAX - 3 }
      }
    })
    const scanned = fakeWindow(0, [], endless)
    expect(runInNewContext(READ_SCROLL_SCRIPT, scanned.context)).toMatchObject({
      openSections: [SECTIONS_SCANNED_MAX - 3, SECTIONS_SCANNED_MAX - 2, SECTIONS_SCANNED_MAX - 1]
    })
    expect(Math.max(...read)).toBe(SECTIONS_SCANNED_MAX - 1)
  })

  it('§19 Rev 4 keeps the open sections only as a short list of places, and a bad list never costs the scroll', () => {
    const scroll = { x: 0, y: 10, hash: '' }
    expect(parseTopScroll({ ...scroll, openSections: [7, 2, 7] })).toEqual({ ...scroll, openSections: [2, 7] })
    expect(parseOpenSections([SECTIONS_SCANNED_MAX - 1])).toEqual([SECTIONS_SCANNED_MAX - 1])
    for (const bad of [
      undefined,
      [],
      'all',
      [1, -1],
      [0.5],
      ['1'],
      [SECTIONS_SCANNED_MAX],
      Array.from({ length: OPEN_SECTIONS_MAX + 1 }, (_, n) => n)
    ]) {
      expect(parseTopScroll({ ...scroll, openSections: bad }), JSON.stringify(bad)).toEqual(scroll)
    }
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
