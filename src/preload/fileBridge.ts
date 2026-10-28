// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload file bridge: the whole `window.api.file` surface in its own module,
 * typed as {@link FileBridge} (the shared contract in
 * `file-schema.ts`). Channel names come from `file-channels.ts`.
 *
 * Every channel that takes arguments takes ONE request object, passed through
 * as it is; the main process validates it against a strict schema.
 */
import { ipcRenderer } from 'electron'
import { FILE_CHANNELS, FILE_EVENTS } from '../shared/ipc/file-channels'
import type { FileBridge } from '../shared/ipc/file-schema'
import type { ProjectChanged } from '../shared/ipc/schema'

export const fileBridge: FileBridge = {
  openProject: () => ipcRenderer.invoke(FILE_CHANNELS.openProject),
  openProjectByPath: (request) => ipcRenderer.invoke(FILE_CHANNELS.openProjectByPath, request),
  getSession: () => ipcRenderer.invoke(FILE_CHANNELS.getSession),
  readDirectory: (request) => ipcRenderer.invoke(FILE_CHANNELS.readDirectory, request),
  findByName: (request) => ipcRenderer.invoke(FILE_CHANNELS.findByName, request),
  readFile: (request) => ipcRenderer.invoke(FILE_CHANNELS.readFile, request),
  writeFile: (request) => ipcRenderer.invoke(FILE_CHANNELS.writeFile, request),
  getStats: (request) => ipcRenderer.invoke(FILE_CHANNELS.getStats, request),
  exists: (request) => ipcRenderer.invoke(FILE_CHANNELS.exists, request),
  getProjectPath: () => ipcRenderer.invoke(FILE_CHANNELS.getProjectPath),
  createFile: (request) => ipcRenderer.invoke(FILE_CHANNELS.createFile, request),
  createFolder: (request) => ipcRenderer.invoke(FILE_CHANNELS.createFolder, request),
  deleteFile: (request) => ipcRenderer.invoke(FILE_CHANNELS.deleteFile, request),
  deleteFolder: (request) => ipcRenderer.invoke(FILE_CHANNELS.deleteFolder, request),
  rename: (request) => ipcRenderer.invoke(FILE_CHANNELS.rename, request),
  revealInFileManager: (request) => ipcRenderer.invoke(FILE_CHANNELS.revealInFileManager, request),
  moveItem: (request) => ipcRenderer.invoke(FILE_CHANNELS.moveItem, request),
  copyItem: (request) => ipcRenderer.invoke(FILE_CHANNELS.copyItem, request),
  checkConflict: (request) => ipcRenderer.invoke(FILE_CHANNELS.checkConflict, request),
  validatePath: (request) => ipcRenderer.invoke(FILE_CHANNELS.validatePath, request),

  /**
   * Read an image, or learn that it has not changed.
   *
   * The only image read channel: ImageViewerPanel loads images through it in
   * the sandboxed renderer, and gets back a data URL like
   * data:image/png;base64,iVBORw0KGgo...
   *
   * Pass the `version` from the previous response as `knownVersion`: an
   * unchanged file then answers `{ status: 'unchanged', version }` without
   * re-encoding up to ~67 MB of base64 on the main-process event loop or
   * sending it across IPC. `unchanged` is a SUCCESS - keep the bytes you
   * have; it must not be surfaced as a failed refresh.
   *
   * Omit `knownVersion` whenever you hold no bytes (first load, remount,
   * after an error) to force a full read. The version is opaque: store the
   * one you were given, never parse or construct one.
   *
   * @see Issue #70 - preview tabs show stale content when the file changes
   */
  readImage: (request) => ipcRenderer.invoke(FILE_CHANNELS.readImage, request),

  // External file drop operations (Spec #012). The main process uses the open
  // project; the requests carry no project root.
  validateExternal: (request) => ipcRenderer.invoke(FILE_CHANNELS.validateExternal, request),
  copyFromExternal: (request) => ipcRenderer.invoke(FILE_CHANNELS.copyFromExternal, request),
  moveFromExternal: (request) => ipcRenderer.invoke(FILE_CHANNELS.moveFromExternal, request),
  moveBatchFromExternal: (request) =>
    ipcRenderer.invoke(FILE_CHANNELS.moveBatchFromExternal, request),
  selectExternalFiles: () => ipcRenderer.invoke(FILE_CHANNELS.selectExternalFiles),

  // Project change event listener
  onProjectChanged: (callback) => {
    const listener = (_event: unknown, data: ProjectChanged) => callback(data)
    ipcRenderer.on(FILE_EVENTS.projectChanged, listener)
    return () => {
      ipcRenderer.removeListener(FILE_EVENTS.projectChanged, listener)
    }
  },
  closeProject: (request) => ipcRenderer.invoke(FILE_CHANNELS.closeProject, request)
}
