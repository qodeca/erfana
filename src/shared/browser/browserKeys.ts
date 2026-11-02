// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which key is which, for the built-in browser (spec 025, 025-FR-008,
 * 025-FR-014, 025-FR-047 to 025-FR-051; ADR 0011 decisions 11–14; panel
 * finding X2). One table for main (`before-input-event` on page views and on
 * Erfana's window) and the renderer (menu, dialog and toolbar states).
 *
 * **Matching.** A shortcut letter or sign is matched by the character the key
 * produces on the user's layout; the physical key (`code`) is a fallback only
 * when the layout produces no ASCII character on that key – so Cmd+[ on a
 * German layout (where that key types `ü`) is still Back, while AZERTY's `a`
 * key (code `KeyQ`) is never Ctrl+Q. Named keys (`F5`, `ArrowLeft`) match by
 * name. "Ctrl/Cmd" is Cmd on macOS and Ctrl elsewhere; the other of the two
 * must be up, and Alt must match exactly, so AltGr (Ctrl+Alt) characters
 * never trigger a shortcut.
 *
 * **IME.** While an input method is composing, every key belongs to the
 * composition, including Esc and Enter ({@link isImeComposing}).
 *
 * Nothing here reads the platform; callers pass it (`process.platform` in
 * main, the renderer's platform helper in the renderer).
 */

/** A key event reduced to what the tables read; Electron's `Input` has this shape. */
export interface BrowserKeyInput {
  /** `'keyDown'` (or `'rawKeyDown'`) for a press; anything else is not a press. */
  readonly type: string
  /** The produced character or the key's name (`KeyboardEvent.key`). */
  readonly key: string
  /** The physical key (`KeyboardEvent.code`). */
  readonly code: string
  readonly control: boolean
  readonly meta: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly isComposing?: boolean
  readonly isAutoRepeat?: boolean
}

/** The browser keys of 025-FR-014 and the zoom keys of 025-FR-008. */
export type BrowserKeyAction =
  | 'focusAddress'
  | 'reload'
  | 'closeTab'
  | 'newTab'
  | 'back'
  | 'forward'
  | 'devTools'
  | 'pick'
  | 'find'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'

/** Reserved keys Erfana acts on in every routing state (025-FR-047). */
export type ReservedAppAction =
  | 'nextEditorTab'
  | 'previousEditorTab'
  | 'focusNextZone'
  | 'focusPreviousZone'
  /** One of Erfana's focus-panel shortcuts; the renderer's key map says which. */
  | 'focusPanel'

/** Operating-system keys: left to the OS, or (macOS app keys) performed by main's router (X2). */
export type ReservedOsAction = 'quit' | 'hide' | 'hideOthers' | 'minimize' | 'closeWindow' | 'system'

export type ReservedKey =
  | { readonly kind: 'app'; readonly action: ReservedAppAction }
  | { readonly kind: 'os'; readonly action: ReservedOsAction }

/** The macOS Edit-menu roles main's router performs in the page (025-FR-047). */
export type MacEditRole = 'copy' | 'paste' | 'cut' | 'selectAll' | 'undo' | 'redo'

/** Keys pick mode handles with page focus (025-FR-048). */
export type PickKeyAction = 'exitPick' | 'parent' | 'child' | 'confirm'

/** Keys the prompt-actions menu handles (025-FR-049); the browser keys are separate. */
export type MenuKeyAction = 'close' | 'parent' | 'child' | 'activate' | 'nextControl' | 'previousControl' | 'space'

type ShiftRule = boolean | 'any'

interface Binding<A> {
  readonly action: A
  /** Produced characters (lower case) or a key name such as `F5`. */
  readonly keys: readonly string[]
  /** Physical keys tried only when the layout produces no ASCII character. */
  readonly codes?: readonly string[]
  readonly mod: boolean
  readonly alt?: boolean
  readonly shift?: ShiftRule
  /** Literal Control (also on macOS), instead of the primary modifier. */
  readonly ctrl?: boolean
}

export function isMacPlatform(platform: string): boolean {
  return platform === 'darwin'
}

/** True for a key press (not a release). */
export function isKeyPress(input: BrowserKeyInput): boolean {
  return input.type === 'keyDown' || input.type === 'rawKeyDown'
}

/** True while an input method composes text: every key belongs to the composition. */
export function isImeComposing(input: BrowserKeyInput): boolean {
  return input.isComposing === true || input.key === 'Process'
}

/** True when `key` is one produced character in the printable ASCII range. */
function isAsciiCharacter(key: string): boolean {
  return key.length === 1 && key >= ' ' && key <= '~'
}

function modifiersMatch(input: BrowserKeyInput, b: Binding<unknown>, mac: boolean): boolean {
  const primary = mac ? input.meta : input.control
  const other = mac ? input.control : input.meta
  if (b.ctrl === true) {
    if (!input.control || input.meta) return false
  } else if (primary !== b.mod || other) {
    return false
  }
  if (input.alt !== (b.alt ?? false)) return false
  const shift = b.shift ?? false
  return shift === 'any' || input.shift === shift
}

function keyMatches(input: BrowserKeyInput, b: Binding<unknown>): boolean {
  const produced = input.key.length === 1 ? input.key.toLowerCase() : input.key
  if (b.keys.includes(produced)) return true
  return b.codes !== undefined && b.codes.includes(input.code) && !isAsciiCharacter(input.key)
}

function match<A>(input: BrowserKeyInput, table: readonly Binding<A>[], platform: string): A | null {
  if (!isKeyPress(input) || isImeComposing(input)) return null
  const mac = isMacPlatform(platform)
  for (const b of table) if (modifiersMatch(input, b, mac) && keyMatches(input, b)) return b.action
  return null
}

const BROWSER_KEYS_COMMON: readonly Binding<BrowserKeyAction>[] = [
  { action: 'focusAddress', keys: ['l'], codes: ['KeyL'], mod: true },
  { action: 'reload', keys: ['r'], codes: ['KeyR'], mod: true },
  { action: 'reload', keys: ['F5'], mod: false },
  { action: 'closeTab', keys: ['w'], codes: ['KeyW'], mod: true },
  { action: 'newTab', keys: ['t'], codes: ['KeyT'], mod: true },
  { action: 'devTools', keys: ['F12'], mod: false },
  { action: 'pick', keys: ['e'], codes: ['KeyE'], mod: true },
  { action: 'find', keys: ['f'], codes: ['KeyF'], mod: true },
  { action: 'zoomIn', keys: ['+', '='], codes: ['Equal', 'NumpadAdd'], mod: true, shift: 'any' },
  { action: 'zoomOut', keys: ['-', '_'], codes: ['Minus', 'NumpadSubtract'], mod: true, shift: 'any' },
  { action: 'zoomReset', keys: ['0'], codes: ['Digit0', 'Numpad0'], mod: true }
]

const BROWSER_KEYS_MAC: readonly Binding<BrowserKeyAction>[] = [
  ...BROWSER_KEYS_COMMON,
  { action: 'back', keys: ['['], codes: ['BracketLeft'], mod: true },
  { action: 'forward', keys: [']'], codes: ['BracketRight'], mod: true }
]

const BROWSER_KEYS_OTHER: readonly Binding<BrowserKeyAction>[] = [
  ...BROWSER_KEYS_COMMON,
  { action: 'back', keys: ['ArrowLeft'], mod: false, alt: true },
  { action: 'forward', keys: ['ArrowRight'], mod: false, alt: true }
]

/** The browser key this press is, or `null` (025-FR-014). */
export function matchBrowserKey(input: BrowserKeyInput, platform: string): BrowserKeyAction | null {
  return match(input, isMacPlatform(platform) ? BROWSER_KEYS_MAC : BROWSER_KEYS_OTHER, platform)
}

/** The zoom keys act only in some states (025-FR-014). */
export function isZoomAction(action: BrowserKeyAction): boolean {
  return action === 'zoomIn' || action === 'zoomOut' || action === 'zoomReset'
}

/** Browser keys that navigate or close the tab, and so end pick mode silently (025-FR-052). */
export function isLeavingAction(action: BrowserKeyAction): boolean {
  return ['reload', 'closeTab', 'newTab', 'back', 'forward'].includes(action)
}

const APP_RESERVED: readonly Binding<ReservedAppAction>[] = [
  { action: 'nextEditorTab', keys: ['Tab'], mod: false, ctrl: true },
  { action: 'previousEditorTab', keys: ['Tab'], mod: false, ctrl: true, shift: true },
  { action: 'nextEditorTab', keys: ['PageDown'], mod: true },
  { action: 'previousEditorTab', keys: ['PageUp'], mod: true },
  { action: 'focusNextZone', keys: ['F6'], mod: false },
  { action: 'focusPreviousZone', keys: ['F6'], mod: false, shift: true }
]

const MAC_APP_KEYS: readonly Binding<ReservedOsAction>[] = [
  { action: 'quit', keys: ['q'], codes: ['KeyQ'], mod: true },
  { action: 'hide', keys: ['h'], codes: ['KeyH'], mod: true },
  { action: 'hideOthers', keys: ['h'], codes: ['KeyH'], mod: true, alt: true },
  { action: 'minimize', keys: ['m'], codes: ['KeyM'], mod: true },
  { action: 'system', keys: ['Tab'], mod: true, shift: 'any' }
]

const OTHER_OS_KEYS: readonly Binding<ReservedOsAction>[] = [
  { action: 'closeWindow', keys: ['F4'], mod: false, alt: true },
  { action: 'system', keys: ['Tab'], mod: false, alt: true, shift: 'any' }
]

/** The macOS application keys main's router performs itself (X2), or `null`. */
export function matchMacAppKey(input: BrowserKeyInput, platform: string): ReservedOsAction | null {
  return isMacPlatform(platform) ? match(input, MAC_APP_KEYS, platform) : null
}

/**
 * The reserved key this press is, or `null` (025-FR-047): the operating
 * system's keys, editor-tab switching and F6 / Shift+F6. The Windows key
 * (`Meta`) alone is an OS key on Windows and Linux. `focusPanelKeys` matches
 * Erfana's focus-panel shortcuts, which live in the renderer's key map.
 */
export function matchReservedKey(
  input: BrowserKeyInput,
  platform: string,
  focusPanelKeys?: (input: BrowserKeyInput) => boolean
): ReservedKey | null {
  if (!isKeyPress(input) || isImeComposing(input)) return null
  const mac = isMacPlatform(platform)
  const os = mac ? match(input, MAC_APP_KEYS, platform) : match(input, OTHER_OS_KEYS, platform)
  if (os !== null) return { kind: 'os', action: os }
  if (!mac && input.key === 'Meta') return { kind: 'os', action: 'system' }
  const app = match(input, APP_RESERVED, platform)
  if (app !== null) return { kind: 'app', action: app }
  if (focusPanelKeys?.(input) === true) return { kind: 'app', action: 'focusPanel' }
  return null
}

const MAC_EDIT_ROLES: readonly Binding<MacEditRole>[] = [
  { action: 'copy', keys: ['c'], codes: ['KeyC'], mod: true },
  { action: 'paste', keys: ['v'], codes: ['KeyV'], mod: true },
  { action: 'cut', keys: ['x'], codes: ['KeyX'], mod: true },
  { action: 'selectAll', keys: ['a'], codes: ['KeyA'], mod: true },
  { action: 'undo', keys: ['z'], codes: ['KeyZ'], mod: true },
  { action: 'redo', keys: ['z'], codes: ['KeyZ'], mod: true, shift: true }
]

/** The macOS Edit-menu role this press is, or `null` (macOS only). */
export function matchMacEditRole(input: BrowserKeyInput, platform: string): MacEditRole | null {
  return isMacPlatform(platform) ? match(input, MAC_EDIT_ROLES, platform) : null
}

const PICK_KEYS: readonly Binding<PickKeyAction>[] = [
  { action: 'exitPick', keys: ['Escape'], mod: false },
  { action: 'parent', keys: ['ArrowUp'], mod: false },
  { action: 'parent', keys: ['ArrowUp'], mod: false, alt: true },
  { action: 'child', keys: ['ArrowDown'], mod: false },
  { action: 'child', keys: ['ArrowDown'], mod: false, alt: true },
  { action: 'confirm', keys: ['Enter'], mod: false }
]

/** The pick-mode key this press is, or `null` (025-FR-048; Alt / Option arrows act as arrows). */
export function matchPickKey(input: BrowserKeyInput, platform: string): PickKeyAction | null {
  return match(input, PICK_KEYS, platform)
}

/** The menu's own keys; Up, Down and their Alt aliases come from the pick table. */
const MENU_KEYS: readonly Binding<MenuKeyAction>[] = [
  { action: 'close', keys: ['Escape'], mod: false },
  { action: 'activate', keys: ['Enter'], mod: false },
  { action: 'nextControl', keys: ['Tab'], mod: false },
  { action: 'previousControl', keys: ['Tab'], mod: false, shift: true },
  { action: 'space', keys: [' '], mod: false }
]

/** The menu key this press is, or `null` (025-FR-049). */
export function matchMenuKey(input: BrowserKeyInput, platform: string): MenuKeyAction | null {
  const arrow = matchPickKey(input, platform)
  if (arrow === 'parent' || arrow === 'child') return arrow
  return match(input, MENU_KEYS, platform)
}
