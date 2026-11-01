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
 * thread id, a text or an author (§4.1 B1'). So a mark's click (I-13, C-17)
 * names its pin and the place of its words there (`overlayCore` `markKeyOf`),
 * and main alone turns that into its thread: {@link threadsOfWords}.
 */
import type { AnchorSelection } from '../../../../shared/comments/anchorSel'
import type { CommentLoadView } from './ElementTokenTable'

/** Marked words one pin carries to the page: more threads on one element are still in its pin and the drawer. */
export const PIN_WORDS_MAX = 20

/** One pin, before main gives it a key. */
export interface PinGroup {
  /** Groups blocks on the same element: `token`, plus the runtime path and tag. */
  readonly id: string
  readonly token: string
  readonly runtime?: { readonly path: string; readonly tag: string }
  /** Open conversations on the element, in file order. */
  readonly threadIds: readonly string[]
  /** The words of its open threads that have them, in file order, at most {@link PIN_WORDS_MAX} (C-12). */
  readonly words?: readonly AnchorSelection[]
  /** Which thread has each of {@link words}, in step with them. Main's own: this never goes to the page. */
  readonly wordThreads?: readonly string[]
  /** Damaged or newer blocks on the element. */
  readonly attention: number
  /** What the overlay draws: open threads plus blocks that need attention. */
  readonly count: number
  readonly status: 'open' | 'damaged'
  /** One of its open threads is Changed or Words changed (C-06): the pin is notched. */
  readonly changed?: true
}

/** A page's or a file's comment counts (§10.1 badge). */
export interface CommentCounts {
  readonly open: number
  readonly resolved: number
  /** Damaged blocks only (OD-04: the ▲ counter); newer-format blocks count in neither. */
  readonly attention: number
}

/** No comments. */
export const NO_COUNTS: CommentCounts = Object.freeze({ open: 0, resolved: 0, attention: 0 })

interface MutableGroup {
  id: string
  token: string
  runtime?: { path: string; tag: string }
  threadIds: string[]
  words: AnchorSelection[]
  wordThreads: string[]
  attention: number
  changed?: true
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
      group = { id, token: block.token, threadIds: [], words: [], wordThreads: [], attention: 0 }
      if (runtime !== undefined) group.runtime = { path: runtime.path, tag: runtime.tag }
      groups.set(id, group)
    }
    if (block.kind === 'ok' && block.sel !== undefined && block.id !== undefined && group.words.length < PIN_WORDS_MAX) {
      group.words.push(block.sel)
      group.wordThreads.push(block.id)
    }
    if (block.kind === 'ok' && block.changed === true) group.changed = true
    if (block.kind === 'ok' && block.id !== undefined) group.threadIds.push(block.id)
    else group.attention += 1
  }
  return [...groups.values()].map(({ words, wordThreads, ...group }) => ({
    ...group,
    ...(words.length === 0 ? {} : { words, wordThreads }),
    count: group.threadIds.length + group.attention,
    status: group.attention > 0 ? 'damaged' : 'open'
  }))
}

/**
 * The threads on the words at place `word` of `pin` (I-13): what a click on
 * their mark opens. Two threads on the same words share one mark, so both open.
 * None for a place the pin does not have.
 */
export function threadsOfWords(pin: Pick<PinGroup, 'words' | 'wordThreads'>, word: number): string[] {
  const sel = pin.words?.[word]
  if (sel === undefined) return []
  const same = (words: AnchorSelection): boolean => words.exact === sel.exact && words.prefix === sel.prefix && words.suffix === sel.suffix
  return (pin.words ?? []).flatMap((words, i) => (same(words) ? (pin.wordThreads?.[i] ?? []) : []))
}

/** One load's counts. */
export function countsOf(view: Pick<CommentLoadView, 'blocks'>): CommentCounts {
  let open = 0
  let resolved = 0
  let attention = 0
  for (const block of view.blocks) {
    // OD-04: an open thread is open whether or not its element is found; a
    // newer-format block is in neither count; only a damaged one needs attention.
    if (block.kind === 'damaged') attention += 1
    else if (block.kind !== 'ok') continue
    else if (block.status === 'resolved') resolved += 1
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
