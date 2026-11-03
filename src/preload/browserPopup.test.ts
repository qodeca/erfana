// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The popup host's preload (spec 025, commit 18): it exposes exactly
 * `browserPopupApi` with three members, on the channels main registers, and
 * its inlined channel names cannot drift from `browser-tab-channels.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_TAB_POPUP_CHANNELS, BROWSER_TAB_POPUP_EVENTS } from '../shared/ipc/browser-tab-channels'

type Listener = (event: unknown, payload: unknown) => void

const electron = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>()
  return {
    listeners,
    exposed: new Map<string, unknown>(),
    invoke: vi.fn(async () => null),
    on: vi.fn((channel: string, listener: Listener) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
    }),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      listeners.set(channel, (listeners.get(channel) ?? []).filter(l => l !== listener))
    })
  }
})

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, value: unknown) => electron.exposed.set(key, value) },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.removeListener }
}))

import { browserPopupBridge, POPUP_PRELOAD_CHANNELS } from './browserPopup'

beforeEach(() => {
  electron.invoke.mockClear()
})

describe('browserPopup preload', () => {
  it('exposes only browserPopupApi, with strip, close and onChanged', () => {
    expect([...electron.exposed.keys()]).toEqual(['browserPopupApi'])
    expect(Object.keys(browserPopupBridge).sort()).toEqual(['close', 'onChanged', 'strip'])
  })

  it('pins its inlined channel names to the shared constants', () => {
    expect(POPUP_PRELOAD_CHANNELS.popupStrip).toBe(BROWSER_TAB_POPUP_CHANNELS.popupStrip)
    expect(POPUP_PRELOAD_CHANNELS.popupClose).toBe(BROWSER_TAB_POPUP_CHANNELS.popupClose)
    expect(POPUP_PRELOAD_CHANNELS.popupChanged).toBe(BROWSER_TAB_POPUP_EVENTS.popupChanged)
  })

  it('sends empty payloads on the popup channels', async () => {
    await browserPopupBridge.strip()
    await browserPopupBridge.close()
    expect(electron.invoke.mock.calls).toEqual([
      [BROWSER_TAB_POPUP_CHANNELS.popupStrip, {}],
      [BROWSER_TAB_POPUP_CHANNELS.popupClose, {}]
    ])
  })

  it('delivers popupChanged without its payload and unsubscribes', () => {
    const callback = vi.fn()
    const off = browserPopupBridge.onChanged(callback)
    for (const l of electron.listeners.get(BROWSER_TAB_POPUP_EVENTS.popupChanged) ?? []) l({}, { secret: 1 })
    expect(callback).toHaveBeenCalledWith()
    expect(off()).toBeUndefined()
    expect(electron.listeners.get(BROWSER_TAB_POPUP_EVENTS.popupChanged)).toEqual([])
  })
})
