// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One tab's input in main (spec 025, 025-FR-014, 025-FR-019, 025-FR-047 to
 * 025-FR-052; ADR 0011 decisions 11–16): the real routing reducer driven by
 * the page's keys, clicks and focus, and what reaches the owning window.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({ mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../LoggingService', () => ({ logger: mockLogger }))

import { CLICK_GUARD_MS, type RoutingEffect } from '../../../../shared/browser/routingState'
import { BrowserTabInput, EXIT_FULLSCREEN_WORLD_ID, type BrowserTabInputDeps, type TabInputEvents } from './BrowserTabInput'
import type { MacAppKeyTargets } from './macAppRoles'
import { FakeInputContents, keyDown } from './__test-helpers__/fakeInputContents'

const TAB = 'browser-tab-7'

let contents: FakeInputContents
let now: number
let events: { [K in keyof TabInputEvents]: Mock<TabInputEvents[K]> }
let macAppKeys: { [K in keyof MacAppKeyTargets]: Mock<() => void> }
let onEffect: Mock<(effect: RoutingEffect) => void>
let input: BrowserTabInput

function make(platform = 'darwin', extra: Partial<BrowserTabInputDeps> = {}): BrowserTabInput {
  return new BrowserTabInput({
    tabId: TAB,
    contents,
    platform,
    clock: { now: () => now },
    events,
    macAppKeys,
    onEffect,
    ...extra
  })
}

/** Load a page and give it focus, as a click from outside would. */
function loadAndFocus(): void {
  contents.emit('did-navigate', {}, 'https://a.test/')
  contents.focused = true
  contents.emit('focus')
}

/** Turn pick mode on with Cmd+E from page focus. */
function startPick(): void {
  contents.press(keyDown('e', ['meta']))
}

beforeEach(() => {
  vi.clearAllMocks()
  contents = new FakeInputContents()
  now = 10_000
  events = { forwardedKey: vi.fn(), pageFocus: vi.fn(), pick: vi.fn() }
  macAppKeys = { quit: vi.fn(), hide: vi.fn(), hideOthers: vi.fn(), minimize: vi.fn() }
  onEffect = vi.fn()
  input = make()
})

describe('set-up', () => {
  it('025-AC-061 makes the page ignore the app menu\'s shortcuts and starts out of focus', () => {
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenCalledWith(true)
    expect(input.state()).toMatchObject({ focus: 'out', pick: false, pageLoaded: false })
  })

  it('marks a page loaded when a document commits', () => {
    contents.emit('did-navigate', {}, 'https://a.test/')
    expect(input.state().pageLoaded).toBe(true)
  })
})

