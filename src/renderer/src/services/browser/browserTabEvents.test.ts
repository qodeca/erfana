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
      onTabAdded: on('tabAdded'),
      onStrip: on('strip'),
      onFindResult: on('findResult'),
      onContextMenu: on('contextMenu'),
      onPick: on('pick'),
      onTabClosed: on('tabClosed'),
      onNewTabCommand: on('newTabCommand')
    }
  }
})

const lifecycle = vi.hoisted(() => ({ browserTabClosedByMain: vi.fn(() => 'returned') }))
vi.mock('./browserTabLifecycle', () => lifecycle)
const still = vi.hoisted(() => ({
  hold: vi.fn(async () => true),
  showPick: vi.fn(async () => true),
  release: vi.fn()
}))
vi.mock('./browserStill', () => ({ browserStill: still, PICK_STILL_HOLDER: 'pick', CONTEXT_MENU_STILL_HOLDER: 'contextMenu' }))
const toasts = vi.hoisted(() => ({ showErrorToast: vi.fn() }))
vi.mock('../../utils/toastHelpers', () => toasts)

import { mountBrowserTabEvents, type BrowserTabEventDeps } from './browserTabEvents'
import { useBrowserChromeStore } from '../../stores/useBrowserChromeStore'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'
import { useBrowserPickStore } from '../../stores/useBrowserPickStore'

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

function deps(patch: Partial<BrowserTabEventDeps> = {}): BrowserTabEventDeps {
  return { openPageTab: vi.fn(), removePanel: vi.fn(), newTabCommand: vi.fn(), ...patch }
}

