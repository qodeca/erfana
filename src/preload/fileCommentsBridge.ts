// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload bridge for comments in renderer-hosted previews (spec 024
 * architecture note 001 § 4): the whole `window.api.fileComments` surface,
 * typed as {@link FileCommentsBridge} (`file-comment-schema.ts`). Channel
 * names come from `file-comment-channels.ts`.
 *
 * Erfana's own window only – this is the MAIN-WINDOW preload; the previewed
 * HTML page has its own preload and can reach none of this. A request names
 * a panel and the file it shows, a main-minted draft token or keys – never an
 * author: main reads the reviewer from its own settings. In the renderer,
 * only `services/comments/fileCommentGateway.ts` reads this bridge (lint rule).
 */
import { ipcRenderer } from 'electron'
import { FileCommentChannels, FileCommentEvents } from '../shared/ipc/file-comment-channels'
import type { FileCommentsBridge } from '../shared/ipc/file-comment-schema'
import { subscribe } from './ipcSubscribe'

export const fileCommentsBridge: FileCommentsBridge = {
  list: (request) => ipcRenderer.invoke(FileCommentChannels.LIST, request),
  openDraft: (request) => ipcRenderer.invoke(FileCommentChannels.OPEN_DRAFT, request),
  save: (request) => ipcRenderer.invoke(FileCommentChannels.SAVE, request),
  onChanged: (callback) => subscribe(FileCommentEvents.CHANGED, callback)
}
