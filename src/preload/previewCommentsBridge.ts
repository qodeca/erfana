// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload HTML Preview comments bridge (docs/designs/comments/html-preview-comments.md
 * §8): the whole `window.api.previewComments` surface, typed as
 * {@link PreviewCommentsBridge} (the shared contract in
 * `preview-comment-schema.ts`). Channel names come from
 * `preview-comment-channels.ts`.
 *
 * Erfana's own window only – the previewed page has its own preload and never
 * this one. A request names a panel and main-minted keys, never a path to
 * write or an author: main reads the reviewer from its own settings.
 */
import { ipcRenderer } from 'electron'
import { PreviewCommentChannels, PreviewCommentEvents } from '../shared/ipc/preview-comment-channels'
import type { PreviewCommentsBridge } from '../shared/ipc/preview-comment-schema'
import { subscribe } from './ipcSubscribe'

export const previewCommentsBridge: PreviewCommentsBridge = {
  setMode: (request) => ipcRenderer.invoke(PreviewCommentChannels.SET_MODE, request),
  list: (panelId) => ipcRenderer.invoke(PreviewCommentChannels.LIST, { panelId }),
  reveal: (panelId, threadKey) =>
    ipcRenderer.invoke(PreviewCommentChannels.COMMAND, { panelId, command: 'reveal', threadKey }),
  keepDraft: (panelId, draftToken) =>
    ipcRenderer.invoke(PreviewCommentChannels.COMMAND, { panelId, command: 'keep-draft', draftToken }),
  save: (request) => ipcRenderer.invoke(PreviewCommentChannels.SAVE, request),
  setUnsavedSources: (paths) =>
    ipcRenderer.invoke(PreviewCommentChannels.SET_UNSAVED_SOURCES, { paths: [...paths] }),
  onDraftOpened: (callback) => subscribe(PreviewCommentEvents.DRAFT_OPENED, callback),
  onCommentsChanged: (callback) => subscribe(PreviewCommentEvents.COMMENTS_CHANGED, callback),
  onAnchorStatus: (callback) => subscribe(PreviewCommentEvents.ANCHOR_STATUS, callback),
  onModeChanged: (callback) => subscribe(PreviewCommentEvents.MODE_CHANGED, callback),
  onSaveSettled: (callback) => subscribe(PreviewCommentEvents.SAVE_SETTLED, callback)
}
