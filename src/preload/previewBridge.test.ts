// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the preload preview bridge (issue #124, WI-7).
 *
 * Pins the members #124 adds – `navigate`, `onPageChanged`, `onResizeHold` and
 * the `settled` flag on `setBounds` – and that what the bridge sends is what
 * the shared schema main validates with will accept. A steady-state bounds push
 * must stay byte-identical to what it was before any flag existed: the bounds
 * pump sends one every frame while a panel resizes.
 *
 * Then the whole surface, because asserting a member EXISTS never runs it: every
 * request verb is called (channel and wrapped payload pinned) and every `onX` is
 * subscribed, delivered to, and unsubscribed – which is the only way the
 * unsubscribe closures each one returns are ever executed.
 *
 * @see previewBridge.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PreviewChannels, PreviewEvents } from '../shared/ipc/preview-channels'
import { PreviewNavigateRequestSchema } from '../shared/ipc/preview-navigation-schema'
import { PreviewSetBoundsSchema } from '../shared/ipc/preview-schema'
import type { PreviewBridge } from '../shared/ipc/preview-bridge-types'
import { previewBridge } from './previewBridge'

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
  ipcRenderer: {
    on: ipc.on,
    removeListener: ipc.removeListener,
    invoke: ipc.invoke,
    send: ipc.send
  }
}))

const PANEL_ID = 'preview-1'
const BOUNDS = { x: 1, y: 2, width: 300, height: 200 }
/** A find request in the shape `PreviewFindRequestSchema` accepts; the bridge passes it through. */
const FIND_REQUEST = { panelId: PANEL_ID, text: 'erfana', forward: true, findNext: false, matchCase: false }

/** The payload of the most recent `send`. */
function lastSent(): unknown {
  return ipc.send.mock.calls.at(-1)?.[1]
}

beforeEach(() => {
  ipc.listeners.clear()
  ipc.on.mockClear()
  ipc.removeListener.mockClear()
  ipc.invoke.mockReset()
  ipc.send.mockReset()
})

describe('previewBridge.setBounds', () => {
  it('sends a plain push byte-identical to the one before any flag existed', () => {
    previewBridge.setBounds(PANEL_ID, BOUNDS, 7)
    expect(ipc.send.mock.calls[0][0]).toBe(PreviewChannels.SET_BOUNDS)
    expect(JSON.stringify(lastSent())).toBe(
      JSON.stringify({ panelId: PANEL_ID, bounds: BOUNDS, seq: 7 })
    )
  })

  it('never sends a flag as false', () => {
    previewBridge.setBounds(PANEL_ID, BOUNDS, 7, { ack: false, settled: false })
    expect(JSON.stringify(lastSent())).toBe(
      JSON.stringify({ panelId: PANEL_ID, bounds: BOUNDS, seq: 7 })
    )
  })

  it('adds `settled: true` to the push that ends a resize hold', () => {
    previewBridge.setBounds(PANEL_ID, BOUNDS, 8, { settled: true })
    expect(lastSent()).toEqual({ panelId: PANEL_ID, bounds: BOUNDS, seq: 8, settled: true })
  })

  it('keeps `ack` as before, alone or with `settled`', () => {
    previewBridge.setBounds(PANEL_ID, BOUNDS, 9, { ack: true })
    expect(lastSent()).toEqual({ panelId: PANEL_ID, bounds: BOUNDS, seq: 9, ack: true })
    previewBridge.setBounds(PANEL_ID, BOUNDS, 10, { ack: true, settled: true })
    expect(lastSent()).toEqual({
      panelId: PANEL_ID,
      bounds: BOUNDS,
      seq: 10,
      ack: true,
      settled: true
    })
  })

  it('only sends pushes the main-side schema accepts', () => {
    previewBridge.setBounds(PANEL_ID, BOUNDS, 1)
    previewBridge.setBounds(PANEL_ID, BOUNDS, 2, { settled: true })
    previewBridge.setBounds(PANEL_ID, BOUNDS, 3, { ack: true, settled: true })
    for (const [, payload] of ipc.send.mock.calls) {
      expect(PreviewSetBoundsSchema.safeParse(payload).success).toBe(true)
    }
  })
})

