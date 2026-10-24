// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload import bridge: the whole `window.api.import` surface in its own
 * module, typed as {@link ImportBridge}. The document channels come from
 * `import-channels.ts`.
 *
 * @see Issue #133 - LiteParse IPC handlers, Zod schemas, and preload bridge
 */
import { ipcRenderer } from 'electron'
import { IMPORT_CHANNELS } from '../shared/ipc/import-channels'
import type { ImportBridge } from '../shared/ipc/import-schema'
import { subscribe } from './ipcSubscribe'

export const importBridge: ImportBridge = {
  selectFile: () => ipcRenderer.invoke('import:selectFile'),
  validate: (filePath) => ipcRenderer.invoke('import:validate', filePath),
  process: (filePath) => ipcRenderer.invoke('import:process', filePath),
  getSupportedExtensions: () => ipcRenderer.invoke('import:getSupportedExtensions'),
  isSupported: (extension) => ipcRenderer.invoke('import:isSupported', extension),
  documentImport: (request) => ipcRenderer.invoke(IMPORT_CHANNELS.DOCUMENT, request),
  cancelDocument: () => ipcRenderer.invoke(IMPORT_CHANNELS.DOCUMENT_CANCEL),
  getDocumentExtensions: () => ipcRenderer.invoke(IMPORT_CHANNELS.GET_DOCUMENT_EXTENSIONS),
  toolStatus: (request) => ipcRenderer.invoke(IMPORT_CHANNELS.TOOL_STATUS, request),
  onDocumentProgress: (callback) => subscribe(IMPORT_CHANNELS.DOCUMENT_PROGRESS, callback),
  onDependenciesReady: (callback) => subscribe(IMPORT_CHANNELS.DEPENDENCIES_READY, callback)
}
