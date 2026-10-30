// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML overlay against the shared overlay behaviour suite (spec 024,
 * 024-FR-001, 024-FR-020; architecture note
 * specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md
 * § 2, § 6 commit 4).
 *
 * The driver runs the real controller and input guards through the preload
 * harness (`__test-helpers__/harness.ts`): trusted events in, recorded
 * `commentPick` messages out, and the outline read back from the closed shadow
 * root. Main turns comment mode on and off (a `commentState`), as it does for
 * the toolbar and the forwarded shortcut.
 *
 * The element menu, the comment window and Find are not the page's: main shows
 * the menu natively, the renderer draws the window and the find bar, and while
 * either the menu or the window is open the page sits hidden behind a still
 * frame, so no key reaches it. The suite skips those Esc steps for this host.
 */
import { COMMENT_PICK_CHANNEL, TOKEN_ATTRIBUTE } from './constants'
import { GUARDED_EVENTS } from './input'
import {
  createHarness,
  microtasks,
  mount,
  token,
  userKey,
  userMouse,
  userMove,
  userUp,
  type Harness
} from './__test-helpers__/harness'
import { runOverlaySuite } from '../../shared/comments/__conformance__/overlay.suite'
import {
  OVERLAY_FIXTURE,
  type GestureModifiers,
  type GesturePoint,
  type OverlayDriver,
  type OverlayPick,
  type OverlayTargetId
} from '../../shared/comments/__conformance__/overlayDriver'

const T = TOKEN_ATTRIBUTE
/** Which fixture target an element is. Not an id or a class, so the label never shows it. */
const TARGET_ATTRIBUTE = 'data-ovl'

const PAGE =
  `<section id="stage" class="stage" ${T}="${token(1)}" ${TARGET_ATTRIBUTE}="container">` +
  `<div id="first" ${T}="${token(2)}" ${TARGET_ATTRIBUTE}="first">First block ` +
  `<button id="buy" class="cta primary" ${T}="${token(3)}" ${TARGET_ATTRIBUTE}="inner">Buy now</button></div>` +
  `<p id="second" class="note lead extra" ${T}="${token(4)}" ${TARGET_ATTRIBUTE}="second">Second paragraph text</p>` +
  `<article id="a-very-long-identifier-that-overflows-the-label" class="x" ${T}="${token(5)}" ${TARGET_ATTRIBUTE}="long">Long label</article>` +
  `</section>`

/** The words the v0.23.1 HTML overlay's label shows for each fixture target (design §10.2, J-001). */
const HTML_LABELS: Readonly<Record<OverlayTargetId, string>> = {
  container: 'section#stage.stage 600×400',
  first: 'div#first 260×120',
  inner: 'button#buy.cta.primary 100×30',
  second: 'p#second.note.lead… 260×120',
  long: 'article#a-very-long-identifier-that-ove… 260×120'
}

/** The page's own listeners: bubble phase, registered after the preload's capture guards. */
const PAGE_EVENTS = [...GUARDED_EVENTS, 'keydown', 'keyup'] as const

