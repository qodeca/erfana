// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearCommentDetails,
  clearPickTabIndex,
  copyWithoutCommentAttributes,
  setCommentDetails,
  setPickTabIndex,
  stripCommentAttributes,
  htmlWithoutCommentAttributes
} from './commentContentAttrs'

function block(html: string): HTMLElement {
  const holder = document.createElement('div')
  holder.innerHTML = html
  document.body.append(holder)
  return holder
}

afterEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

describe('commentContentAttrs', () => {
  it("C-11 (Markdown) aria-details points a block at its icon, and only the host's own is taken back", () => {
    const root = block('<p>One</p><p aria-details="own">Two</p>')
    const [mine, own] = root.querySelectorAll('p')
    setCommentDetails(mine as HTMLElement, 'icon-1')
    setCommentDetails(own as HTMLElement, 'icon-2')
    expect(mine.getAttribute('aria-details')).toBe('icon-1')
    expect(own.getAttribute('aria-details')).toBe('own')
    clearCommentDetails(mine as HTMLElement)
    clearCommentDetails(own as HTMLElement)
    expect(mine.hasAttribute('aria-details')).toBe(false)
    expect(own.getAttribute('aria-details')).toBe('own')
  })

  it("C-08 the picker's tabindex is written only where none was, and taken back only there", () => {
    const root = block('<p>One</p><p tabindex="0">Two</p>')
    const [plain, focusable] = root.querySelectorAll('p')
    expect(setPickTabIndex(plain as HTMLElement)).toBe(true)
    expect(setPickTabIndex(focusable as HTMLElement)).toBe(false)
    clearPickTabIndex(plain as HTMLElement)
    clearPickTabIndex(focusable as HTMLElement)
    expect(plain.hasAttribute('tabindex')).toBe(false)
    expect(focusable.getAttribute('tabindex')).toBe('0')
  })

  it('024-AC-032 the strip removes what the host wrote and every data-erf-comment marker, nothing else', () => {
    const root = block('<p aria-details="own" tabindex="0" data-line-start="2">Own</p><p>Mine</p>')
    const mine = root.querySelectorAll('p')[1] as HTMLElement
    setCommentDetails(mine, 'icon-1')
    setPickTabIndex(mine)
    mine.setAttribute('data-erf-comment-later', 'x')
    const copy = root.cloneNode(true) as HTMLElement
    stripCommentAttributes(copy)
    expect(copy.innerHTML).toBe('<p aria-details="own" tabindex="0" data-line-start="2">Own</p><p>Mine</p>')
    // The live content keeps them: only a copy is stripped.
    expect(mine.getAttribute('aria-details')).toBe('icon-1')
  })

  it('024-AC-032 the export HTML is read from a stripped copy; unmarked content is read as it is', () => {
    const plain = block('<p title="a &amp; b">x</p>')
    expect(htmlWithoutCommentAttributes(plain)).toBe('<p title="a &amp; b">x</p>')
    const marked = block('<p>x</p>')
    setCommentDetails(marked.querySelector('p')!, 'icon-1')
    expect(htmlWithoutCommentAttributes(marked)).toBe('<p>x</p>')
    expect(marked.querySelector('p')!.getAttribute('aria-details')).toBe('icon-1')
  })

  describe('024-AC-032 a copy of the content', () => {
    function copyEvent(): { event: ClipboardEvent; data: Map<string, string> } {
      const data = new Map<string, string>()
      const event = new Event('copy', { cancelable: true }) as ClipboardEvent
      Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => data.set(type, value) } })
      return { event, data }
    }

    function selectText(el: Element): void {
      const range = document.createRange()
      range.selectNodeContents(el)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
    }

    it('024-AC-032 is left to the browser while the host wrote nothing into the content', () => {
      const content = block('<p>Plain words</p>')
      selectText(content)
      const { event, data } = copyEvent()
      expect(copyWithoutCommentAttributes(event, content)).toBe(false)
      expect(event.defaultPrevented).toBe(false)
      expect(data.size).toBe(0)
    })

    it('024-AC-032 is taken over as stripped HTML and plain text once the host wrote into it', () => {
      const content = block('<p>Plain words</p>')
      const p = content.querySelector('p')!
      setCommentDetails(p, 'icon-1')
      selectText(content)
      const { event, data } = copyEvent()
      const prevent = vi.spyOn(event, 'preventDefault')
      expect(copyWithoutCommentAttributes(event, content)).toBe(true)
      expect(prevent).toHaveBeenCalled()
      expect(data.get('text/html')).toBe('<p>Plain words</p>')
      expect(data.get('text/plain')).toBe('Plain words')
    })

    it('024-AC-032 a selection outside the content is not touched', () => {
      const content = block('<p aria-details="i" data-erf-comment-details="">In</p>')
      const outside = block('<p>Out</p>')
      selectText(outside)
      const { event } = copyEvent()
      expect(copyWithoutCommentAttributes(event, content)).toBe(false)
    })
  })
})
