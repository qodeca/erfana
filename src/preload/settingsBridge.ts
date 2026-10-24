// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload settings bridges: `window.api.settings` (app settings) and
 * `window.api.globalSettings` (~/.erfana/settings.json), typed as
 * {@link SettingsBridge} and {@link GlobalSettingsBridge}.
 */
import { ipcRenderer } from 'electron'
import type { GlobalSettingsBridge } from '../shared/ipc/global-settings-schema'
import type { SettingsBridge } from '../shared/ipc/settings-schema'
import { subscribe } from './ipcSubscribe'

export const settingsBridge: SettingsBridge = {
  getProjectFilterMode: () => ipcRenderer.invoke('settings:getProjectFilterMode'),
  setProjectFilterMode: (mode) => ipcRenderer.invoke('settings:setProjectFilterMode', mode),
  getDirectoryWatchDepth: () => ipcRenderer.invoke('settings:getDirectoryWatchDepth'),
  setDirectoryWatchDepth: (depth) => ipcRenderer.invoke('settings:setDirectoryWatchDepth', depth),
  getRecentProjects: () => ipcRenderer.invoke('settings:getRecentProjects'),
  addRecentProject: (path, name) => ipcRenderer.invoke('settings:addRecentProject', path, name),
  removeRecentProject: (path) => ipcRenderer.invoke('settings:removeRecentProject', path)
}

export const globalSettingsBridge: GlobalSettingsBridge = {
  get: () => ipcRenderer.invoke('globalSettings:get'),
  set: (key, value) => ipcRenderer.invoke('globalSettings:set', { key, value }),
  reset: () => ipcRenderer.invoke('globalSettings:reset'),
  onSettingsChanged: (callback) => subscribe('globalSettings:changed', callback)
}
