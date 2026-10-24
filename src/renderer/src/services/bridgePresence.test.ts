// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The presence check answers what `window.api?.<domain>?.<method>` used to,
 * at each level that can be missing, and reads `window.api` on every call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasBridge, hasBridgeMethod } from './bridgePresence'

const original = window.api

afterEach(() => {
  window.api = original
})

const install = (api: unknown): void => {
  window.api = api as typeof window.api
}

describe('hasBridge', () => {
  it.each([
    ['no window.api', undefined, false],
    ['a null window.api', null, false],
    ['no such bridge', {}, false],
    ['a null bridge', { directoryWatch: null }, false],
    ['the bridge', { directoryWatch: {} }, true]
  ])('%s → %s', (_name, api, expected) => {
    install(api)
    expect(hasBridge('directoryWatch')).toBe(expected)
  })
})

describe('hasBridgeMethod', () => {
  it.each([
    ['no window.api', undefined, false],
    ['no such bridge', {}, false],
    ['a null bridge', { directoryWatch: null }, false],
    ['no such method', { directoryWatch: {} }, false],
    ['a member that is not a function', { directoryWatch: { onDirectoryChanged: true } }, false],
    ['the method', { directoryWatch: { onDirectoryChanged: vi.fn() } }, true]
  ])('%s → %s', (_name, api, expected) => {
    install(api)
    expect(hasBridgeMethod('directoryWatch', 'onDirectoryChanged')).toBe(expected)
  })

  it('reads window.api on every call', () => {
    install({})
    expect(hasBridgeMethod('directoryWatch', 'start')).toBe(false)
    install({ directoryWatch: { start: vi.fn() } })
    expect(hasBridgeMethod('directoryWatch', 'start')).toBe(true)
  })

  it('never calls the method it looks for', () => {
    const start = vi.fn()
    install({ directoryWatch: { start } })
    hasBridgeMethod('directoryWatch', 'start')
    expect(start).not.toHaveBeenCalled()
  })
})
