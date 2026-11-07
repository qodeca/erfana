// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The popup blocker's two counters (spec 025, 025-FR-011 rule 3; solution
 * design § 3.5 `browserWindowOpen`; ADR 0011 decision 16).
 *
 * Electron runs no popup blocker of its own: every `window.open` reaches the
 * window-open handler, with or without a user action (measured on Electron
 * 44). Erfana decides here.
 *
 * - **User activation** ({@link ActivationTracker}, one per page
 *   `webContents`). A press counts only when the page actually received it:
 *   a mouse button press, or a key press other than a modifier or Esc, that
 *   no router before this one dropped (`event.defaultPrevented` – the tab's
 *   key and mouse routers listen first). A press lets the page open one tab
 *   or window within {@link ACTIVATION_WINDOW_MS}; the open uses it up.
 *   Chromium attributes activation per frame; this tracker sees the view, not
 *   the frame, so a press anywhere in the page activates every frame of it.
 * - **Rate** ({@link OpenRateLimit}, one per tab, shared with the tab's
 *   popups): at most {@link MAX_OPENS_PER_MINUTE} opens in any
 *   {@link RATE_WINDOW_MS}.
 *
 * Time is the injected clock's, so tests move it.
 */
import type { Clock } from '../../../../shared/clock'

/** How long a press lets the page open one tab or window (design § 3.5). */
export const ACTIVATION_WINDOW_MS = 5_000
/** Most tabs and windows one tab's pages may open per {@link RATE_WINDOW_MS} (025-FR-011). */
export const MAX_OPENS_PER_MINUTE = 5
export const RATE_WINDOW_MS = 60_000

/** Keys that are never a user activation (Chromium's rule): modifiers, locks and Esc. */
const NON_ACTIVATING_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'FnLock',
  'OS',
  'Hyper',
  'Super',
  'Escape'
])

/** The fields of an Electron input event the tracker reads. */
export interface PressEvent {
  readonly defaultPrevented?: boolean
}
export interface PressMouse {
  readonly type: string
}
export interface PressKey {
  readonly type: string
  readonly key: string
  readonly isAutoRepeat?: boolean
}

type Listener = (...args: unknown[]) => void

/** The page `webContents` surface the tracker listens to. */
export interface ActivationContents {
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
  isDestroyed(): boolean
}

/** User activation of one page view. */
export class ActivationTracker {
  private lastPressAt: number | null = null
  private detach: () => void = () => undefined

  constructor(private readonly clock: Pick<Clock, 'now'>) {}

  /** Count the presses `contents` receives; call after the tab's input routers attached. */
  listen(contents: ActivationContents): void {
    const onMouse = ((event: PressEvent, mouse: PressMouse) => this.onMouse(event, mouse)) as unknown as Listener
    const onKey = ((event: PressEvent, key: PressKey) => this.onKey(event, key)) as unknown as Listener
    contents.on('before-mouse-event', onMouse)
    contents.on('before-input-event', onKey)
    this.detach = () => {
      if (contents.isDestroyed()) return
      contents.removeListener('before-mouse-event', onMouse)
      contents.removeListener('before-input-event', onKey)
    }
  }

  /** Stop listening. */
  unlisten(): void {
    this.detach()
    this.detach = () => undefined
  }

  /** A press the page received (also the test seam). */
  recordPress(): void {
    this.lastPressAt = this.clock.now()
  }

  /** Whether a press within {@link ACTIVATION_WINDOW_MS} is still unused. */
  isActive(): boolean {
    return this.lastPressAt !== null && this.clock.now() - this.lastPressAt <= ACTIVATION_WINDOW_MS
  }

  /** Use the press up: one open per press. */
  consume(): void {
    this.lastPressAt = null
  }

  onMouse(event: PressEvent, mouse: PressMouse): void {
    if (mouse.type === 'mouseDown' && event.defaultPrevented !== true) this.recordPress()
  }

  onKey(event: PressEvent, key: PressKey): void {
    if (event.defaultPrevented === true || key.isAutoRepeat === true) return
    if (key.type !== 'keyDown' && key.type !== 'rawKeyDown') return
    if (!NON_ACTIVATING_KEYS.has(key.key)) this.recordPress()
  }
}

/** At most {@link MAX_OPENS_PER_MINUTE} opens per tab in any minute. */
export class OpenRateLimit {
  private readonly opens: number[] = []

  constructor(private readonly clock: Pick<Clock, 'now'>) {}

  /** Whether one more open fits in the last minute. */
  hasRoom(): boolean {
    this.prune()
    return this.opens.length < MAX_OPENS_PER_MINUTE
  }

  /** Record an open that went ahead. */
  record(): void {
    this.prune()
    this.opens.push(this.clock.now())
  }

  private prune(): void {
    const since = this.clock.now() - RATE_WINDOW_MS
    while (this.opens.length > 0 && (this.opens[0] as number) <= since) this.opens.shift()
  }
}
