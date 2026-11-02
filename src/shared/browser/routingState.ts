// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser tab's routing state (spec 025, 025-FR-014, 025-FR-025,
 * 025-FR-047 to 025-FR-053, 025-FR-065; ADR 0011 decisions 11–16; spec change
 * S-29).
 *
 * One pure reducer, run by main's routers and mirrored in the renderer:
 * `reduceRouting(state, event)` returns the next state and the effects the
 * caller performs (start or discard a capture, unfreeze, move focus, show a
 * note). Time arrives in events (`now`, from the injected clock), so the
 * reducer never reads a clock.
 *
 * While keyboard focus is in the tab exactly one of five states applies –
 * browse, pick, menu, dialog, toolbar ({@link routingMode}); with focus
 * elsewhere the tab is `out` and receives no key. {@link routeKey} decides
 * where one key press goes in each state, and {@link pickBanner} gives the
 * banner of 025-FR-065.
 */
import {
  isImeComposing,
  isKeyPress,
  isMacPlatform,
  isZoomAction,
  matchBrowserKey,
  matchMacEditRole,
  matchPickKey,
  matchMenuKey,
  matchReservedKey,
  type BrowserKeyAction,
  type BrowserKeyInput,
  type MacEditRole,
  type PickKeyAction,
  type ReservedKey
} from './browserKeys'

/** Page clicks are ignored this long after a row above the page appears or goes (025-FR-047). */
export const CLICK_GUARD_MS = 500

/** Fixed status-slot notes, with how long each shows (025-FR-025 to 025-FR-027, 025-FR-048). */
export const STATUS_NOTES = Object.freeze({
  loadAPage: { text: 'Load a page to pick an element', ms: 4000 },
  moveTheMouse: { text: 'Move the mouse over the page to pick an element', ms: 4000 },
  pageMoved: { text: 'The page moved – click again', ms: 2000 },
  topOfPage: { text: 'Top of the page', ms: 2000 },
  backAtStart: { text: 'Back at the element you started from', ms: 2000 },
  elementGone: { text: 'That element is gone – pick again', ms: 2000 }
} as const)
export type StatusNote = keyof typeof STATUS_NOTES

/** The notice when the page itself navigates while the menu is open (025-FR-053). */
export const PAGE_CHANGED_NOTICE = 'The page changed – pick the element again'

/** The chip while the page is frozen (025-FR-065). */
export const PAUSED_CHIP = 'Page paused'

export type FocusPlace = 'out' | 'page' | 'toolbar'
export type PickSurface = 'none' | 'menu' | 'dialog'
/** Why the tab is `out` with pick mode on, for the banner (025-FR-065). */
export type OutReason = 'none' | 'menuClosedOnLeave' | 'dialogKept'
export type RoutingMode = 'out' | 'browse' | 'pick' | 'menu' | 'dialog' | 'toolbar'

export interface RoutingState {
  readonly focus: FocusPlace
  readonly pick: boolean
  readonly surface: PickSurface
  readonly frozen: boolean
  /** An element is highlighted under the mouse. */
  readonly highlighted: boolean
  /** A pick was confirmed and its capture is being taken ("Capturing…"). */
  readonly capturing: boolean
  /** A web page is loaded (not an empty tab or an Erfana page), so pick mode may start. */
  readonly pageLoaded: boolean
  readonly outReason: OutReason
  /** Focus came back from outside with pick on: the next page click only focuses (025-FR-048). */
  readonly firstClickOnlyFocuses: boolean
  /** Page clicks, Enter and the second Ctrl/Cmd+E before this time are dropped (click guard, S-29). */
  readonly clickGuardUntil: number
  /** Clicks before this time are the rest of the double-click that confirmed a pick (025-FR-049). */
  readonly ignoreClicksUntil: number
  /** The page navigated while the dialog was open (025-FR-053): the dialog stays, pick mode is off. */
  readonly dialogAfterReload: boolean
}

export const INITIAL_ROUTING_STATE: RoutingState = Object.freeze({
  focus: 'out',
  pick: false,
  surface: 'none',
  frozen: false,
  highlighted: false,
  capturing: false,
  pageLoaded: false,
  outReason: 'none',
  firstClickOnlyFocuses: false,
  clickGuardUntil: 0,
  ignoreClicksUntil: 0,
  dialogAfterReload: false
})

