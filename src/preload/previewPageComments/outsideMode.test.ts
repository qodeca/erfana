// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments outside comment mode, in a page the reader does not own (differences
 * table D-09, D-10; comments-v2 C-16, C-17; docs/designs/comments/
 * spike-outside-mode.md). Every case reads the page's events and never changes
 * them. jsdom has no layout: line boxes and what is under a point are the test's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SELECTION_BUTTON_DELAY_MS, UNDERLINE_CLICK_WAIT_MS } from '../../shared/comments/overlayCore/selectionRules'
import { COMMENT_PICK_CHANNEL, TOKEN_ATTRIBUTE } from './constants'
import { byId, createHarness, microtasks, mount, token, userMouse, type Harness } from './__test-helpers__/harness'

const T = TOKEN_ATTRIBUTE
const PAGE =
  `<main id="main" ${T}="${token(1)}">` +
  `<p id="ship" ${T}="${token(2)}">We ship the beta to ten customers by Friday.</p>` +
  `<p id="other" ${T}="${token(3)}">Other text</p>` +
  `<a id="link" href="#x" ${T}="${token(4)}">We ship the beta to ten customers by Friday.</a>` +
  `<button id="control" ${T}="${token(5)}">We ship the beta to ten customers by Friday.</button>` +
  `<span id="role" role="button" ${T}="${token(6)}">We ship the beta to ten customers by Friday.</span>` +
  `<div id="edit" contenteditable="true" ${T}="${token(7)}">We ship the beta to ten customers by Friday.</div>` +
  '</main>'
const BOXES = { main: { left: 0, top: 0, width: 800, height: 600 }, ship: { left: 0, top: 100, width: 600, height: 20 }, other: { left: 0, top: 200, width: 600, height: 20 } }
const WORDS = { exact: 'ten customers', prefix: 'We ship the beta to ', suffix: ' by Friday.' }
/** Where the selection's (and a mark's) one line is drawn. */
const LINE = { left: 160, top: 100, width: 104, height: 20 }
const ON_LINE = { x: LINE.left + 10, y: LINE.top + 10 }
const MARKED = { key: 'p1', token: token(2), count: 1, status: 'open', words: [WORDS] }

let h: Harness
const realRects = Range.prototype.getClientRects

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  h = createHarness()
  mount(PAGE, BOXES, h.doubles)
  await microtasks()
  h.controller.documentReady()
  Range.prototype.getClientRects = function getClientRects() {
    const rect = { ...LINE, x: LINE.left, y: LINE.top, right: LINE.left + LINE.width, bottom: LINE.top + LINE.height }
    return [{ ...rect, toJSON: () => rect }] as unknown as DOMRectList
  }
})

afterEach(() => {
  Range.prototype.getClientRects = realRects
  window.getSelection()?.removeAllRanges()
  delete (document as unknown as Record<string, unknown>).elementsFromPoint
  h.dispose()
  vi.useRealTimers()
})

const picks = (): Array<Record<string, unknown>> => (h.sent(COMMENT_PICK_CHANNEL) as Array<Record<string, unknown>>).filter(p => p.kind !== 'step')

function selectWords(id = 'ship'): void {
  const node = byId(id).firstChild as Text
  const range = document.createRange()
  range.setStart(node, 20)
  range.setEnd(node, 33)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
}

/** Everything the page's queue and the button's wait hold has run. */
async function settle(): Promise<void> {
  await microtasks()
  vi.advanceTimersByTime(0)
  h.clock.now += SELECTION_BUTTON_DELAY_MS
  vi.advanceTimersByTime(SELECTION_BUTTON_DELAY_MS)
  h.controller.renderNow()
}

/** A real drag over the words: the press, the browser's selection, the release and its click. */
function drag(id = 'ship', select: () => void = () => selectWords(id)): void {
  userMouse(byId(id), 'mousedown', { x: 160, y: 110, detail: 1 })
  select()
  userMouse(byId(id), 'mouseup', { x: 264, y: 110, detail: 1 })
  userMouse(byId(id), 'click', { x: 264, y: 110 })
}

