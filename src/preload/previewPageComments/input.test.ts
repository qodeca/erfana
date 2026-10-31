// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment mode's input guards and picks (docs/designs/comments/html-preview-comments.md
 * §3, §7.1–§7.3, decision 19; J-003, J-004, J-009, J-012, J-013, J-015,
 * SEC-02, SEC-03, SEC-29).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMENT_ANCHORS_CHANNEL,
  COMMENT_PICK_CHANNEL,
  CONTROL_PICKS_PER_SECOND,
  PICKS_PER_SECOND,
  TOKEN_ATTRIBUTE
} from './constants'
import { GUARDED_EVENTS, TOGGLE_EVENTS, TOUCH_EVENTS, pickerActionOf } from './input'
import {
  byId,
  createHarness,
  dispatchTrusted,
  drawnText,
  microtasks,
  mount,
  token,
  userKey,
  userMouse,
  userUp,
  userMove,
  type Harness
} from './__test-helpers__/harness'

const T = TOKEN_ATTRIBUTE
const PAGE = `<main id="main" ${T}="${token(1)}"><button id="cta" class="btn" ${T}="${token(2)}">Buy</button><p id="para" ${T}="${token(3)}">Text <em id="em" ${T}="${token(4)}">here</em></p></main>`
const BOXES = {
  main: { left: 0, top: 0, width: 800, height: 400 },
  cta: { left: 100, top: 100, width: 80, height: 30 },
  para: { left: 0, top: 200, width: 400, height: 40 },
  em: { left: 40, top: 210, width: 30, height: 20 }
}

let h: Harness

beforeEach(async () => {
  h = createHarness()
  mount(PAGE, BOXES, h.doubles)
  await microtasks()
  h.controller.documentReady()
})

afterEach(() => {
  h.dispose()
})

/** Page listeners that record what reached the page. */
function pageListeners(): { seen: string[]; remove: () => void } {
  const seen: string[] = []
  const record = (event: Event): void => {
    seen.push(event.type)
  }
  for (const type of GUARDED_EVENTS) window.addEventListener(type, record, true)
  for (const type of GUARDED_EVENTS) byId('cta').addEventListener(type, record)
  return {
    seen,
    remove: () => {
      for (const type of GUARDED_EVENTS) window.removeEventListener(type, record, true)
    }
  }
}

/** Picks, without the keyboard picker's `step`s (what the window's live region says). */
const picks = (): Array<Record<string, unknown>> =>
  (h.sent(COMMENT_PICK_CHANNEL) as Array<Record<string, unknown>>).filter(p => p.kind !== 'step')

