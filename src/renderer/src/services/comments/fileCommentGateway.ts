// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments in renderer-hosted previews – the renderer's ONE door to
 * `window.api.fileComments` (spec 024 architecture note 001 § 4, § 8 C15;
 * 024-NFR-005 item 10). An ESLint rule fails any other renderer file that
 * names the bridge.
 *
 * The same contract as the HTML Preview's `services/preview/commentGateway.ts`:
 *
 * - **No bridge is not a crash.** A test that installs no bridge, or a window
 *   whose preload predates it: every subscription is a no-op and every request
 *   answers "refused".
 * - **Never throws; a rejected invoke is an answer.** Main answers every
 *   refusal as `{ ok: false, code, reason }`, but an invoke can still reject (a
 *   handler not registered yet, the window closing). The comment window must
 *   keep the reviewer's text then too, so a rejection – or a throw from the
 *   bridge itself – becomes `{ ok: false, code: UNKNOWN_ERROR }`.
 *
 * Nothing here carries an author: main reads it from its own settings.
 *
 * @module services/comments/fileCommentGateway
 */
import { ErrorCode } from '../../../../shared/errors'
import type {
  FileCommentChanged,
  FileCommentListRequest,
  FileCommentListResult,
  FileCommentOpenDraftRequest,
  FileCommentOpenDraftResult,
  FileCommentSaveRequest,
  FileCommentSaveResult,
  FileCommentsBridge
} from '../../../../shared/ipc/file-comment-schema'

/** The refusal every request answers with when there is no bridge or the invoke rejects. */
const UNAVAILABLE = { ok: false as const, code: ErrorCode.UNKNOWN_ERROR }

const noop = (): void => {}

/** The bridge, read per call so a test that swaps `window.api` is honoured; `undefined` when absent. */
function bridge(): FileCommentsBridge | undefined {
  return (window as unknown as { api?: { fileComments?: FileCommentsBridge | null } }).api?.fileComments ?? undefined
}

/** Runs `request` on the bridge when it is there, folding a throw or a rejection into the refusal. */
async function ask<T>(request: (api: FileCommentsBridge) => Promise<T>, refused: T): Promise<T> {
  const api = bridge()
  if (api === undefined) return refused
  try {
    return await request(api)
  } catch {
    return refused
  }
}

/**
 * The file-comment API the renderer-hosted previews use.
 *
 * @example
 * ```ts
 * const off = fileCommentGateway.onChanged(({ panelId }) => relist(panelId))
 * const draft = await fileCommentGateway.openDraft({ panelId, filePath })
 * if (draft.ok) await fileCommentGateway.save({ panelId, filePath, op: 'add', draftToken: draft.draftToken, target, text, view })
 * ```
 */
export const fileCommentGateway = {
  /** Whether this window can comment in renderer-hosted previews at all. */
  available: (): boolean => bridge() !== undefined,
  list: (request: FileCommentListRequest): Promise<FileCommentListResult> =>
    ask<FileCommentListResult>(api => api.list(request), UNAVAILABLE),
  openDraft: (request: FileCommentOpenDraftRequest): Promise<FileCommentOpenDraftResult> =>
    ask<FileCommentOpenDraftResult>(api => api.openDraft(request), UNAVAILABLE),
  save: (request: FileCommentSaveRequest): Promise<FileCommentSaveResult> =>
    ask<FileCommentSaveResult>(api => api.save(request), UNAVAILABLE),
  onChanged: (callback: (payload: FileCommentChanged) => void): (() => void) => {
    const api = bridge()
    if (api === undefined) return noop
    try {
      return api.onChanged(callback)
    } catch {
      return noop
    }
  }
}
