// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments outside comment mode, against a page that hides or swaps what the
 * reader acted on (security audit of D-09, D-10). Split from
 * `outsideMode.test.ts`, which is at its size limit. jsdom has no layout: line
 * boxes and what is under a point are the test's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SELECTION_BUTTON_DELAY_MS, UNDERLINE_CLICK_WAIT_MS } from '../../shared/comments/overlayCore/selectionRules'
import { COMMENT_PICK_CHANNEL, TOKEN_ATTRIBUTE } from './constants'
import { byId, createHarness, microtasks, mount, token, userMouse, type Harness } from './__test-helpers__/harness'

const T = TOKEN_ATTRIBUTE
const TEXT = 'We ship the beta to ten customers by Friday.'
const PAGE =
  `<main id="main" ${T}="${token(1)}">` +
  `<p id="ship" ${T}="${token(2)}">${TEXT}</p>` +
  `<div id="popup" ${T}="${token(3)}">Page popup</div>` +
  `<my-card id="card" ${T}="${token(4)}"><p id="inside" ${T}="${token(5)}">${TEXT}</p></my-card>` +
  '</main>'
const BOXES = { main: { left: 0, top: 0, width: 800, height: 600 }, ship: { left: 0, top: 100, width: 600, height: 20 }, inside: { left: 0, top: 100, width: 600, height: 20 } }
const WORDS = { exact: 'ten customers', prefix: 'We ship the beta to ', suffix: ' by Friday.' }
const LINE = { left: 160, top: 100, width: 104, height: 20 }
const ON_LINE = { x: LINE.left + 10, y: LINE.top + 10 }
const MARKED = { key: 'p1', token: token(2), count: 1, status: 'open', words: [WORDS] }
const TEN_CUSTOMERS: readonly [number, number] = [20, 33]
const THE_BETA: readonly [number, number] = [8, 16]

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

function select([from, to]: readonly [number, number], id = 'ship'): void {
  const node = byId(id).firstChild as Text
  const range = document.createRange()
  range.setStart(node, from)
  range.setEnd(node, to)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
}

function realClick(target: Element, at = ON_LINE): void {
  userMouse(target, 'mousedown', { ...at, detail: 1 })
  userMouse(target, 'mouseup', { ...at, detail: 1 })
  userMouse(target, 'click', at)
}

function drag(id = 'ship'): void {
  userMouse(byId(id), 'mousedown', { x: 160, y: 110, detail: 1 })
  select(TEN_CUSTOMERS, id)
  userMouse(byId(id), 'mouseup', { x: 264, y: 110, detail: 1 })
  userMouse(byId(id), 'click', { x: 264, y: 110 })
}

async function afterTheWait(): Promise<void> {
  await microtasks()
  vi.advanceTimersByTime(0)
  vi.advanceTimersByTime(UNDERLINE_CLICK_WAIT_MS)
}

async function settle(): Promise<void> {
  await microtasks()
  vi.advanceTimersByTime(0)
  h.clock.now += SELECTION_BUTTON_DELAY_MS
  vi.advanceTimersByTime(SELECTION_BUTTON_DELAY_MS)
  h.controller.renderNow()
}

const button = (): HTMLElement | null | undefined => h.root()?.querySelector<HTMLElement>('.erf-hpc-button')
const buttonShown = (): boolean => {
  const shown = button()
  return shown !== null && shown !== undefined && !shown.classList.contains('erf-hpc-hidden')
}
const buttonTop = (): number => Number.parseFloat(button()?.style.top ?? 'NaN')

describe('D-09 what counts as a click on an underline', () => {
  beforeEach(() => h.state({ mode: false, showIcons: true, icons: [MARKED] }))

  it('D-09 a click on the marked element at the mark opens it', async () => {
    realClick(byId('ship'))
    await afterTheWait()
    expect(picks()).toEqual([expect.objectContaining({ kind: 'icon', key: 'p1-w0' })])
  })

  it('hostile: a page part drawn over the underline keeps the click', async () => {
    realClick(byId('popup'))
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 never in a custom element, whose controls cannot be seen from here', async () => {
    h.state({ mode: false, showIcons: true, icons: [{ ...MARKED, token: token(5) }] })
    realClick(byId('inside'))
    await afterTheWait()
    expect(picks()).toEqual([])
  })

  it('D-09 never in a shadow host, and a reaction inside its tree stays the page’s', async () => {
    const host = byId('ship')
    const root = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('span')
    root.append(inner)
    inner.addEventListener('click', () => inner.setAttribute('data-open', 'yes'))
    realClick(inner)
    await afterTheWait()
    expect(inner.getAttribute('data-open')).toBe('yes')
    expect(picks()).toEqual([])
  })
})

describe('D-10 the button keeps off parts it cannot see into', () => {
  beforeEach(() => h.state({ mode: false }))

  const above = (element: Element): void => {
    ;(document as unknown as Record<string, unknown>).elementsFromPoint = (_x: number, y: number) => (y < LINE.top ? [element] : [byId('main')])
  }

  it('D-10 a drag that starts in a custom element earns no button', async () => {
    drag('inside')
    await settle()
    expect(buttonShown()).toBe(false)
  })

  it.each(['card', 'inside'])('D-10 a custom element above, or a part of one (%s): below the line', async id => {
    above(byId(id))
    drag()
    await settle()
    expect(buttonTop()).toBeGreaterThanOrEqual(LINE.top + LINE.height)
  })

  it('D-10 a shadow host above: below the line', async () => {
    const host = byId('popup')
    host.attachShadow({ mode: 'open' })
    above(host)
    drag()
    await settle()
    expect(buttonTop()).toBeGreaterThanOrEqual(LINE.top + LINE.height)
  })
})

describe('D-10 the words the button holds are the words the reader selected', () => {
  beforeEach(() => h.state({ mode: false }))

  const swap = (): void => select(THE_BETA)

  it('hostile: a page that swaps the words in its own mouseup earns no button', async () => {
    document.addEventListener('mouseup', swap)
    drag()
    document.removeEventListener('mouseup', swap)
    await settle()
    expect(buttonShown()).toBe(false)
  })

  it('hostile: a page that swaps the words during the wait earns no button', async () => {
    drag()
    await microtasks()
    vi.advanceTimersByTime(0)
    swap()
    await settle()
    expect(buttonShown()).toBe(false)
  })

  it('D-10 the same words, still selected when the wait ends, show the button', async () => {
    drag()
    await settle()
    expect(buttonShown()).toBe(true)
  })
})