describe('the guards', () => {
  it('J-004 in comment mode every click-family event is stopped in capture; contextmenu and a primary press keep their default (024-FR-004: a drag selects)', () => {
    const page = pageListeners()
    h.state({ mode: true })
    // On text: a primary press keeps its default, so a drag can select words (on a control it does not – L-2 below).
    const events = GUARDED_EVENTS.map(type => userMouse(byId('para'), type, { x: 120, y: 210 }))
    const onButton = GUARDED_EVENTS.map(type => userMouse(byId('cta'), type, { x: 120, y: 110 }))
    page.remove()
    expect(page.seen).toEqual([])
    const kept = new Set(['contextmenu', 'pointerdown', 'mousedown'])
    for (const event of events) expect(event.defaultPrevented, event.type).toBe(!kept.has(event.type))
    for (const event of onButton) expect(event.defaultPrevented, `button ${event.type}`).toBe(event.type !== 'contextmenu')
  })

  it('L-2 in comment mode a primary press on a control, or inside one, is prevented; on text elsewhere it is not', () => {
    h.state({ mode: true })
    const controls = document.createElement('div')
    const inner = document.createElement('span')
    const summary = document.createElement('summary')
    summary.append(inner)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', '')
    const elements = ['select', 'input', 'textarea', 'button', 'video', 'audio'].map(tag => document.createElement(tag))
    controls.append(...elements, summary, editable)
    byId('main').append(controls)
    for (const target of [...elements, inner, editable]) {
      for (const type of ['pointerdown', 'mousedown']) {
        expect(userMouse(target, type, { x: 1, y: 1, button: 0 }).defaultPrevented, `${target.tagName} ${type}`).toBe(true)
      }
    }
    // Text outside any control: the press keeps its default (a drag still selects).
    expect(userMouse(byId('em'), 'mousedown', { x: 50, y: 215, button: 0 }).defaultPrevented).toBe(false)
    // Out of comment mode a control works as the page made it.
    h.state({ mode: false })
    expect(userMouse(elements[0], 'mousedown', { x: 1, y: 1, button: 0 }).defaultPrevented).toBe(false)
  })

  it('J-004 out of comment mode the page’s own handlers run and nothing is prevented', () => {
    const page = pageListeners()
    h.state({ mode: false })
    const events = GUARDED_EVENTS.map(type => userMouse(byId('cta'), type, { x: 120, y: 110 }))
    page.remove()
    expect(page.seen).toHaveLength(GUARDED_EVENTS.length * 2)
    expect(events.every(event => !event.defaultPrevented)).toBe(true)
    expect(picks()).toEqual([])
  })

  it('J-012 a left click in comment mode sends kind open (no menu), with the trusted screen point', () => {
    h.state({ mode: true })
    userMouse(byId('cta'), 'click', { x: 120, y: 110, screenX: 520.4, screenY: 310, button: 0 })
    expect(picks()).toEqual([
      {
        kind: 'open',
        via: 'pointer',
        token: token(2),
        tag: 'button',
        ws: 'preserve',
        box: { x: 100, y: 100, w: 80, h: 30 },
        screen: { x: 520, y: 310 },
        view: expect.objectContaining({ w: window.innerWidth, h: window.innerHeight })
      }
    ])
  })

  it('a right click in comment mode sends kind menu; middle clicks and keyboard-made clicks send nothing', () => {
    h.state({ mode: true })
    userMouse(byId('em'), 'contextmenu', { x: 50, y: 215, button: 2, screenX: 9, screenY: 8 })
    userMouse(byId('em'), 'auxclick', { button: 1 })
    userMouse(byId('em'), 'click', { button: 0, detail: 0 })
    expect(picks()).toEqual([expect.objectContaining({ kind: 'menu', via: 'pointer', token: token(4) })])
  })

  it('picks the level the pointer holds (after Alt+↑) when the click lands inside it', () => {
    h.state({ mode: true })
    userMove(50, 215)
    userKey({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    userMove(52, 216)
    userMouse(byId('em'), 'click', { x: 52, y: 216, button: 0 })
    expect(picks().at(-1)).toEqual(expect.objectContaining({ kind: 'open', token: token(3) }))
  })

  it('SEC-03 page-made clicks, context menus and pin clicks send nothing and are not stopped', () => {
    h.state({ mode: true, showIcons: true, icons: [{ key: 'k', token: token(2), count: 1, status: 'open' }] })
    h.controller.renderNow()
    const page = pageListeners()
    byId('cta').click()
    byId('cta').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    h.host()?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 190, clientY: 80, detail: 1 }))
    page.remove()
    expect(picks()).toEqual([])
    expect(page.seen).toContain('click')
    expect(page.seen).toContain('contextmenu')
  })

  it('J-015 a non-commentable frame (mode-only state) swallows clicks and picks nothing', () => {
    const page = pageListeners()
    h.state({ mode: true, commentable: false })
    const click = userMouse(byId('cta'), 'click', { button: 0 })
    page.remove()
    expect(page.seen).toEqual([])
    expect(click.defaultPrevented).toBe(true)
    expect(picks()).toEqual([])
  })

  it('swallows a submit in comment mode', () => {
    h.state({ mode: true })
    const form = document.createElement('form')
    document.body.append(form)
    const onSubmit = vi.fn()
    form.addEventListener('submit', onSubmit)
    const submit = new Event('submit', { bubbles: true, cancelable: true })
    dispatchTrusted(form, submit)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(submit.defaultPrevented).toBe(true)
  })

  it('ignores a click whose target is not an element', () => {
    h.state({ mode: true })
    userMouse(document, 'click', { button: 0 })
    expect(picks()).toEqual([])
  })
})

