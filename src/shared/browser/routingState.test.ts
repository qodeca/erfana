// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  CLICK_GUARD_MS,
  INITIAL_ROUTING_STATE,
  PAGE_CHANGED_NOTICE,
  STATUS_NOTES,
  pausedChip,
  pickBanner,
  reduceRouting,
  routingMode,
  type RoutingEvent,
  type RoutingResult,
  type RoutingState
} from './routingState'

const DBL = 500
const run = (s: RoutingState, ...events: RoutingEvent[]): RoutingResult =>
  events.reduce<RoutingResult>((r, e) => reduceRouting(r.state, e), { state: s, effects: [] })
const browsing = run(INITIAL_ROUTING_STATE, { type: 'pageLoaded', loaded: true }, { type: 'focusPage', from: 'tab' }).state
const picking = run(browsing, { type: 'pickButton' }, { type: 'hover', element: true }).state
const withMenu = run(picking, { type: 'enter', now: 1000 }, { type: 'captureReady' }).state
const frozenMenu = run(picking, { type: 'pickShortcut', now: 1000 }, { type: 'captureReady' }, { type: 'frozen' }).state
const withDialog = run(frozenMenu, { type: 'dialogOpen' }).state

describe('routing modes (025-FR-014)', () => {
  it('025-AC-014 derives exactly one of the five states while focus is in the tab, else out', () => {
    expect(routingMode(INITIAL_ROUTING_STATE)).toBe('out')
    expect(routingMode(browsing)).toBe('browse')
    expect(routingMode(picking)).toBe('pick')
    expect(routingMode(withMenu)).toBe('menu')
    expect(routingMode(withDialog)).toBe('dialog')
    expect(routingMode(run(picking, { type: 'focusToolbar' }).state)).toBe('toolbar')
    expect(routingMode(run(browsing, { type: 'focusToolbar' }).state)).toBe('toolbar')
  })

  it('025-AC-014 closes the menu without sending when focus leaves, but keeps the dialog', () => {
    const left = run(frozenMenu, { type: 'focusOut' })
    expect(left.state).toMatchObject({ surface: 'none', frozen: false, pick: true, outReason: 'menuClosedOnLeave' })
    expect(left.effects).toEqual([{ type: 'discardCapture' }, { type: 'unfreeze' }])
    const kept = run(withDialog, { type: 'focusOut' })
    expect(kept.state).toMatchObject({ surface: 'dialog', frozen: true, outReason: 'dialogKept' })
    expect(kept.effects).toEqual([])
    expect(routingMode(run(kept.state, { type: 'pageClick', now: 9000, doubleClickMs: DBL }).state)).toBe('dialog')
  })
})

describe('pick mode on and off (025-FR-025)', () => {
  it('starts pick mode with page focus, and refuses on an empty tab or Erfana page', () => {
    const r = run(browsing, { type: 'pickShortcut', now: 0 })
    expect(r.state).toMatchObject({ pick: true, focus: 'page' })
    expect(r.effects).toEqual([{ type: 'pickMode', on: true }, { type: 'focus', target: 'page' }])
    const empty = run({ ...INITIAL_ROUTING_STATE, focus: 'page' }, { type: 'pickButton' })
    expect(empty.state.pick).toBe(false)
    expect(empty.effects).toEqual([{ type: 'note', note: 'loadAPage' }])
    expect(STATUS_NOTES.loadAPage).toEqual({ text: 'Load a page to pick an element', ms: 4000 })
  })

  it('ends pick mode on Esc with page focus or the button, and when the page goes to an Erfana page', () => {
    expect(run(picking, { type: 'pickEsc' }).effects).toEqual([{ type: 'pickMode', on: false }])
    expect(run(picking, { type: 'pickButton' }).state.pick).toBe(false)
    expect(run(picking, { type: 'pageLoaded', loaded: false }).state).toMatchObject({ pick: false, pageLoaded: false })
  })
})

