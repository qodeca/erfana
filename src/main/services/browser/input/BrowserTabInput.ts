// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The input side of one browser tab, in main (spec 025, 025-FR-014,
 * 025-FR-019, 025-FR-047 to 025-FR-052; ADR 0011 decisions 11–16; solution
 * design § 7).
 *
 * Holds the tab's routing state – the shared pure reducer
 * (`shared/browser/routingState.ts`), which the renderer mirrors – and wires
 * the page's input to it:
 *
 * - the key router ({@link BrowserKeyRouter}) on `before-input-event`, and
 *   the mouse router ({@link BrowserMouseRouter}) on `before-mouse-event`;
 * - where keyboard focus is: the page's own `focus` / `blur`, and the
 *   renderer's reports of toolbar focus and of where focus came from (the
 *   first-click rule applies only to focus from outside the tab);
 * - the click guard: {@link BrowserTabInput.recordRowShift} when the page
 *   area moved because a row above it appeared or went;
 * - page full screen, so Esc exits it before the page sees it.
 *
 * Keys Erfana acts on are performed here or handed to the owning window:
 * browser keys and reserved keys go out as `browser-tab:forwardedKey`
 * actions (ADR 0011 decision 14), Ctrl/Cmd+E and the pick keys run through
 * the reducer, and the macOS Edit roles and application keys run in main
 * (`macAppRoles.ts`). A browser key that navigates or closes the tab ends
 * pick mode silently first (025-FR-052).
 *
 * The page view ignores the application menu's shortcuts while focused, so
 * Erfana's app shortcuts never fire from a page (025-FR-047).
 *
 * Reducer effects this module does not perform itself – capture start and
 * discard, unfreeze, the page-changed notice, toolbar focus targets – go to
 * {@link BrowserTabInputDeps.onEffect} and to the attached pick pipeline
 * (`pick/BrowserTabPick.ts`), which perform them.
 */
import type { Clock } from '../../../../shared/clock'
import {
  isLeavingAction,
  type BrowserKeyAction,
  type BrowserKeyInput,
  type PickKeyAction,
  type ReservedKey
} from '../../../../shared/browser/browserKeys'
import {
  INITIAL_ROUTING_STATE,
  reduceRouting,
  routeKey,
  type KeyRouteContext,
  type RoutingEffect,
  type RoutingEvent,
  type RoutingState
} from '../../../../shared/browser/routingState'
import type { ForwardedKeyAction, PickEvent } from '../../../../shared/ipc/browser-tab-schema'
import { logger } from '../../LoggingService'
import { BrowserKeyRouter, type KeyRouteActions, type PreventableEvent } from './browserKeyRouter'
import { BrowserMouseRouter, DEFAULT_DOUBLE_CLICK_MS, type RoutedMouseInput } from './browserMouseRouter'
import type { ToolbarKeyTarget } from './appWindowBrowserKeys'
import { performMacAppKey, performMacEditRole, type EditableContents, type MacAppKeyTargets } from './macAppRoles'

/**
 * The isolated world the full-screen exit runs in: the page's own
 * `document.exitFullscreen` may be replaced by the page, the isolated world's
 * cannot. Distinct from the preview's worlds (997–999).
 */
export const EXIT_FULLSCREEN_WORLD_ID = 996

/** Leaves page full screen and the pointer lock; runs in {@link EXIT_FULLSCREEN_WORLD_ID}. */
const EXIT_FULLSCREEN_SCRIPT =
  'if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); if (document.pointerLockElement) document.exitPointerLock();'

type Listener = (...args: unknown[]) => void

/** The page `webContents` surface the tab's input needs. */
export interface TabInputContents extends EditableContents {
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
  focus(): void
  isFocused(): boolean
  isDestroyed(): boolean
  setIgnoreMenuShortcuts(ignore: boolean): void
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>, userGesture?: boolean): Promise<unknown>
}

/** What the tab's input tells the owning window. */
export interface TabInputEvents {
  forwardedKey(action: ForwardedKeyAction): void
  /** The page gained (true) or lost (false) keyboard focus. */
  pageFocus(focused: boolean): void
  /** Pick mode on or off, and the status-slot notes. */
  pick(event: PickEvent): void
}

export interface BrowserTabInputDeps {
  readonly tabId: string
  readonly contents: TabInputContents
  /** `process.platform`. */
  readonly platform: string
  readonly clock: Pick<Clock, 'now'>
  readonly events: TabInputEvents
  readonly macAppKeys: MacAppKeyTargets
  /** The operating system's double-click interval, when known. */
  readonly doubleClickMs?: number
  /** Matches Erfana's focus-panel shortcuts (reserved keys). */
  readonly focusPanelKeys?: (input: BrowserKeyInput) => boolean
  /** Zoom the page (025-FR-008); the zoom keys do nothing without it. */
  readonly zoom?: (step: 'in' | 'out' | 'reset') => void
  /** Up, Down and their Alt aliases in pick mode (025-FR-027). */
  readonly refine?: (move: 'parent' | 'child') => void
  /** Reducer effects this module does not perform itself. */
  readonly onEffect?: (effect: RoutingEffect) => void
  /** A pick menu or dialog opened (`true`) or the last one closed (`false`): site requests wait meanwhile (S-28). */
  readonly onSurface?: (open: boolean) => void
  /**
   * Give OS keyboard focus to the owning window's own `webContents`. The
   * toolbar can take on-screen focus (Cmd/Ctrl+L) while the OS still sends
   * keys to the page view; this pulls them back (025-AC-071).
   */
  readonly focusWindow?: () => void
}

