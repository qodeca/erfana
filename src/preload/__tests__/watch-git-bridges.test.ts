// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preload watcher and git bridges (`fileWatch`, `directoryWatch`, `git`,
 * `gitWatcher`, `gitPolling`) against their wire: every method sends the
 * channel it always sent, with the arguments it always sent, and every event
 * subscription unsubscribes the listener it added.
 */
import { vi } from 'vitest'
import { describeBridge } from './bridgeHarness'
import { fileWatchBridge } from '../fileWatchBridge'
import { directoryWatchBridge } from '../directoryWatchBridge'
import { gitBridge, gitPollingBridge, gitWatcherBridge } from '../gitBridge'

vi.mock('electron', async () => ({ ipcRenderer: (await import('./bridgeHarness')).ipc }))

describeBridge('fileWatch bridge', fileWatchBridge, {
  invokes: [
    { method: 'start', args: ['/p/a.md'], channel: 'file-watch:start', wire: ['/p/a.md'] },
    { method: 'stop', args: ['/p/a.md'], channel: 'file-watch:stop', wire: ['/p/a.md'] },
    { method: 'stopAll', args: [], channel: 'file-watch:stopAll', wire: [] },
    { method: 'pause', args: ['/p/a.md'], channel: 'file-watch:pause', wire: ['/p/a.md'] },
    { method: 'resume', args: ['/p/a.md'], channel: 'file-watch:resume', wire: ['/p/a.md'] },
    { method: 'getStats', args: [], channel: 'file-watch:stats', wire: [] }
  ],
  events: [
    { method: 'onFileChanged', channel: 'file-watch:changed' },
    { method: 'onFileDeleted', channel: 'file-watch:deleted' },
    { method: 'onFileError', channel: 'file-watch:error' }
  ]
})

describeBridge('directoryWatch bridge', directoryWatchBridge, {
  invokes: [
    { method: 'start', args: ['/p'], channel: 'directory-watch:start', wire: ['/p'] },
    { method: 'stop', args: ['/p'], channel: 'directory-watch:stop', wire: ['/p'] },
    { method: 'stopAll', args: [], channel: 'directory-watch:stop-all', wire: [] },
    { method: 'pause', args: ['/p'], channel: 'directory-watch:pause', wire: ['/p'] },
    { method: 'resume', args: ['/p'], channel: 'directory-watch:resume', wire: ['/p'] },
    { method: 'getStats', args: [], channel: 'directory-watch:get-stats', wire: [] }
  ],
  events: [
    { method: 'onDirectoryChanged', channel: 'directory-watch:changed' },
    { method: 'onProjectDeleted', channel: 'directory-watch:project-deleted' },
    { method: 'onDirectoryError', channel: 'directory-watch:error' }
  ]
})

describeBridge('git bridge', gitBridge, {
  invokes: [{ method: 'getStatus', args: ['/p'], channel: 'git:getStatus', wire: ['/p'] }]
})

describeBridge('gitWatcher bridge', gitWatcherBridge, {
  invokes: [
    { method: 'start', args: ['/p'], channel: 'git-watcher:start', wire: ['/p'] },
    { method: 'stop', args: [], channel: 'git-watcher:stop', wire: [] },
    { method: 'getStatus', args: [], channel: 'git-watcher:status', wire: [] }
  ],
  events: [{ method: 'onStateChanged', channel: 'git:state-changed' }]
})

describeBridge('gitPolling bridge', gitPollingBridge, {
  invokes: [
    { method: 'start', args: ['/p'], channel: 'git-polling:start', wire: ['/p'] },
    { method: 'stop', args: [], channel: 'git-polling:stop', wire: [] },
    { method: 'setInterval', args: [5000], channel: 'git-polling:set-interval', wire: [5000] },
    { method: 'setEnabled', args: [false], channel: 'git-polling:set-enabled', wire: [false] }
  ],
  events: [{ method: 'onPollTriggered', channel: 'git:poll-triggered' }]
})