export type RoutingEvent =
  | { readonly type: 'pageLoaded'; readonly loaded: boolean }
  | { readonly type: 'focusPage'; readonly from: 'outside' | 'tab' }
  | { readonly type: 'focusToolbar' }
  | { readonly type: 'focusOut' }
  /** The **Pick element** button. */
  | { readonly type: 'pickButton' }
  /** Ctrl/Cmd+E with page focus: starts pick mode, or picks at once (025-FR-028). */
  | { readonly type: 'pickShortcut'; readonly now: number }
  /** Esc with page focus in pick mode. */
  | { readonly type: 'pickEsc' }
  | { readonly type: 'hover'; readonly element: boolean }
  /** Enter in pick mode. */
  | { readonly type: 'enter'; readonly now: number }
  /** A primary click on the page area; `doubleClickMs` is the OS double-click interval. */
  | { readonly type: 'pageClick'; readonly now: number; readonly doubleClickMs: number }
  /** **Pick this element** from a pointer right-click: picks at once (025-FR-057). */
  | { readonly type: 'contextMenuPick' }
  | { readonly type: 'captureReady' }
  | { readonly type: 'captureFailed' }
  /** Main froze the page after a shortcut pick's hints finished (025-FR-028). */
  | { readonly type: 'frozen' }
  | { readonly type: 'menuClose'; readonly reason: 'esc' | 'toolbarClick' | 'focusAddress' | 'f6' | 'shiftF6' }
  | { readonly type: 'dialogOpen' }
  | { readonly type: 'dialogBack' }
  | { readonly type: 'dialogClose' }
  | { readonly type: 'sent' }
  /** The page committed a new document by itself (script, link, redirect). */
  | { readonly type: 'pageNavigated' }
  /** A browser key navigated or closed the tab, the tab was hidden, or the page crashed or hung. */
  | { readonly type: 'endSilently' }
  /** A row above the page appeared or went (025-FR-047). */
  | { readonly type: 'rowShift'; readonly now: number; readonly pointerOverPage: boolean }

export type FocusTarget = 'page' | 'address' | 'pickButton' | 'previousZoneLast'

export type RoutingEffect =
  | { readonly type: 'startCapture'; readonly freeze: boolean }
  | { readonly type: 'discardCapture' }
  | { readonly type: 'unfreeze' }
  | { readonly type: 'pickMode'; readonly on: boolean }
  | { readonly type: 'note'; readonly note: StatusNote }
  | { readonly type: 'notice'; readonly text: typeof PAGE_CHANGED_NOTICE }
  | { readonly type: 'focus'; readonly target: FocusTarget }
  /** The page click was not delivered (browse: click guard). */
  | { readonly type: 'dropClick' }

export interface RoutingResult {
  readonly state: RoutingState
  readonly effects: readonly RoutingEffect[]
}

/** Which of the five states applies, or `out` (025-FR-014). */
export function routingMode(s: RoutingState): RoutingMode {
  if (s.focus === 'out') return 'out'
  if (s.surface !== 'none') return s.surface
  if (s.focus === 'toolbar') return 'toolbar'
  return s.pick ? 'pick' : 'browse'
}

const result = (state: RoutingState, ...effects: RoutingEffect[]): RoutingResult => ({ state, effects })

/** Close the menu or dialog without sending: discard the capture, unfreeze. */
function closeSurface(s: RoutingState, effects: RoutingEffect[]): RoutingState {
  if (s.surface !== 'none' || s.capturing) effects.push({ type: 'discardCapture' })
  if (s.frozen) effects.push({ type: 'unfreeze' })
  return { ...s, surface: 'none', frozen: false, capturing: false, dialogAfterReload: false }
}

/** End pick mode and close everything without sending and without a notice (025-FR-052). */
function endPick(s: RoutingState): RoutingResult {
  const effects: RoutingEffect[] = []
  const closed = closeSurface(s, effects)
  if (s.pick) effects.push({ type: 'pickMode', on: false })
  return { state: { ...closed, pick: false, highlighted: false, outReason: 'none', firstClickOnlyFocuses: false }, effects }
}

function startPick(s: RoutingState): RoutingResult {
  if (!s.pageLoaded) return result(s, { type: 'note', note: 'loadAPage' })
  const state = { ...s, pick: true, focus: 'page' as const, outReason: 'none' as const, firstClickOnlyFocuses: false }
  return result(state, { type: 'pickMode', on: true }, { type: 'focus', target: 'page' })
}

