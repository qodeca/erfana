// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preload app bridges (`settings`, `globalSettings`, `logging`, `quit`,
 * `system`, `clipboard`, `projectLock`) against their wire: every method sends
 * the channel it always sent, with the arguments it always sent, and every
 * event subscription unsubscribes the listener it added.
 */
import { vi } from 'vitest'
import { describeBridge } from './bridgeHarness'
import { globalSettingsBridge, settingsBridge } from '../settingsBridge'
import { loggingBridge } from '../loggingBridge'
import { quitBridge } from '../quitBridge'
import { systemBridge } from '../systemBridge'
import { clipboardBridge } from '../clipboardBridge'
import { projectLockBridge } from '../projectLockBridge'

vi.mock('electron', async () => ({ ipcRenderer: (await import('./bridgeHarness')).ipc }))

describeBridge('settings bridge', settingsBridge, {
  invokes: [
    { method: 'getProjectFilterMode', args: [], channel: 'settings:getProjectFilterMode', wire: [] },
    { method: 'setProjectFilterMode', args: ['all'], channel: 'settings:setProjectFilterMode', wire: ['all'] },
    { method: 'getDirectoryWatchDepth', args: [], channel: 'settings:getDirectoryWatchDepth', wire: [] },
    { method: 'setDirectoryWatchDepth', args: [null], channel: 'settings:setDirectoryWatchDepth', wire: [null] },
    { method: 'getRecentProjects', args: [], channel: 'settings:getRecentProjects', wire: [] },
    {
      method: 'addRecentProject',
      args: ['/p', 'p'],
      channel: 'settings:addRecentProject',
      wire: ['/p', 'p']
    },
    { method: 'removeRecentProject', args: ['/p'], channel: 'settings:removeRecentProject', wire: ['/p'] }
  ]
})

describeBridge('globalSettings bridge', globalSettingsBridge, {
  invokes: [
    { method: 'get', args: [], channel: 'globalSettings:get', wire: [] },
    {
      method: 'set',
      args: ['editor', { fontSize: 14 }],
      channel: 'globalSettings:set',
      wire: [{ key: 'editor', value: { fontSize: 14 } }]
    },
    { method: 'reset', args: [], channel: 'globalSettings:reset', wire: [] }
  ],
  events: [{ method: 'onSettingsChanged', channel: 'globalSettings:changed' }]
})

const entry = { level: 'info', message: 'm', timestamp: 't', source: 'renderer' }

describeBridge('logging bridge', loggingBridge, {
  invokes: [
    { method: 'getLevel', args: [], channel: 'logging:getLevel', wire: [] },
    { method: 'getLogsDir', args: [], channel: 'logging:getLogsDir', wire: [] },
    { method: 'openLogsFolder', args: [], channel: 'logging:openLogsFolder', wire: [] }
  ],
  sends: [{ method: 'log', args: [entry], channel: 'logging:log', wire: [entry] }]
})

describeBridge('quit bridge', quitBridge, {
  sends: [
    {
      method: 'sendQuitResponse',
      args: [false],
      channel: 'quit:confirmResponse',
      wire: [{ proceed: false }]
    }
  ],
  events: [{ method: 'onQuitRequested', channel: 'quit:requested' }]
})

describeBridge('system bridge', systemBridge, {
  invokes: [
    {
      method: 'openScreenRecordingSettings',
      args: [],
      channel: 'system:openScreenRecordingSettings',
      wire: []
    },
    { method: 'relaunchApp', args: [], channel: 'system:relaunchApp', wire: [] }
  ]
})

describeBridge('clipboard bridge', clipboardBridge, {
  invokes: [
    { method: 'readText', args: [], channel: 'clipboard:readText', wire: [] },
    { method: 'writeText', args: ['t'], channel: 'clipboard:writeText', wire: ['t'] }
  ]
})

describeBridge('projectLock bridge', projectLockBridge, {
  invokes: [
    { method: 'acquire', args: ['/p'], channel: 'project-lock:acquire', wire: [{ projectPath: '/p' }] },
    { method: 'release', args: ['/p'], channel: 'project-lock:release', wire: [{ projectPath: '/p' }] },
    { method: 'check', args: ['/p'], channel: 'project-lock:check', wire: [{ projectPath: '/p' }] },
    {
      method: 'requestFocus',
      args: ['/p'],
      channel: 'project-lock:requestFocus',
      wire: [{ projectPath: '/p' }]
    },
    { method: 'cleanup', args: [], channel: 'project-lock:cleanup', wire: [] }
  ],
  events: [{ method: 'onFocused', channel: 'project-lock:focused' }]
})
