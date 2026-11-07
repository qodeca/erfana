// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preload bridge for the built-in browser's tabs (spec 025, § 8): every
 * request verb is called, with its channel and wrapped payload pinned and the
 * payload checked against the schema main validates with; every `onX` is
 * subscribed, delivered to and unsubscribed.
 *
 * @see browserTabBridge.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BROWSER_TAB_CHANNELS as C, BROWSER_TAB_EVENTS as E } from '../shared/ipc/browser-tab-channels'
import {
  CertificateRequestSchema,
  CloseRequestSchema,
  CreateRequestSchema,
  OpenExternalRequestSchema,
  DevToolsRequestSchema,
  FocusOriginRequestSchema,
  FocusPageRequestSchema,
  HistoryRequestSchema,
  OpenLocalFileRequestSchema,
  ShowDownloadRequestSchema,
  ToolbarFocusRequestSchema
} from '../shared/ipc/browser-tab-schema'
import { browserTabBridge } from './browserTabBridge'

type Listener = (event: unknown, payload: unknown) => void

const ipc = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>()
  return {
    listeners,
    on: vi.fn((channel: string, listener: Listener) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
    }),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      listeners.set(
        channel,
        (listeners.get(channel) ?? []).filter((registered) => registered !== listener)
      )
    }),
    invoke: vi.fn(),
    send: vi.fn(),
    emit(channel: string, payload: unknown): void {
      for (const listener of listeners.get(channel) ?? []) listener({}, payload)
    }
  }
})

vi.mock('electron', () => ({
  ipcRenderer: { on: ipc.on, removeListener: ipc.removeListener, invoke: ipc.invoke, send: ipc.send }
}))

const TAB = 'browser-tab-3'

beforeEach(() => {
  ipc.listeners.clear()
  ipc.on.mockClear()
  ipc.removeListener.mockClear()
  ipc.invoke.mockReset()
  ipc.send.mockReset()
})

describe('browserTabBridge requests', () => {
  it('wraps each request in the payload main validates, on its own channel', async () => {
    ipc.invoke.mockResolvedValue('answer')
    expect(await browserTabBridge.create('panel-1')).toBe('answer')
    await browserTabBridge.close(TAB)
    await browserTabBridge.history(TAB, 'reload')
    await browserTabBridge.focusPage(TAB)
    await browserTabBridge.devTools(TAB)
    await browserTabBridge.devTools(TAB, { x: 10, y: 20 })

    expect(ipc.invoke.mock.calls).toEqual([
      [C.create, { panelId: 'panel-1' }],
      [C.close, { tabId: TAB }],
      [C.history, { tabId: TAB, step: 'reload' }],
      [C.focusPage, { tabId: TAB }],
      [C.devTools, { tabId: TAB }],
      [C.devTools, { tabId: TAB, inspectAt: { x: 10, y: 20 } }]
    ])
    const [create, close, history, focus, devTools, inspect] = ipc.invoke.mock.calls.map((call) => call[1])
    expect(CreateRequestSchema.safeParse(create).success).toBe(true)
    expect(CloseRequestSchema.safeParse(close).success).toBe(true)
    expect(HistoryRequestSchema.safeParse(history).success).toBe(true)
    expect(FocusPageRequestSchema.safeParse(focus).success).toBe(true)
    expect(DevToolsRequestSchema.safeParse(devTools).success).toBe(true)
    expect(DevToolsRequestSchema.safeParse(inspect).success).toBe(true)
  })

  it('sends strip answers and Show in folder on their own channels', async () => {
    const answer = { tabId: TAB, requestId: 'row-1', answer: 'allow' } as unknown as Parameters<
      typeof browserTabBridge.answerStrip
    >[0]
    await browserTabBridge.answerStrip(answer)
    await browserTabBridge.showDownload('dl-1')
    expect(ipc.invoke.mock.calls).toEqual([
      [C.answerStrip, answer],
      [C.showDownload, { downloadId: 'dl-1' }]
    ])
    expect(ShowDownloadRequestSchema.safeParse({ downloadId: 'dl-1' }).success).toBe(true)
  })

  it('sends a certificate page decision on its own channel', async () => {
    const decision = { tabId: TAB, decisionId: 'd-1', proceed: true }
    await browserTabBridge.certificate(decision)
    expect(ipc.invoke).toHaveBeenCalledWith(C.certificate, decision)
    expect(CertificateRequestSchema.safeParse(decision).success).toBe(true)
  })

  it('passes a navigate request through unchanged', async () => {
    const request = { tabId: TAB, input: 'example.test', source: 'address' } as unknown as Parameters<
      typeof browserTabBridge.navigate
    >[0]
    await browserTabBridge.navigate(request)
    expect(ipc.invoke).toHaveBeenCalledWith(C.navigate, request)
  })

  it('wraps openLocalFile in the payload main validates', async () => {
    await browserTabBridge.openLocalFile(TAB, '/p/site/index.html')
    expect(ipc.invoke).toHaveBeenCalledWith(C.openLocalFile, { tabId: TAB, filePath: '/p/site/index.html' })
    expect(OpenLocalFileRequestSchema.safeParse(ipc.invoke.mock.calls[0]![1]).success).toBe(true)
  })

  it('sends bounds fire-and-forget, never through invoke', () => {
    const request = { tabId: TAB, seq: 1 } as unknown as Parameters<typeof browserTabBridge.setBounds>[0]
    expect(browserTabBridge.setBounds(request)).toBeUndefined()
    expect(ipc.send).toHaveBeenCalledWith(C.bounds, request)
    expect(ipc.invoke).not.toHaveBeenCalled()
  })

  it('sends where focus came from through invoke and toolbar focus fire-and-forget', async () => {
    await browserTabBridge.focusOrigin(TAB, 'toolbar')
    expect(browserTabBridge.toolbarFocus(TAB, true)).toBeUndefined()
    expect(ipc.invoke.mock.calls).toEqual([[C.focusOrigin, { tabId: TAB, from: 'toolbar' }]])
    expect(ipc.send.mock.calls).toEqual([[C.toolbarFocus, { tabId: TAB, focused: true }]])
    expect(FocusOriginRequestSchema.safeParse(ipc.invoke.mock.calls[0]![1]).success).toBe(true)
    expect(ToolbarFocusRequestSchema.safeParse(ipc.send.mock.calls[0]![1]).success).toBe(true)
  })
})