/** Confirm the highlighted element by Enter or the second Ctrl/Cmd+E (S-29: the click guard applies). */
function confirmByKey(s: RoutingState, now: number, freeze: boolean): RoutingResult {
  if (s.capturing) return result(s)
  if (now < s.clickGuardUntil) return result(s, { type: 'note', note: 'pageMoved' })
  if (!s.highlighted) return result(s, { type: 'note', note: 'moveTheMouse' })
  return result({ ...s, capturing: true }, { type: 'startCapture', freeze })
}

function pageClick(s: RoutingState, now: number, doubleClickMs: number): RoutingResult {
  const mode = routingMode(s)
  if (mode === 'dialog') return result(s)
  if (mode === 'out') {
    // A click from outside the tab only gives the page focus in pick mode (025-FR-048).
    const back = { ...s, focus: 'page' as const, outReason: 'none' as const, firstClickOnlyFocuses: false }
    if (s.surface === 'dialog') return result({ ...s, focus: 'page', outReason: 'none' })
    return s.pick ? result(back) : pageClick(back, now, doubleClickMs)
  }
  if (mode === 'menu') {
    if (now < s.ignoreClicksUntil) return result(s)
    const effects: RoutingEffect[] = []
    return { state: { ...closeSurface(s, effects), focus: 'page' }, effects }
  }
  const focused = { ...s, focus: 'page' as const }
  if (!s.pick) return now < s.clickGuardUntil ? result(focused, { type: 'dropClick' }) : result(focused)
  if (s.firstClickOnlyFocuses) return result({ ...focused, firstClickOnlyFocuses: false })
  if (now < s.clickGuardUntil) return result(focused, { type: 'note', note: 'pageMoved' })
  if (now < s.ignoreClicksUntil || s.capturing) return result(focused)
  return result({ ...focused, capturing: true, ignoreClicksUntil: now + doubleClickMs }, { type: 'startCapture', freeze: false })
}

function closeMenu(s: RoutingState, reason: Extract<RoutingEvent, { type: 'menuClose' }>['reason']): RoutingResult {
  if (s.surface !== 'menu') return result(s)
  const effects: RoutingEffect[] = []
  const closed = closeSurface(s, effects)
  if (reason === 'esc') return { state: { ...closed, focus: 'page' }, effects }
  const target: FocusTarget | null =
    reason === 'focusAddress' ? 'address' : reason === 'f6' ? 'pickButton' : reason === 'shiftF6' ? 'previousZoneLast' : null
  if (target !== null) effects.push({ type: 'focus', target })
  return { state: { ...closed, focus: 'toolbar' }, effects }
}

function focusOut(s: RoutingState): RoutingResult {
  if (s.surface === 'dialog') return result({ ...s, focus: 'out', outReason: 'dialogKept' })
  const effects: RoutingEffect[] = []
  const wasMenu = s.surface === 'menu'
  const closed = closeSurface(s, effects)
  const outReason: OutReason = wasMenu && s.pick ? 'menuClosedOnLeave' : 'none'
  return { state: { ...closed, focus: 'out', outReason }, effects }
}

function pageNavigated(s: RoutingState): RoutingResult {
  if (s.surface === 'dialog') {
    const effects: RoutingEffect[] = []
    if (s.frozen) effects.push({ type: 'unfreeze' })
    if (s.pick) effects.push({ type: 'pickMode', on: false })
    return { state: { ...s, pick: false, frozen: false, highlighted: false, dialogAfterReload: true }, effects }
  }
  const hadMenu = s.surface === 'menu'
  const ended = endPick(s)
  return hadMenu ? { ...ended, effects: [...ended.effects, { type: 'notice', text: PAGE_CHANGED_NOTICE }] } : ended
}

