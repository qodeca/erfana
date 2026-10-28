// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pins and counts from a served load (docs/designs/comments/html-preview-comments.md
 * §8 `icons`, §10.1 badge, §10.5, decision 33; tests J-005, M-018).
 *
 * A pin stands on one element – a token, plus a JS-built path below it when
 * the block's anchor has one – and counts what needs reading there: each open
 * thread, and each damaged or newer block (which the overlay draws in the
 * warning colour). A resolved thread has no pin; it stays in the drawer.
 *
 * The page receives a pin's key, token, path, count and status – never a
 * thread id, a text or an author (§4.1 B1').
 */
import type { CommentLoadView } from './ElementTokenTable'

/** One pin, before main gives it a key. */
export interface PinGroup {
  /** Groups blocks on the same element: `token`, plus the runtime path and tag. */
  readonly id: string
  readonly token: string
  readonly runtime?: { readonly path: string; readonly tag: string }
  /** Open threads on the element, in file order. */
  readonly threadIds: readonly string[]
  /** Damaged or newer blocks on the element. */
  readonly attention: number
  /** What the overlay draws: open threads plus blocks that need attention. */
  readonly count: number
  readonly status: 'open' | 'damaged'
}

/** A page's or a file's comment counts (§10.1 badge). */
export interface CommentCounts {
  readonly open: number
  readonly resolved: number
  /** Damaged and newer blocks, and open threads whose element is not in the file. */
  readonly attention: number
}

/** No comments. */
export const NO_COUNTS: CommentCounts = Object.freeze({ open: 0, resolved: 0, attention: 0 })

interface MutableGroup {
  id: string
  token: string
  runtime?: { path: string; tag: string }
  threadIds: string[]
  attention: number
}

/** The pins of one load, in file order of their first block. */
export function groupPins(view: Pick<CommentLoadView, 'blocks'>): PinGroup[] {
  const groups = new Map<string, MutableGroup>()
  for (const block of view.blocks) {
    if (block.token === undefined) continue
    if (block.kind === 'ok' && block.status !== 'open') continue
    const runtime = block.kind === 'ok' ? block.runtime : undefined
    const id = runtime === undefined ? block.token : `${block.token} ${runtime.tag} ${runtime.path}`
    let group = groups.get(id)
    if (group === undefined) {
      group = { id, token: block.token, threadIds: [], attention: 0 }
      if (runtime !== undefined) group.runtime = { path: runtime.path, tag: runtime.tag }
      groups.set(id, group)
    }
    if (block.kind === 'ok' && block.id !== undefined) group.threadIds.push(block.id)
    else group.attention += 1
  }
  return [...groups.values()].map(group => ({
    ...group,
    count: group.threadIds.length + group.attention,
    status: group.attention > 0 ? 'damaged' : 'open'
  }))
}

/** One load's counts. */
export function countsOf(view: Pick<CommentLoadView, 'blocks'>): CommentCounts {
  let open = 0
  let resolved = 0
  let attention = 0
  for (const block of view.blocks) {
    // A resolved thread stays "Resolved" even when its element is gone (§8 drawer mapping).
    if (block.kind !== 'ok') attention += 1
    else if (block.status === 'resolved') resolved += 1
    else if (block.token === undefined) attention += 1
    else open += 1
  }
  return { open, resolved, attention }
}

/** The sum of several files' counts. */
export function addCounts(counts: readonly CommentCounts[]): CommentCounts {
  return counts.reduce(
    (sum, c) => ({ open: sum.open + c.open, resolved: sum.resolved + c.resolved, attention: sum.attention + c.attention }),
    NO_COUNTS
  )
}
