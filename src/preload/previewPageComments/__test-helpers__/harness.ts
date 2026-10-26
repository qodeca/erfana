// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A comment controller on the test document, with its input guards attached,
 * a recording `send`, a manual clock and the browser doubles installed. One
 * harness per test: `dispose()` removes every listener, observer and node it
 * added, so tests sharing jsdom's single window do not leak into each other.
 */
import { vi, type Mock } from 'vitest'
import { CommentController, type ControllerDeps } from '../controller'
import { attachInputGuards } from '../input'
import { installBrowserDoubles, dispatchTrusted, type BrowserDoubles, type TestBox } from './browserDoubles'

/** A valid element token (`[a-z2-7]{12}`) derived from `n`. */
export function token(n: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  let out = ''
  for (let v = n; out.length < 12; v = Math.floor(v / 32)) out = alphabet[v % 32] + out
  return out
}

/** The test's harness. */
export interface Harness {
  readonly controller: CommentController
  readonly send: Mock<(channel: string, payload: unknown) => void>
  readonly doubles: BrowserDoubles
  readonly clock: { now: number }
  /** What was sent on `channel`, in order. */
  sent(channel: string): unknown[]
  /** The overlay host, when one is attached. */
  host(): HTMLElement | null
  /** The overlay's closed shadow root, captured by the doubles. */
  root(): ShadowRoot | undefined
  /** Apply a state; `commentable` defaults to true and `icons` to none. */
  state(partial: Record<string, unknown>): void
  dispose(): void
}

/** Options for {@link createHarness}. */
export interface HarnessOptions {
  readonly isTop?: boolean
  /** Whether the document is still loading when the controller starts (token window open). */
  readonly loading?: boolean
}

/**
 * Build the harness. With `loading` (the default) the token window is open
 * until `controller.documentReady()`.
 */
export function createHarness(options: HarnessOptions = {}): Harness {
  const doubles = installBrowserDoubles()
  const clock = { now: 10_000 }
  const send = vi.fn<(channel: string, payload: unknown) => void>()
  if (options.loading !== false) {
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' })
  }
  const deps: ControllerDeps = {
    win: window,
    doc: document,
    send,
    now: () => clock.now,
    isTop: options.isTop ?? true
  }
  const controller = new CommentController(deps)
  delete (document as unknown as Record<string, unknown>).readyState
  controller.start()
  const detach = attachInputGuards(window, document, controller)
  const isHost = (el: Element): boolean => el.parentElement === document.documentElement && el.localName === 'div'
  return {
    controller,
    send,
    doubles,
    clock,
    sent: channel => send.mock.calls.filter(([c]) => c === channel).map(([, payload]) => payload),
    host: () => ([...document.documentElement.children].find(isHost) as HTMLElement | undefined) ?? null,
    root: () => doubles.shadowRoots.at(-1),
    state: partial => controller.applyState({ mode: false, commentable: true, icons: [], ...partial }),
    dispose() {
      detach()
      controller.dispose()
      for (const el of [...document.documentElement.children]) if (isHost(el)) el.remove()
      document.body.innerHTML = ''
      doubles.restore()
    }
  }
}

/** Let queued microtasks (MutationObserver deliveries) run. */
export async function microtasks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve()
}

/** Mount `html` in the body and give each listed element (by id) a box. */
export function mount(html: string, boxes: Record<string, TestBox> = {}, doubles?: BrowserDoubles): void {
  document.body.insertAdjacentHTML('beforeend', html)
  for (const [id, box] of Object.entries(boxes)) {
    const el = document.getElementById(id)
    if (el === null) throw new Error(`mount: no #${id}`)
    doubles?.setBox(el, box)
  }
}

/** The element with `id`, or a thrown error. */
export function byId(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`no #${id}`)
  return el
}

/** A trusted mouse-family event at `target`, positioned at (x, y). */
export function userMouse(
  target: EventTarget,
  type: string,
  init: MouseEventInit & { x?: number; y?: number } = {}
): MouseEvent {
  const { x = 0, y = 0, ...rest } = init
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    detail: type === 'click' || type === 'dblclick' ? 1 : 0,
    ...rest
  })
  dispatchTrusted(target, event)
  return event
}

/** A trusted key press at `target` (default: the body). */
export function userKey(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init })
  dispatchTrusted(target, event)
  return event
}

/** A trusted key release at `target` (default: the body). */
export function userUp(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, composed: true, ...init })
  dispatchTrusted(target, event)
  return event
}

/** A trusted pointer move to (x, y). */
export function userMove(x: number, y: number, target: EventTarget = document.body): void {
  dispatchTrusted(target, new MouseEvent('pointermove', { bubbles: true, composed: true, clientX: x, clientY: y }))
}

export { dispatchTrusted }
