// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pick-and-send channels (spec 025 § 8, commits 14–15): trust and payload
 * checks, the tab from the sender's window, the terminal checked against the
 * sender, and answers that never throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handles, removed, logger } = vi.hoisted(() => ({
  handles: new Map<string, (...args: unknown[]) => unknown>(),
  removed: [] as string[],
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: vi.fn(() => null) } }))
vi.mock('../../services/LoggingService', () => ({ logger }))
vi.mock('../registry', () => ({
  registerHandle: (c: string, l: (...a: unknown[]) => unknown) => handles.set(c, l),
  unregisterHandle: (c: string) => removed.push(c)
}))

import { BrowserWindow } from 'electron'
import { BROWSER_TAB_PICK_CHANNELS, registerBrowserTabPickHandlers } from './pick-handlers'

const TAB = 'browser-tab-1'
const CAPTURE = 'a'.repeat(32)
const SENDER = 77

let pickState = false
const input = {
  state: vi.fn(() => ({ pick: pickState })),
  dispatch: vi.fn(() => {
    pickState = !pickState
    return []
  })
}
const stillImage = { toBitmap: () => Buffer.alloc(16, 255), getSize: () => ({ width: 2, height: 2 }) }
const tab = { id: TAB, contents: { isDestroyed: () => false, capturePage: vi.fn(async () => stillImage) } }
const pick = { capture: { id: CAPTURE } as { id: string } | null, refine: vi.fn(), close: vi.fn(() => true) }
const tabs = { tabOf: vi.fn((w: number, id: string) => (w === 3 && id === TAB ? tab : null)), inputFor: vi.fn(() => input as unknown) }
const picks = {
  forTab: vi.fn(() => pick as unknown),
  writeCapture: vi.fn(async () => ({ paths: { context: 'a.md', screenshot: 'a.png', crop: 'a-crop.png' } })),
  discardCaptureFiles: vi.fn(async () => true),
  targetStatus: vi.fn(() => ({ kind: 'agent' as const, process: null, fresh: true }))
}

const event = (trusted = true) => ({ sender: { id: SENDER }, trusted })
const call = (channel: string, e: unknown, arg: unknown) => handles.get(channel)!(e, arg)

beforeEach(() => {
  handles.clear()
  removed.length = 0
  vi.clearAllMocks()
  pickState = false
  pick.capture = { id: CAPTURE }
  registerBrowserTabPickHandlers({
    tabs: tabs as never,
    picks: picks as never,
    isTrustedSender: (e) => (e as unknown as { trusted: boolean }).trusted,
    resolveWindowId: () => 3
  })
})

