// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preload bridge for images referenced from Markdown (#71): the whole
 * `window.api.markdownImage` surface, typed as {@link MarkdownImageBridge}.
 * A plain pipe – the main process checks the sender, the request shape and
 * the path.
 */
import { ipcRenderer } from 'electron'
import { MARKDOWN_IMAGE_CHANNELS } from '../shared/ipc/markdown-image-channels'
import type { MarkdownImageBridge } from '../shared/ipc/markdown-image-schema'

export const markdownImageBridge: MarkdownImageBridge = {
  read: (request) => ipcRenderer.invoke(MARKDOWN_IMAGE_CHANNELS.read, request)
}
