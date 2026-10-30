// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Small pure parts of the renderer's comment overlay host
 * (`useCommentOverlayHost.ts`): a pick's draft key, the toolbar counts and
 * where a window opened on a target is anchored.
 *
 * @module components/Comments/overlay/hostParts
 */
import { hashText } from '../../../../../shared/comments/blocks'
import type { PickedTargetRequest } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import type { CommentCounts } from '../../../stores/usePreviewCommentStore'

/** A pick's draft key: 128 bits of the target's place, so the same target gets its text back. */
export function draftKeyOf(pick: PickedTargetRequest): string {
  return hashText(`${pick.lineStart}|${pick.tag}|${pick.ordinal}|${pick.quote?.exact ?? ''}`).slice(0, 32)
}

/** Toolbar counts from the list: open, resolved, and what needs attention. */
export function countsOf(file: CommentFileView | null): CommentCounts | null {
  if (file === null) return null
  let open = 0
  let resolved = 0
  let attention = file.damaged.length + file.newer.length
  for (const thread of file.threads) {
    if (thread.status === 'resolved') resolved += 1
    else if (thread.attached) open += 1
    else attention += 1
  }
  return { open, resolved, attention }
}

/** Where a window opened on `el` is anchored: its top-right corner, else the area's upper middle. */
export function pointOf(el: HTMLElement | null, area: HTMLElement | null): { x: number; y: number } {
  const box = el?.getBoundingClientRect() ?? area?.getBoundingClientRect()
  if (box === undefined) return { x: 0, y: 0 }
  return el ? { x: box.right, y: box.top } : { x: box.left + box.width / 2, y: box.top + box.height / 3 }
}

/** The preview's viewport as a pick records it: size, pixel ratio and scroll. */
export function viewOf(el: HTMLElement | null): { w: number; h: number; dpr: number; x: number; y: number } {
  return {
    w: Math.round(el?.clientWidth ?? 0),
    h: Math.round(el?.clientHeight ?? 0),
    dpr: window.devicePixelRatio || 1,
    x: 0,
    y: Math.round(el?.scrollTop ?? 0)
  }
}
