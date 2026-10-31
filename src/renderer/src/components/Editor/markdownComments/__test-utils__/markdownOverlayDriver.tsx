// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown Preview's driver for the shared overlay behaviour suite (spec
 * 024, 024-AC-001; architecture note 001 § 2 option C – one behaviour, two
 * hosts).
 *
 * It runs the real preview, the real `useMarkdownComments` and the real
 * renderer overlay host through the panel harness (`harness.tsx`), with only
 * the comment bridge mocked. The fixture is a block quote: the quote is
 * `container`; its one list item, which holds a nested item (`inner`), is
 * `first`; two paragraphs are `second` and `long`. jsdom has no layout, so
 * each fixture block gets its fixture box and a gesture is delivered to the
 * innermost fixture block under its point (`fixtureTargetAt`).
 *
 * - **The page** is the preview's own listeners: bubble-phase listeners on
 *   the document, as in the HTML driver.
 * - **Picks** are the overlay's asks of its host, recorded by
 *   `pickRecorder.ts` (the test wraps `useHostPointerKeys` with it).
 * - **The outline** is read back from the overlay layer's outline box; its
 *   selected state is the picked block holding focus (D-06: the Focus card's
 *   ring on the picked target).
 * - **No floating label** (D-05): the mode tab names the outlined block.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'
import { TEST_IDS } from '../../../../constants/testids'
import {
  OVERLAY_FIXTURE,
  fixturePointOf,
  fixtureTargetAt,
  type GestureModifiers,
  type GesturePoint,
  type OverlayDriver,
  type OverlayLayer,
  type OverlayTargetId
} from '../../../../../../shared/comments/__conformance__/overlayDriver'
import { Harness, fileView, installApi, resetStores, setSettings } from './harness'
import { pickRecorder } from './pickRecorder'

/** The fixture as Markdown: a quote holding a list item (with a nested item) and two paragraphs. */
export const OVERLAY_DOC = ['> - First block', '>   - Buy now', '>', '> Second paragraph text', '>', '> Long label', ''].join('\n')

/** Where each fixture target is in the rendered preview. */
const SELECTORS: Readonly<Record<OverlayTargetId, string>> = {
  container: 'blockquote[data-line-start="1"]',
  first: 'blockquote > ul > li[data-line-start="1"]',
  inner: 'li > ul > li[data-line-start="2"]',
  second: 'blockquote > p[data-line-start="4"]',
  long: 'blockquote > p[data-line-start="6"]'
}

/** What the mode tab says while each target is outlined (A-03, Markdown words). */
const MARKDOWN_LABELS: Readonly<Record<OverlayTargetId, string>> = {
  container: 'Comment mode · Block quote, line 1 · Esc to leave',
  first: 'Comment mode · List item, line 1 · Esc to leave',
  inner: 'Comment mode · List item, line 2 · Esc to leave',
  second: 'Comment mode · Paragraph, line 4 · Esc to leave',
  long: 'Comment mode · Paragraph, line 6 · Esc to leave'
}

/** The pane's (and every other element's) box: the fixture fits inside it, at the viewport's origin. */
const PANE_BOX = new DOMRect(0, 0, 800, 600)

/** The page's own listeners (the HTML driver's set: the preload's guarded events and the keys). */
const PAGE_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'auxclick',
  'dblclick',
  'contextmenu',
  'dragstart',
  'submit',
  'keydown',
  'keyup'
] as const

const byTestId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

/** A pointer event where jsdom has them, else the mouse event it stands for. */
function pointerEvent(type: string, init: MouseEventInit): Event {
  return typeof PointerEvent === 'function' ? new PointerEvent(type, init) : new MouseEvent(type, init)
}

function mouse(el: Element, type: string, init: MouseEventInit & { x: number; y: number }): void {
  const { x, y, ...rest } = init
  const full: MouseEventInit = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, ...rest }
  fireEvent(el, type.startsWith('pointer') ? pointerEvent(type, full) : new MouseEvent(type, full))
}

const modifiers = (m: GestureModifiers = {}): MouseEventInit => ({
  shiftKey: m.shift === true,
  altKey: m.alt === true,
  ctrlKey: m.ctrl === true,
  metaKey: m.meta === true
})

/** The nearest element holding both `a` and `b` – where Chromium sends the `click` after a drag. */
function commonAncestor(a: Element, b: Element): Element {
  for (let el: Element | null = a; el !== null; el = el.parentElement) if (el.contains(b)) return el
  return document.documentElement
}

/**
 * A fresh Markdown Preview on the fixture, comment mode off.
 *
 * @returns The driver; `dispose` unmounts it and puts back what it replaced.
 */
