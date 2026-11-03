// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The mouse router of one browser tab's page view (spec 025, 025-FR-047 to
 * 025-FR-049; ADR 0011 decision 16; solution design § 7).
 *
 * Runs on the page's `before-mouse-event`, before the page sees the event.
 * What a primary press means is decided by the shared reducer
 * (`pageClick` in `shared/browser/routingState.ts`); this module decides
 * whether the page receives the press:
 *
 * - **Browsing** (pick mode off, no menu or dialog): the press reaches the
 *   page unless the click guard drops it – a row above the page appeared or
 *   went in the last 500 ms while the pointer was over the page.
 * - **Pick mode, menu, dialog**: no press, release or context-menu event
 *   reaches the page (pick blocking). The reducer turns the press into a
 *   confirm, a dropped click with its note, or the first-click rule: when
 *   keyboard focus came from outside the tab, the first click only gives the
 *   page focus.
 * - A dropped press gives the page focus itself (the press that would have
 *   done it never arrives), and the release of a dropped press is dropped.
 *
 * The pointer's presence over the page (`mouseEnter`, `mouseMove`,
 * `mouseLeave`) feeds the click guard. Hit testing in pick mode joins in
 * commit 14.
 */
import type { RoutingEffect, RoutingEvent, RoutingState } from '../../../../shared/browser/routingState'
import type { PreventableEvent } from './browserKeyRouter'

/**
 * The double-click interval when the operating system's is not known.
 * Electron does not expose the system setting; 500 ms is the Windows default
 * and longer than the macOS and GNOME defaults, so a real double-click is
 * always inside it.
 */
export const DEFAULT_DOUBLE_CLICK_MS = 500

/** The fields of Electron's `MouseInputEvent` the router reads. */
export interface RoutedMouseInput {
  readonly type: string
  readonly button?: 'left' | 'middle' | 'right'
}

export interface BrowserMouseRouterDeps {
  readonly state: () => RoutingState
  /** Run the routing reducer and return the effects it asked for. */
  readonly dispatch: (event: RoutingEvent) => readonly RoutingEffect[]
  readonly now: () => number
  readonly doubleClickMs: number
  /** Give the page keyboard focus. */
  readonly focusPage: () => void
}

export class BrowserMouseRouter {
  private pointerOver = false
  private readonly droppedPresses = new Set<string>()

  constructor(private readonly deps: BrowserMouseRouterDeps) {}

  /** Whether the pointer is over the page area now (for the click guard). */
  isPointerOverPage(): boolean {
    return this.pointerOver
  }

  /** The page's `before-mouse-event` listener. */
  handle(event: PreventableEvent, mouse: RoutedMouseInput): void {
    switch (mouse.type) {
      case 'mouseEnter':
      case 'mouseMove':
        this.pointerOver = true
        return
      case 'mouseLeave':
        this.pointerOver = false
        return
      case 'mouseDown':
        this.press(event, mouse.button ?? 'left')
        return
      case 'mouseUp':
        this.release(event, mouse.button ?? 'left')
        return
      case 'contextMenu':
        if (this.blocksPage(this.deps.state())) event.preventDefault()
        return
      default:
    }
  }

  /** Focus left the page: a release that comes later belongs to no press here. */
  reset(): void {
    this.droppedPresses.clear()
  }

  /** Pick mode, an open menu or an open dialog: the page receives no press. */
  private blocksPage(s: RoutingState): boolean {
    return s.pick || s.surface !== 'none'
  }

  private press(event: PreventableEvent, button: string): void {
    const before = this.deps.state()
    this.pointerOver = true
    if (button !== 'left') {
      if (this.blocksPage(before)) this.drop(event, button)
      return
    }
    const effects = this.deps.dispatch({ type: 'pageClick', now: this.deps.now(), doubleClickMs: this.deps.doubleClickMs })
    const guarded = effects.some((effect) => effect.type === 'dropClick')
    if (!guarded && !this.blocksPage(before)) return
    this.drop(event, button)
    this.deps.focusPage()
  }

  private release(event: PreventableEvent, button: string): void {
    if (!this.droppedPresses.delete(button)) return
    event.preventDefault()
  }

  private drop(event: PreventableEvent, button: string): void {
    event.preventDefault()
    this.droppedPresses.add(button)
  }
}
