// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** macOS application-menu roles from page focus (spec 025, 025-FR-047; ADR 0011 decision 12). */
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { MacEditRole, ReservedOsAction } from '../../../../shared/browser/browserKeys'
import { electronMacAppKeys, performMacAppKey, performMacEditRole, type MacAppKeyTargets } from './macAppRoles'

describe('performMacEditRole', () => {
  it.each<MacEditRole>(['copy', 'paste', 'cut', 'selectAll', 'undo', 'redo'])('runs %s in the page', (role) => {
    const contents = { copy: vi.fn(), paste: vi.fn(), cut: vi.fn(), selectAll: vi.fn(), undo: vi.fn(), redo: vi.fn() }
    performMacEditRole(contents, role)
    expect(contents[role]).toHaveBeenCalledTimes(1)
    expect(Object.values(contents).filter((fn) => fn.mock.calls.length > 0)).toHaveLength(1)
  })
})

describe('performMacAppKey', () => {
  const targets = (): { [K in keyof MacAppKeyTargets]: Mock<() => void> } => ({
    quit: vi.fn(),
    hide: vi.fn(),
    hideOthers: vi.fn(),
    minimize: vi.fn()
  })

  it.each<[ReservedOsAction, keyof MacAppKeyTargets]>([
    ['quit', 'quit'],
    ['hide', 'hide'],
    ['hideOthers', 'hideOthers'],
    ['minimize', 'minimize']
  ])('performs %s', (action, target) => {
    const t = targets()
    expect(performMacAppKey(t, action)).toBe(true)
    expect(t[target]).toHaveBeenCalledTimes(1)
  })

  it.each<ReservedOsAction>(['closeWindow', 'system'])('leaves %s to the operating system', (action) => {
    const t = targets()
    expect(performMacAppKey(t, action)).toBe(false)
    for (const fn of Object.values(t)) expect(fn).not.toHaveBeenCalled()
  })
})

describe('electronMacAppKeys', () => {
  it('quits through app.quit, hides, sends the hide-others selector and minimises the tab window', () => {
    const app = { quit: vi.fn(), hide: vi.fn() }
    const send = vi.fn()
    const window = { minimize: vi.fn(), isDestroyed: () => false }
    const keys = electronMacAppKeys({ app, sendActionToFirstResponder: send, window: () => window })
    keys.quit()
    keys.hide()
    keys.hideOthers()
    keys.minimize()
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(app.hide).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('hideOtherApplications:')
    expect(window.minimize).toHaveBeenCalledTimes(1)
  })

  it('minimises nothing when the window is gone or destroyed', () => {
    const app = { quit: vi.fn(), hide: vi.fn() }
    const destroyed = { minimize: vi.fn(), isDestroyed: () => true }
    expect(() => electronMacAppKeys({ app, sendActionToFirstResponder: vi.fn(), window: () => null }).minimize()).not.toThrow()
    electronMacAppKeys({ app, sendActionToFirstResponder: vi.fn(), window: () => destroyed }).minimize()
    expect(destroyed.minimize).not.toHaveBeenCalled()
  })
})