describe('mountBrowserTabEvents', () => {
  it('feeds strip rows, find results and the page menu into the chrome store; tabClosed and the menu command to the window', async () => {
    const d = deps()
    mountBrowserTabEvents(d)
    const row = { requestId: 'r1', kind: 'hung', text: 'x', answers: ['wait'], takesFocus: false }
    emit('strip', { tabId: 'browser-tab-1', op: 'add', row })
    expect(useBrowserChromeStore.getState().rows.get('browser-tab-1')?.[0]?.row).toEqual(row)
    emit('findResult', { tabId: 'browser-tab-1', active: 1, total: 3 })
    expect(useBrowserChromeStore.getState().find.get('browser-tab-1')).toEqual({ tabId: 'browser-tab-1', active: 1, total: 3 })
    const menu = { tabId: 'browser-tab-1', menuId: 'm', items: ['reload'], linkOrigin: null, at: { x: 1, y: 2 } }
    emit('contextMenu', menu)
    // The menu waits for the page's still image (ADR 0011).
    expect(still.hold).toHaveBeenCalledWith('browser-tab-1', 'contextMenu')
    await vi.waitFor(() => expect(useBrowserChromeStore.getState().menu).toEqual(menu))
    emit('tabClosed', { tabId: 'browser-tab-1' })
    expect(lifecycle.browserTabClosedByMain).toHaveBeenCalledWith('browser-tab-1', d.removePanel)
    emit('newTabCommand', { byKey: true })
    expect(d.newTabCommand).toHaveBeenCalledWith(true)
    useBrowserChromeStore.getState().dropTab('browser-tab-1')
  })

  it('feeds state, focus and local addresses into the store, and page-opened tabs to the window', () => {
    const openPageTab = vi.fn()
    const dispose = mountBrowserTabEvents(deps({ openPageTab }))
    useBrowserTabStore.getState().attach('browser-panel-1', 'browser-tab-1')

    emit('state', { tabId: 'browser-tab-1', title: 'T', erfanaPage: null })
    expect(useBrowserTabStore.getState().byTab.get('browser-tab-1')?.state?.title).toBe('T')

    emit('focus', { tabId: 'browser-tab-1', pageFocused: true })
    expect(useBrowserTabStore.getState().byTab.get('browser-tab-1')?.pageFocused).toBe(true)

    emit('notice', { tabId: null, kind: 'localAddressSeen', text: 'http://localhost:5173/' })
    emit('notice', { tabId: null, kind: 'downloadDone', text: 'file.zip' })
    expect(useBrowserTabStore.getState().localAddresses).toEqual(['http://localhost:5173/'])
    // A download notice becomes a toast (025-FR-020, browserDownloadNotices.ts).
    emit('notice', {
      tabId: null,
      kind: 'downloadFailed',
      text: 'Couldn’t download file.zip. The disk is full. The partial file was deleted.',
      download: { fileName: 'file.zip', downloadId: null, reason: 'diskFull' }
    })
    expect(toasts.showErrorToast).toHaveBeenCalledWith('Couldn’t download file.zip', 'The disk is full. The partial file was deleted.')
    expect(useBrowserTabStore.getState().localAddresses).toEqual(['http://localhost:5173/'])

    const added = { tabId: 'browser-tab-2', openerTabId: 'browser-tab-1', background: true }
    emit('tabAdded', added)
    expect(openPageTab).toHaveBeenCalledExactlyOnceWith(added)

    dispose()
    expect(unsubscribed.sort()).toEqual([
      'contextMenu',
      'findResult',
      'focus',
      'newTabCommand',
      'notice',
      'pick',
      'state',
      'strip',
      'tabAdded',
      'tabClosed'
    ])
  })

  it('mirrors pick events, shows a capture as the still image, toasts a failed capture and lets an ended capture go', () => {
    mountBrowserTabEvents(deps())
    const summary = { name: 'button', size: '1 × 1', ancestors: [], box: { x: 0, y: 0, width: 1, height: 1 }, atTop: false, atStart: true, gone: false, changedAfterPick: false }
    const data = new Uint8Array(4)
    emit('pick', { tabId: 'browser-tab-1', kind: 'captured', captureId: 'a'.repeat(32), still: data, stillWidth: 1, stillHeight: 1, summary })
    expect(useBrowserPickStore.getState().byTab.get('browser-tab-1')?.capture?.captureId).toBe('a'.repeat(32))
    expect(still.showPick).toHaveBeenCalledWith('browser-tab-1', 'pick', { data, width: 1, height: 1 })
    emit('pick', { tabId: 'browser-tab-1', kind: 'ended', reason: 'pageChanged' })
    expect(still.release).not.toHaveBeenCalled()
    emit('pick', { tabId: 'browser-tab-1', kind: 'ended', reason: 'user' })
    expect(still.release).toHaveBeenCalledWith('browser-tab-1', 'pick')
    emit('pick', { tabId: 'browser-tab-1', kind: 'captureFailed', reason: 'The screenshot came back empty' })
    expect(toasts.showErrorToast).toHaveBeenCalledWith(
      "Couldn't capture this element",
      'The screenshot came back empty. Nothing was sent – pick it again.'
    )
    emit('tabClosed', { tabId: 'browser-tab-1' })
    expect(useBrowserPickStore.getState().byTab.has('browser-tab-1')).toBe(false)
  })

  it('every callback returns nothing, so the context bridge never clones a panel', () => {
    // A returned value crosses the bridge and is cloned; a dockview panel
    // cannot be, and the throw stops the other listeners on the channel.
    const panel = { api: { close: () => undefined } }
    mountBrowserTabEvents(deps({ openPageTab: vi.fn(() => panel) as never, removePanel: vi.fn(() => panel) as never }))
    const results = [
      listeners.get('state')?.({ tabId: 'browser-tab-1', title: 'T', erfanaPage: null } as never),
      listeners.get('focus')?.({ tabId: 'browser-tab-1', pageFocused: true } as never),
      listeners.get('notice')?.({ tabId: null, kind: 'localAddressSeen', text: 'http://localhost:1/' } as never),
      listeners.get('tabAdded')?.({ tabId: 'browser-tab-2', openerTabId: 'browser-tab-1', background: false } as never),
      listeners.get('tabClosed')?.({ tabId: 'browser-tab-2' } as never),
      listeners.get('newTabCommand')?.({ byKey: true } as never),
      listeners.get('pick')?.({ tabId: 'browser-tab-1', kind: 'mode', on: true } as never),
      listeners.get('contextMenu')?.({ tabId: 'browser-tab-1', menuId: 'm', items: [], linkOrigin: null, at: { x: 0, y: 0 } } as never)
    ]
    expect(results).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined])
  })
})
