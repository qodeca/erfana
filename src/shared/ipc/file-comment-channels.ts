// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments in renderer-hosted previews – IPC channel names (spec 024
 * architecture note 001 § 4; `docs/ipc-patterns.md` § File comments).
 *
 * Not `md-comment:`: any later text-file preview reuses these channels, and
 * which file kinds they serve is fixed in main (`fileCommentKinds`).
 *
 * Erfana's own window only, through `window.api.fileComments` on the
 * main-window preload; the previewed HTML page can reach none of them. Every
 * request is `registerHandle` + `isTrustedSender` + a strict schema
 * (`file-comment-schema.ts`); the event goes only to the window whose panel
 * listed the file.
 */

/** Renderer → main requests (all `invoke`/`handle`). */
export const FileCommentChannels = {
  /** A file's comments, read from disk – or, for display only, from the editor's unsaved text. */
  LIST: 'file-comment:list',
  /** Mint a single-use draft token for a new comment, tied to the window, the panel and the file (C17). */
  OPEN_DRAFT: 'file-comment:openDraft',
  /** Add, reply, edit, resolve, re-open or delete. */
  SAVE: 'file-comment:save',
  /** "Resolve all changed comments", "Delete all resolved comments": one write (024-FR-028). */
  BULK: 'file-comment:bulk',
  /** The name git knows for the open project: a suggestion for the identity step (P-F33). Payload-free. */
  GIT_NAME: 'file-comment:gitName',
  /** The panel closed: forget its record, keys and file watch (the sender's window only). */
  RELEASE: 'file-comment:release'
} as const

/** Main → renderer events, sent only to the window that owns the panel. */
export const FileCommentEvents = {
  /** A listed file changed on disk: list it again. */
  CHANGED: 'file-comment:changed',
  /** A save answered `COMMENT_SAVE_PENDING` settled after all: written, or refused with its code (W-10). */
  SAVE_SETTLED: 'file-comment:saveSettled'
} as const

export type FileCommentChannel = (typeof FileCommentChannels)[keyof typeof FileCommentChannels]
export type FileCommentEvent = (typeof FileCommentEvents)[keyof typeof FileCommentEvents]
