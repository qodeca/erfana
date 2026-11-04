// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const { fromWebContents, logger } = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents } }))
vi.mock('../../services/LoggingService', () => ({ logger }))

import type { IpcMainInvokeEvent } from 'electron'
import { createTabGate, guarded, resolveWindowId } from './tabRequestGate'

const Schema = z.strictObject({ tabId: z.string(), n: z.number() })
const event = (trusted: boolean, window: number | null = 3) => ({ trusted, window, sender: { id: 9 } }) as unknown as IpcMainInvokeEvent
const info = (e: IpcMainInvokeEvent) => e as unknown as { trusted: boolean; window: number | null }

function gate() {
  const tabOf = vi.fn((windowId: number, tabId: string) => (windowId === 3 && tabId === 'mine' ? { id: tabId } : null))
  return {
    tabOf,
    gate: createTabGate<IpcMainInvokeEvent, number, { id: string }>({
      isTrusted: (e) => info(e).trusted,
      resolveWindow: (e) => info(e).window,
      tabOf
    })
  }
}

describe('tabRequestGate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a trusted sender with a valid payload, the window taken from the sender', () => {
    expect(gate().gate.accept('c', event(true), Schema, { tabId: 'any', n: 1 })).toEqual({ window: 3, data: { tabId: 'any', n: 1 } })
  })

  it('refuses an untrusted sender before parsing, and logs the channel only', () => {
    const parse = vi.spyOn(Schema, 'safeParse')
    expect(gate().gate.accept('c', event(false), Schema, { tabId: 'x', n: 1 })).toBeNull()
    expect(parse).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('Rejected a browser tab request from an untrusted sender', { channel: 'c' })
    parse.mockRestore()
  })

  it('refuses a payload that does not parse (strict: no extra keys) and a sender with no window', () => {
    const { gate: g } = gate()
    expect(g.accept('c', event(true), Schema, { tabId: 'x', n: 1, windowId: 4 })).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith('Rejected a browser tab request with an invalid payload', expect.objectContaining({ channel: 'c' }))
    expect(g.accept('c', event(true, null), Schema, { tabId: 'x', n: 1 })).toBeNull()
  })

  it('acceptTab answers only a tab the sender\'s window owns', () => {
    const { gate: g, tabOf } = gate()
    expect(g.acceptTab('c', event(true), Schema, { tabId: 'mine', n: 2 })).toEqual({ window: 3, tab: { id: 'mine' }, data: { tabId: 'mine', n: 2 } })
    expect(g.acceptTab('c', event(true), Schema, { tabId: 'other', n: 2 })).toBeNull()
    expect(g.acceptTab('c', event(true, 4), Schema, { tabId: 'mine', n: 2 })).toBeNull()
    expect(tabOf).toHaveBeenLastCalledWith(4, 'mine')
    tabOf.mockClear()
    expect(g.acceptTab('c', event(false), Schema, { tabId: 'mine', n: 2 })).toBeNull()
    expect(tabOf).not.toHaveBeenCalled()
  })

  it('acceptTab refuses every request when the gate has no tab lookup', () => {
    const noTabs = createTabGate<IpcMainInvokeEvent, number, never>({ isTrusted: () => true, resolveWindow: () => 3 })
    expect(noTabs.accept('c', event(true), Schema, { tabId: 'mine', n: 1 })).not.toBeNull()
    expect(noTabs.acceptTab('c', event(true), Schema, { tabId: 'mine', n: 1 })).toBeNull()
  })

  it('guarded returns the result, or logs a throw and returns the fallback', () => {
    expect(guarded('c', 0, () => 5)).toBe(5)
    expect(guarded('c', 'fallback', () => {
      throw new Error('boom')
    })).toBe('fallback')
    expect(logger.error).toHaveBeenCalledWith('Browser tab request failed', expect.any(Error), { channel: 'c' })
  })

  it('resolveWindowId: the live window\'s id, null for none or a destroyed one', () => {
    fromWebContents.mockReturnValueOnce({ id: 7, isDestroyed: () => false })
    expect(resolveWindowId(event(true))).toBe(7)
    fromWebContents.mockReturnValueOnce({ id: 7, isDestroyed: () => true })
    expect(resolveWindowId(event(true))).toBeNull()
    fromWebContents.mockReturnValueOnce(null)
    expect(resolveWindowId(event(true))).toBeNull()
  })
})
