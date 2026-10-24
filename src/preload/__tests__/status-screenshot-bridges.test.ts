// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preload `claudeStatus` and `screenshot` bridges against their wire:
 * every method sends the channel it always sent, with the arguments it always
 * sent, and the status subscription unsubscribes the listener it added.
 */
import { vi } from 'vitest'
import { describeBridge } from './bridgeHarness'
import { claudeStatusBridge } from '../claudeStatusBridge'
import { screenshotBridge } from '../screenshotBridge'

vi.mock('electron', async () => ({ ipcRenderer: (await import('./bridgeHarness')).ipc }))

describeBridge('claudeStatus bridge', claudeStatusBridge, {
  invokes: [
    // A terminal id only: the PTY pid is resolved main-side and never sent
    { method: 'register', args: ['t1'], channel: 'claude-status:register', wire: [{ terminalId: 't1' }] },
    {
      method: 'unregister',
      args: ['t1'],
      channel: 'claude-status:unregister',
      wire: [{ terminalId: 't1' }]
    },
    { method: 'nudge', args: ['t1'], channel: 'claude-status:nudge', wire: [{ terminalId: 't1' }] }
  ],
  events: [{ method: 'onChanged', channel: 'claude-status:changed' }]
})

const captureRequest = { mode: 'screen' }
const enumerateRequest = { includeThumbnails: false, maxSources: 10 }

describeBridge('screenshot bridge', screenshotBridge, {
  invokes: [
    { method: 'getDisplays', args: [], channel: 'screenshot:getDisplays', wire: [] },
    {
      method: 'enumerateWindows',
      args: [enumerateRequest],
      channel: 'screenshot:enumerateWindows',
      wire: [enumerateRequest]
    },
    // No request: the handler reads `undefined` as the default behaviour
    {
      method: 'enumerateWindows',
      args: [],
      channel: 'screenshot:enumerateWindows',
      wire: [undefined]
    },
    { method: 'capture', args: [captureRequest], channel: 'screenshot:capture', wire: [captureRequest] },
    { method: 'getCapabilities', args: [], channel: 'screenshot:getCapabilities', wire: [] },
    { method: 'getScreenPermission', args: [], channel: 'screenshot:getScreenPermission', wire: [] }
  ]
})
