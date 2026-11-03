// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: never) => void
const listeners = vi.hoisted(() => new Map<string, Listener>())
const unsubscribed = vi.hoisted(() => [] as string[])

vi.mock('../browserTabGateway', () => {
  const on = (name: string) => (callback: Listener) => {
    listeners.set(name, callback)
    return () => unsubscribed.push(name)
  }
  return {
    browserTabGateway: {
      onState: on('state'),
      onFocus: on('focus'),
      onNotice: on('notice'),
      onTabAdded: on('tabAdded')
    }
  }
})

import { mountBrowserTabEvents } from './browserTabEvents'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'

function emit(name: string, event: unknown): void {
  listeners.get(name)?.(event as never)
}

afterEach(() => {
  listeners.clear()
  unsubscribed.length = 0
  useBrowserTabStore.setState({
    byTab: new Map(),
    tabByPanel: new Map(),
    unhosted: new Map(),
    localAddresses: []
  })
})

describe('mountBrowserTabEvents', () => {
  it('feeds state, focus and local addresses into the store, and page-opened tabs to the window', () => {
    const openPageTab = vi.fn()
    const dispose = mountBrowserTabEvents({ openPageTab })
    useBrowserTabStore.getState().attach('browser-panel-1', 'browser-tab-1')

    emit('state', { tabId: 'browser-tab-1', title: 'T', erfanaPage: null })
    expect(useBrowserTabStore.getState().byTab.get('browser-tab-1')?.state?.title).toBe('T')

    emit('focus', { tabId: 'browser-tab-1', pageFocused: true })
    expect(useBrowserTabStore.getState().byTab.get('browser-tab-1')?.pageFocused).toBe(true)

    emit('notice', { tabId: null, kind: 'localAddressSeen', text: 'http://localhost:5173/' })
    emit('notice', { tabId: null, kind: 'downloadDone', text: 'file.zip' })
    expect(useBrowserTabStore.getState().localAddresses).toEqual(['http://localhost:5173/'])

    const added = { tabId: 'browser-tab-2', openerTabId: 'browser-tab-1', background: true }
    emit('tabAdded', added)
    expect(openPageTab).toHaveBeenCalledExactlyOnceWith(added)

    dispose()
    expect(unsubscribed.sort()).toEqual(['focus', 'notice', 'state', 'tabAdded'])
  })

  it('every callback returns nothing, so the context bridge never clones a panel', () => {
    // A returned value crosses the bridge and is cloned; a dockview panel
    // cannot be, and the throw stops the other listeners on the channel.
    const panel = { api: { close: () => undefined } }
    mountBrowserTabEvents({ openPageTab: vi.fn(() => panel) as never })
    const results = [
      listeners.get('state')?.({ tabId: 'browser-tab-1', title: 'T', erfanaPage: null } as never),
      listeners.get('focus')?.({ tabId: 'browser-tab-1', pageFocused: true } as never),
      listeners.get('notice')?.({ tabId: null, kind: 'localAddressSeen', text: 'http://localhost:1/' } as never),
      listeners.get('tabAdded')?.({ tabId: 'browser-tab-2', openerTabId: 'browser-tab-1', background: false } as never)
    ]
    expect(results).toEqual([undefined, undefined, undefined, undefined])
  })
})
