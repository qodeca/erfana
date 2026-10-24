// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `settings:*` channels: the app settings kept by `SettingsService` –
 * the project tree's filter mode, the directory watcher's depth and the recent
 * projects list. Global settings (`~/.erfana/settings.json`) are
 * `global-settings-schema.ts`.
 */
import type { IpcAck } from './schema'

/** One entry of the recent projects list. */
export interface RecentProject {
  path: string
  name: string
  /** `Date.now()` when the project was last opened */
  lastOpened: number
}

/**
 * Shared contract for the preload `settings` bridge.
 *
 * Implemented by `window.api.settings` (preload, `settingsBridge.ts`) and
 * consumed by the renderer settings gateway.
 */
export interface SettingsBridge {
  getProjectFilterMode(): Promise<{ success: boolean; mode?: string; error?: string }>
  setProjectFilterMode(mode: string): Promise<IpcAck>
  getDirectoryWatchDepth(): Promise<{ success: boolean; depth?: number; error?: string }>
  /** `null` removes the limit. */
  setDirectoryWatchDepth(depth: number | null): Promise<IpcAck>
  getRecentProjects(): Promise<{ success: boolean; projects?: RecentProject[]; error?: string }>
  addRecentProject(path: string, name: string): Promise<IpcAck>
  removeRecentProject(path: string): Promise<IpcAck>
}
