// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  isImeComposing,
  isLeavingAction,
  matchBrowserKey,
  matchMacAppKey,
  matchMacEditRole,
  matchMenuKey,
  matchPickKey,
  matchReservedKey,
  type BrowserKeyInput
} from './browserKeys'

type Mods = Partial<Pick<BrowserKeyInput, 'control' | 'meta' | 'alt' | 'shift' | 'isComposing'>>
const key = (k: string, code: string, mods: Mods = {}, type = 'keyDown'): BrowserKeyInput => ({
  type,
  key: k,
  code,
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods
})
const mac = 'darwin'
const win = 'win32'
const linux = 'linux'

describe('browser keys (025-FR-014)', () => {
  it('025-AC-014 matches each browser key with Cmd on macOS and Ctrl elsewhere', () => {
    const table: ReadonlyArray<readonly [string, string, string]> = [
      ['l', 'KeyL', 'focusAddress'],
      ['r', 'KeyR', 'reload'],
      ['w', 'KeyW', 'closeTab'],
      ['t', 'KeyT', 'newTab'],
      ['e', 'KeyE', 'pick'],
      ['f', 'KeyF', 'find'],
      ['0', 'Digit0', 'zoomReset']
    ]
    for (const [k, code, action] of table) {
      expect(matchBrowserKey(key(k, code, { meta: true }), mac)).toBe(action)
      expect(matchBrowserKey(key(k, code, { control: true }), win)).toBe(action)
      expect(matchBrowserKey(key(k, code, { control: true }), mac)).toBeNull()
      expect(matchBrowserKey(key(k, code, { meta: true }), linux)).toBeNull()
    }
    expect(matchBrowserKey(key('F5', 'F5'), linux)).toBe('reload')
    expect(matchBrowserKey(key('F12', 'F12'), mac)).toBe('devTools')
  })

  it('025-AC-014 uses Cmd+[ / Cmd+] on macOS and Alt+Left / Alt+Right elsewhere', () => {
    expect(matchBrowserKey(key('[', 'BracketLeft', { meta: true }), mac)).toBe('back')
    expect(matchBrowserKey(key(']', 'BracketRight', { meta: true }), mac)).toBe('forward')
    expect(matchBrowserKey(key('ArrowLeft', 'ArrowLeft', { alt: true }), win)).toBe('back')
    expect(matchBrowserKey(key('ArrowRight', 'ArrowRight', { alt: true }), linux)).toBe('forward')
    expect(matchBrowserKey(key('ArrowLeft', 'ArrowLeft', { alt: true }), mac)).toBeNull()
  })

  it('025-AC-014 falls back to the physical key when the layout produces no such character (German Cmd+[)', () => {
    expect(matchBrowserKey(key('ü', 'BracketLeft', { meta: true }), mac)).toBe('back')
    expect(matchBrowserKey(key('д', 'KeyL', { control: true }), win)).toBe('focusAddress')
    expect(matchBrowserKey(key('Dead', 'BracketRight', { meta: true }), mac)).toBe('forward')
  })

  it('matches by the produced character first, so AZERTY keys keep their letters', () => {
    // AZERTY: the KeyQ position types "a", the KeyA position types "q".
    expect(matchBrowserKey(key('a', 'KeyQ', { control: true }), win)).toBeNull()
    expect(matchBrowserKey(key('e', 'KeyW', { control: true }), win)).toBe('pick')
    expect(matchBrowserKey(key('w', 'KeyZ', { control: true }), linux)).toBe('closeTab')
  })

  it('025-AC-008 zooms in with Plus, Shift+= and keypad +, out with Minus, reset with 0', () => {
    expect(matchBrowserKey(key('+', 'Equal', { control: true, shift: true }), win)).toBe('zoomIn')
    expect(matchBrowserKey(key('=', 'Equal', { meta: true }), mac)).toBe('zoomIn')
    expect(matchBrowserKey(key('=', 'Equal', { meta: true, shift: true }), mac)).toBe('zoomIn')
    expect(matchBrowserKey(key('+', 'NumpadAdd', { control: true }), linux)).toBe('zoomIn')
    expect(matchBrowserKey(key('-', 'Minus', { control: true }), win)).toBe('zoomOut')
    expect(matchBrowserKey(key('-', 'NumpadSubtract', { meta: true }), mac)).toBe('zoomOut')
    expect(matchBrowserKey(key('à', 'Digit0', { control: true }), win)).toBe('zoomReset')
  })

  it('never fires on AltGr characters, other modifiers or releases', () => {
    expect(matchBrowserKey(key('l', 'KeyL', { control: true, alt: true }), win)).toBeNull()
    expect(matchBrowserKey(key('l', 'KeyL', { control: true, shift: true }), win)).toBeNull()
    expect(matchBrowserKey(key('l', 'KeyL', { meta: true, control: true }), mac)).toBeNull()
    expect(matchBrowserKey(key('l', 'KeyL', { control: true }, 'keyUp'), win)).toBeNull()
    expect(matchBrowserKey(key('r', 'KeyR', { control: true }, 'rawKeyDown'), win)).toBe('reload')
  })

  it('025-AC-014 gives every key to the IME while it composes, including Esc and Enter', () => {
    expect(isImeComposing(key('Escape', 'Escape', { isComposing: true }))).toBe(true)
    expect(isImeComposing(key('Process', 'KeyA'))).toBe(true)
    expect(matchBrowserKey(key('l', 'KeyL', { control: true, isComposing: true }), win)).toBeNull()
    expect(matchPickKey(key('Enter', 'Enter', { isComposing: true }), win)).toBeNull()
  })

  it('names the browser keys that navigate or close the tab (025-FR-052)', () => {
    expect(['reload', 'closeTab', 'newTab', 'back', 'forward'].every(a => isLeavingAction(a as never))).toBe(true)
    expect(isLeavingAction('find')).toBe(false)
    expect(isLeavingAction('pick')).toBe(false)
  })
})

