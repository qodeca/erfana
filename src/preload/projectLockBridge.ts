// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload project-lock bridge: the whole `window.api.projectLock` surface in
 * its own module, typed as {@link ProjectLockBridge}. File-based locks keep two
 * Erfana instances from opening the same project.
 *
 * @see Issue #27 - Multiple independent instances
 * @see Spec #010 - Multi-instance support specification
 */
import { ipcRenderer } from 'electron'
import type { ProjectLockBridge } from '../shared/ipc/project-lock-schema'
import { subscribe } from './ipcSubscribe'

export const projectLockBridge: ProjectLockBridge = {
  acquire: (projectPath) => ipcRenderer.invoke('project-lock:acquire', { projectPath }),
  release: (projectPath) => ipcRenderer.invoke('project-lock:release', { projectPath }),
  check: (projectPath) => ipcRenderer.invoke('project-lock:check', { projectPath }),
  requestFocus: (projectPath) => ipcRenderer.invoke('project-lock:requestFocus', { projectPath }),
  cleanup: () => ipcRenderer.invoke('project-lock:cleanup'),
  onFocused: (callback) => subscribe('project-lock:focused', callback)
}