describe('keys from page focus', () => {
  beforeEach(loadAndFocus)

  it('025-AC-061 lets the page have Erfana app shortcuts and forwards nothing', () => {
    for (const press of [keyDown('s', ['meta']), keyDown('k', ['meta']), keyDown('p', ['meta']), keyDown('N', ['meta', 'shift'])]) {
      expect(contents.press(press)).toEqual({ down: false, up: false })
    }
    expect(events.forwardedKey).not.toHaveBeenCalled()
  })

  it('025-AC-014 forwards each browser key as a named action and keeps it from the page', () => {
    const presses = [
      keyDown('l', ['meta']),
      keyDown('r', ['meta']),
      keyDown('F5'),
      keyDown('w', ['meta']),
      keyDown('t', ['meta']),
      keyDown('[', ['meta'], { code: 'BracketLeft' }),
      keyDown(']', ['meta'], { code: 'BracketRight' }),
      keyDown('F12'),
      keyDown('f', ['meta'])
    ]
    for (const press of presses) expect(contents.press(press)).toEqual({ down: true, up: true })
    expect(events.forwardedKey.mock.calls.map(([a]) => a)).toEqual([
      'focusAddress',
      'reload',
      'reload',
      'closeTab',
      'newTab',
      'back',
      'forward',
      'devTools',
      'find'
    ])
  })

  it('025-AC-014 goes back on Cmd+[ from a German layout, matched by the physical key', () => {
    contents.press(keyDown('ü', ['meta'], { code: 'BracketLeft' }))
    expect(events.forwardedKey).toHaveBeenCalledWith('back')
  })

  it('025-AC-071 forwards Ctrl+Tab, F6, Shift+F6 and the focus-panel shortcuts as reserved actions', () => {
    input.dispose()
    contents = new FakeInputContents()
    input = make('darwin', { focusPanelKeys: (k) => k.key === '1' && k.control && k.shift })
    loadAndFocus()
    contents.press(keyDown('Tab', ['control']))
    contents.press(keyDown('Tab', ['control', 'shift']))
    contents.press(keyDown('F6'))
    contents.press(keyDown('F6', ['shift']))
    contents.press(keyDown('1', ['control', 'shift']))
    expect(events.forwardedKey.mock.calls.map(([a]) => a)).toEqual([
      'nextEditorTab',
      'previousEditorTab',
      'focusNextZone',
      'focusPreviousZone',
      'focusPanel'
    ])
  })

  it('025-AC-061 performs the macOS Edit roles in the page', () => {
    contents.press(keyDown('a', ['meta']))
    contents.press(keyDown('c', ['meta']))
    contents.press(keyDown('x', ['meta']))
    contents.press(keyDown('v', ['meta']))
    contents.press(keyDown('z', ['meta']))
    contents.press(keyDown('z', ['meta', 'shift']))
    for (const fn of [contents.selectAll, contents.copy, contents.cut, contents.paste, contents.undo, contents.redo]) {
      expect(fn).toHaveBeenCalledTimes(1)
    }
  })

  it('025-AC-061 performs Cmd+Q, Cmd+H, Cmd+Option+H and Cmd+M from page focus', () => {
    contents.press(keyDown('q', ['meta']))
    contents.press(keyDown('h', ['meta']))
    contents.press(keyDown('h', ['meta', 'alt']))
    contents.press(keyDown('m', ['meta']))
    for (const fn of Object.values(macAppKeys)) expect(fn).toHaveBeenCalledTimes(1)
  })

  it('hands the zoom keys to the zoom step, and drops them quietly with no zoom yet', () => {
    expect(contents.press(keyDown('=', ['meta'], { code: 'Equal' })).down).toBe(true)
    const zoom = vi.fn()
    input.dispose()
    contents = new FakeInputContents()
    input = make('darwin', { zoom })
    loadAndFocus()
    contents.press(keyDown('=', ['meta'], { code: 'Equal' }))
    contents.press(keyDown('-', ['meta'], { code: 'Minus' }))
    contents.press(keyDown('0', ['meta']))
    expect(zoom.mock.calls).toEqual([['in'], ['out'], ['reset']])
    expect(events.forwardedKey).not.toHaveBeenCalled()
  })

  it('025-AC-019 exits full screen in an isolated world on Esc, before the page sees it', () => {
    contents.emit('enter-html-full-screen')
    expect(contents.press(keyDown('Escape'))).toEqual({ down: true, up: true })
    expect(contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
      EXIT_FULLSCREEN_WORLD_ID,
      [{ code: expect.stringContaining('exitFullscreen') }],
      true
    )
    contents.emit('leave-html-full-screen')
    expect(contents.press(keyDown('Escape')).down).toBe(false)
  })

  it('025-AC-019 keeps pick mode on when Esc only exits full screen', () => {
    startPick()
    contents.emit('enter-html-full-screen')
    contents.press(keyDown('Escape'))
    expect(input.state().pick).toBe(true)
  })

  it('logs a full-screen exit that fails', async () => {
    contents.executeJavaScriptInIsolatedWorld.mockRejectedValueOnce(new Error('frame gone'))
    contents.emit('enter-html-full-screen')
    contents.press(keyDown('Escape'))
    await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenCalledWith('Browser tab could not leave full screen', { error: 'frame gone' }))
    contents.executeJavaScriptInIsolatedWorld.mockRejectedValueOnce('odd')
    contents.press(keyDown('Escape'))
    await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenLastCalledWith('Browser tab could not leave full screen', { error: 'odd' }))
  })

  it('takes a key that reaches the page as proof of page focus', () => {
    input.reportToolbarFocus(true)
    contents.emit('blur')
    expect(input.state().focus).toBe('toolbar')
    contents.press(keyDown('a'))
    expect(input.state().focus).toBe('page')
  })
})

