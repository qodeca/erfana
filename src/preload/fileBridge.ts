// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload file bridge: the whole `window.api.file` surface in its own module,
 * typed as {@link FileBridge} (the shared contract in
 * `file-schema.ts`). Channel names come from `file-channels.ts`.
 *
 * The wire is positional and unchanged: this module only moves the code out of
 * `index.ts` and ties it to the contract.
 */
import { ipcRenderer } from 'electron'
import { FILE_CHANNELS, FILE_EVENTS } from '../shared/ipc/file-channels'
import type { FileBridge } from '../shared/ipc/file-schema'
import type { ProjectChanged } from '../shared/ipc/schema'

export const fileBridge: FileBridge = {
  openProject: () => ipcRenderer.invoke(FILE_CHANNELS.openProject),
  openProjectByPath: (projectPath) =>
    ipcRenderer.invoke(FILE_CHANNELS.openProjectByPath, projectPath),
  getSession: () => ipcRenderer.invoke(FILE_CHANNELS.getSession),
  readDirectory: (dirPath) => ipcRenderer.invoke(FILE_CHANNELS.readDirectory, dirPath),
  readFile: (filePath) => ipcRenderer.invoke(FILE_CHANNELS.readFile, filePath),
  writeFile: (filePath, content, options) =>
    options === undefined
      ? ipcRenderer.invoke(FILE_CHANNELS.writeFile, filePath, content)
      : ipcRenderer.invoke(FILE_CHANNELS.writeFile, filePath, content, options),
  getStats: (filePath) => ipcRenderer.invoke(FILE_CHANNELS.getStats, filePath),
  exists: (filePath) => ipcRenderer.invoke(FILE_CHANNELS.exists, filePath),
  getProjectPath: () => ipcRenderer.invoke(FILE_CHANNELS.getProjectPath),
  createFile: (dirPath, fileName) =>
    ipcRenderer.invoke(FILE_CHANNELS.createFile, dirPath, fileName),
  createFolder: (dirPath, folderName) =>
    ipcRenderer.invoke(FILE_CHANNELS.createFolder, dirPath, folderName),
  deleteFile: (filePath) => ipcRenderer.invoke(FILE_CHANNELS.deleteFile, filePath),
  deleteFolder: (folderPath) => ipcRenderer.invoke(FILE_CHANNELS.deleteFolder, folderPath),
  rename: (oldPath, newName) => ipcRenderer.invoke(FILE_CHANNELS.rename, oldPath, newName),
  revealInFileManager: (filePath) =>
    ipcRenderer.invoke(FILE_CHANNELS.revealInFileManager, filePath),
  moveItem: (sourcePath, targetParentPath, newName, replaceExisting) =>
    ipcRenderer.invoke(FILE_CHANNELS.moveItem, sourcePath, targetParentPath, newName, replaceExisting),
  copyItem: (sourcePath, targetParentPath, newName) =>
    ipcRenderer.invoke(FILE_CHANNELS.copyItem, sourcePath, targetParentPath, newName),
  checkConflict: (targetParentPath, itemName) =>
    ipcRenderer.invoke(FILE_CHANNELS.checkConflict, targetParentPath, itemName),
  validatePath: (filePath, projectRoot) =>
    ipcRenderer.invoke(FILE_CHANNELS.validatePath, filePath, projectRoot),

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
  readImage: (filePath, knownVersion) =>
    ipcRenderer.invoke(FILE_CHANNELS.readImage, filePath, knownVersion),

  // External file drop operations (Spec #012). `projectRoot` is ignored: the
  // main process uses the open project.
  validateExternal: (sourcePath, projectRoot) =>
    ipcRenderer.invoke(FILE_CHANNELS.validateExternal, sourcePath, projectRoot),
  copyFromExternal: (sourcePath, targetFolder, projectRoot, conflictResolution) =>
    ipcRenderer.invoke(
      FILE_CHANNELS.copyFromExternal,
      sourcePath,
      targetFolder,
      projectRoot,
      conflictResolution
    ),
  moveFromExternal: (sourcePath, targetFolder, projectRoot, conflictResolution) =>
    ipcRenderer.invoke(
      FILE_CHANNELS.moveFromExternal,
      sourcePath,
      targetFolder,
      projectRoot,
      conflictResolution
    ),
  selectExternalFiles: () => ipcRenderer.invoke(FILE_CHANNELS.selectExternalFiles),

  // Project change event listener
  onProjectChanged: (callback) => {
    const listener = (_event: unknown, data: ProjectChanged) => callback(data)
    ipcRenderer.on(FILE_EVENTS.projectChanged, listener)
    return () => {
      ipcRenderer.removeListener(FILE_EVENTS.projectChanged, listener)
    }
  },
  closeProject: (expectedGeneration) =>
    ipcRenderer.invoke(FILE_CHANNELS.closeProject, expectedGeneration)
}
