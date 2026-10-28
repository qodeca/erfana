// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment mode's input guards (docs/designs/comments/html-preview-comments.md §3
 * "Keyboard picker keys", §7.1 steps 3–4, §7.2, decision 19; tests J-003,
 * J-004, J-012, J-013, SEC-02, SEC-03, SEC-29).
 *
 * Every listener is on `window`, in the CAPTURE phase, and registered when
 * the preload starts – before any page script – so it runs first and a page
 * cannot get between it and the event. They stay registered for the life of
 * the document and do nothing while comment mode is off: re-adding them when
 * the mode turns on would put them behind every capture listener the page
 * registered in the meantime. `dispose` (tests) is what removes them.
 *
 * `document.open()` erases every listener of the window and the document, the
 * isolated world's included. The page replacing `<html>` is the trace it
 * leaves (`documentWatch.ts`): the guards are put back at once – behind any
 * listener a script in the written markup registered first, which is why the
 * controller then tells main comments are unavailable for this load.
 *
 * Only `isTrusted` events count. A page's own `dispatchEvent` / `.click()`
 * passes through untouched and sends nothing (SEC-03, SEC-29).
 *
 * In comment mode a trusted click-family event is stopped
 * (`stopImmediatePropagation`) and its default prevented – except
 * `contextmenu`, whose default the native view has none of. Touches are
 * stopped too (passive: the click they make is what gets cancelled), and so is
 * the release of every key whose press was a picker action. A click on a pin
 * is stopped in any mode, so a pin click never reaches the page. Wheel and
 * scroll keys are never touched: inner scrollers keep working.
 *
 * The overlay host's own popover events (`beforetoggle`, `toggle`) are kept
 * from the page in any mode: a page listener cancelling the host's
 * `showPopover()` would otherwise hide the overlay with nothing to repair.
 *
 * Main forwards only the comment-mode toggle; the picker keys are handled
 * here: Tab / Shift+Tab, Alt+↑ / Alt+↓ (matched on `code`, so Option on macOS
 * and any layout work), Enter, Shift+F10 / ContextMenu, Esc.
 */
import type { CommentController, PickerAction } from './controller'
import { watchDocumentElement } from './documentWatch'

/** The click family comment mode swallows (§7.1 step 3, plus `pointerup`). */
export const GUARDED_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'auxclick',
  'dblclick',
  'contextmenu',
  'dragstart',
  'submit'
] as const

/** Touches comment mode keeps from the page; passive, so never cancelled. */
export const TOUCH_EVENTS = ['touchstart', 'touchend'] as const

/** The overlay host's popover events, kept from the page in any mode. */
export const TOGGLE_EVENTS = ['beforetoggle', 'toggle'] as const

/** Inputs that mean the user has taken over the scroll. */
const USER_INPUT_EVENTS = ['wheel', 'pointerdown', 'keydown'] as const

const CAPTURE: AddEventListenerOptions = Object.freeze({ capture: true })
const PASSIVE: AddEventListenerOptions = Object.freeze({ capture: true, passive: true })

/**
 * Stop an event from reaching the page. The ONLY place this preload calls
 * `preventDefault` (SEC-02): the comment-mode guard and pin clicks.
 */
function swallow(event: Event): void {
  event.stopImmediatePropagation()
  if (event.type !== 'contextmenu') event.preventDefault()
}

/** The picker action a key press means, or `null` for any other key (which the page keeps). */
export function pickerActionOf(event: KeyboardEvent): PickerAction | null {
  if (event.ctrlKey || event.metaKey) return null
  if (event.altKey) {
    if (event.shiftKey) return null
    if (event.code === 'ArrowUp') return 'up'
    return event.code === 'ArrowDown' ? 'down' : null
  }
  if (event.key === 'Tab') return event.shiftKey ? 'previous' : 'next'
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) return 'menu'
  if (event.shiftKey) return null
  if (event.key === 'Enter') return 'open'
  return event.key === 'Escape' ? 'exit' : null
}

/** One key across its press and release (the physical key; `key` where the engine gives no `code`). */
function keyOf(event: KeyboardEvent): string {
  return event.code === '' ? event.key : event.code
}

type Handler = (event: Event) => void

/** The guards' handlers for one controller. */
interface Handlers {
  readonly guarded: Handler
  readonly touch: Handler
  readonly toggle: Handler
  readonly keyDown: Handler
  readonly keyUp: Handler
  readonly move: Handler
  readonly out: Handler
  readonly visibility: Handler
  readonly userInput: Handler
  readonly ready: Handler
}