describe('pick mode keys', () => {
  beforeEach(loadAndFocus)

  it('025-AC-062 starts pick mode with Cmd+E and tells the window', () => {
    startPick()
    expect(input.state().pick).toBe(true)
    expect(events.pick).toHaveBeenCalledWith({ tabId: TAB, kind: 'mode', on: true })
  })

  it('shows "Load a page" for Cmd+E on an empty tab', () => {
    input.dispose()
    contents = new FakeInputContents()
    input = make()
    contents.focused = true
    contents.emit('focus')
    startPick()
    expect(events.pick).toHaveBeenCalledWith({ tabId: TAB, kind: 'note', note: 'loadAPage' })
    expect(input.state().pick).toBe(false)
  })

  it('025-AC-062 handles Esc, Up, Down, Alt+Up and Enter, and drops every other key, the page getting none', () => {
    const refine = vi.fn()
    input.dispose()
    contents = new FakeInputContents()
    input = make('darwin', { refine })
    loadAndFocus()
    startPick()
    for (const press of [keyDown('a'), keyDown('s', ['meta']), keyDown('N', ['meta', 'shift'])]) {
      expect(contents.press(press)).toEqual({ down: true, up: true })
    }
    expect(events.forwardedKey).not.toHaveBeenCalled()
    contents.press(keyDown('ArrowUp'))
    contents.press(keyDown('ArrowDown', ['alt']))
    expect(refine.mock.calls).toEqual([['parent'], ['child']])
    // Enter with nothing highlighted: the note, and no capture.
    contents.press(keyDown('Enter'))
    expect(events.pick).toHaveBeenLastCalledWith({ tabId: TAB, kind: 'note', note: 'moveTheMouse' })
    expect(contents.press(keyDown('Escape')).down).toBe(true)
    expect(input.state().pick).toBe(false)
    expect(events.pick).toHaveBeenLastCalledWith({ tabId: TAB, kind: 'mode', on: false })
  })

  it('025-AC-062 still opens the find bar in pick mode', () => {
    startPick()
    contents.press(keyDown('f', ['meta']))
    expect(events.forwardedKey).toHaveBeenCalledWith('find')
    expect(input.state().pick).toBe(true)
  })

  it('025-AC-066 ends pick mode silently before a key that navigates or closes the tab', () => {
    for (const press of [keyDown('[', ['meta'], { code: 'BracketLeft' }), keyDown('r', ['meta']), keyDown('F5'), keyDown('w', ['meta']), keyDown('t', ['meta'])]) {
      startPick()
      events.pick.mockClear()
      contents.press(press)
      expect(input.state().pick).toBe(false)
      expect(events.pick.mock.calls).toEqual([[{ tabId: TAB, kind: 'mode', on: false }]])
    }
    expect(onEffect).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'notice' }))
  })

  it('confirms with the second Cmd+E only when something is highlighted (the capture goes to the pick pipeline)', () => {
    startPick()
    contents.press(keyDown('e', ['meta']))
    expect(events.pick).toHaveBeenLastCalledWith({ tabId: TAB, kind: 'note', note: 'moveTheMouse' })
    input.dispatch({ type: 'hover', element: true })
    contents.press(keyDown('e', ['meta']))
    expect(onEffect).toHaveBeenCalledWith({ type: 'startCapture', freeze: true })
  })
})