describe('key routing states (025-FR-047 to 025-FR-052)', () => {
  it('025-AC-061 drops page clicks within 500 ms of a row shift over the page (499 vs 500)', () => {
    const shifted = run(browsing, { type: 'rowShift', now: 1000, pointerOverPage: true }).state
    expect(run(shifted, { type: 'pageClick', now: 1000 + CLICK_GUARD_MS - 1, doubleClickMs: DBL }).effects).toEqual([
      { type: 'dropClick' }
    ])
    expect(run(shifted, { type: 'pageClick', now: 1000 + CLICK_GUARD_MS, doubleClickMs: DBL }).effects).toEqual([])
    expect(run(browsing, { type: 'rowShift', now: 1000, pointerOverPage: false }).state.clickGuardUntil).toBe(0)
  })

  it('025-AC-062 confirms by click and Enter; the guard drops both with the note (S-29)', () => {
    expect(run(picking, { type: 'pageClick', now: 5000, doubleClickMs: DBL }).effects).toEqual([
      { type: 'startCapture', freeze: false }
    ])
    expect(run(picking, { type: 'enter', now: 5000 }).effects).toEqual([{ type: 'startCapture', freeze: false }])
    const shifted = run(picking, { type: 'rowShift', now: 5000, pointerOverPage: true }).state
    for (const e of [
      { type: 'pageClick', now: 5499, doubleClickMs: DBL },
      { type: 'enter', now: 5499 },
      { type: 'pickShortcut', now: 5499 }
    ] as const) {
      const r = run(shifted, e)
      expect(r.effects).toEqual([{ type: 'note', note: 'pageMoved' }])
      expect(r.state.capturing).toBe(false)
    }
    expect(run(shifted, { type: 'enter', now: 5500 }).effects).toEqual([{ type: 'startCapture', freeze: false }])
    expect(STATUS_NOTES.pageMoved).toEqual({ text: 'The page moved – click again', ms: 2000 })
  })

  it('025-AC-062 first click after focus returns from outside only focuses the page', () => {
    const out = run(picking, { type: 'focusOut' }).state
    const back = run(out, { type: 'pageClick', now: 1, doubleClickMs: DBL })
    expect(back.effects).toEqual([])
    expect(routingMode(back.state)).toBe('pick')
    expect(run(back.state, { type: 'pageClick', now: 2, doubleClickMs: DBL }).effects).toEqual([
      { type: 'startCapture', freeze: false }
    ])
    const byKeyboard = run(out, { type: 'focusPage', from: 'outside' }).state
    expect(run(byKeyboard, { type: 'pageClick', now: 3, doubleClickMs: DBL }).effects).toEqual([])
    const fromToolbar = run(picking, { type: 'focusToolbar' }, { type: 'pageClick', now: 4, doubleClickMs: DBL })
    expect(fromToolbar.effects).toEqual([{ type: 'startCapture', freeze: false }])
  })

  it('025-AC-062 Enter and the second Ctrl/Cmd+E pick nothing until an element is highlighted', () => {
    const none = run(browsing, { type: 'pickButton' }).state
    expect(run(none, { type: 'enter', now: 1 }).effects).toEqual([{ type: 'note', note: 'moveTheMouse' }])
    expect(run(none, { type: 'pickShortcut', now: 1 }).effects).toEqual([{ type: 'note', note: 'moveTheMouse' }])
  })

  it('025-AC-062 one capture per confirm: presses while capturing are dropped', () => {
    const capturing = run(picking, { type: 'enter', now: 1 }).state
    expect(capturing.capturing).toBe(true)
    expect(run(capturing, { type: 'enter', now: 2 }).effects).toEqual([])
    expect(run(capturing, { type: 'pageClick', now: 2, doubleClickMs: DBL }).effects).toEqual([])
    expect(run(capturing, { type: 'captureFailed' }).state).toMatchObject({ capturing: false, pick: true, surface: 'none' })
  })

  it('025-AC-063 a click on the page closes the menu without sending and keeps pick mode', () => {
    const r = run(frozenMenu, { type: 'pageClick', now: 9000, doubleClickMs: DBL })
    expect(r.state).toMatchObject({ surface: 'none', pick: true, frozen: false, focus: 'page' })
    expect(r.effects).toEqual([{ type: 'discardCapture' }, { type: 'unfreeze' }])
  })

  it('025-AC-063 ignores the second click of the double-click that confirmed the pick', () => {
    const confirmed = run(picking, { type: 'pageClick', now: 1000, doubleClickMs: DBL }, { type: 'captureReady' }).state
    expect(run(confirmed, { type: 'pageClick', now: 1000 + DBL - 1, doubleClickMs: DBL }).state.surface).toBe('menu')
    expect(run(confirmed, { type: 'pageClick', now: 1000 + DBL, doubleClickMs: DBL }).state.surface).toBe('none')
  })

  it('025-AC-063 Ctrl/Cmd+L, a toolbar click, F6 and Shift+F6 close the menu and move focus', () => {
    expect(run(frozenMenu, { type: 'menuClose', reason: 'focusAddress' }).effects).toEqual([
      { type: 'discardCapture' },
      { type: 'unfreeze' },
      { type: 'focus', target: 'address' }
    ])
    expect(run(frozenMenu, { type: 'menuClose', reason: 'f6' }).effects.at(-1)).toEqual({ type: 'focus', target: 'pickButton' })
    expect(run(frozenMenu, { type: 'menuClose', reason: 'shiftF6' }).effects.at(-1)).toEqual({
      type: 'focus',
      target: 'previousZoneLast'
    })
    const toolbar = run(withMenu, { type: 'pickButton' })
    expect(toolbar.state).toMatchObject({ surface: 'none', pick: true, focus: 'toolbar' })
    expect(run(withMenu, { type: 'menuClose', reason: 'esc' }).state).toMatchObject({ pick: true, focus: 'page' })
    expect(run(browsing, { type: 'menuClose', reason: 'esc' }).effects).toEqual([])
  })

  it('025-AC-064 the dialog is modal: page clicks and the pick button do nothing', () => {
    expect(run(withDialog, { type: 'pageClick', now: 9000, doubleClickMs: DBL })).toEqual({ state: withDialog, effects: [] })
    expect(run(withDialog, { type: 'pickButton' })).toEqual({ state: withDialog, effects: [] })
  })

  it('025-AC-064 ← Actions returns to the menu on the same capture and keeps the freeze; Cancel unfreezes', () => {
    const back = run(withDialog, { type: 'dialogBack' })
    expect(back.state).toMatchObject({ surface: 'menu', frozen: true })
    expect(back.effects).toEqual([])
    const cancel = run(withDialog, { type: 'dialogClose' })
    expect(cancel.state).toMatchObject({ surface: 'none', frozen: false, pick: true })
    expect(cancel.effects).toEqual([{ type: 'discardCapture' }, { type: 'unfreeze' }])
  })

  it('025-AC-065 toolbar focus never leaves pick mode', () => {
    const toolbar = run(picking, { type: 'focusToolbar' }).state
    expect(run(toolbar, { type: 'pickEsc' }).state.pick).toBe(true)
    expect(run(toolbar, { type: 'pickShortcut', now: 1 })).toEqual({ state: toolbar, effects: [] })
  })

  it('025-AC-066 leaving by key or hiding the tab ends pick mode and discards without a notice', () => {
    for (const s of [picking, withMenu, frozenMenu, withDialog]) {
      const r = run(s, { type: 'endSilently' })
      expect(r.state).toMatchObject({ pick: false, surface: 'none', frozen: false })
      expect(r.effects.some(e => e.type === 'notice')).toBe(false)
      expect(r.effects.at(-1)).toEqual({ type: 'pickMode', on: false })
    }
    expect(run(frozenMenu, { type: 'endSilently' }).effects).toEqual([
      { type: 'discardCapture' },
      { type: 'unfreeze' },
      { type: 'pickMode', on: false }
    ])
  })
})