function handlersOf(controller: CommentController): Handlers {
  /** Keys whose press the guard swallowed: their release is swallowed too. */
  const swallowedKeys = new Set<string>()
  return {
    guarded(event) {
      if (!event.isTrusted) return
      const onOverlay = controller.isOverlayEvent(event)
      if (!controller.mode && !onOverlay) return
      swallow(event)
      if (!(event instanceof MouseEvent)) return
      if (onOverlay) controller.overlayEvent(event)
      else controller.pageEvent(event)
    },
    touch(event) {
      if (event.isTrusted && (controller.mode || controller.isOverlayEvent(event))) event.stopImmediatePropagation()
    },
    toggle(event) {
      if (!controller.isOverlayEvent(event)) return
      // The host's own listener never runs now: the controller passes it on.
      event.stopImmediatePropagation()
      if (event.type === 'toggle') controller.hostToggled(event)
    },
    keyDown(event) {
      const key = event as KeyboardEvent
      if (!key.isTrusted) return
      const action = controller.mode ? pickerActionOf(key) : null
      if (action === null) {
        // A press the page keeps: a release left over from a swallowed one
        // (focus moved before it came) must not be swallowed now.
        swallowedKeys.delete(keyOf(key))
        return
      }
      swallow(key)
      swallowedKeys.add(keyOf(key))
      controller.pickerAction(action)
    },
    keyUp(event) {
      if (event.isTrusted && swallowedKeys.delete(keyOf(event as KeyboardEvent))) swallow(event)
    },
    move(event) {
      const pointer = event as PointerEvent
      if (pointer.isTrusted) controller.pointerAt({ x: pointer.clientX, y: pointer.clientY })
    },
    out(event) {
      if (event.isTrusted && (event as PointerEvent).relatedTarget === null) controller.pointerLeft()
    },
    visibility(event) {
      if (event.isTrusted) controller.visibilityChanged()
    },
    userInput(event) {
      if (event.isTrusted) controller.userInput()
    },
    ready(event) {
      if (event.isTrusted) controller.documentReady()
    }
  }
}

/** One listener the guards keep registered. */
interface Registration {
  readonly target: EventTarget
  readonly type: string
  readonly listener: Handler
  readonly options: AddEventListenerOptions
}

function registrationsOf(win: Window, doc: Document, on: Handlers): Registration[] {
  const onWindow = (types: readonly string[], listener: Handler, options: AddEventListenerOptions): Registration[] =>
    types.map(type => ({ target: win, type, listener, options }))
  return [
    ...onWindow(GUARDED_EVENTS, on.guarded, CAPTURE),
    ...onWindow(TOUCH_EVENTS, on.touch, PASSIVE),
    ...onWindow(TOGGLE_EVENTS, on.toggle, CAPTURE),
    ...onWindow(USER_INPUT_EVENTS, on.userInput, PASSIVE),
    ...onWindow(['keydown'], on.keyDown, CAPTURE),
    ...onWindow(['keyup'], on.keyUp, CAPTURE),
    ...onWindow(['pointermove'], on.move, PASSIVE),
    { target: doc, type: 'pointerout', listener: on.out, options: PASSIVE },
    // The view hidden behind a menu's or window's still frame (and shown again).
    { target: doc, type: 'visibilitychange', listener: on.visibility, options: PASSIVE },
    // The first DOMContentLoaded listener of the document – the window, in
    // capture, before the document's own – so the token window closes before
    // any page listener runs (R3-2). Not `once`: a page's forged event would
    // spend it, and the controller ignores a second real one.
    ...onWindow(['DOMContentLoaded'], on.ready, CAPTURE)
  ]
}

/**
 * Attach the guards, and put them back each time the page replaces `<html>`.
 * Returns the function that removes them (tests only – in the page they live
 * as long as the document).
 */
export function attachInputGuards(win: Window, doc: Document, controller: CommentController): () => void {
  const registrations = registrationsOf(win, doc, handlersOf(controller))
  const add = (): void => {
    // Idempotent: the same listener, type and phase is never added twice.
    for (const { target, type, listener, options } of registrations) target.addEventListener(type, listener, options)
  }
  add()
  const unwatch = watchDocumentElement(doc, () => {
    add()
    controller.documentReplaced()
  })
  return () => {
    unwatch()
    for (const { target, type, listener, options } of registrations) target.removeEventListener(type, listener, options)
  }
}