/** A real click at a point: press, release, click. */
function realClick(target: Element, at = ON_LINE): MouseEvent {
  userMouse(target, 'mousedown', { ...at, detail: 1 })
  userMouse(target, 'mouseup', { ...at, detail: 1 })
  return userMouse(target, 'click', at)
}

const buttonShown = (): boolean => {
  const button = h.root()?.querySelector<HTMLElement>('.erf-hpc-button')
  return button !== null && button !== undefined && !button.classList.contains('erf-hpc-hidden')
}
const buttonTop = (): number => Number.parseFloat(h.root()?.querySelector<HTMLElement>('.erf-hpc-button')?.style.top ?? 'NaN')

/** The click's own turn and the double-click wait have both passed. */
async function afterTheWait(): Promise<void> {
  await microtasks()
  vi.advanceTimersByTime(0)
  vi.advanceTimersByTime(UNDERLINE_CLICK_WAIT_MS)
}

describe('D-10 the Comment button outside comment mode', () => {
  beforeEach(() => h.state({ mode: false }))

  it('D-10 a real drag shows it after its wait; its click sends a pointer open pick with the words and the real point', async () => {
    drag()
    expect(buttonShown()).toBe(false)
    await settle()
    expect(buttonShown()).toBe(true)
    const box = { x: LINE.left + LINE.width - 80, y: buttonTop() + 4 }
    userMouse(h.host()!, 'mousedown', box)
    expect(picks()).toEqual([])
    userMouse(h.host()!, 'click', { ...box, screenX: 900, screenY: 700 })
    expect(picks()).toEqual([expect.objectContaining({ kind: 'open', via: 'pointer', token: token(2), sel: WORDS, screen: { x: 900, y: 700 } })])
  })

  it('D-10 a real double-click shows it, by the click count alone', async () => {
    userMouse(byId('ship'), 'mousedown', { x: 170, y: 110, detail: 1 })
    userMouse(byId('ship'), 'mouseup', { x: 170, y: 110, detail: 1 })
    userMouse(byId('ship'), 'click', { x: 170, y: 110 })
    userMouse(byId('ship'), 'mousedown', { x: 170, y: 110, detail: 2 })
    selectWords()
    userMouse(byId('ship'), 'mouseup', { x: 170, y: 110, detail: 2 })
    await settle()
    expect(buttonShown()).toBe(true)
  })

  it('PIN-S the page keeps its own press, release and click: nothing is stopped or cancelled', async () => {
    const seen: string[] = []
    const heard = (event: Event): void => {
      seen.push(`${event.type}:${event.defaultPrevented}`)
    }
    const types = ['mousedown', 'mouseup', 'click'] as const
    for (const type of types) document.addEventListener(type, heard)
    drag()
    for (const type of types) document.removeEventListener(type, heard)
    await settle()
    expect(seen).toEqual(['mousedown:false', 'mouseup:false', 'click:false'])
  })

  it('D-10 a press on the button never reaches the page, and the selection stays', async () => {
    drag()
    await settle()
    const heard = vi.fn()
    window.addEventListener('mousedown', heard)
    const press = userMouse(h.host()!, 'mousedown', { x: LINE.left + LINE.width - 80, y: buttonTop() + 4 })
    window.removeEventListener('mousedown', heard)
    expect(heard).not.toHaveBeenCalled()
    expect(press.defaultPrevented).toBe(true)
    expect(window.getSelection()?.toString()).toBe('ten customers')
  })

  it('D-10 a new press on the page takes the button away', async () => {
    drag()
    await settle()
    userMouse(byId('other'), 'mousedown', { x: 10, y: 205, detail: 1 })
    window.getSelection()!.removeAllRanges()
    h.controller.renderNow()
    expect(buttonShown()).toBe(false)
  })

  it('D-10 it goes on the short timer when a script clears the selection, with no input and no page change', async () => {
    drag()
    await settle()
    window.getSelection()!.removeAllRanges()
    await settle()
    expect(buttonShown()).toBe(false)
  })

  describe('a selection that shows no button', () => {
    it('hostile: a script selection with no input at all', async () => {
      selectWords()
      await settle()
      expect(buttonShown()).toBe(false)
    })

    it('hostile: a script selection with forged press, release and click', async () => {
      const forge = (type: string, x: number): void => {
        byId('ship').dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, detail: 1, clientX: x, clientY: 110 }))
      }
      forge('mousedown', 160)
      selectWords()
      forge('mouseup', 264)
      forge('click', 264)
      await settle()
      expect(buttonShown()).toBe(false)
      expect(picks()).toEqual([])
    })

    it('hostile bait: a real click on a part that selects by script leaves the words selected and no button', async () => {
      const bait = (): void => selectWords()
      byId('other').addEventListener('click', bait)
      realClick(byId('other'), { x: 10, y: 205 })
      await settle()
      expect(window.getSelection()?.toString()).toBe('ten customers')
      expect(buttonShown()).toBe(false)
    })

    it('a page that blocks selection: a real drag leaves nothing selected, so no button', async () => {
      drag('ship', () => {})
      await settle()
      expect(buttonShown()).toBe(false)
    })

    it.each(['control', 'link', 'role', 'edit'])('a drag that starts on the page’s own %s', async id => {
      drag(id)
      await settle()
      expect(buttonShown()).toBe(false)
    })

    it('a whole element selected: main keeps no words for it, so the right-click route remains', async () => {
      drag('other', () => window.getSelection()!.selectAllChildren(byId('other')))
      await settle()
      expect(buttonShown()).toBe(false)
    })

    it('a frame main cannot comment in', async () => {
      h.state({ mode: false, commentable: false })
      drag()
      await settle()
      expect(buttonShown()).toBe(false)
    })
  })

  describe('it keeps off the page’s controls: above, else below, else hidden', () => {
    /** Page controls drawn at these boxes; the point test stands in for layout. */
    function controlsAt(...tops: readonly (readonly [number, number])[]): void {
      const control = byId('control')
      ;(document as unknown as Record<string, unknown>).elementsFromPoint = (_x: number, y: number) =>
        [...(h.host() === null ? [] : [h.host()]), tops.some(([from, to]) => y >= from && y < to) ? control : byId('main')]
    }
    const ABOVE: readonly [number, number] = [50, 100]
    const BELOW: readonly [number, number] = [120, 170]

    it('clear above: above the line', async () => {
      controlsAt()
      drag()
      await settle()
      expect(buttonTop()).toBeLessThan(LINE.top)
    })

    it('a control above: below the line', async () => {
      controlsAt(ABOVE)
      drag()
      await settle()
      expect(buttonShown()).toBe(true)
      expect(buttonTop()).toBeGreaterThanOrEqual(LINE.top + LINE.height)
    })

    it('controls both ways: hidden, with the words kept, and back when the way clears', async () => {
      controlsAt(ABOVE, BELOW)
      drag()
      await settle()
      expect(buttonShown()).toBe(false)
      controlsAt(BELOW)
      await settle()
      expect(buttonShown()).toBe(true)
    })

    it('a small control between coarse sample points is still seen', async () => {
      const tiny = byId('control')
      ;(document as unknown as Record<string, unknown>).elementsFromPoint = (x: number, y: number) =>
        x >= LINE.left + 41 && x < LINE.left + 53 && y < LINE.top ? [tiny] : [byId('main')]
      drag()
      await settle()
      expect(buttonTop()).toBeGreaterThanOrEqual(LINE.top + LINE.height)
    })

    it('an element with a pointer cursor counts as a control', async () => {
      const styled = byId('other')
      styled.style.cursor = 'pointer'
      ;(document as unknown as Record<string, unknown>).elementsFromPoint = (_x: number, y: number) => (y < LINE.top ? [styled] : [byId('main')])
      drag()
      await settle()
      expect(buttonTop()).toBeGreaterThanOrEqual(LINE.top + LINE.height)
    })
  })

  it('PIN-S a page with no comments gets the overlay host only when the button first shows', async () => {
    expect(h.host()).toBeNull()
    drag()
    expect(h.host()).toBeNull()
    await settle()
    expect(h.host()).not.toBeNull()
  })
})

