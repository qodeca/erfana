// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Selected words in a renderer-hosted preview's DOM (spec 024 024-FR-004;
 * comments-v2 C-07, C-12): from a live `Range` to a range in the target's
 * collapsed text, and from stored words back to a `Range` for the underline.
 *
 * Both directions read the target's text the way a selection reads it
 * (`shared/comments/selectionWords.ts`): whitespace runs to one space,
 * trimmed. Nothing here writes to the DOM.
 *
 * @module components/Comments/overlay/domWords
 */
import { collapseRange, locateWords, type WordsRange } from '../../../../../shared/comments/selectionWords'
import type { AnchorSelection } from '../../../../../shared/comments/anchorSel'

const SPACE = /\s/

/** A range in a target's text, and whether the selection ran past the target and was cut to it. */
export interface TargetWords extends WordsRange {
  readonly cut: boolean
}

/** Characters of `target`'s text before the boundary point `(node, offset)`. */
function offsetOf(target: HTMLElement, node: Node, offset: number): number {
  const before = target.ownerDocument.createRange()
  before.setStart(target, 0)
  before.setEnd(node, offset)
  return before.toString().length
}

/** `target`'s text as a selection reads it: whitespace collapsed, trimmed, NFC. */
export function targetText(target: HTMLElement): string {
  const raw = target.textContent ?? ''
  return collapseRange(raw, 0, 0).text
}

/**
 * The part of `range` inside `target`, as a range in its collapsed text.
 * A selection that runs past the target's end is cut there (`cut`); the
 * caller passes the target the selection started in.
 *
 * @param target - The target holding the range's start.
 * @param range - The live selection range.
 */
export function wordsInTarget(target: HTMLElement, range: Range): TargetWords {
  const raw = target.textContent ?? ''
  const start = target.contains(range.startContainer) ? offsetOf(target, range.startContainer, range.startOffset) : 0
  const inside = target.contains(range.endContainer)
  const end = inside ? offsetOf(target, range.endContainer, range.endOffset) : raw.length
  return { ...collapseRange(raw, start, end), cut: !inside }
}

/** One character of the collapsed text and where it came from. */
interface Source {
  readonly node: Text
  readonly offset: number
}

/** The collapsed text of `target` with each of its characters' source, for mapping back to the DOM. */
function mappedText(target: HTMLElement): { text: string; at: Source[] } {
  let text = ''
  const at: Source[] = []
  const walker = target.ownerDocument.createTreeWalker(target, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    const data = node.data
    for (let i = 0; i < data.length; i += 1) {
      if (SPACE.test(data[i])) {
        if (text === '' || text.endsWith(' ')) continue
        text += ' '
      } else text += data[i]
      at.push({ node, offset: i })
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1)
    at.pop()
  }
  return { text, at }
}

/**
 * A `Range` over the stored words in `target` now, or `null` when they are
 * gone, ambiguous, or the text is not in NFC (no underline is drawn then).
 */
export function rangeOfWords(target: HTMLElement, sel: AnchorSelection): Range | null {
  const { text, at } = mappedText(target)
  if (text !== text.normalize('NFC')) return null
  const found = locateWords(text, sel)
  if (found === null || found.end <= found.start) return null
  const first = at[found.start]
  const last = at[found.end - 1]
  const range = target.ownerDocument.createRange()
  range.setStart(first.node, first.offset)
  range.setEnd(last.node, last.offset + 1)
  return range
}
