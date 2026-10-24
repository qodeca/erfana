// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload git bridges: `window.api.git` (status), `window.api.gitWatcher` (the
 * `.git` folder watch) and `window.api.gitPolling` (the timer that backs the
 * watch up), typed as {@link GitBridge}, {@link GitWatcherBridge} and
 * {@link GitPollingBridge}. Channel names come from `git-watcher-channels.ts`
 * where it names them.
 *
 * @see Issue #74 - real-time git status refresh
 */
import { ipcRenderer } from 'electron'
import type { GitBridge } from '../shared/ipc/git-schema'
import {
  GitPollingChannels,
  GitWatcherChannels,
  GitWatcherEvents
} from '../shared/ipc/git-watcher-channels'
import type { GitPollingBridge, GitWatcherBridge } from '../shared/ipc/git-watcher-schema'
import { subscribe } from './ipcSubscribe'

export const gitBridge: GitBridge = {
  getStatus: (projectPath) => ipcRenderer.invoke('git:getStatus', projectPath)
}

export const gitWatcherBridge: GitWatcherBridge = {
  start: (projectPath) => ipcRenderer.invoke(GitWatcherChannels.START, projectPath),
  stop: () => ipcRenderer.invoke(GitWatcherChannels.STOP),
  getStatus: () => ipcRenderer.invoke(GitWatcherChannels.STATUS),
  onStateChanged: (callback) => subscribe(GitWatcherEvents.STATE_CHANGED, callback)
}

export const gitPollingBridge: GitPollingBridge = {
  start: (projectPath) => ipcRenderer.invoke(GitPollingChannels.START, projectPath),
  stop: () => ipcRenderer.invoke(GitPollingChannels.STOP),
  setInterval: (ms) => ipcRenderer.invoke(GitPollingChannels.SET_INTERVAL, ms),
  setEnabled: (enabled) => ipcRenderer.invoke(GitPollingChannels.SET_ENABLED, enabled),
  onPollTriggered: (callback) => subscribe(GitWatcherEvents.POLL_TRIGGERED, callback)
}
