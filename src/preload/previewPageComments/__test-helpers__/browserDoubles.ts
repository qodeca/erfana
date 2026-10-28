// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Test doubles for the browser APIs the comment overlay uses and jsdom lacks
 * (docs/designs/html-preview-comments.md §12.1 L3: "geometry,
 * elementFromPoint, checkVisibility, Popover API and adoptedStyleSheets
 * injected as test doubles").
 *
 * jsdom has no layout, no top layer, no constructable stylesheets with
 * `replaceSync`, no `checkVisibility`, no `elementFromPoint` and no
 * `ResizeObserver`. Each double is installed on the prototype the real code
 * calls, so the code under test runs unchanged; `restore()` puts every
 * original back.
 *
 * Trusted events: the overlay ignores any event whose `isTrusted` is false,
 * and jsdom's public `dispatchEvent` always makes it false. `dispatchTrusted`
 * marks the event trusted and dispatches it the way jsdom fires its own
 * events – the same helper `previewPage.test.ts` documents and self-checks.
 */
import { createRequire } from 'node:module'

const requireFromHere = createRequire(import.meta.url)
const { implForWrapper } = requireFromHere('jsdom/lib/jsdom/living/generated/utils.js') as {
  implForWrapper: (wrapper: object) => unknown
}

/** Dispatch `event` at `target` as a browser-made (trusted) event. */
export function dispatchTrusted(target: EventTarget, event: Event): void {
  const eventImpl = implForWrapper(event) as { isTrusted: boolean }
  eventImpl.isTrusted = true
  ;(implForWrapper(target) as { _dispatch: (e: unknown) => boolean })._dispatch(eventImpl)
}

/** A rectangle as tests write it. */
export interface TestBox {
  left: number
  top: number
  width: number
  height: number
}

/** The installed doubles. */
export interface BrowserDoubles {
  /** Give `element` a border box (and a client rect when it has an area). */
  setBox(element: Element, box: TestBox): void
  /** What `checkVisibility` answers for `element` (default true; false inside a closed `<details>`, as in Chromium). */
  setVisible(element: Element, visible: boolean): void
  /** Every closed shadow root attached since install, oldest first. */
  readonly shadowRoots: ShadowRoot[]
  /** CSS text replaced into each constructable sheet. */
  sheetText(sheet: CSSStyleSheet): string | undefined
  /** `checkVisibility` options seen, last first. */
  readonly visibilityOptions: unknown[]
  /** `scrollIntoView` calls: element and options. */
  readonly scrolledIntoView: Array<{ element: Element; options: unknown }>
  /** Elements the `ResizeObserver` double observes right now. */
  readonly resizeObserved: Set<Element>
  /** Fire every `ResizeObserver` double's callback. */
  fireResize(): void
  /** Close a popover as the page's `hidePopover()` would (trusted `toggle`). */
  hidePopover(element: HTMLElement): void
  restore(): void
}

interface Saved {
  target: object
  key: PropertyKey
  descriptor: PropertyDescriptor | undefined
}

function toRect(box: TestBox): DOMRect {
  const rect = {
    x: box.left,
    y: box.top,
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    right: box.left + box.width,
    bottom: box.top + box.height
  }
  return { ...rect, toJSON: () => rect } as DOMRect
}

/**
 * Whether a closed `<details>` hides `element`, as Chromium renders one: of a
 * closed section only its first `<summary>` child is rendered.
 */
function foldedAway(element: Element): boolean {
  let child: Element = element
  for (let parent = element.parentElement; parent !== null; child = parent, parent = parent.parentElement) {
    if (parent.localName !== 'details' || parent.hasAttribute('open')) continue
    if ([...parent.children].find(c => c.localName === 'summary') !== child) return true
  }
  return false
}

/** Install every double. Call `restore()` in `afterEach`. */
export function installBrowserDoubles(): BrowserDoubles {
  const saved: Saved[] = []
  const define = (target: object, key: PropertyKey, descriptor: PropertyDescriptor): void => {
    saved.push({ target, key, descriptor: Object.getOwnPropertyDescriptor(target, key) })
    Object.defineProperty(target, key, { configurable: true, ...descriptor })
  }
  const boxes = new WeakMap<Element, TestBox>()
  const hidden = new WeakSet<Element>()
  const open = new WeakSet<Element>()
  const sheets = new WeakMap<CSSStyleSheet, string>()
  const adopted = new WeakMap<object, CSSStyleSheet[]>()
  const shadowRoots: ShadowRoot[] = []
  const visibilityOptions: unknown[] = []
  const scrolledIntoView: Array<{ element: Element; options: unknown }> = []
  const resizeObserved = new Set<Element>()
  const resizeCallbacks: Array<() => void> = []
  const realMatches = Element.prototype.matches
  const realAttachShadow = Element.prototype.attachShadow

  define(Element.prototype, 'getBoundingClientRect', {
    value(this: Element) {
      return toRect(boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 })
    }
  })
  define(Element.prototype, 'getClientRects', {
    value(this: Element) {
      const box = boxes.get(this)
      return box === undefined ? [] : [toRect(box)]
    }
  })
  define(Element.prototype, 'checkVisibility', {
    value(this: Element, options: unknown) {
      visibilityOptions.unshift(options)
      return !hidden.has(this) && !foldedAway(this)
    }
  })
  define(Element.prototype, 'scrollIntoView', {
    value(this: Element, options: unknown) {
      scrolledIntoView.push({ element: this, options })
    }
  })
  define(Element.prototype, 'matches', {
    value(this: Element, selector: string) {
      if (selector === ':popover-open') return open.has(this)
      return realMatches.call(this, selector)
    }
  })
  define(Element.prototype, 'attachShadow', {
    value(this: Element, init: ShadowRootInit) {
      const root = realAttachShadow.call(this, init)
      shadowRoots.push(root)
      return root
    }
  })
  define(HTMLElement.prototype, 'showPopover', {
    value(this: HTMLElement) {
      open.add(this)
    }
  })
  define(HTMLElement.prototype, 'popover', { value: null, writable: true })
  define(CSSStyleSheet.prototype, 'replaceSync', {
    value(this: CSSStyleSheet, text: string) {
      sheets.set(this, text)
    }
  })
  for (const proto of [ShadowRoot.prototype, Document.prototype]) {
    define(proto, 'adoptedStyleSheets', {
      get(this: object) {
        return adopted.get(this) ?? []
      },
      set(this: object, value: CSSStyleSheet[]) {
        adopted.set(this, [...value])
      }
    })
  }
  define(document, 'elementFromPoint', {
    value(x: number, y: number): Element | null {
      const all = [...document.querySelectorAll('*')].reverse()
      return (
        all.find(el => {
          const box = boxes.get(el)
          return box !== undefined && x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height
        }) ?? null
      )
    }
  })
  class ResizeObserverDouble {
    constructor(callback: () => void) {
      resizeCallbacks.push(callback)
    }
    observe(element: Element): void {
      resizeObserved.add(element)
    }
    unobserve(element: Element): void {
      resizeObserved.delete(element)
    }
    disconnect(): void {
      resizeObserved.clear()
    }
  }
  define(window, 'ResizeObserver', { value: ResizeObserverDouble, writable: true })

  return {
    setBox: (element, box) => boxes.set(element, box),
    setVisible: (element, visible) => (visible ? hidden.delete(element) : hidden.add(element)),
    shadowRoots,
    sheetText: sheet => sheets.get(sheet),
    visibilityOptions,
    scrolledIntoView,
    resizeObserved,
    fireResize: () => resizeCallbacks.forEach(cb => cb()),
    hidePopover(element) {
      open.delete(element)
      const event = new Event('toggle')
      Object.defineProperty(event, 'newState', { value: 'closed' })
      dispatchTrusted(element, event)
    },
    restore() {
      for (const { target, key, descriptor } of saved.reverse()) {
        if (descriptor === undefined) delete (target as Record<PropertyKey, unknown>)[key]
        else Object.defineProperty(target, key, descriptor)
      }
    }
  }
}