describe('menu and dialog open and close (S-28)', () => {
  it('reports once when a pick menu opens and once when the last surface closes, not on moves between them', () => {
    const onSurface = vi.fn<(open: boolean) => void>()
    contents = new FakeInputContents()
    input = make('darwin', { onSurface })
    loadAndFocus()
    startPick()
    input.dispatch({ type: 'hover', element: true })
    contents.press(keyDown('e', ['meta']))
    expect(onSurface).not.toHaveBeenCalled()
    input.dispatch({ type: 'captureReady' })
    expect(onSurface.mock.calls).toEqual([[true]])
    input.dispatch({ type: 'dialogOpen' })
    input.dispatch({ type: 'dialogBack' })
    expect(onSurface.mock.calls).toEqual([[true]])
    input.dispatch({ type: 'menuClose', reason: 'esc' })
    expect(onSurface.mock.calls).toEqual([[true], [false]])
  })
})

describe('focus and the first-click rule', () => {
  it('tells the window when the page gains and loses focus', () => {
    contents.emit('focus')
    contents.emit('blur')
    expect(events.pageFocus.mock.calls).toEqual([[true], [false]])
    expect(input.state().focus).toBe('out')
    // A blur with the tab already out of focus changes nothing.
    input.reportToolbarFocus(true)
    contents.emit('blur')
    expect(input.state().focus).toBe('toolbar')
  })

  it('025-AC-062 with focus from outside, the first click in pick mode only focuses the page; the second picks', () => {
    loadAndFocus()
    input.dispatch({ type: 'hover', element: true })
    startPick()
    contents.focused = false
    contents.emit('blur')
    expect(input.state().focus).toBe('out')

    const first = contents.click()
    expect(first).toEqual({ down: true, up: true })
    expect(contents.focus).toHaveBeenCalled()
    expect(onEffect).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'startCapture' }))
    // The focus event that follows does not arm the rule a second time.
    contents.focused = true
    contents.emit('focus')

    expect(contents.click()).toEqual({ down: true, up: true })
    expect(onEffect).toHaveBeenCalledWith({ type: 'startCapture', freeze: false })
  })

  it('025-AC-062 with keyboard focus returning from outside, the first click only focuses', () => {
    loadAndFocus()
    startPick()
    contents.emit('blur')
    input.reportFocusOrigin('outside')
    contents.emit('focus')
    expect(input.state().firstClickOnlyFocuses).toBe(true)
    contents.click()
    expect(onEffect).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'startCapture' }))
    contents.click()
    expect(onEffect).toHaveBeenCalledWith({ type: 'startCapture', freeze: false })
  })

  it('applies no first-click rule when focus came from the tab\'s own toolbar', () => {
    loadAndFocus()
    startPick()
    input.reportToolbarFocus(true)
    contents.emit('blur')
    expect(input.state().focus).toBe('toolbar')
    contents.click()
    expect(onEffect).toHaveBeenCalledWith({ type: 'startCapture', freeze: false })
  })

  it('takes the renderer\'s word that focus came from the toolbar', () => {
    loadAndFocus()
    startPick()
    contents.emit('blur')
    input.reportFocusOrigin('toolbar')
    contents.emit('focus')
    expect(input.state().firstClickOnlyFocuses).toBe(false)
  })

  it('moves between toolbar and out as the renderer reports', () => {
    input.reportToolbarFocus(true)
    expect(input.state().focus).toBe('toolbar')
    input.reportToolbarFocus(false)
    expect(input.state().focus).toBe('out')
    // With the page focused, the toolbar report waits for the page's blur.
    loadAndFocus()
    input.reportToolbarFocus(true)
    expect(input.state().focus).toBe('page')
    contents.focused = false
    contents.emit('blur')
    expect(input.state().focus).toBe('toolbar')
    // Losing toolbar focus while out changes nothing.
    input.reportToolbarFocus(false)
    input.reportToolbarFocus(false)
    expect(input.state().focus).toBe('out')
  })

  it('025-AC-071 a toolbar report while the page holds the OS keyboard moves the keyboard to the window', () => {
    const focusWindow = vi.fn(() => {
      contents.focused = false
      contents.emit('blur')
    })
    input = make('darwin', { focusWindow })
    loadAndFocus()
    input.reportToolbarFocus(true)
    expect(focusWindow).toHaveBeenCalledTimes(1)
    expect(input.state().focus).toBe('toolbar')
    // Already on the toolbar: no second pull.
    input.reportToolbarFocus(true)
    expect(focusWindow).toHaveBeenCalledTimes(1)
  })

  it('a toolbar report with the page not focused never pulls the keyboard', () => {
    const focusWindow = vi.fn()
    input = make('darwin', { focusWindow })
    input.reportToolbarFocus(true)
    expect(focusWindow).not.toHaveBeenCalled()
    expect(input.state().focus).toBe('toolbar')
  })

  it('focuses the page for a reducer focus effect and passes the toolbar targets on', () => {
    loadAndFocus()
    input.dispatch({ type: 'contextMenuPick' })
    input.dispatch({ type: 'captureReady' })
    expect(input.state().surface).toBe('menu')
    input.dispatch({ type: 'menuClose', reason: 'f6' })
    expect(onEffect).toHaveBeenCalledWith({ type: 'discardCapture' })
    expect(onEffect).toHaveBeenCalledWith({ type: 'focus', target: 'pickButton' })
  })
})