describe('capture and send (025-FR-028, 025-FR-053)', () => {
  it('freezes only a shortcut pick, after the hints', () => {
    expect(run(picking, { type: 'pickShortcut', now: 1 }).effects).toEqual([{ type: 'startCapture', freeze: true }])
    expect(frozenMenu.frozen).toBe(true)
    expect(withMenu.frozen).toBe(false)
    expect(run(picking, { type: 'frozen' }).effects).toEqual([{ type: 'unfreeze' }])
  })

  it('picks at once from a pointer right-click', () => {
    const r = run(browsing, { type: 'contextMenuPick' })
    expect(r.state).toMatchObject({ pick: true, capturing: true })
    expect(r.effects).toEqual([{ type: 'pickMode', on: true }, { type: 'startCapture', freeze: false }])
    expect(run(withMenu, { type: 'contextMenuPick' }).effects).toEqual([])
  })

  it('ends pick mode after a send, without discarding the sent capture', () => {
    const r = run(withDialog, { type: 'sent' })
    expect(r.state).toMatchObject({ pick: false, surface: 'none', frozen: false })
    expect(r.effects).toEqual([{ type: 'unfreeze' }, { type: 'pickMode', on: false }])
  })

  it('a page navigation closes the menu with a notice, but keeps the dialog with pick mode off', () => {
    const menu = run(withMenu, { type: 'pageNavigated' })
    expect(menu.state).toMatchObject({ pick: false, surface: 'none' })
    expect(menu.effects).toContainEqual({ type: 'notice', text: PAGE_CHANGED_NOTICE })
    const dialog = run(withDialog, { type: 'pageNavigated' })
    expect(dialog.state).toMatchObject({ pick: false, surface: 'dialog', frozen: false, dialogAfterReload: true })
    expect(run(dialog.state, { type: 'dialogBack' }).state.surface).toBe('dialog')
    expect(run(dialog.state, { type: 'dialogClose' }).state).toMatchObject({ pick: false, surface: 'none' })
    expect(run(picking, { type: 'pageNavigated' }).effects).toEqual([{ type: 'pickMode', on: false }])
  })
})