describe('reserved keys (025-FR-047)', () => {
  it('025-AC-061 reserves the OS keys on each platform', () => {
    expect(matchReservedKey(key('q', 'KeyQ', { meta: true }), mac)).toEqual({ kind: 'os', action: 'quit' })
    expect(matchReservedKey(key('h', 'KeyH', { meta: true }), mac)).toEqual({ kind: 'os', action: 'hide' })
    expect(matchReservedKey(key('˙', 'KeyH', { meta: true, alt: true }), mac)).toEqual({ kind: 'os', action: 'hideOthers' })
    expect(matchReservedKey(key('m', 'KeyM', { meta: true }), mac)).toEqual({ kind: 'os', action: 'minimize' })
    expect(matchReservedKey(key('F4', 'F4', { alt: true }), win)).toEqual({ kind: 'os', action: 'closeWindow' })
    expect(matchReservedKey(key('Tab', 'Tab', { alt: true }), linux)).toEqual({ kind: 'os', action: 'system' })
    expect(matchReservedKey(key('Meta', 'MetaLeft', { meta: true }), win)).toEqual({ kind: 'os', action: 'system' })
    expect(matchReservedKey(key('q', 'KeyQ', { control: true }), win)).toBeNull()
  })

  it('025-AC-061 reserves editor-tab switching and F6 / Shift+F6', () => {
    expect(matchReservedKey(key('Tab', 'Tab', { control: true }), mac)).toEqual({ kind: 'app', action: 'nextEditorTab' })
    expect(matchReservedKey(key('Tab', 'Tab', { control: true, shift: true }), win)).toEqual({
      kind: 'app',
      action: 'previousEditorTab'
    })
    expect(matchReservedKey(key('PageDown', 'PageDown', { meta: true }), mac)).toEqual({ kind: 'app', action: 'nextEditorTab' })
    expect(matchReservedKey(key('PageUp', 'PageUp', { control: true }), linux)).toEqual({ kind: 'app', action: 'previousEditorTab' })
    expect(matchReservedKey(key('F6', 'F6'), win)).toEqual({ kind: 'app', action: 'focusNextZone' })
    expect(matchReservedKey(key('F6', 'F6', { shift: true }), mac)).toEqual({ kind: 'app', action: 'focusPreviousZone' })
  })

  it('reserves a focus-panel shortcut the renderer names', () => {
    const isFocusPanel = (i: BrowserKeyInput): boolean => i.code === 'Digit1' && i.control
    expect(matchReservedKey(key('1', 'Digit1', { control: true }), win, isFocusPanel)).toEqual({ kind: 'app', action: 'focusPanel' })
    expect(matchReservedKey(key('1', 'Digit1'), win, isFocusPanel)).toBeNull()
  })

  it('matches the macOS app keys and Edit roles only on macOS (X2)', () => {
    expect(matchMacAppKey(key('q', 'KeyQ', { meta: true }), mac)).toBe('quit')
    expect(matchMacAppKey(key('q', 'KeyQ', { control: true }), win)).toBeNull()
    const roles: ReadonlyArray<readonly [string, string, Mods, string]> = [
      ['c', 'KeyC', { meta: true }, 'copy'],
      ['v', 'KeyV', { meta: true }, 'paste'],
      ['x', 'KeyX', { meta: true }, 'cut'],
      ['a', 'KeyA', { meta: true }, 'selectAll'],
      ['z', 'KeyZ', { meta: true }, 'undo'],
      ['z', 'KeyZ', { meta: true, shift: true }, 'redo']
    ]
    for (const [k, code, mods, role] of roles) expect(matchMacEditRole(key(k, code, mods), mac)).toBe(role)
    expect(matchMacEditRole(key('c', 'KeyC', { control: true }), win)).toBeNull()
  })
})

describe('pick and menu keys', () => {
  it('025-AC-062 handles Esc, Up, Down, their Alt aliases and Enter in pick mode', () => {
    expect(matchPickKey(key('Escape', 'Escape'), win)).toBe('exitPick')
    expect(matchPickKey(key('ArrowUp', 'ArrowUp'), win)).toBe('parent')
    expect(matchPickKey(key('ArrowUp', 'ArrowUp', { alt: true }), mac)).toBe('parent')
    expect(matchPickKey(key('ArrowDown', 'ArrowDown', { alt: true }), linux)).toBe('child')
    expect(matchPickKey(key('Enter', 'NumpadEnter'), win)).toBe('confirm')
    expect(matchPickKey(key('a', 'KeyA'), win)).toBeNull()
    expect(matchPickKey(key('ArrowUp', 'ArrowUp', { control: true }), win)).toBeNull()
  })

  it('025-AC-063 handles Tab, Shift+Tab, Space, Enter, Esc and the arrows in the menu', () => {
    expect(matchMenuKey(key('Tab', 'Tab'), win)).toBe('nextControl')
    expect(matchMenuKey(key('Tab', 'Tab', { shift: true }), win)).toBe('previousControl')
    expect(matchMenuKey(key(' ', 'Space'), win)).toBe('space')
    expect(matchMenuKey(key('Enter', 'Enter'), win)).toBe('activate')
    expect(matchMenuKey(key('Escape', 'Escape'), win)).toBe('close')
    expect(matchMenuKey(key('ArrowUp', 'ArrowUp', { alt: true }), mac)).toBe('parent')
    expect(matchMenuKey(key('ArrowDown', 'ArrowDown'), mac)).toBe('child')
    expect(matchMenuKey(key('a', 'KeyA'), win)).toBeNull()
  })
})