describe('browserTabBridge page features and the page menu', () => {
  type Bridge = typeof browserTabBridge
  it('wraps find, zoom, width presets, Clear, Forget, suggestions and menu actions on their own channels', async () => {
    const find = { tabId: TAB, text: 'needle', forward: true, findNext: true, matchCase: false } as unknown as Parameters<Bridge['find']>[0]
    const action = { tabId: TAB, menuId: 'menu-1', action: 'reload' } as unknown as Parameters<Bridge['contextAction']>[0]
    await browserTabBridge.find(find)
    await browserTabBridge.stopFind(TAB)
    await browserTabBridge.zoom(TAB, 'in')
    await browserTabBridge.widthPreset(TAB, 'mobile' as Parameters<Bridge['widthPreset']>[1])
    await browserTabBridge.clearData(['cookies'] as unknown as Parameters<Bridge['clearData']>[0])
    await browserTabBridge.forget()
    await browserTabBridge.suggest('app')
    await browserTabBridge.contextAction(action)
    await browserTabBridge.pageClipboard()
    expect(ipc.invoke.mock.calls).toEqual([
      [C.find, find],
      [C.stopFind, { tabId: TAB }],
      [C.zoom, { tabId: TAB, step: 'in' }],
      [C.widthPreset, { tabId: TAB, preset: 'mobile' }],
      [C.clearData, { categories: ['cookies'] }],
      [C.forget, {}],
      [C.suggest, { prefix: 'app' }],
      [C.contextAction, action],
      [C.pageClipboard, {}]
    ])
  })
})

describe('browserTabBridge events', () => {
  it.each([
    ['onState', E.state],
    ['onTabAdded', E.tabAdded],
    ['onStrip', E.strip],
    ['onNotice', E.notice],
    ['onBoundsApplied', E.boundsApplied],
    ['onFocus', E.focus],
    ['onForwardedKey', E.forwardedKey],
    ['onPick', E.pick],
    ['onFindResult', E.findResult],
    ['onContextMenu', E.contextMenu],
    ['onTabClosed', E.tabClosed],
    ['onNewTabCommand', E.newTabCommand]
  ] as const)('%s delivers events until unsubscribed', (member, channel) => {
    const callback = vi.fn()
    const unsubscribe = browserTabBridge[member](callback)
    ipc.emit(channel, { tabId: TAB })
    expect(callback).toHaveBeenCalledWith({ tabId: TAB })
    expect(unsubscribe()).toBeUndefined()
    ipc.emit(channel, { tabId: TAB })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(ipc.removeListener).toHaveBeenCalledWith(channel, expect.any(Function))
  })
})

describe('browserTabBridge commit 18 requests', () => {
  it('close carries byUser only when given; openExternal carries url only when given', async () => {
    ipc.invoke.mockResolvedValue(true)
    expect(await browserTabBridge.close(TAB, false)).toBe(true)
    await browserTabBridge.openExternal(TAB)
    await browserTabBridge.openExternal(TAB, 'https://a.test/')
    expect(ipc.invoke.mock.calls).toEqual([
      [C.close, { tabId: TAB, byUser: false }],
      [C.openExternal, { tabId: TAB }],
      [C.openExternal, { tabId: TAB, url: 'https://a.test/' }]
    ])
    expect(CloseRequestSchema.safeParse(ipc.invoke.mock.calls[0]![1]).success).toBe(true)
    expect(OpenExternalRequestSchema.safeParse(ipc.invoke.mock.calls[2]![1]).success).toBe(true)
  })
})
