// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the drawer's rows open in a renderer-hosted preview
 * (`useCommentOverlayHost.ts`): the window on a damaged or newer-format
 * block, and where a row's thread is in the preview now. Kept apart from the
 * host only because of the 500-line ratchet.
 *
 * @module components/Comments/overlay/hostDrawer
 */
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import type { DrawerRow } from '../commentRows'
import type { CommentWindowRequest } from '../commentWindowTypes'
import { pointOf } from './hostParts'
import type { PreviewCommentAdapter } from './previewAdapter'

/**
 * The window a block row's Open asks for: the block's raw text and its actions.
 *
 * @param file - The listed file.
 * @param blockKey - The damaged or newer-format block.
 * @param panelId - The panel.
 * @param area - The pane the window is placed in.
 * @param listAfter - The list generation the window must not be older than.
 * @returns The threads-view request on that block.
 */
export function blockWindowRequest(
  file: CommentFileView,
  blockKey: string,
  panelId: string,
  area: HTMLElement | null,
  listAfter: number
): CommentWindowRequest {
  return {
    kind: 'threads',
    panelId,
    fileKey: file.fileKey,
    threadKeys: [],
    blockKeys: [blockKey],
    point: pointOf(null, area),
    opener: 'drawer',
    listAfter,
    file: { fileKey: file.fileKey, displayPath: file.displayPath, filePath: file.filePath, frame: false }
  }
}

/**
 * The element a row's thread is attached to now, or `null` ("Show in preview").
 *
 * @param row - The drawer row.
 * @param placements - Where main placed the listed threads.
 * @param adapter - The preview's adapter.
 * @returns The rendered target.
 */
export function rowTarget(row: DrawerRow, placements: readonly ThreadPlacement[], adapter: PreviewCommentAdapter): HTMLElement | null {
  const placement = placements.find(p => p.threadKey === row.threadKey)
  return placement === undefined ? null : adapter.attach(placement)
}
