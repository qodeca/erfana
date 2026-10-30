// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Small pure parts of the renderer's comment overlay host
 * (`useCommentOverlayHost.ts`): a pick's draft key, the toolbar counts, a
 * target's open threads and spoken name, and where a window opened on a
 * target is anchored.
 *
 * @module components/Comments/overlay/hostParts
 */
import { hashText } from '../../../../../shared/comments/blocks'
import type { PickedTargetRequest, ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import type { CommentCounts } from '../../../stores/usePreviewCommentStore'
import { MD_SPOKEN_COPY, SPOKEN_EXCERPT_MAX_CHARS, type CommentWords } from '../commentCopyWords'
import { listCounts } from '../commentRows'
import type { PreviewCommentAdapter } from './previewAdapter'

/** A pick's draft key: 128 bits of the target's place, so the same target gets its text back. */
export function draftKeyOf(pick: PickedTargetRequest): string {
  return hashText(`${pick.lineStart}|${pick.tag}|${pick.ordinal}|${pick.quote?.exact ?? ''}`).slice(0, 32)
}

/**
 * Toolbar counts from the list (OD-04; state table § 1 "Toolbar"): `open` is
 * every open comment, found or not; `attention` is the damaged comments only,
 * the ▲ badge; newer-format comments count in neither.
 */
export function countsOf(file: CommentFileView | null): CommentCounts | null {
  if (file === null) return null
  const { open, resolved, damaged } = listCounts([file])
  return { open, resolved, attention: damaged }
}

/** The toolbar's counts ({@link countsOf}) and its changed count (R-14), read once from the list. */
export function toolbarCounts(file: CommentFileView | null): { readonly counts: CommentCounts | null; readonly changed: number } {
  return { counts: countsOf(file), changed: file === null ? 0 : listCounts([file]).changed }
}

/**
 * The open threads attached to `target` now, in list order (C-22: a click on
 * a commented target opens them instead of a blank new comment).
 *
 * @returns Their thread keys; empty when the target has none.
 */
export function threadsOn(
  target: HTMLElement,
  adapter: PreviewCommentAdapter,
  placements: readonly ThreadPlacement[],
  file: CommentFileView | null
): string[] {
  const open = new Set(file?.threads.filter(t => t.status === 'open' && t.attached).map(t => t.threadKey) ?? [])
  return placements.filter(p => open.has(p.threadKey) && adapter.attach(p) === target).map(p => p.threadKey)
}

/**
 * What the picker says about `target` (C-10): its kind, line, opening words
 * and open comments – the rendered text and main's list, never an id or a class.
 */
export function spokenTarget(
  target: HTMLElement,
  adapter: PreviewCommentAdapter,
  placements: readonly ThreadPlacement[],
  file: CommentFileView | null
): string {
  const text = collapsedWords(target.textContent ?? '')
  const excerpt = text.length > SPOKEN_EXCERPT_MAX_CHARS ? `${text.slice(0, SPOKEN_EXCERPT_MAX_CHARS).trimEnd()}…` : text
  const count = threadsOn(target, adapter, placements, file).length
  return MD_SPOKEN_COPY.target(adapter.words.noun(adapter.tagOf(target)), adapter.lineOf(target), excerpt, count)
}

/** Whitespace runs to one space, trimmed. */
function collapsedWords(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
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

/**
 * Why `file` takes no new comment – read-only, or full at 500 comments, where
 * replies, edits and resolves still work (spec 024 state table F-04) – as the
 * window, the menu and the mode tooltip word it; `null` when it takes one.
 */
export function noNewCommentText(file: CommentFileView | null, fileName: string, words: CommentWords): string | null {
  if (file === null) return null
  if (!file.writable) return words.readOnlyReasonText(file.readOnlyReason, fileName)
  return file.addRefusal === undefined ? null : words.readOnlyReasonText(file.addRefusal, fileName)
}