/** The next routing state and the effects to perform for one event. */
export function reduceRouting(s: RoutingState, e: RoutingEvent): RoutingResult {
  switch (e.type) {
    case 'pageLoaded':
      return e.loaded ? result({ ...s, pageLoaded: true }) : endPickAndUnload(s)
    case 'focusPage': {
      const firstClickOnlyFocuses = e.from === 'outside' && s.pick && s.surface === 'none'
      return result({ ...s, focus: 'page', outReason: 'none', firstClickOnlyFocuses })
    }
    case 'focusToolbar':
      return result({ ...s, focus: 'toolbar', outReason: 'none', firstClickOnlyFocuses: false })
    case 'focusOut':
      return focusOut(s)
    case 'pickButton':
      if (s.surface === 'menu') return closeMenu(s, 'toolbarClick')
      if (s.surface === 'dialog') return result(s)
      return s.pick ? endPick(s) : startPick(s)
    case 'pickShortcut':
      if (routingMode(s) === 'browse') return startPick(s)
      return routingMode(s) === 'pick' ? confirmByKey(s, e.now, true) : result(s)
    case 'pickEsc':
      return routingMode(s) === 'pick' ? endPick(s) : result(s)
    case 'hover':
      return result({ ...s, highlighted: s.pick && e.element })
    case 'enter':
      return routingMode(s) === 'pick' ? confirmByKey(s, e.now, false) : result(s)
    case 'pageClick':
      return pageClick(s, e.now, e.doubleClickMs)
    case 'contextMenuPick':
      if (!s.pageLoaded || s.capturing || s.surface !== 'none') return result(s)
      return result(
        { ...s, pick: true, focus: 'page', capturing: true, outReason: 'none' },
        ...(s.pick ? [] : [{ type: 'pickMode', on: true } as const]),
        { type: 'startCapture', freeze: false }
      )
    case 'captureReady':
      return s.capturing ? result({ ...s, capturing: false, surface: 'menu' }) : result(s)
    case 'captureFailed':
      return result({ ...s, capturing: false })
    case 'frozen':
      return s.surface === 'none' ? result(s, { type: 'unfreeze' }) : result({ ...s, frozen: true })
    case 'menuClose':
      return closeMenu(s, e.reason)
    case 'dialogOpen':
      return s.surface === 'menu' ? result({ ...s, surface: 'dialog' }) : result(s)
    case 'dialogBack':
      return s.surface === 'dialog' && !s.dialogAfterReload ? result({ ...s, surface: 'menu' }) : result(s)
    case 'dialogClose': {
      if (s.surface !== 'dialog') return result(s)
      const effects: RoutingEffect[] = []
      return { state: { ...closeSurface(s, effects), focus: s.focus === 'out' ? 'out' : 'page' }, effects }
    }
    case 'sent': {
      const effects: RoutingEffect[] = []
      if (s.frozen) effects.push({ type: 'unfreeze' })
      if (s.pick) effects.push({ type: 'pickMode', on: false })
      const state = { ...s, pick: false, surface: 'none' as const, frozen: false, highlighted: false, dialogAfterReload: false }
      return { state, effects }
    }
    case 'pageNavigated':
      return pageNavigated(s)
    case 'endSilently':
      return endPick(s)
    case 'rowShift':
      return e.pointerOverPage ? result({ ...s, clickGuardUntil: e.now + CLICK_GUARD_MS }) : result(s)
  }
}

/** An empty tab or an Erfana page: pick mode is unavailable there (025-FR-025). */
function endPickAndUnload(s: RoutingState): RoutingResult {
  const ended = endPick(s)
  return { ...ended, state: { ...ended.state, pageLoaded: false } }
}

/** Where one key press goes (025-FR-047 to 025-FR-051). */
export type KeyRoute =
  /** Deliver to the page. */
  | { readonly to: 'page' }
  /** Deliver to the focused Erfana control (toolbar field, menu, dialog) or the IME composition. */
  | { readonly to: 'focused' }
  /** Leave to the operating system (Cmd+Tab, Alt+Tab, Alt+F4, the Windows key). */
  | { readonly to: 'os' }
  /** Nobody receives it. */
  | { readonly to: 'drop' }
  | { readonly to: 'erfana'; readonly key: ErfanaKey }

export type ErfanaKey =
  | { readonly kind: 'browser'; readonly action: BrowserKeyAction }
  | { readonly kind: 'reserved'; readonly key: ReservedKey }
  | { readonly kind: 'pick'; readonly action: PickKeyAction }
  | { readonly kind: 'macEdit'; readonly action: MacEditRole }
  | { readonly kind: 'exitFullscreen' }

export interface KeyRouteContext {
  /** A popup window: no pick, address bar or new tab (025-FR-014). */
  readonly popup?: boolean
  /** Page fullscreen or pointer lock is active (025-FR-019). */
  readonly fullscreenOrPointerLock?: boolean
  /** Matches Erfana's focus-panel shortcuts (reserved keys). */
  readonly focusPanelKeys?: (input: BrowserKeyInput) => boolean
}

const POPUP_DEAD_KEYS: ReadonlySet<BrowserKeyAction> = new Set(['pick', 'focusAddress', 'newTab'])

