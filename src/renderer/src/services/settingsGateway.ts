// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer settings gateways: the one place `window.api.settings` and
 * `window.api.globalSettings` are read.
 *
 * Renderer code calls `settingsGateway` or `globalSettingsGateway`, which
 * forward to the preload bridges with the same contracts
 * ({@link SettingsBridge}, {@link GlobalSettingsBridge}). Keeping the access in
 * one module gives the renderer a single seam to change or fake.
 */
import type { GlobalSettingsBridge } from '../../../shared/ipc/global-settings-schema'
import type { SettingsBridge } from '../../../shared/ipc/settings-schema'

interface SettingsBridges {
  settings: SettingsBridge
  globalSettings: GlobalSettingsBridge
}

/** The bridges are read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves these bridges out of its type; this module is the only place they are put back
const bridges = (): SettingsBridges => (window as unknown as { api: SettingsBridges }).api

export const settingsGateway: SettingsBridge = {
  getProjectFilterMode: (...args) => bridges().settings.getProjectFilterMode(...args),
  setProjectFilterMode: (...args) => bridges().settings.setProjectFilterMode(...args),
  getDirectoryWatchDepth: (...args) => bridges().settings.getDirectoryWatchDepth(...args),
  setDirectoryWatchDepth: (...args) => bridges().settings.setDirectoryWatchDepth(...args),
  getRecentProjects: (...args) => bridges().settings.getRecentProjects(...args),
  addRecentProject: (...args) => bridges().settings.addRecentProject(...args),
  removeRecentProject: (...args) => bridges().settings.removeRecentProject(...args)
}

export const globalSettingsGateway: GlobalSettingsBridge = {
  get: (...args) => bridges().globalSettings.get(...args),
  set: (...args) => bridges().globalSettings.set(...args),
  reset: (...args) => bridges().globalSettings.reset(...args),
  onSettingsChanged: (...args) => bridges().globalSettings.onSettingsChanged(...args)
}