describe('the click guard', () => {
  beforeEach(loadAndFocus)

  it('025-AC-061 drops a page click before 500 ms after a row shift with the pointer over the page, and delivers one at 500 ms', () => {
    contents.mouse('mouseMove')
    input.recordRowShift()
    now += CLICK_GUARD_MS - 1
    expect(contents.click()).toEqual({ down: true, up: true })
    now += 1
    expect(contents.click()).toEqual({ down: false, up: false })
  })

  it('arms no guard when the pointer is away from the page', () => {
    contents.mouse('mouseMove')
    contents.mouse('mouseLeave')
    input.recordRowShift()
    expect(contents.click().down).toBe(false)
  })

  it('025-AC-062 shows "The page moved – click again" for a click it drops in pick mode', () => {
    startPick()
    contents.mouse('mouseEnter')
    input.recordRowShift()
    contents.click()
    expect(events.pick).toHaveBeenLastCalledWith({ tabId: TAB, kind: 'note', note: 'pageMoved' })
    expect(onEffect).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'startCapture' }))
  })
})

describe('toolbar keys (appWindowBrowserKeys target)', () => {
  it('025-AC-065 acts on browser keys with toolbar focus except Cmd+E, and on nothing elsewhere', () => {
    expect(input.toolbarBrowserKey(keyDown('r', ['meta']))).toBe(false)
    input.reportToolbarFocus(true)
    expect(input.toolbarBrowserKey(keyDown('r', ['meta']))).toBe(true)
    expect(events.forwardedKey).toHaveBeenCalledWith('reload')
    expect(input.toolbarBrowserKey(keyDown('e', ['meta']))).toBe(false)
    expect(input.toolbarBrowserKey(keyDown('a'))).toBe(false)
    expect(input.state().pick).toBe(false)
  })
})

describe('dispose', () => {
  it('removes every listener once, and ignores events afterwards', () => {
    input.dispose()
    input.dispose()
    for (const event of ['before-input-event', 'before-mouse-event', 'focus', 'blur', 'did-navigate']) {
      expect(contents.listenerCount(event)).toBe(0)
    }
    expect(input.dispatch({ type: 'focusToolbar' })).toEqual([])
  })

  it('leaves a destroyed page alone', () => {
    contents.destroyed = true
    input.dispose()
    expect(contents.listenerCount('focus')).toBe(1)
  })

  it('gives no focus to a destroyed page', () => {
    loadAndFocus()
    startPick()
    contents.emit('blur')
    contents.destroyed = true
    contents.focus.mockClear()
    contents.click()
    input.dispatch({ type: 'pickButton' })
    input.dispatch({ type: 'pickButton' })
    expect(contents.focus).not.toHaveBeenCalled()
  })
})
