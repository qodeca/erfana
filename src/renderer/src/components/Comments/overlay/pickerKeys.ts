// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard picker of a renderer-hosted preview (spec 024 024-NFR-006,
 * 024-AC-029; comments-v2 C-08; differences table A-15, D-31). The keys and the
 * moves are the overlay core's (`overlayCore/pickerKeys`), the same rule the
 * HTML page's preload runs; this is what a level is in a preview that names its
 * targets through an adapter, and the sentences both previews say at an end.
 *
 * Pure apart from reading the adapter.
 *
 * @module components/Comments/overlay/pickerKeys
 */
import type { PickerEnd, PickerTree } from '../../../../../shared/comments/overlayCore/pickerKeys'
import { ANNOUNCE } from '../commentCopy'
import { WINDOW_COPY } from '../commentWindowCopy'
import type { PreviewCommentAdapter } from './previewAdapter'

/**
 * The adapter's targets as the picker walks them: a target's level is the
 * targets with the same parent target. A target no longer drawn has no parent,
 * so a remembered way back through it ends.
 *
 * @param adapter - The preview's adapter.
 * @returns The tree.
 */
export function previewTree(adapter: PreviewCommentAdapter): PickerTree<HTMLElement> {
  return {
    parent: node => (node.isConnected ? adapter.parentOf(node) : null),
    firstChild: node => adapter.childOf(node),
    sibling(node, forward) {
      const order = adapter.targetsInOrder()
      const level = adapter.parentOf(node)
      const step = forward ? 1 : -1
      for (let at = order.indexOf(node) + step; at >= 0 && at < order.length; at += step) {
        const other = order[at] as HTMLElement
        // Document order: past the parent's last target, nothing further can be at this level.
        if (level?.contains(other) === false) return null
        if (adapter.parentOf(other) === level) return other
      }
      return null
    }
  }
}

/**
 * What the picker says at an end, in both previews (A-06, C-10).
 *
 * @param end - The end reached.
 * @param noun - The word for the target the picker is on (D-04).
 * @returns The sentence.
 */
export function pickerEndSentence(end: PickerEnd, noun: string): string {
  if (end === 'top') return ANNOUNCE.pickerTop
  if (end === 'no-child') return ANNOUNCE.pickerNoChild
  return end === 'last' ? WINDOW_COPY.pickerLast(noun) : WINDOW_COPY.pickerFirst(noun)
}

/**
 * The first target whose top is inside `viewport` (C-08.2, menu matrix § 4),
 * else the first target below it, else the first at all.
 */
export function firstTargetInView(adapter: PreviewCommentAdapter, viewport: DOMRect | null): HTMLElement | null {
  const order = adapter.targetsInOrder()
  if (viewport === null) return order[0] ?? null
  const inView = order.find(el => {
    const top = el.getBoundingClientRect().top
    return top >= viewport.top && top < viewport.bottom
  })
  return inView ?? order.find(el => el.getBoundingClientRect().top >= viewport.top) ?? order[0] ?? null
}
