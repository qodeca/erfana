// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the drawer's rows open in a renderer-hosted preview
 * (`useCommentOverlayHost.ts`): the window on a damaged or newer-format
 * block, the one reveal step of "Show in preview", and which threads are
 * "Hidden on the page" (S-02, D-13). Kept apart from the host only because of
 * the 500-line ratchet.
 *
 * @module components/Comments/overlay/hostDrawer
 */
import { useEffect, useMemo, useState } from 'react'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import type { CommentWindowRequest, WindowOpener } from '../commentWindowTypes'
import { pointOf } from './hostParts'
import { drawn } from './hostWindow'
import type { PreviewCommentAdapter } from './previewAdapter'

/** What a threads window opens on, and from where. */
interface ThreadsWindowOn {
  readonly threadKeys: readonly string[]
  readonly blockKeys: readonly string[]
  /** The pane the window is placed in, and the element it opens beside; `null`: the pane's upper middle. */
  readonly area: HTMLElement | null
  readonly anchor: HTMLElement | null
  readonly opener: WindowOpener
  /** A click in the preview opened it with comment mode off. */
  readonly outsideMode?: boolean
}

/**
 * The window on a file's threads, or on a damaged or newer-format block.
 *
 * @param file - The listed file.
 * @param panelId - The panel.
 * @param listAfter - The list generation the window must not be older than.
 * @param on - {@link ThreadsWindowOn}
 * @returns The threads-view request.
 */
export function threadsWindowRequest(file: CommentFileView, panelId: string, listAfter: number, on: ThreadsWindowOn): CommentWindowRequest {
  return {
    kind: 'threads',
    panelId,
    fileKey: file.fileKey,
    threadKeys: on.threadKeys,
    blockKeys: on.blockKeys,
    point: pointOf(on.anchor, on.area),
    opener: on.opener,
    listAfter,
    ...(on.outsideMode === true ? { outsideMode: true as const } : {}),
    file: { fileKey: file.fileKey, displayPath: file.displayPath, filePath: file.filePath, frame: false }
  }
}

/**
 * The one reveal step (I-6, K-22, P-F07): open the sections folding the
 * thread's target away, scroll it in, and say whether it can be seen.
 *
 * @param threadKey - The thread.
 * @param placements - Where main placed the listed threads.
 * @param adapter - The preview's adapter.
 * @returns The target when it is drawn now, else `null`: not rendered, or hidden some other way.
 */
export function revealThread(threadKey: string | undefined, placements: readonly ThreadPlacement[], adapter: PreviewCommentAdapter): HTMLElement | null {
  const placement = placements.find(p => p.threadKey === threadKey)
  const target = placement === undefined ? null : (adapter.renderedOf?.(placement) ?? adapter.attach(placement))
  if (target === null) return null
  adapter.openFolds?.(target)
  target.scrollIntoView({ block: 'center' })
  return drawn(target)
}

/** The preview area's box on screen, for the comment window's placement. */
export function areaBox(area: HTMLElement | null | undefined): { left: number; top: number; width: number; height: number } | null {
  const box = area?.getBoundingClientRect()
  return box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null
}

const NOT_VISIBLE_NONE: readonly string[] = []

/**
 * The open, found threads whose target the preview renders but hides right
 * now – a collapsed section (state table S-02; differences table D-13). They
 * feed the drawer's "Hidden on the page" tag and the window's sentence, as main's
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