describe('previewBridge.navigate', () => {
  it("invokes preview:navigate with the request as given and returns main's answer", async () => {
    const answer = { ok: true, target: { filePath: '/p/b.html', anchor: null }, generation: 2 }
    ipc.invoke.mockResolvedValueOnce(answer)
    const request = {
      panelId: PANEL_ID,
      phase: 'check',
      action: 'open',
      filePath: '/p/b.html',
      anchor: null
    } as const

    await expect(previewBridge.navigate(request)).resolves.toBe(answer)
    expect(ipc.invoke).toHaveBeenCalledWith(PreviewChannels.NAVIGATE, request)
  })

  it('passes a refusal through untouched, with the new history', async () => {
    const refusal = {
      ok: false,
      errorCode: 'PREVIEW_NAV_TARGET_MISSING',
      history: {
        canGoBack: true,
        canGoForward: false,
        backTarget: { filePath: '/p/x.html', anchor: null },
        forwardTarget: null,
        generation: 6
      }
    }
    ipc.invoke.mockResolvedValueOnce(refusal)

    await expect(
      previewBridge.navigate({ panelId: PANEL_ID, phase: 'check', action: 'back', generation: 5 })
    ).resolves.toBe(refusal)
  })

  it('sends requests the main-side schema accepts', async () => {
    ipc.invoke.mockResolvedValue({ ok: false, errorCode: 'PREVIEW_NAV_SKIPPED' })
    await previewBridge.navigate({
      panelId: PANEL_ID,
      phase: 'check',
      action: 'open',
      filePath: '/p/b.html',
      anchor: 'plans'
    })
    await previewBridge.navigate({ panelId: PANEL_ID, phase: 'commit', action: 'back', generation: 5 })

    expect(ipc.invoke).toHaveBeenCalledTimes(2)
    for (const [channel, payload] of ipc.invoke.mock.calls) {
      expect(channel).toBe(PreviewChannels.NAVIGATE)
      expect(PreviewNavigateRequestSchema.safeParse(payload).success).toBe(true)
    }
  })
})

const PAGE_CHANGED = {
  panelId: PANEL_ID,
  filePath: '/p/b.html',
  anchor: null,
  sameDocument: false,
  generation: 3,
  canGoBack: true,
  canGoForward: false,
  backTarget: { filePath: '/p/a.html', anchor: null },
  forwardTarget: null,
  failed: false
}

/**
 * Every event subscription, table-driven.
 *
 * `subscribe()` in the bridge is one shared helper, but each `onX` is its own
 * arrow function and each returns its own unsubscribe closure, so only calling
 * every one of them runs every one of them. Each row pins four things: the
 * channel registered on, delivery of the payload, that the unsubscribe removes
 * the very listener that was added, and that the bridge is a PIPE – it does no
 * validation, so whatever main sends reaches the callback unchanged.
 */
const EVENT_MEMBERS = [
  {
    method: 'onFailuresChanged',
    channel: PreviewEvents.FAILURES_CHANGED,
    payload: { panelId: PANEL_ID, failures: [], truncated: false }
  },
  {
    method: 'onHostBlocked',
    channel: PreviewEvents.HOST_BLOCKED,
    payload: { panelId: PANEL_ID, host: 'cdn.example.com', kinds: ['script'] }
  },
  {
    method: 'onVisibilityApplied',
    channel: PreviewEvents.VISIBILITY_APPLIED,
    payload: { panelId: PANEL_ID, visible: false, reason: 'tab-hidden' }
  },
  {
    method: 'onAllowlistChanged',
    channel: PreviewEvents.ALLOWLIST_CHANGED,
    payload: { panelId: PANEL_ID, hosts: ['cdn.example.com'] }
  },
  {
    method: 'onFindResult',
    channel: PreviewEvents.FIND_RESULT,
    payload: { panelId: PANEL_ID, activeMatchOrdinal: 1, matches: 3, finalUpdate: true }
  },
  {
    method: 'onStillFrameChanged',
    channel: PreviewEvents.STILL_FRAME_CHANGED,
    payload: { panelId: PANEL_ID, dataUrl: 'data:image/png;base64,AA==' }
  },
  {
    method: 'onLoadStateChanged',
    channel: PreviewEvents.LOAD_STATE_CHANGED,
    payload: { panelId: PANEL_ID, state: 'loaded' }
  },
  {
    method: 'onBackdropChanged',
    channel: PreviewEvents.BACKDROP_CHANGED,
    payload: { panelId: PANEL_ID, color: '#101014' }
  },
  {
    method: 'onBoundsApplied',
    channel: PreviewEvents.BOUNDS_APPLIED,
    payload: { panelId: PANEL_ID, seq: 12 }
  },
  {
    method: 'onForwardedShortcut',
    channel: PreviewEvents.FORWARDED_SHORTCUT,
    payload: { panelId: PANEL_ID, shortcut: 'find' }
  },
  {
    method: 'onOpenFileRequested',
    channel: PreviewEvents.OPEN_FILE_REQUESTED,
    payload: { panelId: PANEL_ID, filePath: '/p/notes.md' }
  },
  { method: 'onPageChanged', channel: PreviewEvents.PAGE_CHANGED, payload: PAGE_CHANGED },
  {
    method: 'onResizeHold',
    channel: PreviewEvents.RESIZE_HOLD,
    payload: { panelId: PANEL_ID, held: true }
  }
] as const

