// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The key router of one browser tab's page view (spec 025, 025-FR-014,
 * 025-FR-047 to 025-FR-052; ADR 0011 decisions 11, 12, 14, 15; solution
 * design § 7).
 *
 * Runs on the page's `before-input-event`, so it sees every key before the
 * page does, and only while the page has keyboard focus. Where a key goes is
 * decided by the shared table (`routeKey` in `shared/browser/routingState.ts`)
 * from the tab's routing state; this module only carries the decision out:
 *
 * - **page** and **os**: the event is left alone – the page, or the operating
 *   system (Alt+Tab, Alt+F4, the Windows key), receives it.
 * - **erfana**: the event is consumed and handed to {@link KeyRouteActions}.
 * - **drop** and **focused**: the event is consumed and nobody acts. A key
 *   meant for a focused Erfana control cannot reach that control from the
 *   page's own input stream, and the page receives no key outside the
 *   browsing state.
 *
 * When a key-down is consumed, its auto-repeats and its key-up are consumed
 * too ({@link ConsumedKeys}), so the page never sees half of a key Erfana
 * took. Holding a consumed key therefore performs its action once.
 */
import { isKeyPress, type BrowserKeyAction, type BrowserKeyInput, type MacEditRole, type PickKeyAction, type ReservedKey } from '../../../../shared/browser/browserKeys'
import { routeKey, type ErfanaKey, type KeyRouteContext, type RoutingState } from '../../../../shared/browser/routingState'

/** The part of Electron's `before-input-event` event the router uses. */
export interface PreventableEvent {
  preventDefault(): void
}

/** What the router asks the tab to do for a key Erfana handles. */
export interface KeyRouteActions {
  browserKey(action: BrowserKeyAction): void
  reservedKey(key: ReservedKey): void
  pickKey(action: PickKeyAction): void
  /** macOS only: Cmd+C, V, X, A, Z, Shift+Z performed in the page (ADR 0011 decision 12). */
  macEdit(role: MacEditRole): void
  /** Esc while the page is in full screen or holds the pointer lock (025-FR-019). */
  exitFullscreen(): void
}

/** The physical key, or the produced key when a synthetic event carries no code. */
function keyId(input: BrowserKeyInput): string {
  return input.code !== '' ? input.code : input.key
}

/**
 * The key-downs Erfana consumed and whose key-up has not come yet. A repeat
 * or the release of one of them is consumed as well (ADR 0011 decision 11).
 */
export class ConsumedKeys {
  private readonly held = new Set<string>()

  /** Note a consumed key-down. */
  remember(input: BrowserKeyInput): void {
    this.held.add(keyId(input))
  }

  /**
   * True when `input` is an auto-repeat or the release of a consumed key; a
   * release also forgets the key. A fresh press of the same key is not a
   * follow-up: it is routed again (a key-up lost to a focus change must not
   * swallow the next press).
   */
  isFollowUp(input: BrowserKeyInput): boolean {
    const id = keyId(input)
    if (!this.held.has(id)) return false
    if (input.type === 'keyUp') {
      this.held.delete(id)
      return true
    }
    if (input.isAutoRepeat === true) return true
    this.held.delete(id)
    return false
  }

  /** Forget everything, for example when focus leaves (key-ups go elsewhere then). */
  clear(): void {
    this.held.clear()
  }
}

export interface BrowserKeyRouterDeps {
  /** `process.platform`; the tables read no platform themselves. */
  readonly platform: string
  /** The tab's routing state at the moment of the key. */
  readonly state: () => RoutingState
  readonly context: () => KeyRouteContext
  readonly actions: KeyRouteActions
}

/** Hand a consumed key to the action that handles its kind. */
export function performErfanaKey(actions: KeyRouteActions, key: ErfanaKey): void {
  switch (key.kind) {
    case 'browser':
      actions.browserKey(key.action)
      return
    case 'reserved':
      actions.reservedKey(key.key)
      return
    case 'pick':
      actions.pickKey(key.action)
      return
    case 'macEdit':
      actions.macEdit(key.action)
      return
    case 'exitFullscreen':
      actions.exitFullscreen()
  }
}

export class BrowserKeyRouter {
  private readonly consumed = new ConsumedKeys()

  constructor(private readonly deps: BrowserKeyRouterDeps) {}

  /** The page's `before-input-event` listener. */
  handle(event: PreventableEvent, input: BrowserKeyInput): void {
    if (this.consumed.isFollowUp(input)) {
      event.preventDefault()
      return
    }
    const route = routeKey(this.deps.state(), input, this.deps.platform, this.deps.context())
    if (route.to === 'page' || route.to === 'os') return
    event.preventDefault()
    if (isKeyPress(input)) this.consumed.remember(input)
    if (route.to === 'erfana') performErfanaKey(this.deps.actions, route.key)
  }

  /** Focus left the page: the key-ups of held keys will not come here. */
  reset(): void {
    this.consumed.clear()
  }
}
