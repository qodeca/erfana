// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – IPC channel names
 * (docs/designs/comments/html-preview-comments.md §8).
 *
 * Two families:
 *
 * - **Page channels** (`PreviewCommentPageChannels`). The preview page's
 *   preload sends three of them, which main hears on that view's
 *   `webContents.ipc`, and receives the fourth through `WebFrameMain.send`.
 *   Electron also emits every renderer send on the global `ipcMain`; that is
 *   safe because nothing there listens on a `preview-page:` channel
 *   (`src/main/ipc/noGlobalPreviewPageListener.test.ts`) and the `registry.ts`
 *   sender gate refuses every frame of a preview page anyway. The preload
 *   cannot import this file (a preload entry must stay self-contained, #73),
 *   so it inlines the same strings; `src/preload/previewPageComments/contract.test.ts`
 *   pins the two copies together.
 * - **Renderer channels** (`PreviewCommentChannels`, `PreviewCommentEvents`,
 *   P5). Erfana's own window drives comment mode, reads the comment list and
 *   saves through these; every request is `registerHandle` +
 *   `isTrustedPreviewSender` + a strict schema (`preview-comment-schema.ts`).
 *   The events are sent to the window that owns the view only.
 */

/** Page ↔ main channels of the comment overlay. */
export const PreviewCommentPageChannels = {
  /** Page → main: a document finished parsing; also "send me the frame list again". */
  HELLO: 'preview-page:commentHello',
  /** Page → main: a pick – menu, open, pin click, Alt+↑ out of a frame, Esc. Never writes. */
  PICK: 'preview-page:commentPick',
  /** Page → main: which pins' elements are rendered now; overlay loss. */
  ANCHORS: 'preview-page:commentAnchors',
  /** Main → frame: the comment state. The preload's only receive channel. */
  STATE: 'preview-page:commentState'
} as const

export type PreviewCommentPageChannel =
  (typeof PreviewCommentPageChannels)[keyof typeof PreviewCommentPageChannels]

/** Renderer → main requests (all `invoke`/`handle`). */
export const PreviewCommentChannels = {
  /** Turn comment mode on or off for a tab, with its "show comment icons" toggle. */
  SET_MODE: 'preview:commentSetMode',
  /** Every comment of the page on screen and its same-project frames, read from disk. */
  LIST: 'preview:commentList',
  /** A command for the page – today only "Show on page" (`reveal`). */
  COMMAND: 'preview:commentCommand',
  /** Add, reply, edit, resolve, re-open or delete – the only page-driven write (§7.6). */
  SAVE: 'preview:commentSave',
  /**
   * The files this window holds unsaved editor changes for (decision 13). Main
   * refuses a save into any of them with `COMMENT_UNSAVED_SOURCE`.
   */
  SET_UNSAVED_SOURCES: 'preview:commentSetUnsavedSources'
} as const

/** Main → renderer events, sent only to the window that owns the view. */
export const PreviewCommentEvents = {
  /** A pick in the page opened a draft (menu, comment window) or a pin's threads. */
  DRAFT_OPENED: 'preview:commentDraftOpened',
  /** The tab's comment counts, or its availability, changed. */
  COMMENTS_CHANGED: 'preview:commentsChanged',
  /** Which threads' elements are not rendered right now ("Not visible now"). */
  ANCHOR_STATUS: 'preview:commentAnchorStatus',
  /** Main turned comment mode on or off: Esc in the page (its exit pick), or the shortcut. */
  MODE_CHANGED: 'preview:commentModeChanged',
  /** A save answered `COMMENT_SAVE_PENDING` settled after all: written, or refused with its code. */
  SAVE_SETTLED: 'preview:commentSaveSettled'
} as const

export type PreviewCommentChannel =
  (typeof PreviewCommentChannels)[keyof typeof PreviewCommentChannels]
export type PreviewCommentEvent = (typeof PreviewCommentEvents)[keyof typeof PreviewCommentEvents]