type SubscribeFn = (callback: (payload: unknown) => void) => () => void

/** A subscription member, cast to the one shape every row of the table shares. */
function subscriber(method: (typeof EVENT_MEMBERS)[number]['method']): SubscribeFn {
  return previewBridge[method] as unknown as SubscribeFn
}

describe.each(EVENT_MEMBERS)('previewBridge.$method', ({ method, channel, payload }) => {
  it(`registers its listener on ${channel}`, () => {
    subscriber(method)(vi.fn())
    expect(ipc.on).toHaveBeenCalledTimes(1)
    expect(ipc.on.mock.calls[0][0]).toBe(channel)
  })

  it('delivers the payload to the callback, and only the payload', () => {
    const callback = vi.fn()
    subscriber(method)(callback)

    ipc.emit(channel, payload)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(payload)
    // The IpcRendererEvent is swallowed by the wrapper: one argument reaches
    // the renderer, never the event object.
    expect(callback.mock.calls[0]).toHaveLength(1)
  })

  it('delivers to every subscriber, and each gets its own listener', () => {
    const first = vi.fn()
    const second = vi.fn()
    subscriber(method)(first)
    subscriber(method)(second)

    expect(ipc.on.mock.calls[0][1]).not.toBe(ipc.on.mock.calls[1][1])
    ipc.emit(channel, payload)
    expect(first).toHaveBeenCalledWith(payload)
    expect(second).toHaveBeenCalledWith(payload)
  })

  it('unsubscribes the very listener it registered, and stops delivery', () => {
    const callback = vi.fn()
    const unsubscribe = subscriber(method)(callback)
    const registered = ipc.on.mock.calls.at(-1)?.[1]

    unsubscribe()

    expect(ipc.removeListener).toHaveBeenCalledWith(channel, registered)
    ipc.emit(channel, payload)
    expect(callback).not.toHaveBeenCalled()
  })

  it('leaves a second subscriber alive when the first unsubscribes', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscriber(method)(first)
    subscriber(method)(second)

    unsubscribeFirst()
    ipc.emit(channel, payload)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(payload)
  })

  it('passes a malformed payload straight through – the bridge does not validate', () => {
    const callback = vi.fn()
    subscriber(method)(callback)

    ipc.emit(channel, undefined)
    ipc.emit(channel, { nonsense: true })

    // Pinned as the bridge really behaves, not as a wish: `subscribe()` is a
    // pipe. Main-side schemas gate what is SENT; nothing re-checks it here, so
    // every renderer consumer owns its own defence.
    expect(callback).toHaveBeenNthCalledWith(1, undefined)
    expect(callback).toHaveBeenNthCalledWith(2, { nonsense: true })
  })
})

/**
 * Every request member, table-driven.
 *
 * Pins the channel each verb lands on and the exact payload shape it wraps its
 * arguments in – the half of the contract a renderer caller cannot see, and the
 * half main's schemas reject when it drifts.
 */