describe('pins and shields', () => {
  const ICON = { key: 'k-cta', token: token(2), count: 2, status: 'open' }

  it('J-013 a pin click in comment mode sends kind icon with its key, not open', () => {
    h.state({ mode: true, showIcons: true, icons: [ICON] })
    h.controller.renderNow()
    // The pin sits above the button's top-right corner (182, 74, 24 × 24).
    userMouse(h.host() as HTMLElement, 'click', { x: 190, y: 80, button: 0, screenX: 1, screenY: 2 })
    expect(picks()).toEqual([
      { kind: 'icon', via: 'pointer', key: 'k-cta', screen: { x: 1, y: 2 }, view: expect.any(Object) }
    ])
  })

  it('a pin click outside comment mode opens it too and never reaches the page', () => {
    h.state({ mode: false, showIcons: true, icons: [ICON] })
    h.controller.renderNow()
    const page = pageListeners()
    const click = userMouse(h.host() as HTMLElement, 'click', { x: 190, y: 80, button: 0 })
    userMouse(h.host() as HTMLElement, 'contextmenu', { x: 190, y: 80, button: 2 })
    userMouse(h.host() as HTMLElement, 'click', { x: 5, y: 5, button: 0 })
    page.remove()
    expect(page.seen).toEqual([])
    expect(click.defaultPrevented).toBe(true)
    expect(picks().map(p => p.kind)).toEqual(['icon'])
  })

  it('J-015 a shield over a non-commentable iframe swallows clicks and picks the <iframe> itself', async () => {
    // A fresh document whose iframe carries a token served before the window closed.
    h.dispose()
    h = createHarness()
    mount(`<iframe id="frame" srcdoc="<p>inline</p>" ${T}="${token(9)}"></iframe>`, {
      frame: { left: 0, top: 450, width: 300, height: 100 }
    }, h.doubles)
    await microtasks()
    h.controller.documentReady()
    h.state({ mode: true })
    h.controller.renderNow()
    userMouse(h.host() as HTMLElement, 'contextmenu', { x: 10, y: 460, button: 2 })
    userMouse(h.host() as HTMLElement, 'click', { x: 10, y: 460, button: 0 })
    expect(picks().map(p => [p.kind, p.token])).toEqual([
      ['menu', token(9)],
      ['open', token(9)]
    ])
    // The shield is hovered as the iframe, labelled as an inline frame.
    userMove(10, 460, h.host() as HTMLElement)
    h.controller.renderNow()
    expect(drawnText(h.root()?.querySelector('.erf-hpc-label'))).toBe('iframe#frame · inline frame300×100')
  })
})

