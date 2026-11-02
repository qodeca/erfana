// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The identity set behind every IPC trust gate (spec 025 commit 1,
 * 025-NFR-001).
 */
import { describe, expect, it } from 'vitest'

import { isAppWebContents, registerAppWebContents } from './appWebContents'
import { createAppSender, createFakeWebContents } from './__test-helpers__/appSender'

describe('appWebContents', () => {
  it('trusts a registered webContents', () => {
    expect(isAppWebContents(createAppSender())).toBe(true)
  })

  it('does not trust a webContents that was never registered', () => {
    expect(isAppWebContents(createFakeWebContents())).toBe(false)
  })

  it('does not trust a missing webContents', () => {
    expect(isAppWebContents(undefined)).toBe(false)
    expect(isAppWebContents(null)).toBe(false)
  })

  it('refuses an unregistered object without calling into it', () => {
    // A malformed sender (no isDestroyed) is a refusal, not a TypeError.
    expect(isAppWebContents({ id: 424242 } as never)).toBe(false)
  })

  it('drops the id when the webContents is destroyed', () => {
    const wc = createAppSender()
    wc.destroy()
    expect(isAppWebContents(wc)).toBe(false)
    // A later object that reuses the id is not trusted either: the entry is gone.
    expect(isAppWebContents({ id: wc.id, isDestroyed: () => false })).toBe(false)
  })

  it('refuses a destroyed webContents even before its destroyed event fires', () => {
    const wc = createAppSender()
    const destroyedNoEvent = { id: wc.id, isDestroyed: () => true }
    expect(isAppWebContents(destroyedNoEvent)).toBe(false)
  })

  it('does not register a webContents that is already destroyed', () => {
    const wc = createFakeWebContents()
    wc.destroy()
    registerAppWebContents(wc)
    expect(isAppWebContents({ id: wc.id, isDestroyed: () => false })).toBe(false)
  })

  it('registers the same webContents once, with one destroyed listener', () => {
    const wc = createFakeWebContents()
    let listeners = 0
    const counting = {
      id: wc.id,
      isDestroyed: () => wc.isDestroyed(),
      once: (event: 'destroyed', listener: () => void): unknown => {
        listeners++
        return wc.once(event, listener)
      }
    }
    registerAppWebContents(counting)
    registerAppWebContents(counting)
    expect(listeners).toBe(1)
    expect(isAppWebContents(wc)).toBe(true)
    wc.destroy()
    expect(isAppWebContents(wc)).toBe(false)
  })

  it('keeps other windows trusted when one is destroyed', () => {
    const a = createAppSender()
    const b = createAppSender()
    a.destroy()
    expect(isAppWebContents(a)).toBe(false)
    expect(isAppWebContents(b)).toBe(true)
  })
})