/** The tab's pick pipeline, attached after the routers exist (`pick/BrowserPicks.ts`). */
export interface TabInputPick {
  /** Pick mode went on or off. */
  mode(on: boolean): void
  refine(move: 'parent' | 'child'): void
  /** A reducer effect the routers do not perform (capture start and discard, unfreeze). */
  onEffect(effect: RoutingEffect): void
}


export class BrowserTabInput implements ToolbarKeyTarget {
  private routing: RoutingState = INITIAL_ROUTING_STATE
  private fullscreen = false
  private toolbarFocused = false
  /** The renderer's word on where the next page focus comes from. */
  private nextFocusOrigin: 'outside' | 'toolbar' | null = null
  private readonly keys: BrowserKeyRouter
  private readonly mouse: BrowserMouseRouter
  private readonly listeners: Array<[string, Listener]> = []
  private disposed = false
  private pick: TabInputPick | null = null

  constructor(private readonly deps: BrowserTabInputDeps) {
    const actions: KeyRouteActions = {
      browserKey: (action) => this.browserKey(action),
      reservedKey: (key) => this.reservedKey(key),
      pickKey: (action) => this.pickKey(action),
      macEdit: (role) => performMacEditRole(deps.contents, role),
      exitFullscreen: () => this.exitFullscreen()
    }
    this.keys = new BrowserKeyRouter({
      platform: deps.platform,
      state: () => this.routing,
      context: () => this.keyContext(),
      actions
    })
    this.mouse = new BrowserMouseRouter({
      state: () => this.routing,
      dispatch: (event) => this.dispatch(event),
      now: () => deps.clock.now(),
      doubleClickMs: deps.doubleClickMs ?? DEFAULT_DOUBLE_CLICK_MS,
      focusPage: () => {
        if (!deps.contents.isDestroyed()) deps.contents.focus()
      }
    })
    // Erfana's File, View and Window shortcuts must not fire from a page (025-FR-047).
    deps.contents.setIgnoreMenuShortcuts(true)
    this.listen('before-input-event', (event: PreventableEvent, input: BrowserKeyInput) => this.onKey(event, input))
    this.listen('before-mouse-event', (event: PreventableEvent, mouse: RoutedMouseInput) => this.mouse.handle(event, mouse))
    this.listen('focus', () => this.onPageFocus())
    this.listen('blur', () => this.onPageBlur())
    this.listen('enter-html-full-screen', () => {
      this.fullscreen = true
    })
    this.listen('leave-html-full-screen', () => {
      this.fullscreen = false
    })
    this.listen('did-navigate', (_event: unknown, url: string) => {
      this.dispatch({ type: 'pageLoaded', loaded: url !== '' })
    })
  }

  /** The tab's routing state now. */
  state(): RoutingState {
    return this.routing
  }

  /** Run one routing event through the reducer and perform its effects; returns the effects. */
  dispatch(event: RoutingEvent): readonly RoutingEffect[] {
    if (this.disposed) return []
    const { state, effects } = reduceRouting(this.routing, event)
    const wasOpen = this.routing.surface !== 'none'
    this.routing = state
    for (const effect of effects) this.perform(effect)
    if (wasOpen !== (state.surface !== 'none')) this.deps.onSurface?.(!wasOpen)
    return effects
  }

  /** The renderer says where keyboard focus comes from as it moves into the page. */
  reportFocusOrigin(from: 'outside' | 'toolbar'): void {
    this.nextFocusOrigin = from
  }

  /** The renderer says whether the tab's toolbar (or another Erfana surface of the tab) has focus. */
  reportToolbarFocus(focused: boolean): void {
    this.toolbarFocused = focused
    if (focused) {
      // A closing tab's page is gone: Electron throws on a destroyed webContents, and there is nothing to route.
      if (this.routing.focus === 'toolbar' || this.deps.contents.isDestroyed()) return
      // The page still holds the OS keyboard: move it to the window; the page's blur then routes to the toolbar.
      if (this.deps.contents.isFocused()) this.deps.focusWindow?.()
      if (!this.deps.contents.isFocused()) this.dispatch({ type: 'focusToolbar' })
      return
    }
    if (this.routing.focus === 'toolbar') this.dispatch({ type: 'focusOut' })
  }