describe('banner (025-FR-065)', () => {
  const E = 'Ctrl+E'
  it('025-AC-081 shows the banner for each focus place', () => {
    expect(pickBanner(browsing, E)).toBeNull()
    expect(pickBanner(picking, E)?.join(' · ')).toBe('Picking – click an element · Esc to stop · Ctrl+E picks under the mouse')
    expect(pickBanner(run(picking, { type: 'focusToolbar' }).state, E)).toEqual(['Picking – Esc returns to the page'])
    expect(pickBanner(withMenu, E)).toEqual(['Picking – Esc or click outside closes the panel'])
    expect(pickBanner(withDialog, E)).toEqual(['Picking – Esc or Cancel closes the dialog'])
    expect(pickBanner(run(picking, { type: 'focusOut' }).state, E)).toEqual(['Picking – click the page to continue'])
    expect(pickBanner(run(withMenu, { type: 'focusOut' }).state, E)).toEqual([
      'Picking – the panel closed when you left; pick again'
    ])
    expect(pickBanner(run(withDialog, { type: 'focusOut' }).state, E)).toEqual(['Picking – click to return to the dialog'])
  })

  it('025-AC-081 shows "Page paused" only while frozen; Esc in the menu removes it and keeps the banner', () => {
    expect(pausedChip(frozenMenu)).toBe('Page paused')
    const esc = run(frozenMenu, { type: 'menuClose', reason: 'esc' }).state
    expect(pausedChip(esc)).toBeNull()
    expect(pickBanner(esc, '⌘E')?.[0]).toBe('Picking – click an element')
  })
})
