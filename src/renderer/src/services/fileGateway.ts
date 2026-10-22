// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer file gateway: the one place `window.api.file` is read.
 *
 * Renderer code calls `fileGateway.<method>`, which forwards to the preload
 * bridge with the same contract ({@link FileBridge}). Keeping the access in one
 * module gives the renderer a single seam to change or fake.
 *
 * Errors are normalised here: a request the main process refused on path
 * grounds rejects with a {@link FileGatewayError} that carries the refusal
 * `code` (read back from the message, because only the message crosses IPC), so
 * a caller can branch on `error.code === 'PROJECT_CHANGED'` instead of matching
 * text. The message itself is left as the main process wrote it. Any other
 * failure (a filesystem error, a schema message) rejects with the error as it
 * came.
 */
import {
  confinementCodeFromMessage,
  type ConfinementErrorCode
} from '../../../shared/ipc/confinement'
import type { FileBridge } from '../../../shared/ipc/file-schema'
import { notifyFileStructureChanged } from './fileStructureSignal'

/** A file request the main process refused, with the reason as a code. */
export class FileGatewayError extends Error {
  /** Why the path was refused */
  readonly code: ConfinementErrorCode

  constructor(message: string, code: ConfinementErrorCode, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FileGatewayError'
    this.code = code
  }
}

/**
 * The error to throw for a rejected request. A refusal becomes a
 * {@link FileGatewayError}; anything else (not an `Error`, or a failure that is
 * not a refusal) passes through as it is.
 */
export function normaliseFileError(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof FileGatewayError) return error
  const code = confinementCodeFromMessage(error.message)
  return code === null ? error : new FileGatewayError(error.message, code, { cause: error })
}

/** True when the request was refused because the open project is no longer the one it was made under. */
export function isProjectChanged(error: unknown): boolean {
  return error instanceof FileGatewayError && error.code === 'PROJECT_CHANGED'
}

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): FileBridge => (window as unknown as { api: { file: FileBridge } }).api.file

type RequestMethod = Exclude<keyof FileBridge, 'onProjectChanged'>

/** Forward one request method, turning its rejection into a {@link FileGatewayError}. */
function forward<K extends RequestMethod>(name: K): FileBridge[K] {
  return (async (...args: unknown[]) => {
    const current = bridge()
    try {
      return await (current[name] as (...a: unknown[]) => Promise<unknown>).apply(current, args)
    } catch (error) {
      throw normaliseFileError(error)
    }
  }) as FileBridge[K]
}

/**
 * Forward a method that can add, remove or move entries, and raise
 * {@link notifyFileStructureChanged} once it settles. Also after a failure: a
 * batch move or a copy may have done part of its work before it failed.
 */
function forwardStructural<K extends RequestMethod>(name: K): FileBridge[K] {
  const call = forward(name) as unknown as (...a: unknown[]) => Promise<unknown>
  return (async (...args: unknown[]) => {
    try {
      return await call(...args)
    } finally {
      notifyFileStructureChanged()
    }
  }) as FileBridge[K]
}

export const fileGateway: FileBridge = {
  openProject: forward('openProject'),
  openProjectByPath: forward('openProjectByPath'),
  getSession: forward('getSession'),
  readDirectory: forward('readDirectory'),
  readFile: forward('readFile'),
  writeFile: forward('writeFile'),
  getStats: forward('getStats'),
  exists: forward('exists'),
  getProjectPath: forward('getProjectPath'),
  createFile: forwardStructural('createFile'),
  createFolder: forwardStructural('createFolder'),
  deleteFile: forwardStructural('deleteFile'),
  deleteFolder: forwardStructural('deleteFolder'),
  rename: forwardStructural('rename'),
  revealInFileManager: forward('revealInFileManager'),
  moveItem: forwardStructural('moveItem'),
  copyItem: forwardStructural('copyItem'),
  checkConflict: forward('checkConflict'),
  validatePath: forward('validatePath'),
  readImage: forward('readImage'),
  validateExternal: forward('validateExternal'),
  copyFromExternal: forwardStructural('copyFromExternal'),
  moveFromExternal: forwardStructural('moveFromExternal'),
  moveBatchFromExternal: forwardStructural('moveBatchFromExternal'),
  selectExternalFiles: forward('selectExternalFiles'),
  onProjectChanged: (...args) => bridge().onProjectChanged(...args),
  closeProject: forward('closeProject')
}
