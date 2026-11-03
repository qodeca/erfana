// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page view's key router (spec 025, 025-FR-047 to 025-FR-051; ADR 0011
 * decisions 11, 12, 14, 15): what is consumed, what reaches the page, and
 * that the auto-repeats and key-up of a consumed key are consumed too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INITIAL_ROUTING_STATE, type KeyRouteContext, type RoutingState } from '../../../../shared/browser/routingState'
import { BrowserKeyRouter, ConsumedKeys, performErfanaKey, type KeyRouteActions } from './browserKeyRouter'
import { autoRepeat, fakeEvent, keyDown, keyUp } from './__test-helpers__/fakeInputContents'

const BROWSE: RoutingState = { ...INITIAL_ROUTING_STATE, focus: 'page', pageLoaded: true }
const PICK: RoutingState = { ...BROWSE, pick: true }
const DIALOG: RoutingState = { ...PICK, surface: 'dialog' }

let state: RoutingState
let context: KeyRouteContext
let actions: { [K in keyof KeyRouteActions]: ReturnType<typeof vi.fn> }

function router(platform: string): BrowserKeyRouter {
  return new BrowserKeyRouter({ platform, state: () => state, context: () => context, actions: actions as unknown as KeyRouteActions })
}

/** Send `input` and return whether it was prevented. */
function send(r: BrowserKeyRouter, input: Parameters<BrowserKeyRouter['handle']>[1]): boolean {
  const event = fakeEvent()
  r.handle(event, input)
  return event.prevented
}

beforeEach(() => {
  state = BROWSE
  context = {}
  actions = {
    browserKey: vi.fn(),
    reservedKey: vi.fn(),
    pickKey: vi.fn(),
    macEdit: vi.fn(),
    exitFullscreen: vi.fn()
  }
})

function noAction(): void {
  for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled()
}

describe('browsing with page focus', () => {
  it.each(['darwin', 'win32'])('025-AC-061 leaves Erfana app shortcuts to the page (%s)', (platform) => {
    const r = router(platform)
    const mod = platform === 'darwin' ? 'meta' : 'control'
    for (const press of [keyDown('s', [mod]), keyDown('k', [mod]), keyDown('p', [mod]), keyDown('N', [mod, 'shift'])]) {
      expect(send(r, press)).toBe(false)
      expect(send(r, keyUp(press))).toBe(false)
    }
    expect(send(r, keyDown('a'))).toBe(false)
    noAction()
  })

  it('025-AC-014 consumes a browser key and hands it on once', () => {
    const r = router('darwin')
    expect(send(r, keyDown('l', ['meta']))).toBe(true)
    expect(actions.browserKey).toHaveBeenCalledWith('focusAddress')
    expect(send(r, keyDown('F12'))).toBe(true)
    expect(actions.browserKey).toHaveBeenLastCalledWith('devTools')
  })

  it('consumes the auto-repeats and the key-up of a consumed key without acting again', () => {
    const r = router('win32')
    const press = keyDown('F5')
    expect(send(r, press)).toBe(true)
    expect(send(r, autoRepeat(press))).toBe(true)
    expect(send(r, autoRepeat(press))).toBe(true)
    expect(send(r, keyUp(press))).toBe(true)
    expect(actions.browserKey).toHaveBeenCalledTimes(1)
    // The key-up ended it: the next release of that key is the page's again.
    expect(send(r, keyUp(press))).toBe(false)
  })

  it('routes a fresh press of a held key again, so a lost key-up swallows nothing', () => {
    const r = router('win32')
    const reload = keyDown('r', ['control'])
    send(r, reload)
    expect(send(r, keyDown('r'))).toBe(false)
    expect(send(r, keyUp(keyDown('r')))).toBe(false)
  })

  it('forgets held keys on reset (focus left; their key-ups go elsewhere)', () => {
    const r = router('win32')
    const press = keyDown('F5')
    send(r, press)
    r.reset()
    expect(send(r, keyUp(press))).toBe(false)
  })

  it('025-AC-061 consumes F6, Shift+F6 and Ctrl+Tab as reserved keys on every platform', () => {
    for (const platform of ['darwin', 'linux']) {
      const r = router(platform)
      expect(send(r, keyDown('F6'))).toBe(true)
      expect(send(r, keyDown('F6', ['shift']))).toBe(true)
      expect(send(r, keyDown('Tab', ['control']))).toBe(true)
    }
    expect(actions.reservedKey.mock.calls.map(([k]) => k.action)).toEqual([
      'focusNextZone',
      'focusPreviousZone',
      'nextEditorTab',
      'focusNextZone',
      'focusPreviousZone',
      'nextEditorTab'
    ])
  })

  it('025-AC-061 performs Cmd+Q on macOS and leaves Alt+F4, Alt+Tab and the Windows key to the system elsewhere', () => {
    expect(send(router('darwin'), keyDown('q', ['meta']))).toBe(true)
    expect(actions.reservedKey).toHaveBeenCalledWith({ kind: 'os', action: 'quit' })
    actions.reservedKey.mockClear()
    const win = router('win32')
    expect(send(win, keyDown('F4', ['alt']))).toBe(false)
    expect(send(win, keyDown('Tab', ['alt']))).toBe(false)
    expect(send(win, keyDown('Meta', [], { code: 'MetaLeft' }))).toBe(false)
    noAction()
  })

  it('025-AC-061 performs the macOS Edit roles in the page, and leaves Ctrl+C to the page elsewhere', () => {
    const mac = router('darwin')
    expect(send(mac, keyDown('c', ['meta']))).toBe(true)
    expect(send(mac, keyDown('z', ['meta', 'shift']))).toBe(true)
    expect(actions.macEdit.mock.calls).toEqual([['copy'], ['redo']])
    actions.macEdit.mockClear()
    expect(send(router('linux'), keyDown('c', ['control']))).toBe(false)
    noAction()
  })

  it('leaves every key to an open IME composition', () => {
    expect(send(router('darwin'), keyDown('Escape', [], { isComposing: true }))).toBe(false)
    expect(send(router('darwin'), keyDown('Process'))).toBe(false)
    noAction()
  })

  it('025-AC-019 consumes Esc in full screen and exits it; without full screen Esc is the page\'s', () => {
    const r = router('linux')
    expect(send(r, keyDown('Escape'))).toBe(false)
    context = { fullscreenOrPointerLock: true }
    expect(send(r, keyDown('Escape'))).toBe(true)
    expect(actions.exitFullscreen).toHaveBeenCalledTimes(1)
  })
})

