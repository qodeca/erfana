// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Browser keys on Erfana's window while a tab's toolbar has focus (spec 025,
 * 025-FR-050, 025-FR-051; ADR 0011 decision 13): the menu's reload and zoom
 * never see a browser key, everything else reaches the renderer.
 */
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { BrowserKeyInput } from '../../../../shared/browser/browserKeys'
import { AppWindowBrowserKeys, isAppMenuForceReload, type AppWindowContents } from './appWindowBrowserKeys'
import { autoRepeat, fakeEvent, keyDown, keyUp } from './__test-helpers__/fakeInputContents'

let contents: EventEmitter
let keys: AppWindowBrowserKeys
let target: { toolbarBrowserKey: Mock<(input: BrowserKeyInput) => boolean> }

function send(input: ReturnType<typeof keyDown>): boolean {
  const event = fakeEvent()
  contents.emit('before-input-event', event, input)
  return event.prevented
}

beforeEach(() => {
  contents = new EventEmitter()
  keys = new AppWindowBrowserKeys(contents as unknown as AppWindowContents, 'darwin')
  target = { toolbarBrowserKey: vi.fn((_input: BrowserKeyInput) => true) }
})

describe('AppWindowBrowserKeys', () => {
  it('touches no key while no toolbar has focus', () => {
    expect(keys.hasTarget()).toBe(false)
    expect(send(keyDown('r', ['meta']))).toBe(false)
    expect(send(keyDown('=', ['meta'], { code: 'Equal' }))).toBe(false)
  })

  it('025-AC-065 consumes a browser key – the app menu never reloads or zooms Erfana – and hands it to the tab', () => {
    keys.setTarget(target)
    expect(keys.hasTarget()).toBe(true)
    const reload = keyDown('r', ['meta'])
    expect(send(reload)).toBe(true)
    expect(send(autoRepeat(reload))).toBe(true)
    expect(send(keyUp(reload))).toBe(true)
    expect(send(keyDown('=', ['meta'], { code: 'Equal' }))).toBe(true)
    expect(target.toolbarBrowserKey).toHaveBeenCalledTimes(2)
    expect(target.toolbarBrowserKey.mock.calls[0]![0]).toMatchObject({ key: 'r', meta: true })
  })

  it('025-AC-065 consumes Ctrl/Cmd+E even though it does nothing with toolbar focus', () => {
    target.toolbarBrowserKey.mockReturnValue(false)
    keys.setTarget(target)
    expect(send(keyDown('e', ['meta']))).toBe(true)
    expect(target.toolbarBrowserKey).toHaveBeenCalledTimes(1)
  })

  it('025-AC-065 leaves typing, Esc, Tab, the reserved keys and the Edit roles to the renderer', () => {
    keys.setTarget(target)
    for (const press of [keyDown('a'), keyDown('Escape'), keyDown('Tab'), keyDown('Tab', ['control']), keyDown('F6'), keyDown('c', ['meta']), keyDown('q', ['meta'])]) {
      expect(send(press)).toBe(false)
      expect(send(keyUp(press))).toBe(false)
    }
    expect(target.toolbarBrowserKey).not.toHaveBeenCalled()
  })

  it('025-AC-014 leaves Esc and Enter to an IME composition in the address bar', () => {
    keys.setTarget(target)
    expect(send(keyDown('Escape', [], { isComposing: true }))).toBe(false)
    expect(send(keyDown('r', ['meta'], { isComposing: true }))).toBe(false)
  })

  it('consumes the menu\'s force reload without handing it to the tab', () => {
    keys.setTarget(target)
    expect(send(keyDown('R', ['meta', 'shift']))).toBe(true)
    expect(target.toolbarBrowserKey).not.toHaveBeenCalled()
  })

  it('clears only its own target, and keeps held keys across a target change', () => {
    const other = { toolbarBrowserKey: vi.fn((_input: BrowserKeyInput) => true) }
    keys.setTarget(target)
    const reload = keyDown('r', ['meta'])
    send(reload)
    keys.clearTarget(other)
    expect(keys.hasTarget()).toBe(true)
    keys.clearTarget(target)
    expect(keys.hasTarget()).toBe(false)
    expect(send(keyUp(reload))).toBe(true)
  })

  it('stops listening on dispose', () => {
    keys.setTarget(target)
    keys.dispose()
    expect(contents.listenerCount('before-input-event')).toBe(0)
    expect(keys.hasTarget()).toBe(false)
  })
})

describe('isAppMenuForceReload', () => {
  it.each([
    ['darwin', keyDown('R', ['meta', 'shift']), true],
    ['darwin', keyDown('R', ['control', 'shift']), false],
    ['darwin', keyDown('r', ['meta']), false],
    ['win32', keyDown('R', ['control', 'shift']), true],
    ['win32', keyDown('R', ['control', 'shift', 'alt']), false],
    ['linux', keyDown('R', ['control', 'meta', 'shift']), false],
    ['linux', keyUp(keyDown('R', ['control', 'shift'])), false],
    ['linux', keyDown('Ŕ', ['control', 'shift'], { code: 'KeyR' }), true]
  ])('%s %o → %s', (platform, input, expected) => {
    expect(isAppMenuForceReload(input, platform)).toBe(expected)
  })
})