describe('keys', () => {
  it('SEC-29 a page-made keydown does nothing', () => {
    h.state({ mode: true })
    const forged = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    byId('cta').dispatchEvent(forged)
    expect(forged.defaultPrevented).toBe(false)
    expect(picks()).toEqual([])
  })

  it('leaves every key alone outside comment mode, and any non-picker key inside it', () => {
    const outside = userKey({ key: 'Tab' })
    h.state({ mode: true })
    const plain = userKey({ key: 'a' })
    const arrow = userKey({ key: 'ArrowDown', code: 'ArrowDown' })
    expect([outside, plain, arrow].map(e => e.defaultPrevented)).toEqual([false, false, false])
  })

  it('J-003 Esc leaves the mode: main hears exit, and the page gets its clicks back', () => {
    h.state({ mode: true })
    const esc = userKey({ key: 'Escape' })
    expect(esc.defaultPrevented).toBe(true)
    expect(h.controller.mode).toBe(false)
    expect(picks()).toEqual([{ kind: 'exit', via: 'keyboard', view: expect.any(Object) }])
    const page = pageListeners()
    const click = userMouse(byId('cta'), 'click', { button: 0 })
    page.remove()
    expect(page.seen).toEqual(['click', 'click'])
    expect(click.defaultPrevented).toBe(false)
    expect(h.root()?.querySelector('.erf-hpc-outline')?.classList.contains('erf-hpc-hidden')).toBe(true)
  })

  it('J-003 mode off keeps the guards registered but inert; dispose() removes every listener', async () => {
    // Inert: out of comment mode a click reaches the page untouched (J-004).
    const page = pageListeners()
    const click = userMouse(byId('cta'), 'click', { button: 0 })
    page.remove()
    expect(page.seen).toEqual(['click', 'click'])
    expect(click.defaultPrevented).toBe(false)

    const removed = vi.spyOn(window, 'removeEventListener')
    const removedDoc = vi.spyOn(document, 'removeEventListener')
    h.dispose()
    const onWindow =
      GUARDED_EVENTS.length + TOUCH_EVENTS.length + TOGGLE_EVENTS.length +
      3 /* user input */ + 4 /* keydown, keyup, pointermove, DOMContentLoaded */
    expect(removed).toHaveBeenCalledTimes(onWindow)
    expect(removedDoc.mock.calls.map(([type]) => type)).toEqual(['pointerout', 'visibilitychange'])
    removed.mockRestore()
    removedDoc.mockRestore()
    h = createHarness()
    await microtasks()
  })

  it('L3 swallows the release of a picker key – Enter, and Esc after it left the mode', () => {
    h.state({ mode: true })
    const seen: string[] = []
    const record = (event: Event): void => {
      seen.push(`${event.type}:${(event as KeyboardEvent).key}`)
    }
    window.addEventListener('keyup', record, true)
    try {
      const enter = userKey({ key: 'Enter', code: 'Enter' })
      const enterUp = userUp({ key: 'Enter', code: 'Enter' })
      const plainUp = userUp({ key: 'a', code: 'KeyA' })
      userKey({ key: 'Escape', code: 'Escape' })
      expect(h.controller.mode).toBe(false)
      const escUp = userUp({ key: 'Escape', code: 'Escape' })
      expect([enter, enterUp, escUp].map(e => e.defaultPrevented)).toEqual([true, true, true])
      expect(plainUp.defaultPrevented).toBe(false)
      expect(seen).toEqual(['keyup:a'])
      // A forged release does nothing.
      const forged = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true })
      document.body.dispatchEvent(forged)
      expect(forged.defaultPrevented).toBe(false)
    } finally {
      window.removeEventListener('keyup', record, true)
    }
  })

  it('L3 a press the page keeps clears a release left over from a swallowed one', () => {
    h.state({ mode: true })
    userKey({ key: 'Tab', code: 'Tab' })
    // Its release went elsewhere (focus moved); the mode ends.
    h.state({ mode: false })
    userKey({ key: 'Tab', code: 'Tab' })
    expect(userUp({ key: 'Tab', code: 'Tab' }).defaultPrevented).toBe(false)
    // Engines without `code` match on `key`.
    h.state({ mode: true })
    userKey({ key: 'Enter' })
    expect(userUp({ key: 'Enter' }).defaultPrevented).toBe(true)
  })

  it.each([
    [{ key: 'Tab' }, 'next'],
    [{ key: 'Tab', shiftKey: true }, 'previous'],
    [{ key: 'ArrowUp', code: 'ArrowUp', altKey: true }, 'up'],
    [{ key: 'ArrowDown', code: 'ArrowDown', altKey: true }, 'down'],
    [{ key: 'Enter' }, 'open'],
    [{ key: 'F10', shiftKey: true }, 'menu'],
    [{ key: 'ContextMenu' }, 'menu'],
    [{ key: 'Escape' }, 'exit'],
    [{ key: 'Escape', shiftKey: true }, null],
    [{ key: 'Enter', ctrlKey: true }, null],
    [{ key: 'Tab', metaKey: true }, null],
    [{ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }, null],
    [{ key: 'ArrowUp', code: 'ArrowUp', altKey: true, shiftKey: true }, null],
    [{ key: 'µ', code: 'KeyM', altKey: true }, null],
    [{ key: 'F10' }, null]
  ])('maps %j to %s', (init, action) => {
    expect(pickerActionOf(new KeyboardEvent('keydown', init))).toBe(action)
  })
})

