// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown Preview's driver for the shared reveal suite (plan step 10):
 * the real preview, host and drawer, walked with the arrow keys – the drawer's
 * "Show in preview" (R-10) – with no mouse. jsdom has no layout, so every
 * element is drawn at its own box, and a block the preview did not render
 * stands for a target that cannot show.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'
import { TEST_IDS } from '../../../../constants/testids'
import { REVEAL_FLASH_MS } from '../../../../../../shared/comments/overlayCore/reveal'
import type { RevealDriver, RevealTarget } from '../../../../../../shared/comments/__conformance__/overlayDriver'
import { Harness, fileView, installApi, resetStores, setSettings, thread } from './harness'

const DOC = ['First block', '', 'Plain block', '', '<details>', '<summary>More</summary>', '', 'Folded block', '', '</details>', ''].join('\n')
/** Where each thread's target is; line 40 was not rendered. */
const LINES: Readonly<Record<RevealTarget | 'first', number>> = { first: 1, plain: 3, folded: 8, hidden: 40 }
const ORDER = ['first', 'plain', 'folded', 'hidden'] as const
const TOPS: Readonly<Record<string, number>> = { 'First block': 0, 'Plain block': 40, 'Folded block': 80 }
const BOX_OF = (el: Element): DOMRect => {
  const top = TOPS[(el.textContent ?? '').trim()]
  return top === undefined ? new DOMRect(0, 0, 800, 600) : new DOMRect(10, top, 200, 30)
}

/**
 * A fresh preview with a comment on each kind of target and the drawer open.
 *
 * @returns The driver.
 */
export async function createMarkdownRevealDriver(): Promise<RevealDriver> {
  resetStores()
  const threads = ORDER.map(name => thread(name, LINES[name], 'p'))
  const api = installApi(
    fileView(threads),
    ORDER.map(name => ({ threadKey: name, line: LINES[name], tag: 'p' }))
  )
  setSettings()
  const box = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return BOX_OF(this)
  })
  const rects = vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return (this.closest('details:not([open])') === null || this.tagName === 'SUMMARY' ? [BOX_OF(this)] : []) as unknown as DOMRectList
  })
  const scrolled: Element[] = []
  const scroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this)
  }
  const view = render(<Harness content={DOC} />)
  await waitFor(() => expect(api.list).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST).getAttribute('aria-label')).toMatch(/^4 comments/))
  fireEvent.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
  const list = await screen.findByTestId(TEST_IDS.COMMENT_DRAWER_LIST)

  const nameOf = (el: Element | null | undefined): RevealTarget | null => {
    const top = el === null || el === undefined ? undefined : TOPS[(el.textContent ?? '').trim()]
    return top === 40 ? 'plain' : top === 80 ? 'folded' : null
  }
  vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ['setTimeout', 'clearTimeout'] })
  let at = 0
  return {
    async show(target) {
      const row = ORDER.indexOf(target)
      for (; at < row; at += 1) {
        await act(async () => {
          fireEvent.keyDown(list, { key: 'ArrowDown' })
        })
      }
    },
    scrolledTo: () => nameOf(scrolled.at(-1)),
    flashed() {
      const flash = screen.queryByTestId(TEST_IDS.COMMENT_HOST_FLASH)
      if (flash === null) return null
      return Number.parseFloat(flash.style.top) === 40 ? 'plain' : Number.parseFloat(flash.style.top) === 80 ? 'folded' : null
    },
    sectionOpen: () => document.querySelector('details')?.open === true,
    async flashEnds() {
      await act(async () => {
        vi.advanceTimersByTime(REVEAL_FLASH_MS)
      })
    },
    dispose() {
      vi.useRealTimers()
      view.unmount()
      box.mockRestore()
      rects.mockRestore()
      if (scroll === undefined) Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      else Object.defineProperty(Element.prototype, 'scrollIntoView', scroll)
      resetStores()
    }
  }
}