export async function createMarkdownOverlayDriver(): Promise<OverlayDriver> {
  const portal = document.createElement('div')
  portal.id = 'portal-root'
  document.body.appendChild(portal)
  resetStores()
  pickRecorder.reset()
  const api = installApi(fileView())
  setSettings()
  // jsdom has no layout: scrolling does nothing and a range has an empty box.
  const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
  const rangeBox = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  Element.prototype.scrollIntoView = vi.fn()
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  const restoreLayout = (): void => {
    for (const [proto, name, original] of [
      [Element.prototype, 'scrollIntoView', scrollIntoView],
      [Range.prototype, 'getBoundingClientRect', rangeBox]
    ] as const) {
      if (original === undefined) Reflect.deleteProperty(proto, name)
      else Object.defineProperty(proto, name, original)
    }
  }

  const view = render(<Harness content={OVERLAY_DOC} />)
  const elements = new Map<OverlayTargetId, HTMLElement>()
  await waitFor(() => {
    for (const target of Object.keys(SELECTORS) as OverlayTargetId[]) {
      const el = document.querySelector<HTMLElement>(`.markdown-preview-content ${SELECTORS[target]}`)
      if (el === null) throw new Error(`no fixture target ${target}`)
      elements.set(target, el)
    }
  })
  await waitFor(() => expect(api.list).toHaveBeenCalled())
  await act(async () => {})

  const targetOf = (el: Element | null): OverlayTargetId | null =>
    [...elements].find(([, element]) => element === el)?.[0] ?? null
  const boxes = new Map<Element, DOMRect>(
    [...elements].map(([target, el]) => {
      const { left, top, width, height } = OVERLAY_FIXTURE[target].box
      return [el, new DOMRect(left, top, width, height)]
    })
  )
  const elementBox = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      return boxes.get(this) ?? PANE_BOX
    })

  const scroller = (): HTMLElement => {
    const el = document.querySelector<HTMLElement>('.preview-pane > .markdown-preview')
    if (el === null) throw new Error('no preview scroller')
    return el
  }

  const seen: string[] = []
  const record = (event: Event): void => {
    seen.push(event.type)
  }
  for (const type of PAGE_EVENTS) document.addEventListener(type, record)

  /** A fresh gesture: a fresh record of what the page saw, and how the overlay is asked. */
  const begin = (via: 'pointer' | 'keyboard' = 'pointer'): void => {
    seen.length = 0
    pickRecorder.via = via
  }
  const at = (point: GesturePoint): { x: number; y: number; el: Element } => {
    const { x, y } = fixturePointOf(point)
    const target = fixtureTargetAt(x, y)
    return { x, y, el: (target === null ? null : elements.get(target)) ?? scroller() }
  }
  const move = (point: GesturePoint): void => {
    const { x, y, el } = at(point)
    mouse(el, 'pointermove', { x, y })
    mouse(el, 'mousemove', { x, y })
  }
  const press = (el: Element, x: number, y: number, button: number, init: MouseEventInit = {}): void => {
    const buttons = button === 2 ? 2 : button === 1 ? 4 : 1
    mouse(el, 'pointerdown', { x, y, button, buttons, ...init })
    mouse(el, 'mousedown', { x, y, button, buttons, ...init })
  }
  const release = (el: Element, x: number, y: number, button: number, init: MouseEventInit = {}): void => {
    mouse(el, 'pointerup', { x, y, button, ...init })
    mouse(el, 'mouseup', { x, y, button, ...init })
  }
  /** `count` primary clicks in a row, with the browser's `detail` and the `dblclick` after the second. */
  const clicks = (target: OverlayTargetId, count: number, m?: GestureModifiers): void => {
    begin()
    move({ target })
    const { x, y, el } = at({ target })
    for (let detail = 1; detail <= count; detail += 1) {
      press(el, x, y, 0, { detail, ...modifiers(m) })
      release(el, x, y, 0, { detail, ...modifiers(m) })
      mouse(el, 'click', { x, y, button: 0, detail, ...modifiers(m) })
      if (detail === 2) mouse(el, 'dblclick', { x, y, button: 0, detail })
    }
  }
  const picks: OverlayDriver['picks'] = () =>
    pickRecorder.picks.map(p => ({ kind: p.kind, via: p.via, target: targetOf(p.element) }))
  const outlinedTarget = (): OverlayTargetId | null => {
    const outline = byTestId(TEST_IDS.COMMENT_HOST_OUTLINE)
    if (outline === null) return null
    const box = ['left', 'top', 'width', 'height'].map(side => outline.style.getPropertyValue(side)).join(' ')
    const hit = (Object.keys(OVERLAY_FIXTURE) as OverlayTargetId[]).find(target => {
      const b = OVERLAY_FIXTURE[target].box
      return `${b.left}px ${b.top}px ${b.width}px ${b.height}px` === box
    })
    return hit ?? null
  }
  const tabText = (): string | null => byTestId(TEST_IDS.COMMENT_HOST_MODE_TAB)?.textContent ?? null
  const menu = (): HTMLElement | null => byTestId(TEST_IDS.COMMENT_CONTEXT_MENU) ?? byTestId(TEST_IDS.CONTEXT_MENU_PREVIEW)
  const commentWindow = (): HTMLElement | null => byTestId('comment-window')
  const modeTool = (): HTMLElement => {
    const tool = byTestId(TEST_IDS.COMMENT_TOOL_MODE)
    if (tool === null) throw new Error('no comment-mode tool')
    return tool
  }
  const isModeOn = (): boolean => byTestId(TEST_IDS.COMMENT_HOST_OVERLAY)?.classList.contains('erf-comment-host--mode') === true
  const rightClick = (target: OverlayTargetId): void => {
    begin()
    move({ target })
    const { x, y, el } = at({ target })
    press(el, x, y, 2)
    release(el, x, y, 2)
    mouse(el, 'contextmenu', { x, y, button: 2 })
    mouse(el, 'auxclick', { x, y, button: 2, detail: 1 })
  }
  const key = (type: 'keyDown' | 'keyUp', target: Element): void => {
    fireEvent[type](target, { key: 'Escape', code: 'Escape' })
  }

  return {
    host: 'Markdown Preview (renderer overlay host)',
    floatingLabel: false,
    labels: MARKDOWN_LABELS,
    modeIndicatorIdle: 'Comment mode · Esc to leave',
    rightClickOutsideMode: 'menu',
    notOwned: {
      floatingLabel:
        'differences table D-05: the Markdown Preview draws no label at the outline – every block has its own box, and the comment-mode tab names the outlined block (its words are checked by OVL-L-01)',
      find: 'Find in the preview-only view is the editor panel’s find bar, outside the preview host this harness mounts'
    },
    modeOn() {
      if (!isModeOn()) fireEvent.click(modeTool())
    },
    modeOff() {
      if (isModeOn()) fireEvent.click(modeTool())
    },
    isModeOn,
    modeIndicatorText: tabText,
    targets: () => [...elements.keys()],
    hover(point) {
      begin()
      move(point)
    },
    click: (target, m) => clicks(target, 1, m),
    doubleClick: target => clicks(target, 2),
    tripleClick: target => clicks(target, 3),
    drag(from, to) {
      begin()
      const start = at(from)
      const end = at(to)
      move(from)
      press(start.el, start.x, start.y, 0, { detail: 1 })
      const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y)))
      for (let i = 1; i <= steps; i += 1) {
        const x = start.x + ((end.x - start.x) * i) / steps
        const y = start.y + ((end.y - start.y) * i) / steps
        const target = fixtureTargetAt(x, y)
        mouse((target === null ? null : elements.get(target)) ?? scroller(), 'mousemove', { x, y, buttons: 1 })
      }
      release(end.el, end.x, end.y, 0, { detail: 1 })
      mouse(commonAncestor(start.el, end.el), 'click', { x: end.x, y: end.y, button: 0, detail: 1 })
    },
    selectText(target) {
      const text = [...(elements.get(target)?.childNodes ?? [])].find(node => node.nodeType === Node.TEXT_NODE)
      if (text === undefined) throw new Error(`no text in ${target}`)
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, Math.min(6, text.textContent?.length ?? 0))
      act(() => {
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(range)
      })
    },
    selectedText: () => window.getSelection()?.toString() ?? '',
    rightClick,
    middleClick(target) {
      begin()
      move({ target })
      const { x, y, el } = at({ target })
      press(el, x, y, 1)
      release(el, x, y, 1)
      mouse(el, 'auxclick', { x, y, button: 1, detail: 1 })
    },
    pressEscape() {
      begin('keyboard')
      // Focus where the reader's is: in an open menu or window, else in the preview (its scroller is a tab stop, C-08.1).
      const active = document.activeElement
      const layer = [menu(), commentWindow()].find(el => el !== null && active !== null && el.contains(active))
      const target = layer !== undefined && active !== null ? active : scroller()
      if (target === scroller()) act(() => scroller().focus())
      key('keyDown', target)
      key('keyUp', target)
    },
    picks,
    pickedTarget: () => picks().filter(p => p.kind !== 'exit').at(-1)?.target ?? null,
    outlinedTarget,
    outlineSelected() {
      const outlined = outlinedTarget()
      return outlined !== null && document.activeElement === elements.get(outlined)
    },
    labelText(target) {
      move({ target })
      return tabText()
    },
    pageSaw: () => [...seen],
    openLayer(): OverlayLayer | null {
      if (menu() !== null) return 'menu'
      if (commentWindow() !== null) return 'window'
      return isModeOn() ? 'mode' : null
    },
    async open(layer, target = 'inner') {
      if (layer === 'menu') {
        rightClick(target)
        await waitFor(() => expect(menu()).not.toBeNull())
      } else if (layer === 'window') {
        clicks(target, 1)
        await waitFor(() => expect(commentWindow()).not.toBeNull())
      } else throw new Error(`the Markdown host does not own ${layer}`)
    },
    async dispose() {
      // Let a window a pick asked for finish opening inside act, then take everything down.
      await act(async () => {})
      for (const type of PAGE_EVENTS) document.removeEventListener(type, record)
      window.getSelection()?.removeAllRanges()
      view.unmount()
      elementBox.mockRestore()
      restoreLayout()
      portal.remove()
      resetStores()
      pickRecorder.reset()
    }
  }
}