describe('touch (L3)', () => {
  const touch = (target: EventTarget, type: string): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true, composed: true })
    dispatchTrusted(target, event)
    return event
  }

  it('L3 keeps touches from the page in comment mode and on a pin, never cancelling them', () => {
    const seen: string[] = []
    const record = (event: Event): void => {
      seen.push(event.type)
    }
    for (const type of TOUCH_EVENTS) window.addEventListener(type, record, true)
    try {
      touch(byId('cta'), 'touchstart')
      expect(seen).toEqual(['touchstart'])
      h.state({ mode: false, showIcons: true, icons: [{ key: 'k', token: token(2), count: 1, status: 'open' }] })
      h.controller.renderNow()
      const onPin = touch(h.host() as HTMLElement, 'touchend')
      h.state({ mode: true })
      const inMode = TOUCH_EVENTS.map(type => touch(byId('cta'), type))
      // A page-made touch is the page's own business.
      byId('cta').dispatchEvent(new Event('touchstart', { bubbles: true }))
      expect(seen).toEqual(['touchstart', 'touchstart'])
      expect([onPin, ...inMode].every(event => !event.defaultPrevented)).toBe(true)
    } finally {
      for (const type of TOUCH_EVENTS) window.removeEventListener(type, record, true)
    }
  })
})

describe('the overlay host’s popover events (L1)', () => {
  it('L1 keeps beforetoggle and toggle on the host from the page, and still re-shows a hidden host', async () => {
    h.state({ mode: true })
    const host = h.host() as HTMLElement
    const seen: string[] = []
    const cancel = (event: Event): void => {
      seen.push(event.type)
      event.preventDefault()
    }
    for (const type of TOGGLE_EVENTS) window.addEventListener(type, cancel, true)
    try {
      const before = Object.assign(new Event('beforetoggle', { cancelable: true }), { newState: 'open' })
      dispatchTrusted(host, before)
      expect(before.defaultPrevented).toBe(false)
      h.doubles.hidePopover(host)
      await microtasks()
      expect(host.matches(':popover-open')).toBe(true)
      expect(seen).toEqual([])
      // A page popover's own events are the page's.
      const own = document.createElement('div')
      document.body.append(own)
      dispatchTrusted(own, new Event('toggle'))
      expect(seen).toEqual(['toggle'])
    } finally {
      for (const type of TOGGLE_EVENTS) window.removeEventListener(type, cancel, true)
    }
  })
})

describe('pick budgets (L4)', () => {
  it(`L4 Esc and Alt+↑ out of a frame have their own budgets: a burst of ${PICKS_PER_SECOND} clicks never drops them`, async () => {
    h.dispose()
    h = createHarness({ isTop: false })
    mount(PAGE, BOXES, h.doubles)
    await microtasks()
    h.controller.documentReady()
    h.state({ mode: true })
    for (let i = 0; i < PICKS_PER_SECOND + 2; i += 1) userMouse(byId('cta'), 'click', { x: 120, y: 110, button: 0 })
    // cta → main → body, then out of the frame, more often than its budget.
    for (let i = 0; i < 2 + CONTROL_PICKS_PER_SECOND + 2; i += 1) userKey({ key: 'ArrowUp', code: 'ArrowUp', altKey: true })
    userKey({ key: 'Escape', code: 'Escape' })
    expect(picks().map(p => p.kind)).toEqual([
      ...Array<string>(PICKS_PER_SECOND).fill('open'),
      ...Array<string>(CONTROL_PICKS_PER_SECOND).fill('parent'),
      'exit'
    ])
  })
})

