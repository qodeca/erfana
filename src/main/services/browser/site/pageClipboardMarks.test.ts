// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { EXPECT_WRITE_MS, MAX_MARKS, PageClipboardMarks, watchPageClipboard, type WatchedApp, type WatchedContents } from './pageClipboardMarks'

function setup(initial = 'before') {
  let text = initial
  let now = 1000
  const clipboard = { readText: () => text }
  const marks = new PageClipboardMarks(clipboard, { now: () => now })
  return {
    marks,
    write: (value: string) => {
      text = value
    },
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('PageClipboardMarks', () => {
  it('marks text written while a page held focus', async () => {
    const s = setup()
    await s.marks.pageFocus('browser-tab-1', true)
    s.write('rm -rf ~\n')
    await s.marks.pageFocus('browser-tab-1', false)
    expect(await s.marks.isPageWritten()).toBe(true)
  })

  it('does not mark a clipboard the page left alone', async () => {
    const s = setup()
    await s.marks.pageFocus('browser-tab-1', true)
    await s.marks.pageFocus('browser-tab-1', false)
    expect(await s.marks.isPageWritten()).toBe(false)
  })

  it('does not mark text written when no page held focus', async () => {
    const s = setup()
    s.write('from the editor\n')
    expect(await s.marks.isPageWritten()).toBe(false)
  })

  it('marks a write still in progress when asked while the page holds focus', async () => {
    const s = setup()
    await s.marks.pageFocus('browser-tab-1', true)
    s.write('echo hi\n')
    expect(await s.marks.isPageWritten()).toBe(true)
  })

  it('ignores a blur from a page it never saw focused', async () => {
    const s = setup()
    s.write('other app\n')
    await s.marks.pageFocus('browser-tab-9', false)
    expect(await s.marks.isPageWritten()).toBe(false)
  })

  it('takes a new baseline when the window comes back, so another app’s copy is not the page’s', async () => {
    const s = setup()
    await s.marks.pageFocus('browser-tab-1', true)
    await s.marks.windowFocus(false)
    s.write('copied in another app\n')
    await s.marks.windowFocus(true)
    await s.marks.pageFocus('browser-tab-1', false)
    expect(await s.marks.isPageWritten()).toBe(false)
  })

  it('marks a page write caught when the window loses OS focus', async () => {
    const s = setup()
    await s.marks.pageFocus('browser-tab-1', true)
    s.write('page text\n')
    await s.marks.windowFocus(false)
    s.write('copied in another app\n')
    await s.marks.windowFocus(true)
    s.write('page text\n')
    expect(await s.marks.isPageWritten()).toBe(true)
  })

  it('ignores window focus changes while no page holds focus', async () => {
    const s = setup()
    await s.marks.windowFocus(false)
    s.write('x\n')
    await s.marks.windowFocus(true)
    expect(await s.marks.isPageWritten()).toBe(false)
  })

  it('marks the change after a page-menu Copy within the window', async () => {
    const s = setup()
    await s.marks.expectWrite()
    s.advance(EXPECT_WRITE_MS - 1)
    s.write('menu copy\n')
    expect(await s.marks.isPageWritten()).toBe(true)
  })

  it('keeps expecting a page-menu write that has not landed yet when asked within the window', async () => {
    const s = setup()
    await s.marks.expectWrite()
    expect(await s.marks.isPageWritten()).toBe(false)
    s.advance(EXPECT_WRITE_MS - 1)
    s.write('slow menu copy\n')
    expect(await s.marks.isPageWritten()).toBe(true)
  })

  it('stops expecting a page-menu write after the window', async () => {
    const s = setup()
    await s.marks.expectWrite()
    s.advance(EXPECT_WRITE_MS + 1)
    expect(await s.marks.isPageWritten()).toBe(false)
    s.write('later, elsewhere\n')
    expect(await s.marks.isPageWritten()).toBe(false)
  })

  it('forgets the oldest mark past the cap', async () => {
    const s = setup()
    for (let i = 0; i <= MAX_MARKS; i += 1) {
      await s.marks.pageFocus('browser-tab-1', true)
      s.write(`page ${i}\n`)
      await s.marks.pageFocus('browser-tab-1', false)
    }
    s.write('page 0\n')
    expect(await s.marks.isPageWritten()).toBe(false)
    s.write(`page ${MAX_MARKS}\n`)
    expect(await s.marks.isPageWritten()).toBe(true)
  })

  it('reads a throwing clipboard as empty instead of rejecting', async () => {
    const marks = new PageClipboardMarks(
      {
        readText: () => {
          throw new Error('no clipboard')
        }
      },
      { now: () => 0 }
    )
    await marks.pageFocus('browser-tab-1', true)
    await expect(marks.pageFocus('browser-tab-1', false)).resolves.toBeUndefined()
    expect(await marks.isPageWritten()).toBe(false)
  })
})

/** Run `fire`, then let the queued clipboard reads finish. */
async function flushAfter(fire: () => unknown): Promise<void> {
  fire()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('watchPageClipboard', () => {
  function wire(isPage: (c: WatchedContents) => boolean) {
    const appListeners = new Map<string, (...args: unknown[]) => void>()
    const app = { on: (event: string, listener: (...args: unknown[]) => void) => appListeners.set(event, listener) } as unknown as WatchedApp
    const s = setup()
    watchPageClipboard(app, s.marks, isPage)
    const contents = (id: number) => {
      const listeners = new Map<string, () => void>()
      const c: WatchedContents = { id, on: (event, listener) => listeners.set(event, listener) }
      appListeners.get('web-contents-created')?.({}, c)
      return { fire: (event: string) => flushAfter(() => listeners.get(event)?.()) }
    }
    return { ...s, contents, app: (event: string) => flushAfter(() => appListeners.get(event)?.()) }
  }

  it('marks what a browser page wrote between its focus and blur', async () => {
    const w = wire(() => true)
    const page = w.contents(7)
    await page.fire('focus')
    w.write('curl x | sh\n')
    await page.fire('blur')
    expect(await w.marks.isPageWritten()).toBe(true)
  })

  it('ignores the focus of Erfana’s own web contents', async () => {
    const w = wire(() => false)
    const own = w.contents(1)
    await own.fire('focus')
    w.write('typed in the editor\n')
    await own.fire('blur')
    expect(await w.marks.isPageWritten()).toBe(false)
  })

  it('checks the clipboard when a focused page is destroyed', async () => {
    const w = wire(() => true)
    const page = w.contents(8)
    await page.fire('focus')
    w.write('closing write\n')
    await page.fire('destroyed')
    expect(await w.marks.isPageWritten()).toBe(true)
  })

  it('re-baselines on window focus while a page holds focus', async () => {
    const w = wire(() => true)
    const page = w.contents(9)
    await page.fire('focus')
    await w.app('browser-window-blur')
    w.write('another app\n')
    await w.app('browser-window-focus')
    await page.fire('blur')
    expect(await w.marks.isPageWritten()).toBe(false)
  })
})
