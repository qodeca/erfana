// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * File and project IPC channel names.
 *
 * One constant per channel, so a name is spelled once and shared by the main
 * process handlers and the preload bridge. The strings are the wire names and
 * did not change when the constants were introduced.
 */

/** Request channels (`ipcMain.handle` / `ipcRenderer.invoke`). */
export const FILE_CHANNELS = {
  openProject: 'file:openProject',
  openProjectByPath: 'file:openProjectByPath',
  closeProject: 'file:closeProject',
  getSession: 'file:getSession',
  getProjectPath: 'file:getProjectPath',
  readDirectory: 'file:readDirectory',
  readFile: 'file:readFile',
  writeFile: 'file:writeFile',
  getStats: 'file:getStats',
  exists: 'file:exists',
  createFile: 'file:createFile',
  createFolder: 'file:createFolder',
  deleteFile: 'file:deleteFile',
  deleteFolder: 'file:deleteFolder',
  rename: 'file:rename',
  moveItem: 'file:moveItem',
  copyItem: 'file:copyItem',
  checkConflict: 'file:checkConflict',
  readImage: 'file:readImage',
  revealInFileManager: 'file:revealInFileManager',
  validatePath: 'file:validatePath',
  validateExternal: 'file:validateExternal',
  copyFromExternal: 'file:copyFromExternal',
  moveFromExternal: 'file:moveFromExternal',
  moveBatchFromExternal: 'file:moveBatchFromExternal',
  selectExternalFiles: 'file:selectExternalFiles'
} as const

/** Events sent from main to the window. */
export const FILE_EVENTS = {
  projectChanged: 'project:changed'
} as const

export type FileChannel = (typeof FILE_CHANNELS)[keyof typeof FILE_CHANNELS]
export type FileEvent = (typeof FILE_EVENTS)[keyof typeof FILE_EVENTS]