describe('D-09 a click on an underline outside comment mode', () => {
  beforeEach(() => h.state({ mode: false, showIcons: true, icons: [MARKED] }))

  it('D-09 a plain click opens that thread by the existing icon pick, only after the 320 ms wait', async () => {
    const event = realClick(byId('ship'))
    expect(event.defaultPrevented).toBe(false)
    await microtasks()
    vi.advanceTimersByTime(UNDERLINE_CLICK_WAIT_MS - 1)
    expect(picks()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(picks()).toEqual([expect.objectContaining({ kind: 'icon', via: 'pointer', key: 'p1-w0' })])
  })

  it('D-09 away from the words nothing happens', async () => {
    realClick(byId('other'), { x: 10, y: 205 })
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 a click the page cancelled stays the page’s, wherever the page cancels it', async () => {
    const cancel = (event: Event): void => event.preventDefault()
    window.addEventListener('click', cancel)
    realClick(byId('ship'))
    window.removeEventListener('click', cancel)
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 a click the page reacted to at once stays the page’s', async () => {
    byId('ship').addEventListener('click', () => byId('other').setAttribute('data-open', 'yes'))
    realClick(byId('ship'))
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 a page reaction that only rewrites text counts as a reaction', async () => {
    byId('ship').addEventListener('click', () => {
      ;(byId('other').firstChild as Text).data = 'Reacted'
    })
    realClick(byId('ship'))
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it.each(['link', 'control', 'role', 'edit'])('D-09 never on the page’s %s, whatever the page does', async id => {
    const placed = byId(id)
    h.state({ mode: false, showIcons: true, icons: [{ ...MARKED, token: placed.getAttribute(T) }] })
    realClick(placed)
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 never on text with a pointer cursor', async () => {
    byId('ship').style.cursor = 'pointer'
    realClick(byId('ship'))
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 a double-click selects the word and opens nothing', async () => {
    realClick(byId('ship'))
    await microtasks()
    vi.advanceTimersByTime(UNDERLINE_CLICK_WAIT_MS - 100)
    userMouse(byId('ship'), 'mousedown', { ...ON_LINE, detail: 2 })
    selectWords()
    userMouse(byId('ship'), 'mouseup', { ...ON_LINE, detail: 2 })
    userMouse(byId('ship'), 'click', { ...ON_LINE, detail: 2 })
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 a drag that starts on an underline selects, and opens nothing', async () => {
    drag()
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 a click that leaves words selected opens nothing', async () => {
    userMouse(byId('ship'), 'mousedown', { ...ON_LINE, detail: 1 })
    userMouse(byId('ship'), 'mouseup', { ...ON_LINE, detail: 1 })
    selectWords()
    userMouse(byId('ship'), 'click', ON_LINE)
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 a click with a modifier key is not a plain click', async () => {
    userMouse(byId('ship'), 'mousedown', { ...ON_LINE, detail: 1 })
    userMouse(byId('ship'), 'mouseup', { ...ON_LINE, detail: 1 })
    userMouse(byId('ship'), 'click', { ...ON_LINE, metaKey: true })
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('hostile: a forged click, with or without a forged press, opens nothing', async () => {
    const forge = (type: string): void => {
      byId('ship').dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, detail: 1, clientX: ON_LINE.x, clientY: ON_LINE.y }))
    }
    forge('click')
    forge('mousedown')
    forge('mouseup')
    forge('click')
    byId('ship').click()
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 a keyboard click (detail 0) opens nothing', async () => {
    userMouse(byId('ship'), 'click', { ...ON_LINE, detail: 0 })
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 the mode coming on, or the mark leaving, during the wait opens nothing', async () => {
    realClick(byId('ship'))
    await microtasks()
    vi.advanceTimersByTime(10)
    h.state({ mode: true, showIcons: true, icons: [MARKED] })
    await afterTheWait()
    expect(picks()).toEqual([])
    h.state({ mode: false, showIcons: true, icons: [MARKED] })
    realClick(byId('ship'))
    await microtasks()
    vi.advanceTimersByTime(10)
    h.state({ mode: false, showIcons: false, icons: [MARKED] })
    await afterTheWait()
    expect(picks()).toEqual([])
  })
})

describe('the seven trial pages (docs/designs/comments/spike-outside-mode.md)', () => {
  beforeEach(() => h.state({ mode: false, showIcons: true, icons: [MARKED] }))
  const bothDone = async (): Promise<void> => {
    await afterTheWait()
    h.controller.renderNow()
  }

  it('plain document: button shown and opens; a click on plain text opens the thread', async () => {
    drag()
    await settle()
    expect(buttonShown()).toBe(true)
    window.getSelection()!.removeAllRanges()
    await settle()
    realClick(byId('ship'))
    await bothDone()
    expect(picks()).toEqual([expect.objectContaining({ kind: 'icon' })])
  })

  it('own click handlers: one with no change, or a late one, lets both act: the stated limit', async () => {
    const quiet = vi.fn()
    byId('ship').addEventListener('click', quiet)
    realClick(byId('ship'))
    await microtasks()
    vi.advanceTimersByTime(0)
    // A change after the click's own turn is not a reaction the overlay can tie to the click.
    byId('other').setAttribute('data-late', 'yes')
    await bothDone()
    expect(quiet).toHaveBeenCalledTimes(1)
    expect(picks()).toEqual([expect.objectContaining({ kind: 'icon' })])
  })

  it('own selection toolbar: the button moves below and leaves the toolbar uncovered', async () => {
    ;(document as unknown as Record<string, unknown>).elementsFromPoint = (_x: number, y: number) => (y < LINE.top ? [byId('control')] : [byId('main')])
    drag()
    await settle()
    expect(buttonTop()).toBeGreaterThanOrEqual(LINE.top + LINE.height)
  })

  it('cancels clicks and blocks selection: no button, and nothing opens', async () => {
    const cancel = (event: Event): void => event.preventDefault()
    window.addEventListener('click', cancel)
    drag('ship', () => {})
    await settle()
    realClick(byId('ship'))
    await bothDone()
    window.removeEventListener('click', cancel)
    expect(buttonShown()).toBe(false)
    expect(picks()).toEqual([])
  })

  it('app-like, root click handler: nothing opens, because each click changes the page', async () => {
    let renders = 0
    const render = (): void => {
      renders += 1
      byId('main').setAttribute('data-render', String(renders))
    }
    window.addEventListener('click', render)
    realClick(byId('ship'))
    await bothDone()
    window.removeEventListener('click', render)
    expect(picks()).toEqual([])
  })

  it('live clock: changes between clicks do not hold the click back', async () => {
    byId('other').setAttribute('data-time', '1')
    await microtasks()
    realClick(byId('ship'))
    await microtasks()
    vi.advanceTimersByTime(30)
    byId('other').setAttribute('data-time', '2')
    await bothDone()
    expect(picks()).toEqual([expect.objectContaining({ kind: 'icon' })])
  })

  it('hostile: only real input acts', async () => {
    byId('ship').click()
    selectWords()
    await settle()
    expect(buttonShown()).toBe(false)
    expect(picks()).toEqual([])
    window.getSelection()!.removeAllRanges()
    realClick(byId('ship'))
    await bothDone()
    expect(picks()).toEqual([expect.objectContaining({ kind: 'icon' })])
  })
})
