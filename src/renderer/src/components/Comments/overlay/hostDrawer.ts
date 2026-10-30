// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the drawer's rows open in a renderer-hosted preview
 * (`useCommentOverlayHost.ts`): the window on a damaged or newer-format
 * block, where a row's thread is in the preview now, and which threads are
 * "Not visible now" (S-02, D-13). Kept apart from the host only because of
 * the 500-line ratchet.
 *
 * @module components/Comments/overlay/hostDrawer
 */
import { useEffect, useMemo, useState } from 'react'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import { DRAWER_COPY } from '../commentCopy'
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

/**
 * A row's "Show in preview": its target scrolled into view, or – while the
 * target is hidden (S-02) – the HTML Preview's sentence that it is not on
 * screen right now.
 */
export function revealRow(
  row: DrawerRow,
  placements: readonly ThreadPlacement[],
  adapter: PreviewCommentAdapter,
  say: (text: string) => void
): void {
  const target = rowTarget(row, placements, adapter)
  if (target !== null) target.scrollIntoView({ block: 'center' })
  else if (row.tags.some(tag => tag.text === DRAWER_COPY.notVisible)) say(adapter.words.notOnScreen)
}

const NOT_VISIBLE_NONE: readonly string[] = []

/**
 * The open, found threads whose target the preview renders but hides right
 * now – a collapsed section (state table S-02; differences table D-13). They
 * feed the drawer's "Not visible now" tag and the window's sentence, as main's
 * report does for the HTML Preview. Read again when a section opens or closes
 * (`toggle`, which does not bubble, is caught on its way down) and whenever
 * the list changes.
 *
 * @param live - The host is shown.
 * @param adapter - The preview's adapter; one without `hiddenNow` hides nothing.
 * @param placements - Where main placed the listed threads.
 * @param file - The listed file.
 * @param scroller - The preview's scroller, where `toggle` is caught.
 * @returns The hidden threads' keys; the same empty list while there are none.
 */
export function useNotVisible(
  live: boolean,
  adapter: PreviewCommentAdapter,
  placements: readonly ThreadPlacement[],
  file: CommentFileView | null,
  scroller: HTMLElement | null
): readonly string[] {
  const [toggles, setToggles] = useState(0)
  useEffect(() => {
    if (!live || scroller === null) return undefined
    const onToggle = (): void => setToggles(n => n + 1)
    scroller.addEventListener('toggle', onToggle, true)
    return () => scroller.removeEventListener('toggle', onToggle, true)
  }, [live, scroller])
  return useMemo(() => {
    const hiddenNow = adapter.hiddenNow
    // `toggles`: the same inputs, a section opened or closed since – a new answer.
    if (!live || hiddenNow === undefined || file === null || toggles < 0) return NOT_VISIBLE_NONE
    const open = new Set(file.threads.filter(t => t.status === 'open' && t.attached).map(t => t.threadKey))
    const hidden = placements.filter(p => open.has(p.threadKey) && hiddenNow(p)).map(p => p.threadKey)
    return hidden.length === 0 ? NOT_VISIBLE_NONE : hidden
  }, [live, adapter, placements, file, toggles])
}
