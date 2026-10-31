// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The renderer host's comment-mode pointer guard (`contentGuard.ts`; spec 024
 * 024-AC-001, 024-FR-004): what the preview's content sees, what Erfana's own
 * listeners above it still see, and which defaults it leaves alone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { guardContent } from './contentGuard'

let scroller: HTMLDivElement
let content: HTMLDivElement
let paragraph: HTMLParagraphElement
let outside: HTMLDivElement
let mode: boolean
let stop: () => void
/** What the content's own (bubble) listeners saw. */
let contentSaw: string[]
/** What Erfana's listeners saw: the scroller in capture, the document in bubble. */
let scrollerSaw: string[]
let documentSaw: string[]

const TYPES = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'dblclick'] as const
const recordInto = (into: string[]) => (event: Event) => into.push(event.type)
const recorders = { content: recordInto([]), scroller: recordInto([]), document: recordInto([]) }

function fire(el: Element, type: string, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(event)
  return event
}

beforeEach(() => {
  scroller = document.createElement('div')
  content = document.createElement('div')
  paragraph = document.createElement('p')
  paragraph.textContent = 'We ship on Friday.'
  outside = document.createElement('div')
  content.appendChild(paragraph)
  scroller.appendChild(content)
  document.body.append(scroller, outside)
  mode = true
  contentSaw = []
  scrollerSaw = []
  documentSaw = []
  recorders.content = recordInto(contentSaw)
  recorders.scroller = recordInto(scrollerSaw)
  recorders.document = recordInto(documentSaw)
  for (const type of TYPES) {
    paragraph.addEventListener(type, recorders.content)
    scroller.addEventListener(type, recorders.scroller, true)
    document.addEventListener(type, recorders.document)
  }
  stop = guardContent(content, () => mode)
})

afterEach(() => {
  stop()
  for (const type of TYPES) document.removeEventListener(type, recorders.document)
  scroller.remove()
  outside.remove()
})

describe('guardContent (024-AC-001)', () => {
  it('in comment mode keeps a press and its release from the content; the scroller still sees both in capture', () => {
    fire(paragraph, 'pointerdown', { button: 0 })
    fire(paragraph, 'mousedown', { button: 0 })
    fire(paragraph, 'pointerup', { button: 0 })
    fire(paragraph, 'mouseup', { button: 0 })
    expect(contentSaw).toEqual([])
    expect(documentSaw).toEqual([])
    expect(scrollerSaw).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup'])
  })

  it('024-FR-004: a primary press keeps its default, so a drag still selects words', () => {
    expect(fire(paragraph, 'mousedown', { button: 0 }).defaultPrevented).toBe(false)
  })

  it('a middle press loses its default (no autoscroll); a right press keeps it (focus still moves)', () => {
    expect(fire(paragraph, 'mousedown', { button: 1 }).defaultPrevented).toBe(true)
    expect(fire(paragraph, 'mousedown', { button: 2 }).defaultPrevented).toBe(false)
  })

  it('L-2: a primary press on a form control loses its default', () => {
    const box = document.createElement('input')
    box.type = 'checkbox'
    paragraph.appendChild(box)
    expect(fire(box, 'mousedown', { button: 0 }).defaultPrevented).toBe(true)
  })

  it('keeps auxclick and dblclick from the content and cancels them (a middle click on a link opens nothing)', () => {
    const aux = fire(paragraph, 'auxclick', { button: 1 })
    const dbl = fire(paragraph, 'dblclick', { button: 0 })
    expect(contentSaw).toEqual([])
    expect(aux.defaultPrevented).toBe(true)
    expect(dbl.defaultPrevented).toBe(true)
  })

  it('leaves click to the overlay host', () => {
    fire(paragraph, 'click', { button: 0 })
    expect(contentSaw).toEqual(['click'])
  })

  it('a release whose press began outside the content (a divider drag) reaches everyone', () => {
    fire(outside, 'mousedown', { button: 0 })
    fire(paragraph, 'mouseup', { button: 0 })
    expect(contentSaw).toEqual(['mouseup'])
    expect(documentSaw).toEqual(['mousedown', 'mouseup'])
  })

  it('a press kept from the content owes one release only: the next release is the content’s again', () => {
    fire(paragraph, 'mousedown', { button: 0 })
    fire(outside, 'mouseup', { button: 0 })
    fire(paragraph, 'mouseup', { button: 0 })
    expect(contentSaw).toEqual(['mouseup'])
  })

  it('a release keeps following its press when the mode ended in between', () => {
    fire(paragraph, 'mousedown', { button: 0 })
    mode = false
    fire(paragraph, 'mouseup', { button: 0 })
    expect(contentSaw).toEqual([])
  })

  it('with comment mode off, the content sees every event', () => {
    mode = false
    for (const type of ['mousedown', 'mouseup', 'auxclick', 'dblclick']) fire(paragraph, type, { button: 0 })
    expect(contentSaw).toEqual(['mousedown', 'mouseup', 'auxclick', 'dblclick'])
  })

  it('removes every listener when stopped', () => {
    stop()
    fire(paragraph, 'mousedown', { button: 0 })
    fire(paragraph, 'auxclick', { button: 1 })
    expect(contentSaw).toEqual(['mousedown', 'auxclick'])
  })
})
