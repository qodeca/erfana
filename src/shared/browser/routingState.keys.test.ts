// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import type { BrowserKeyInput } from './browserKeys'
import { INITIAL_ROUTING_STATE, reduceRouting, routeKey, type RoutingEvent, type RoutingState } from './routingState'

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
const run = (s: RoutingState, ...events: RoutingEvent[]): RoutingState => events.reduce((st, e) => reduceRouting(st, e).state, s)
const win = 'win32'
const mac = 'darwin'
const browse = run(INITIAL_ROUTING_STATE, { type: 'pageLoaded', loaded: true }, { type: 'focusPage', from: 'tab' })
const pick = run(browse, { type: 'pickButton' }, { type: 'hover', element: true })
const menu = run(pick, { type: 'enter', now: 1 }, { type: 'captureReady' })
const dialog = run(menu, { type: 'dialogOpen' })
const toolbar = run(pick, { type: 'focusToolbar' })

const ctrl = (k: string): BrowserKeyInput => key(k, `Key${k.toUpperCase()}`, { control: true })
const browser = (action: string): unknown => ({ to: 'erfana', key: { kind: 'browser', action } })

describe('routeKey (025-FR-047 to 025-FR-051)', () => {
  it('025-AC-061 browsing: browser keys act, every other key reaches the page', () => {
    expect(routeKey(browse, ctrl('r'), win)).toEqual(browser('reload'))
    expect(routeKey(browse, ctrl('e'), win)).toEqual(browser('pick'))
    for (const k of ['s', 'k', 'p']) expect(routeKey(browse, ctrl(k), win)).toEqual({ to: 'page' })
    expect(routeKey(browse, key('N', 'KeyN', { control: true, shift: true }), win)).toEqual({ to: 'page' })
    expect(routeKey(browse, key('a', 'KeyA'), win)).toEqual({ to: 'page' })
    expect(routeKey(browse, key('Escape', 'Escape'), win)).toEqual({ to: 'page' })
  })

  it('025-AC-061 browsing on macOS: Edit roles and app keys are performed by the router', () => {
    expect(routeKey(browse, key('c', 'KeyC', { meta: true }), mac)).toEqual({ to: 'erfana', key: { kind: 'macEdit', action: 'copy' } })
    expect(routeKey(browse, key('q', 'KeyQ', { meta: true }), mac)).toEqual({
      to: 'erfana',
      key: { kind: 'reserved', key: { kind: 'os', action: 'quit' } }
    })
    expect(routeKey(browse, key('F4', 'F4', { alt: true }), win)).toEqual({ to: 'os' })
    expect(routeKey(browse, key('Tab', 'Tab', { meta: true }), mac)).toEqual({ to: 'os' })
  })

  it('025-AC-061 F6 and editor-tab switching act from page focus', () => {
    expect(routeKey(browse, key('F6', 'F6'), win)).toEqual({
      to: 'erfana',
      key: { kind: 'reserved', key: { kind: 'app', action: 'focusNextZone' } }
    })
    expect(routeKey(pick, key('Tab', 'Tab', { control: true }), win)).toMatchObject({ to: 'erfana' })
  })

  it('025-AC-062 pick mode: pick keys and browser keys act, nothing reaches the page', () => {
    expect(routeKey(pick, key('Escape', 'Escape'), win)).toEqual({ to: 'erfana', key: { kind: 'pick', action: 'exitPick' } })
    expect(routeKey(pick, key('ArrowUp', 'ArrowUp', { alt: true }), mac)).toEqual({ to: 'erfana', key: { kind: 'pick', action: 'parent' } })
    expect(routeKey(pick, key('Enter', 'Enter'), win)).toEqual({ to: 'erfana', key: { kind: 'pick', action: 'confirm' } })
    expect(routeKey(pick, ctrl('f'), win)).toEqual(browser('find'))
    expect(routeKey(pick, key('+', 'Equal', { control: true, shift: true }), win)).toEqual(browser('zoomIn'))
    for (const input of [key('a', 'KeyA'), ctrl('s'), key('N', 'KeyN', { control: true, shift: true }), key('c', 'KeyC', { meta: true })]) {
      expect(routeKey(pick, input, input.meta ? mac : win)).toEqual({ to: 'drop' })
    }
    expect(routeKey(pick, key('Escape', 'Escape', {}, 'keyUp'), win)).toEqual({ to: 'drop' })
  })

  it('025-AC-063 menu: its keys go to the menu; Ctrl/Cmd+E, find and zoom do nothing; navigation keys act', () => {
    for (const input of [key('Tab', 'Tab'), key('Tab', 'Tab', { shift: true }), key(' ', 'Space'), key('ArrowUp', 'ArrowUp', { alt: true })]) {
      expect(routeKey(menu, input, win)).toEqual({ to: 'focused' })
    }
    for (const input of [key('a', 'KeyA'), ctrl('e'), ctrl('f'), key('-', 'Minus', { control: true })]) {
      expect(routeKey(menu, input, win)).toEqual({ to: 'drop' })
    }
    expect(routeKey(menu, ctrl('l'), win)).toEqual(browser('focusAddress'))
    expect(routeKey(menu, ctrl('w'), win)).toEqual(browser('closeTab'))
    expect(routeKey(menu, key('F6', 'F6', { shift: true }), win)).toMatchObject({ to: 'erfana' })
  })

  it('025-AC-064 dialog: every key but the reserved ones goes to the dialog; F6 moves nothing', () => {
    for (const input of [key('a', 'KeyA'), ctrl('r'), ctrl('w'), ctrl('e'), key('Escape', 'Escape'), key('Enter', 'Enter', { control: true })]) {
      expect(routeKey(dialog, input, win)).toEqual({ to: 'focused' })
    }
    expect(routeKey(dialog, key('F6', 'F6'), win)).toEqual({ to: 'drop' })
    expect(routeKey(dialog, key('F6', 'F6', { shift: true }), win)).toEqual({ to: 'drop' })
    expect(routeKey(dialog, key('Tab', 'Tab', { control: true }), win)).toMatchObject({ to: 'erfana' })
    expect(routeKey(dialog, key('Escape', 'Escape', { isComposing: true }), win)).toEqual({ to: 'focused' })
  })

  it('025-AC-065 toolbar: typing goes to the control, browser keys act except Ctrl/Cmd+E', () => {
    expect(routeKey(toolbar, key('a', 'KeyA'), win)).toEqual({ to: 'focused' })
    expect(routeKey(toolbar, key('Escape', 'Escape'), win)).toEqual({ to: 'focused' })
    expect(routeKey(toolbar, ctrl('e'), win)).toEqual({ to: 'drop' })
    expect(routeKey(toolbar, ctrl('r'), win)).toEqual(browser('reload'))
    expect(routeKey(toolbar, key('=', 'Equal', { control: true }), win)).toEqual(browser('zoomIn'))
  })

  it('025-AC-014 an IME composition takes every key, including Esc and Enter', () => {
    expect(routeKey(toolbar, key('Enter', 'Enter', { isComposing: true }), win)).toEqual({ to: 'focused' })
    expect(routeKey(browse, key('Escape', 'Escape', { isComposing: true }), win)).toEqual({ to: 'page' })
    expect(routeKey(pick, key('Process', 'KeyA'), win)).toEqual({ to: 'drop' })
  })

  it('025-AC-014 the tab receives no key while focus is outside it', () => {
    const out = run(pick, { type: 'focusOut' })
    expect(routeKey(out, ctrl('e'), win)).toEqual({ to: 'focused' })
  })

  it('popups: pick, address bar and new tab do nothing; close, find, zoom and DevTools act (025-FR-014)', () => {
    const popup = { popup: true }
    for (const k of ['e', 'l', 't']) expect(routeKey(browse, ctrl(k), win, popup)).toEqual({ to: 'drop' })
    expect(routeKey(browse, ctrl('w'), win, popup)).toEqual(browser('closeTab'))
    expect(routeKey(browse, ctrl('f'), win, popup)).toEqual(browser('find'))
    expect(routeKey(browse, key('F12', 'F12'), win, popup)).toEqual(browser('devTools'))
  })

  it('Esc in fullscreen or pointer lock only exits it (025-FR-019)', () => {
    expect(routeKey(browse, key('Escape', 'Escape'), win, { fullscreenOrPointerLock: true })).toEqual({
      to: 'erfana',
      key: { kind: 'exitFullscreen' }
    })
  })
})