const elementOf = (target: OverlayTargetId): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[${TARGET_ATTRIBUTE}="${target}"]`)
  if (el === null) throw new Error(`no fixture target ${target}`)
  return el
}

const targetOf = (el: Element | null | undefined): OverlayTargetId | null =>
  (el?.getAttribute(TARGET_ATTRIBUTE) as OverlayTargetId | null | undefined) ?? null

const pointOf = ({ target, dx = 0, dy = 0 }: GesturePoint): { x: number; y: number } => {
  const { left, top, width, height } = OVERLAY_FIXTURE[target].box
  return { x: left + width / 2 + dx, y: top + height / 2 + dy }
}

/** The nearest element holding both `a` and `b` – where Chromium sends the `click` after a drag. */
const commonAncestor = (a: Element, b: Element): Element => {
  for (let el: Element | null = a; el !== null; el = el.parentElement) if (el.contains(b)) return el
  return document.documentElement
}

const isShown = (el: Element | null | undefined): el is HTMLElement =>
  el !== null && el !== undefined && !el.classList.contains('erf-hpc-hidden')

/** The driver over a harness whose page holds the fixture. */
function driverOn(h: Harness): OverlayDriver {
  for (const target of Object.keys(OVERLAY_FIXTURE) as OverlayTargetId[]) {
    h.doubles.setBox(elementOf(target), OVERLAY_FIXTURE[target].box)
  }
  const seen: string[] = []
  const record = (event: Event): void => {
    seen.push(event.type)
  }
  for (const type of PAGE_EVENTS) document.addEventListener(type, record)

  /** A fresh gesture: a new rate-limit second, and a fresh record of what the page saw. */
  const begin = (): void => {
    h.clock.now += 1_000
    seen.length = 0
  }
  const at = (point: GesturePoint): { x: number; y: number; el: Element } => {
    const { x, y } = pointOf(point)
    const el = document.elementFromPoint(x, y)
    if (el === null) throw new Error(`nothing at ${x},${y}`)
    return { x, y, el }
  }
  const move = (x: number, y: number): void => {
    userMove(x, y)
    userMouse(document.elementFromPoint(x, y) ?? document.body, 'mousemove', { x, y })
  }
  const modifiers = (m: GestureModifiers = {}): MouseEventInit => ({
    shiftKey: m.shift === true,
    altKey: m.alt === true,
    ctrlKey: m.ctrl === true,
    metaKey: m.meta === true
  })
  const press = (el: Element, x: number, y: number, button: number, init: MouseEventInit = {}): void => {
    const buttons = button === 2 ? 2 : button === 1 ? 4 : 1
    userMouse(el, 'pointerdown', { x, y, button, buttons, ...init })
    userMouse(el, 'mousedown', { x, y, button, buttons, ...init })
  }
  const release = (el: Element, x: number, y: number, button: number, init: MouseEventInit = {}): void => {
    userMouse(el, 'pointerup', { x, y, button, ...init })
    userMouse(el, 'mouseup', { x, y, button, ...init })
  }
  /** `count` primary clicks in a row, with the browser's `detail` and the `dblclick` after the second. */
  const clicks = (target: OverlayTargetId, count: number, m?: GestureModifiers): void => {
    begin()
    const { x, y, el } = at({ target })
    move(x, y)
    for (let detail = 1; detail <= count; detail += 1) {
      press(el, x, y, 0, { detail, ...modifiers(m) })
      release(el, x, y, 0, { detail, ...modifiers(m) })
      userMouse(el, 'click', { x, y, button: 0, detail, ...modifiers(m) })
      if (detail === 2) userMouse(el, 'dblclick', { x, y, button: 0, detail })
    }
  }
  const picks = (): OverlayPick[] =>
    (h.sent(COMMENT_PICK_CHANNEL) as Array<{ kind: string; via: 'pointer' | 'keyboard'; token?: string }>)
      .filter((p): p is { kind: OverlayPick['kind']; via: 'pointer' | 'keyboard'; token?: string } =>
        p.kind === 'open' || p.kind === 'menu' || p.kind === 'exit'
      )
      .map(p => ({
        kind: p.kind,
        via: p.via,
        target: p.token === undefined ? null : targetOf(h.controller.tokens.elementOf(p.token))
      }))
  const part = (selector: string): Element | null => {
    h.controller.renderNow()
    return h.root()?.querySelector(selector) ?? null
  }
  const outlinedTarget = (): OverlayTargetId | null => {
    const outline = part('.erf-hpc-outline')
    if (!isShown(outline)) return null
    const box = ['left', 'top', 'width', 'height'].map(side => outline.style.getPropertyValue(side)).join(' ')
    const hit = (Object.keys(OVERLAY_FIXTURE) as OverlayTargetId[]).find(target => {
      const b = OVERLAY_FIXTURE[target].box
      return `${b.left}px ${b.top}px ${b.width}px ${b.height}px` === box
    })
    return hit ?? null
  }

  return {
    host: 'HTML Preview (page preload)',
    floatingLabel: true,
    labels: HTML_LABELS,
    // A-03: the decided tab, the same words as the Markdown Preview's before a target is outlined.
    modeIndicatorIdle: 'Comment mode · Esc to leave',
    rightClickOutsideMode: 'page',
    notOwned: {
      menu: 'the element menu is main’s native menu; the page is hidden behind a still frame while it is open and gets no key',
      window: 'the comment window is renderer UI over a still frame of the page; the page gets no key while it is open',
      find: 'Find is the renderer’s find bar; main forwards its Esc to the renderer and the page never sees it'
    },
    modeOn: () => h.state({ mode: true }),
    modeOff: () => h.state({ mode: false }),
    isModeOn: () => h.controller.mode,
    modeIndicatorText() {
      const tab = part('.erf-hpc-tab')
      return isShown(tab) ? tab.getAttribute('data-text') : null
    },
    targets: () => [...document.querySelectorAll(`[${TARGET_ATTRIBUTE}]`)].map(el => targetOf(el) as OverlayTargetId),
    hover(point) {
      begin()
      const { x, y } = pointOf(point)
      move(x, y)
    },
    click: (target, m) => clicks(target, 1, m),
    doubleClick: target => clicks(target, 2),
    tripleClick: target => clicks(target, 3),
    drag(from, to) {
      begin()
      const start = at(from)
      const end = at(to)
      move(start.x, start.y)
      press(start.el, start.x, start.y, 0, { detail: 1 })
      const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y)))
      for (let i = 1; i <= steps; i += 1) {
        move(start.x + ((end.x - start.x) * i) / steps, start.y + ((end.y - start.y) * i) / steps)
      }
      release(end.el, end.x, end.y, 0, { detail: 1 })
      userMouse(commonAncestor(start.el, end.el), 'click', { x: end.x, y: end.y, button: 0, detail: 1 })
    },
    selectText(target) {
      const text = [...elementOf(target).childNodes].find(node => node.nodeType === Node.TEXT_NODE)
      if (text === undefined) throw new Error(`no text in ${target}`)
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, Math.min(6, text.textContent?.length ?? 0))
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    },
    selectedText: () => window.getSelection()?.toString() ?? '',
    rightClick(target) {
      begin()
      const { x, y, el } = at({ target })
      move(x, y)
      press(el, x, y, 2)
      release(el, x, y, 2)
      userMouse(el, 'contextmenu', { x, y, button: 2 })
      userMouse(el, 'auxclick', { x, y, button: 2, detail: 1 })
    },
    middleClick(target) {
      begin()
      const { x, y, el } = at({ target })
      move(x, y)
      press(el, x, y, 1)
      release(el, x, y, 1)
      userMouse(el, 'auxclick', { x, y, button: 1, detail: 1 })
    },
    pressEscape() {
      begin()
      userKey({ key: 'Escape', code: 'Escape' })
      userUp({ key: 'Escape', code: 'Escape' })
    },
    picks,
    pickedTarget() {
      const last = picks().filter(p => p.kind !== 'exit').at(-1)
      return last?.target ?? null
    },
    outlinedTarget,
    outlineSelected: () => part('.erf-hpc-outline')?.classList.contains('erf-hpc-outline--selected') === true,
    labelText(target) {
      const { x, y } = pointOf({ target })
      move(x, y)
      const label = part('.erf-hpc-label')
      if (!isShown(label)) return null
      const [tag, rest, size] = [...label.children].map(span => span.getAttribute('data-text') ?? '')
      return `${tag}${rest} ${size}`
    },
    pageSaw: () => [...seen],
    openLayer: () => (h.controller.mode ? 'mode' : null),
    dispose() {
      for (const type of PAGE_EVENTS) document.removeEventListener(type, record)
      window.getSelection()?.removeAllRanges()
      h.dispose()
    }
  }
}

runOverlaySuite('HTML', async () => {
  const h = createHarness()
  mount(PAGE)
  // The token window is open while the page parses: let the registry see the fixture, then close it.
  await microtasks()
  h.controller.documentReady()
  return driverOn(h)
})
