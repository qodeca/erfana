// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – IPC channel names
 * (docs/designs/html-preview-comments.md §8).
 *
 * P4 adds the page channels only: the preview page's preload sends three of
 * them, which main hears on that view's `webContents.ipc`, and receives the
 * fourth through `WebFrameMain.send`. Electron also emits every renderer send
 * on the global `ipcMain`; that is safe because nothing there listens on a
 * `preview-page:` channel (`src/main/ipc/noGlobalPreviewPageListener.test.ts`)
 * and the `registry.ts` sender gate refuses every frame of a preview page
 * anyway. The preload cannot import this file (a preload entry must stay
 * self-contained, #73), so it inlines the same strings;
 * `src/preload/previewPageComments/contract.test.ts` pins the two copies
 * together. The renderer ↔ main channels (`PreviewCommentChannels`,
 * `PreviewCommentEvents`) join this file with the comment service (P5).
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