describe('registerBrowserTabPickHandlers', () => {
  it('registers every pick channel and removes them all', () => {
    expect([...handles.keys()].sort()).toEqual([...BROWSER_TAB_PICK_CHANNELS].sort())
    registerBrowserTabPickHandlers({ tabs: tabs as never, picks: picks as never })()
    expect(removed.sort()).toEqual([...BROWSER_TAB_PICK_CHANNELS].sort())
  })

  it('pickMode toggles through the routing only when the state differs', () => {
    expect(call('browser-tab:pickMode', event(), { tabId: TAB, on: true })).toEqual({ ok: true })
    expect(input.dispatch).toHaveBeenCalledWith({ type: 'pickButton' })
    expect(call('browser-tab:pickMode', event(), { tabId: TAB, on: true })).toEqual({ ok: true })
    expect(input.dispatch).toHaveBeenCalledTimes(1)
  })

  it('pickMode refuses an untrusted sender, a bad payload, another window\'s tab, a tab without pick or routing', () => {
    expect(call('browser-tab:pickMode', event(false), { tabId: TAB, on: true })).toEqual({ ok: false })
    expect(logger.warn).toHaveBeenCalledWith('Rejected a browser tab request from an untrusted sender', { channel: 'browser-tab:pickMode' })
    expect(call('browser-tab:pickMode', event(), { tabId: TAB, on: 'yes' })).toEqual({ ok: false })
    expect(call('browser-tab:pickMode', event(), { tabId: 'browser-tab-2', on: true })).toEqual({ ok: false })
    picks.forTab.mockReturnValueOnce(null)
    expect(call('browser-tab:pickMode', event(), { tabId: TAB, on: true })).toEqual({ ok: false })
    tabs.inputFor.mockReturnValueOnce(null)
    expect(call('browser-tab:pickMode', event(), { tabId: TAB, on: true })).toEqual({ ok: false })
    expect(input.dispatch).not.toHaveBeenCalled()
  })

  it('pickMode never throws: a failure is logged and refused', () => {
    input.dispatch.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(call('browser-tab:pickMode', event(), { tabId: TAB, on: true })).toEqual({ ok: false })
    expect(logger.error).toHaveBeenCalledWith('Browser tab request failed', expect.anything(), { channel: 'browser-tab:pickMode' })
  })

  it('refine moves the held capture only, and refuses another capture id', () => {
    expect(call('browser-tab:refine', event(), { tabId: TAB, captureId: CAPTURE, move: 'parent' })).toEqual({ ok: true })
    expect(pick.refine).toHaveBeenCalledWith('parent')
    expect(call('browser-tab:refine', event(), { tabId: TAB, captureId: 'b'.repeat(32), move: 'parent' })).toEqual({ ok: false })
    pick.capture = null
    expect(call('browser-tab:refine', event(), { tabId: TAB, captureId: CAPTURE, move: { ancestor: 1 } })).toEqual({ ok: false })
  })

  it('closePick passes the reason, sent included', () => {
    expect(call('browser-tab:closePick', event(), { tabId: TAB, captureId: CAPTURE, reason: 'sent' })).toEqual({ ok: true })
    expect(pick.close).toHaveBeenCalledWith(CAPTURE, 'sent')
    expect(call('browser-tab:closePick', event(), { tabId: TAB, captureId: CAPTURE, reason: 'later' })).toEqual({ ok: false })
  })

  it('writeCapture checks the terminal against the sender\'s own webContents, never the payload', async () => {
    const request = { tabId: TAB, captureId: CAPTURE, terminalId: 'terminal-1' }
    expect(await call('browser-tab:writeCapture', event(), request)).toEqual({ paths: { context: 'a.md', screenshot: 'a.png', crop: 'a-crop.png' } })
    expect(picks.writeCapture).toHaveBeenCalledWith(tab, pick, SENDER, request)
    expect(await call('browser-tab:writeCapture', event(), { ...request, sendAnyway: false })).toEqual({ error: 'Request refused' })
    expect(await call('browser-tab:writeCapture', event(false), request)).toEqual({ error: 'Request refused' })
    picks.writeCapture.mockRejectedValueOnce(new Error('disk'))
    expect(await call('browser-tab:writeCapture', event(), request)).toEqual({ error: 'The capture could not be saved' })
  })

  it('discardCaptureFiles answers whether files were discarded, never throwing', async () => {
    expect(await call('browser-tab:discardCaptureFiles', event(), { tabId: TAB, captureId: CAPTURE })).toEqual({ ok: true })
    expect(await call('browser-tab:discardCaptureFiles', event(), { tabId: TAB })).toEqual({ ok: false })
    picks.discardCaptureFiles.mockRejectedValueOnce(new Error('disk'))
    expect(await call('browser-tab:discardCaptureFiles', event(), { tabId: TAB, captureId: CAPTURE })).toEqual({ ok: false })
  })

  it('targetStatus asks for the sender\'s terminal; a refusal or failure reads unknown and not fresh', () => {
    expect(call('browser-tab:targetStatus', event(), { terminalId: 'terminal-1' })).toEqual({ kind: 'agent', process: null, fresh: true })
    expect(picks.targetStatus).toHaveBeenCalledWith(SENDER, 'terminal-1')
    const unknown = { kind: 'unknown', process: null, fresh: false }
    expect(call('browser-tab:targetStatus', event(), { terminalId: 'bash' })).toEqual(unknown)
    picks.targetStatus.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(call('browser-tab:targetStatus', event(), { terminalId: 'terminal-1' })).toEqual(unknown)
  })

  it('resolves the window from the sender by default, and refuses a sender with no window', () => {
    handles.clear()
    registerBrowserTabPickHandlers({ tabs: tabs as never, picks: picks as never, isTrustedSender: () => true })
    expect(call('browser-tab:pickMode', event(), { tabId: TAB, on: true })).toEqual({ ok: false })
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce({ id: 3, isDestroyed: () => false } as never)
    expect(call('browser-tab:pickMode', event(), { tabId: TAB, on: true })).toEqual({ ok: true })
  })

  it('pickSurface moves the held capture between the panel and the dialog, and refuses a stale capture', () => {
    expect(call('browser-tab:pickSurface', event(), { tabId: TAB, captureId: CAPTURE, surface: 'dialog' })).toEqual({ ok: true })
    expect(input.dispatch).toHaveBeenLastCalledWith({ type: 'dialogOpen' })
    expect(call('browser-tab:pickSurface', event(), { tabId: TAB, captureId: CAPTURE, surface: 'menu' })).toEqual({ ok: true })
    expect(input.dispatch).toHaveBeenLastCalledWith({ type: 'dialogBack' })
    expect(call('browser-tab:pickSurface', event(), { tabId: TAB, captureId: 'b'.repeat(32), surface: 'menu' })).toEqual({ ok: false })
    expect(call('browser-tab:pickSurface', event(), { tabId: TAB, captureId: CAPTURE, surface: 'sheet' })).toEqual({ ok: false })
    tabs.inputFor.mockReturnValueOnce(null)
    expect(call('browser-tab:pickSurface', event(), { tabId: TAB, captureId: CAPTURE, surface: 'menu' })).toEqual({ ok: false })
  })

  it('still answers the page as a bitmap, and an error for a refused request or a failed capture', async () => {
    expect(await call('browser-tab:still', event(), { tabId: TAB })).toMatchObject({ width: 2, height: 2 })
    expect(await call('browser-tab:still', event(false), { tabId: TAB })).toEqual({ error: 'Request refused' })
    expect(await call('browser-tab:still', event(), { tabId: 'browser-tab-9' })).toEqual({ error: 'Request refused' })
    tab.contents.capturePage.mockRejectedValueOnce(new Error('gone'))
    expect(await call('browser-tab:still', event(), { tabId: TAB })).toEqual({ error: 'The page could not be captured' })
    expect(logger.error).toHaveBeenCalled()
  })
})
