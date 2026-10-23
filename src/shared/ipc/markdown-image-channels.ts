// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown preview image IPC channel names (#71).
 *
 * One `invoke` channel: the Markdown preview asks the main process for the
 * bytes of an image the document references, and gets back a `data:` URL. The
 * handler is sender-gated and path-confined main-side
 * (`src/main/ipc/markdown-image-handlers.ts`).
 */
export const MARKDOWN_IMAGE_CHANNELS = {
  read: 'markdown-image:read'
} as const

export type MarkdownImageChannel =
  (typeof MARKDOWN_IMAGE_CHANNELS)[keyof typeof MARKDOWN_IMAGE_CHANNELS]
