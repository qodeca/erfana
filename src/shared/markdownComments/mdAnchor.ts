// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `@data` anchor of a Markdown block, the words a comment is about, and
 * the target hint (spec 024 design `markdown-format.md` § 5, § 6; 024-FR-004,
 * 024-FR-008; architecture note 001 § 8 C5, C16).
 *
 * The anchor names the CARRIER – the element the block sits right before –
 * by tag, path (and a heading's id), with its rendered text as the quote.
 * When the carrier is not the target (list item 1, a table row or cell, a
 * block inside a block quote, an image, or a later slot before a whole
 * list), the target goes in `anchor.runtime` with `snapshotSource: 'page'`
 * and no snapshot, which the shipped renderer writes as the ` (comment is
 * about <tag> at <path> inside this element)` suffix. `anchor.cls` is never
 * written: classes in Markdown come from plugins, not the author.
 */
import type { CommentAnchor, RuntimeAnchor, TextQuote } from '../comments/format'
import { ANCHOR_ID_MAX_CHARS, ANCHOR_PATH_MAX_CHARS } from '../comments/format'
import { isAnchorSelection, SEL_CONTEXT_MAX_CHARS, type AnchorSelection } from '../comments/anchorSel'
import { headOf, occurrences, tailOf } from '../comments/selectionWords'
import { exactOf, prefixOf, suffixOf } from '../comments/quoteText'
import { PREVIEW_LIMITS } from '../preview-limits'
import { MARKDOWN_SELECTION_SEARCH_MAX_CHARS } from './markdownLimits'
import type { MdIndex, MdTarget } from './mdIndex'

/** The quote of a target: its rendered text and the text around it; none when it has no text. */
export function quoteOf(index: MdIndex, target: MdTarget): TextQuote | undefined {
  const exact = exactOf(index, target)
  if (exact === '') return undefined
  return { exact, prefix: prefixOf(index, target), suffix: suffixOf(index, target) }
}

/**
 * `target`'s path below `carrier`, as the `@data` table writes it: the
 * steps after the carrier's own, with a table's only `thead` or `tbody`
 * named without a position (`tbody > tr:nth-of-type(2)`).
 */
export function runtimePathOf(carrier: MdTarget, target: MdTarget): string {
  const below = target.path.slice(carrier.path.length + ' > '.length)
  return carrier.kind === 'table' ? below.replace(/^(thead|tbody):nth-of-type\(1\)/, '$1') : below
}

/** The target named by `runtime` below `carrier`, if any. */
export function innerTargetOf(index: MdIndex, carrier: MdTarget, runtime: RuntimeAnchor): MdTarget | undefined {
  const prefix = `${carrier.path} > `
  return index.elements.find(
    target => target.tag === runtime.tag && target.path.startsWith(prefix) && runtimePathOf(carrier, target) === runtime.path
  )
}

function runtimeOf(index: MdIndex, carrier: MdTarget, target: MdTarget): RuntimeAnchor {
  const path = runtimePathOf(carrier, target)
  const quote = target.kind === 'image' ? undefined : quoteOf(index, target)
  return {
    path: path.length <= PREVIEW_LIMITS.COMMENT_RUNTIME_PATH_MAX_CHARS ? path : '',
    tag: target.tag,
    ...(quote === undefined ? {} : { quote }),
    snapshotSource: 'page'
  }
}

/** The anchor of a block written before `carrier` about `target` (§ 5). */
export function markdownAnchor(index: MdIndex, carrier: MdTarget, target: MdTarget): CommentAnchor {
  const quote = quoteOf(index, carrier)
  const id = carrier.kind === 'heading' && carrier.id !== undefined && carrier.id !== '' && carrier.id.length <= ANCHOR_ID_MAX_CHARS
  return {
    tag: carrier.tag,
    ...(id ? { id: carrier.id } : {}),
    path: carrier.path.length <= ANCHOR_PATH_MAX_CHARS ? carrier.path : '',
    ...(quote === undefined ? {} : { quote }),
    ...(carrier === target ? {} : { runtime: runtimeOf(index, carrier, target) })
  }
}

const WHITESPACE_RUN = /\s+/g

/** A target's rendered text as a selection reads it: whitespace collapsed, trimmed, NFC. */
function selectableText(index: MdIndex, target: MdTarget): string | undefined {
  if (target.textEnd - target.textStart > MARKDOWN_SELECTION_SEARCH_MAX_CHARS) return undefined
  return index.visibleText.slice(target.textStart, target.textEnd).replace(WHITESPACE_RUN, ' ').trim().normalize('NFC')
}

/**
 * The selected words as `anchor.sel` (024-FR-004, C16): kept only when
 * valid, not blank, inside the target's rendered text on disk, and not the
 * whole text – which makes the comment a block comment. The occurrence the
 * pick's context points at is chosen; prefix and suffix are re-read from
 * the file and widened to 32 code points, and when two occurrences still
 * look the same the words are dropped (the window offers the whole block).
 * The search reads at most {@link MARKDOWN_SELECTION_SEARCH_MAX_CHARS}.
 */
export function markdownSelection(index: MdIndex, target: MdTarget, sel: TextQuote | undefined): AnchorSelection | undefined {
  if (!isAnchorSelection(sel) || sel.exact.trim() === '') return undefined
  const text = selectableText(index, target)
  if (text === undefined || text === sel.exact) return undefined
  const found = occurrences(text, sel.exact)
  const picked = found.filter(at => text.slice(0, at).endsWith(sel.prefix) && text.startsWith(sel.suffix, at + sel.exact.length))
  const at = picked.length > 0 ? picked[0] : found[0]
  if (at === undefined) return undefined
  const prefix = tailOf(text.slice(0, at), SEL_CONTEXT_MAX_CHARS)
  const suffix = headOf(text.slice(at + sel.exact.length), SEL_CONTEXT_MAX_CHARS)
  const twins = found.filter(other => text.slice(0, other).endsWith(prefix) && text.startsWith(suffix, other + sel.exact.length))
  if (twins.length !== 1) return undefined
  const kept = { exact: sel.exact, prefix, suffix }
  return isAnchorSelection(kept) ? kept : undefined
}