describe('document.open (M1)', () => {
  it('M1 puts every guard back when the page replaces <html>, and tells main comments are unavailable', async () => {
    h.state({ mode: true })
    const [cursor] = document.adoptedStyleSheets
    // As `document.open()` leaves it: listeners erased (the spies below see
    // them re-added), the crosshair sheet gone, a new root.
    document.adoptedStyleSheets = []
    const added = vi.spyOn(window, 'addEventListener')
    const addedDoc = vi.spyOn(document, 'addEventListener')
    const oldRoot = document.documentElement
    const newRoot = document.createElement('html')
    newRoot.append(document.createElement('body'))
    document.replaceChild(newRoot, oldRoot)
    try {
      await microtasks()
      const types = added.mock.calls.map(([type]) => type)
      const expected = [...GUARDED_EVENTS, ...TOUCH_EVENTS, ...TOGGLE_EVENTS, 'keydown', 'keyup', 'pointermove', 'DOMContentLoaded', 'scroll']
      for (const type of expected) expect(types, type).toContain(type)
      expect(added.mock.calls.every(([, , options]) => (options as AddEventListenerOptions).capture === true)).toBe(true)
      expect(addedDoc.mock.calls.map(([type]) => type)).toEqual(['pointerout', 'visibilitychange'])
      expect(document.adoptedStyleSheets).toEqual([cursor])
      expect(h.sent(COMMENT_ANCHORS_CHANNEL).at(-1)).toEqual({ visible: [], hidden: [], overlay: 'unavailable', reason: 'document-replaced' })
      // The overlay came back on the new root, and comment mode still picks.
      expect(h.host()?.parentNode).toBe(newRoot)
      mount('<button id="written">Written</button>', { written: { left: 10, top: 10, width: 50, height: 20 } }, h.doubles)
      userMouse(byId('written'), 'click', { x: 20, y: 15, button: 0 })
      expect(picks().at(-1)).toEqual(expect.objectContaining({ kind: 'open', via: 'pointer' }))
      expect(picks().at(-1)).not.toHaveProperty('token')
    } finally {
      added.mockRestore()
      addedDoc.mockRestore()
      document.replaceChild(oldRoot, newRoot)
      await microtasks()
    }
  })
})

describe('hover (J-009)', () => {
  it('J-009 survives the hovered element being removed mid-hover', () => {
    h.state({ mode: true })
    userMove(120, 110)
    h.controller.renderNow()
    expect(drawnText(h.root()?.querySelector('.erf-hpc-label'))).toContain('button#cta.btn')
    byId('cta').remove()
    expect(() => h.controller.renderNow()).not.toThrow()
    expect(h.root()?.querySelector('.erf-hpc-outline')?.classList.contains('erf-hpc-hidden')).toBe(true)
  })

  it('J-009 a pointer move on a 10,000-element page costs one hit test, no DOM walk', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => `<span id="s${i}"></span>`).join('')
    document.body.insertAdjacentHTML('beforeend', `<div id="big">${many}</div>`)
    h.state({ mode: true })
    // The double's own hit test walks the DOM; Chromium's does not.
    const hitTest = vi.spyOn(document, 'elementFromPoint').mockReturnValue(byId('cta'))
    const query = vi.spyOn(document, 'querySelectorAll')
    for (let i = 0; i < 20; i += 1) userMove(120, 110)
    expect(hitTest).toHaveBeenCalledTimes(20)
    expect(query).not.toHaveBeenCalled()
    hitTest.mockRestore()
    query.mockRestore()
  })

  it('clears the hover when the pointer leaves the frame', () => {
    h.state({ mode: true })
    userMove(120, 110)
    const out = new MouseEvent('pointerout', { bubbles: true, relatedTarget: null })
    dispatchTrusted(byId('cta'), out)
    h.controller.renderNow()
    expect(h.root()?.querySelector('.erf-hpc-outline')?.classList.contains('erf-hpc-hidden')).toBe(true)
    // A move into a child element is not a leave.
    dispatchTrusted(byId('cta'), new MouseEvent('pointerout', { bubbles: true, relatedTarget: byId('main') }))
  })

  it('moves nothing outside comment mode, and skips the overlay host itself', () => {
    userMove(120, 110)
    h.controller.renderNow()
    expect(h.host()).toBeNull()
    h.state({ mode: true })
    const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(h.host())
    userMove(10, 10)
    hit.mockReturnValue(null)
    userMove(10, 10)
    hit.mockRestore()
    h.controller.renderNow()
    expect(h.root()?.querySelector('.erf-hpc-outline')?.classList.contains('erf-hpc-hidden')).toBe(true)
  })
})
