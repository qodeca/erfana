// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer file gateway: the one place `window.api.file` is read.
 *
 * Renderer code calls `fileGateway.<method>`, which forwards to the preload
 * bridge with the same contract ({@link FileBridge}). Keeping the access in one
 * module gives the renderer a single seam to change or fake.
 */
import type { FileBridge } from '../../../shared/ipc/file-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
const bridge = (): FileBridge => window.api.file

export const fileGateway: FileBridge = {
  openProject: (...args) => bridge().openProject(...args),
  openProjectByPath: (...args) => bridge().openProjectByPath(...args),
  getSession: (...args) => bridge().getSession(...args),
  readDirectory: (...args) => bridge().readDirectory(...args),
  readFile: (...args) => bridge().readFile(...args),
  writeFile: (...args) => bridge().writeFile(...args),
  getStats: (...args) => bridge().getStats(...args),
  exists: (...args) => bridge().exists(...args),
  getProjectPath: (...args) => bridge().getProjectPath(...args),
  createFile: (...args) => bridge().createFile(...args),
  createFolder: (...args) => bridge().createFolder(...args),
  deleteFile: (...args) => bridge().deleteFile(...args),
  deleteFolder: (...args) => bridge().deleteFolder(...args),
  rename: (...args) => bridge().rename(...args),
  revealInFileManager: (...args) => bridge().revealInFileManager(...args),
  moveItem: (...args) => bridge().moveItem(...args),
  copyItem: (...args) => bridge().copyItem(...args),
  checkConflict: (...args) => bridge().checkConflict(...args),
  validatePath: (...args) => bridge().validatePath(...args),
  readImage: (...args) => bridge().readImage(...args),
  validateExternal: (...args) => bridge().validateExternal(...args),
  copyFromExternal: (...args) => bridge().copyFromExternal(...args),
  moveFromExternal: (...args) => bridge().moveFromExternal(...args),
  selectExternalFiles: (...args) => bridge().selectExternalFiles(...args),
  onProjectChanged: (...args) => bridge().onProjectChanged(...args),
  closeProject: (...args) => bridge().closeProject(...args)
}