  /** The page area moved because a row above it appeared or went (click guard, 025-FR-047). */
  recordRowShift(): void {
    this.dispatch({ type: 'rowShift', now: this.deps.clock.now(), pointerOverPage: this.mouse.isPointerOverPage() })
  }

  /** {@link ToolbarKeyTarget}: a browser key pressed while this tab's toolbar has focus. */
  toolbarBrowserKey(input: BrowserKeyInput): boolean {
    if (this.routing.focus !== 'toolbar') return false
    const route = routeKey(this.routing, input, this.deps.platform, this.keyContext())
    if (route.to !== 'erfana' || route.key.kind !== 'browser') return false
    this.browserKey(route.key.action)
    return true
  }

  /** Attach the tab's pick pipeline: it gets pick mode, Up and Down, and the effects not performed here. */
  attachPick(pick: TabInputPick): void {
    this.pick = pick
  }

  /** Remove every listener; the tab is closing. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.deps.contents.isDestroyed()) return
    for (const [event, listener] of this.listeners) this.deps.contents.removeListener(event, listener)
  }

  /**
   * Listen to one `webContents` event. Electron types each event's arguments
   * in its own overload; the surface here is the emitter's untyped one, so the
   * listener's own argument types are asserted at this one place.
   */
  private listen<A extends unknown[]>(event: string, typed: (...args: A) => void): void {
    const listener = typed as unknown as Listener
    this.deps.contents.on(event, listener)
    this.listeners.push([event, listener])
  }

  private keyContext(): KeyRouteContext {
    return { fullscreenOrPointerLock: this.fullscreen, focusPanelKeys: this.deps.focusPanelKeys }
  }

  private onKey(event: PreventableEvent, input: BrowserKeyInput): void {
    // A key reaching the page proves page focus, even if the focus event is still on its way.
    if (this.routing.focus !== 'page') this.enterPage()
    this.keys.handle(event, input)
  }

  private onPageFocus(): void {
    this.deps.events.pageFocus(true)
    if (this.routing.focus !== 'page') this.enterPage()
  }

  private enterPage(): void {
    const origin = this.nextFocusOrigin ?? (this.routing.focus === 'toolbar' ? 'toolbar' : 'outside')
    this.nextFocusOrigin = null
    this.dispatch({ type: 'focusPage', from: origin === 'toolbar' ? 'tab' : 'outside' })
  }

  private onPageBlur(): void {
    this.deps.events.pageFocus(false)
    this.keys.reset()
    this.mouse.reset()
    if (this.routing.focus !== 'page') return
    this.dispatch(this.toolbarFocused ? { type: 'focusToolbar' } : { type: 'focusOut' })
  }

  private browserKey(action: BrowserKeyAction): void {
    if (action === 'pick') {
      this.dispatch({ type: 'pickShortcut', now: this.deps.clock.now() })
      return
    }
    if (action === 'zoomIn' || action === 'zoomOut' || action === 'zoomReset') {
      this.deps.zoom?.(action === 'zoomIn' ? 'in' : action === 'zoomOut' ? 'out' : 'reset')
      return
    }
    // A key that navigates or closes the tab ends pick mode without sending (025-FR-052).
    if (isLeavingAction(action)) this.dispatch({ type: 'endSilently' })
    this.deps.events.forwardedKey(action)
  }

  private reservedKey(key: ReservedKey): void {
    if (key.kind === 'app') {
      this.deps.events.forwardedKey(key.action)
      return
    }
    performMacAppKey(this.deps.macAppKeys, key.action)
  }

  private pickKey(action: PickKeyAction): void {
    const now = this.deps.clock.now()
    if (action === 'exitPick') this.dispatch({ type: 'pickEsc' })
    else if (action === 'confirm') this.dispatch({ type: 'enter', now })
    else if (this.deps.refine !== undefined) this.deps.refine(action)
    else this.pick?.refine(action)
  }

  private exitFullscreen(): void {
    this.deps.contents
      .executeJavaScriptInIsolatedWorld(EXIT_FULLSCREEN_WORLD_ID, [{ code: EXIT_FULLSCREEN_SCRIPT }], true)
      .catch((error: unknown) => {
        logger.warn('Browser tab could not leave full screen', { error: error instanceof Error ? error.message : String(error) })
      })
  }

  private perform(effect: RoutingEffect): void {
    const { tabId, events } = this.deps
    switch (effect.type) {
      case 'pickMode':
        events.pick({ tabId, kind: 'mode', on: effect.on })
        this.pick?.mode(effect.on)
        return
      case 'note':
        events.pick({ tabId, kind: 'note', note: effect.note })
        return
      case 'focus':
        if (effect.target === 'page' && !this.deps.contents.isDestroyed()) {
          this.deps.contents.focus()
          return
        }
        this.deps.onEffect?.(effect)
        return
      case 'dropClick':
        // The mouse router acts on it (the press is not delivered).
        return
      default:
        this.deps.onEffect?.(effect)
        this.pick?.onEffect(effect)
    }
  }
}