function routeReserved(key: ReservedKey, mode: RoutingMode, platform: string): KeyRoute {
  if (key.kind === 'os') {
    const performed = isMacPlatform(platform) && key.action !== 'system'
    return performed ? { to: 'erfana', key: { kind: 'reserved', key } } : { to: 'os' }
  }
  const f6 = key.action === 'focusNextZone' || key.action === 'focusPreviousZone'
  if (f6 && mode === 'dialog') return { to: 'drop' }
  return { to: 'erfana', key: { kind: 'reserved', key } }
}

function routeBrowserKey(action: BrowserKeyAction, mode: RoutingMode, popup: boolean): KeyRoute {
  if (popup && POPUP_DEAD_KEYS.has(action)) return { to: 'drop' }
  if (mode === 'menu' && (action === 'pick' || action === 'find' || isZoomAction(action))) return { to: 'drop' }
  if (mode === 'toolbar' && action === 'pick') return { to: 'drop' }
  return { to: 'erfana', key: { kind: 'browser', action } }
}

/** The route for keys that match nothing above, by state. */
function routeOther(input: BrowserKeyInput, mode: RoutingMode, platform: string): KeyRoute {
  switch (mode) {
    case 'browse':
      return { to: 'page' }
    case 'pick': {
      const action = matchPickKey(input, platform)
      return action === null ? { to: 'drop' } : { to: 'erfana', key: { kind: 'pick', action } }
    }
    case 'menu':
      return matchMenuKey(input, platform) === null ? { to: 'drop' } : { to: 'focused' }
    default:
      return { to: 'focused' }
  }
}

/**
 * Where a key event goes in the current state. Key releases and auto-repeats
 * of keys Erfana consumed are dropped by the router, which remembers them; a
 * release reaching this function routes like any key with no binding.
 */
export function routeKey(
  s: RoutingState,
  input: BrowserKeyInput,
  platform: string,
  ctx: KeyRouteContext = {}
): KeyRoute {
  const mode = routingMode(s)
  if (mode === 'out') return { to: 'focused' }
  if (!isKeyPress(input)) return routeOther({ ...input, key: '', code: '' }, mode, platform)
  if (isImeComposing(input)) return mode === 'pick' ? { to: 'drop' } : mode === 'browse' ? { to: 'page' } : { to: 'focused' }
  if (ctx.fullscreenOrPointerLock === true && input.key === 'Escape') {
    return { to: 'erfana', key: { kind: 'exitFullscreen' } }
  }
  const reserved = matchReservedKey(input, platform, ctx.focusPanelKeys)
  if (reserved !== null) return routeReserved(reserved, mode, platform)
  if (mode === 'dialog') return { to: 'focused' }
  const browser = matchBrowserKey(input, platform)
  if (browser !== null) return routeBrowserKey(browser, mode, ctx.popup === true)
  const edit = matchMacEditRole(input, platform)
  if (edit !== null && mode === 'browse') return { to: 'erfana', key: { kind: 'macEdit', action: edit } }
  return routeOther(input, mode, platform)
}

/** The separator between banner clauses. */
export const BANNER_CLAUSE_SEPARATOR = ' · '

/**
 * The pick banner's clauses, most important first (025-FR-065): the UI drops
 * clauses from the end when they do not fit; the first never drops. `null`
 * when pick mode is off. `pickShortcut` is the platform's label for
 * Ctrl/Cmd+E (`formatShortcut('E', { mod: true })` in the renderer).
 */
export function pickBanner(s: RoutingState, pickShortcut: string): readonly string[] | null {
  if (!s.pick) return null
  switch (routingMode(s)) {
    case 'out':
      if (s.outReason === 'menuClosedOnLeave') return ['Picking – the panel closed when you left; pick again']
      if (s.outReason === 'dialogKept') return ['Picking – click to return to the dialog']
      return ['Picking – click the page to continue']
    case 'dialog':
      return ['Picking – Esc or Cancel closes the dialog']
    case 'menu':
      return ['Picking – Esc or click outside closes the panel']
    case 'toolbar':
      return ['Picking – Esc returns to the page']
    default:
      return ['Picking – click an element', 'Esc to stop', `${pickShortcut} picks under the mouse`]
  }
}

/** The "Page paused" chip while the page is frozen, else `null` (025-FR-065). */
export function pausedChip(s: RoutingState): typeof PAUSED_CHIP | null {
  return s.frozen ? PAUSED_CHIP : null
}
