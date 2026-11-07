// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pick-and-send verbs of the browser tab bridge (spec 025 § 8, commits
 * 14–15): each is called, with its channel and wrapped payload pinned and the
 * payload checked against the schema main validates with.
 *
 * @see browserTabBridge.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BROWSER_TAB_CHANNELS as C } from '../shared/ipc/browser-tab-channels'
import {
  ClosePickRequestSchema,
  DiscardCaptureFilesRequestSchema,
  PickModeRequestSchema,
  RefineRequestSchema,
  TargetStatusRequestSchema,
  WriteCaptureRequestSchema
} from '../shared/ipc/browser-tab-schema'
import { PickSurfaceRequestSchema, StillRequestSchema } from '../shared/ipc/browser-tab-pick-schema'
import { browserTabBridge } from './browserTabBridge'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ ipcRenderer: { on: vi.fn(), removeListener: vi.fn(), invoke, send: vi.fn() } }))

const TAB = 'browser-tab-3'
const CAPTURE = '0123456789abcdef0123456789abcdef'

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ ok: true })
})

describe('browserTabBridge pick and send', () => {
  it('wraps each pick request in the payload main validates, on its own channel', async () => {
    expect(await browserTabBridge.pickMode(TAB, true)).toEqual({ ok: true })
    await browserTabBridge.refine({ tabId: TAB, captureId: CAPTURE, move: { ancestor: 2 } })
    await browserTabBridge.closePick({ tabId: TAB, captureId: CAPTURE, reason: 'sent' })
    await browserTabBridge.writeCapture({ tabId: TAB, captureId: CAPTURE, terminalId: 'terminal-1', sendAnyway: true })
    await browserTabBridge.discardCaptureFiles(TAB, CAPTURE)
    await browserTabBridge.targetStatus('terminal-1')

    expect(invoke.mock.calls).toEqual([
      [C.pickMode, { tabId: TAB, on: true }],
      [C.refine, { tabId: TAB, captureId: CAPTURE, move: { ancestor: 2 } }],
      [C.closePick, { tabId: TAB, captureId: CAPTURE, reason: 'sent' }],
      [C.writeCapture, { tabId: TAB, captureId: CAPTURE, terminalId: 'terminal-1', sendAnyway: true }],
      [C.discardCaptureFiles, { tabId: TAB, captureId: CAPTURE }],
      [C.targetStatus, { terminalId: 'terminal-1' }]
    ])
    const schemas = [PickModeRequestSchema, RefineRequestSchema, ClosePickRequestSchema, WriteCaptureRequestSchema, DiscardCaptureFilesRequestSchema, TargetStatusRequestSchema]
    invoke.mock.calls.forEach(([, payload], i) => expect(schemas[i].safeParse(payload).success, String(invoke.mock.calls[i][0])).toBe(true))
  })

  it('sends the surface change and the still-image request in the payloads main validates', async () => {
    await browserTabBridge.pickSurface(TAB, CAPTURE, 'dialog')
    await browserTabBridge.still(TAB)
    expect(invoke.mock.calls).toEqual([
      [C.pickSurface, { tabId: TAB, captureId: CAPTURE, surface: 'dialog' }],
      [C.still, { tabId: TAB }]
    ])
    expect(PickSurfaceRequestSchema.safeParse(invoke.mock.calls[0][1]).success).toBe(true)
    expect(StillRequestSchema.safeParse(invoke.mock.calls[1][1]).success).toBe(true)
  })
})