describe('pick mode, dialog and keys meant for an Erfana control', () => {
  it('025-AC-062 hands Esc, Up, Down, Alt+Up and Enter to pick mode and drops every other key', () => {
    state = PICK
    const r = router('darwin')
    for (const press of [keyDown('Escape'), keyDown('ArrowUp'), keyDown('ArrowDown'), keyDown('ArrowUp', ['alt']), keyDown('Enter')]) {
      expect(send(r, press)).toBe(true)
    }
    expect(actions.pickKey.mock.calls.map(([a]) => a)).toEqual(['exitPick', 'parent', 'child', 'parent', 'confirm'])
    actions.pickKey.mockClear()
    for (const press of [keyDown('a'), keyDown('s', ['meta']), keyDown('N', ['meta', 'shift']), keyDown('c', ['meta'])]) {
      expect(send(r, press)).toBe(true)
      expect(send(r, keyUp(press))).toBe(true)
    }
    noAction()
  })

  it('025-AC-064 consumes every key with a dialog open, F6 included, and acts on none but the reserved', () => {
    state = DIALOG
    const r = router('win32')
    expect(send(r, keyDown('a'))).toBe(true)
    expect(send(r, keyDown('r', ['control']))).toBe(true)
    expect(send(r, keyDown('F6'))).toBe(true)
    noAction()
    expect(send(r, keyDown('Tab', ['control']))).toBe(true)
    expect(actions.reservedKey).toHaveBeenCalledWith({ kind: 'app', action: 'nextEditorTab' })
  })

  it('consumes a key release that reaches the page outside the browsing state', () => {
    state = PICK
    expect(send(router('linux'), keyUp(keyDown('a')))).toBe(true)
  })
})

describe('ConsumedKeys', () => {
  it('falls back to the produced key when a synthetic event carries no code', () => {
    const held = new ConsumedKeys()
    const press = keyDown('F6', [], { code: '' })
    held.remember(press)
    expect(held.isFollowUp(autoRepeat(press))).toBe(true)
    expect(held.isFollowUp(keyUp(press))).toBe(true)
    expect(held.isFollowUp(keyUp(press))).toBe(false)
  })
})

describe('performErfanaKey', () => {
  it('hands each kind to its action', () => {
    performErfanaKey(actions as unknown as KeyRouteActions, { kind: 'pick', action: 'confirm' })
    performErfanaKey(actions as unknown as KeyRouteActions, { kind: 'exitFullscreen' })
    expect(actions.pickKey).toHaveBeenCalledWith('confirm')
    expect(actions.exitFullscreen).toHaveBeenCalledTimes(1)
  })
})
