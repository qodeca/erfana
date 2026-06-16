// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Document Import IPC Channel Names
 *
 * Type-safe channel name constants for document import IPC communication.
 * Using constants eliminates typos and enables refactoring.
 *
 * @see Issue #133 - LiteParse IPC handlers, Zod schemas, and preload bridge
 * @see Spec #021 - LiteParse document import
 */

/**
 * Document import request/response channels (ipcMain.handle)
 * and streaming channels (webContents.send)
 */
export const IMPORT_CHANNELS = {
  /** Start document import with options (ipcMain.handle) */
  DOCUMENT: 'import:document',
  /** Progress event streamed to renderer (webContents.send) */
  DOCUMENT_PROGRESS: 'import:documentProgress',
  /** Cancel active document import (ipcMain.handle) */
  DOCUMENT_CANCEL: 'import:documentCancel',
  /** Query available document extensions (ipcMain.handle) */
  GET_DOCUMENT_EXTENSIONS: 'import:getDocumentExtensions',
  /** Dependency detection complete event (webContents.send) */
  DEPENDENCIES_READY: 'import:dependenciesReady'
} as const

/**
 * Union type of all document import channel names
 */
export type ImportChannel = (typeof IMPORT_CHANNELS)[keyof typeof IMPORT_CHANNELS]