describe.each([
  {
    name: 'checkEligibility',
    call: () => previewBridge.checkEligibility('/p/a.html'),
    channel: PreviewChannels.CHECK_ELIGIBILITY,
    payload: { filePath: '/p/a.html' }
  },
  {
    name: 'open',
    call: () => previewBridge.open({ panelId: PANEL_ID, filePath: '/p/a.html', bounds: BOUNDS }),
    channel: PreviewChannels.OPEN,
    payload: { panelId: PANEL_ID, filePath: '/p/a.html', bounds: BOUNDS }
  },
  {
    name: 'close',
    call: () => previewBridge.close(PANEL_ID),
    channel: PreviewChannels.CLOSE,
    payload: { panelId: PANEL_ID }
  },
  {
    name: 'reload',
    call: () => previewBridge.reload(PANEL_ID),
    channel: PreviewChannels.RELOAD,
    payload: { panelId: PANEL_ID }
  },
  {
    name: 'reload with ignoreCache',
    call: () => previewBridge.reload(PANEL_ID, { ignoreCache: true }),
    channel: PreviewChannels.RELOAD,
    payload: { panelId: PANEL_ID, ignoreCache: true }
  },
  {
    name: 'reload with ignoreCache: false',
    call: () => previewBridge.reload(PANEL_ID, { ignoreCache: false }),
    channel: PreviewChannels.RELOAD,
    payload: { panelId: PANEL_ID, ignoreCache: false }
  },
  {
    name: 'approveHost',
    call: () => previewBridge.approveHost(PANEL_ID, 'cdn.example.com'),
    channel: PreviewChannels.APPROVE_HOST,
    payload: { panelId: PANEL_ID, host: 'cdn.example.com' }
  },
  {
    name: 'find',
    call: () => previewBridge.find(FIND_REQUEST),
    channel: PreviewChannels.FIND,
    payload: FIND_REQUEST
  },
  {
    name: 'stopFind',
    call: () => previewBridge.stopFind(PANEL_ID),
    channel: PreviewChannels.STOP_FIND,
    payload: { panelId: PANEL_ID }
  },
  {
    name: 'exportPdf',
    call: () => previewBridge.exportPdf(PANEL_ID),
    channel: PreviewChannels.EXPORT_PDF,
    payload: { panelId: PANEL_ID }
  },
  {
    name: 'focusPage',
    call: () => previewBridge.focusPage(PANEL_ID),
    channel: PreviewChannels.FOCUS_PAGE,
    payload: { panelId: PANEL_ID }
  }
])('previewBridge.$name', ({ call, channel, payload }) => {
  it(`invokes ${channel} with the payload the handler expects`, async () => {
    ipc.invoke.mockResolvedValueOnce(undefined)
    await call()
    expect(ipc.invoke).toHaveBeenCalledWith(channel, payload)
  })

  it("resolves with main's answer, untouched", async () => {
    const answer = { marker: 'from-main' }
    ipc.invoke.mockResolvedValueOnce(answer)
    await expect(call() as Promise<unknown>).resolves.toBe(answer)
  })

  it('lets a rejection from main propagate rather than swallowing it', async () => {
    ipc.invoke.mockRejectedValueOnce(new Error('no handler'))
    await expect(call() as Promise<unknown>).rejects.toThrow('no handler')
  })
})

describe('previewBridge.setVisibility', () => {
  it('sends panelId, visible and the diagnostic reason, fire-and-forget', () => {
    expect(previewBridge.setVisibility(PANEL_ID, false, 'tab-hidden')).toBeUndefined()
    expect(ipc.send).toHaveBeenCalledWith(PreviewChannels.SET_VISIBILITY, {
      panelId: PANEL_ID,
      visible: false,
      reason: 'tab-hidden'
    })
  })

  it('sends the show side with the same shape', () => {
    previewBridge.setVisibility(PANEL_ID, true, 'tab-activated')
    expect(lastSent()).toEqual({ panelId: PANEL_ID, visible: true, reason: 'tab-activated' })
  })
})

/**
 * The bridge's member list, pinned (QG-8 TQ3).
 *
 * The renderer panel suites drive a FAKE `window.api.preview`; nothing else
 * compares it with the real one, so a member renamed or dropped here left
 * every one of those suites green while the app broke. This is the runtime
 * half of the fix (the harness's `satisfies Window['api']['preview']` is the
 * compile-time half): the literal below is typed `Record<keyof PreviewBridge,
 * true>`, so removing a member from the contract is a TYPE error here, and
 * an implementation that stops exporting one is a test failure.
 */
const BRIDGE_MEMBERS: Record<keyof PreviewBridge, true> = {
  checkEligibility: true,
  open: true,
  close: true,
  setBounds: true,
  setVisibility: true,
  reload: true,
  approveHost: true,
  find: true,
  stopFind: true,
  exportPdf: true,
  navigate: true,
  focusPage: true,
  onFailuresChanged: true,
  onHostBlocked: true,
  onVisibilityApplied: true,
  onAllowlistChanged: true,
  onFindResult: true,
  onStillFrameChanged: true,
  onLoadStateChanged: true,
  onBackdropChanged: true,
  onBoundsApplied: true,
  onForwardedShortcut: true,
  onOpenFileRequested: true,
  onPageChanged: true,
  onResizeHold: true
}

describe('previewBridge surface', () => {
  it('exports exactly the members the contract declares, all callable', () => {
    expect(Object.keys(previewBridge).sort()).toEqual(Object.keys(BRIDGE_MEMBERS).sort())
    for (const member of Object.keys(BRIDGE_MEMBERS)) {
      expect(typeof (previewBridge as unknown as Record<string, unknown>)[member]).toBe('function')
    }
  })
})
