// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML file kind (spec 024 architecture note 001 § 1, § 3): the shipped
 * HTML comment behaviour behind the {@link CommentFileKind} seam.
 *
 * It only wraps the HTML modules in `../htmlComments/` – the parse5 parse,
 * the anchor builder, the before-target slot, the element check and the
 * `<meta charset>` growth check (C10) – so the
 * shared base can serve HTML without importing them. It is HTML-specific
 * (marked H in the module map) although it lives in this folder, and the
 * shared barrel (`index.ts`) leaves it out so importing the base never loads
 * parse5.
 *
 * HTML picks reach the writer as page tokens (`commentDraftCore.ts`), not as
 * a {@link PickedTarget}; {@link htmlKind}'s `locate` therefore reads only the
 * pick's `path` and `id`, and its `slots` only `ws`. A valid selection is
 * stored as `anchor.sel` and shown to agents as the words hint (C-01); its
 * note is the HTML agent note (C-02).
 */
import { buildAnchor } from '../htmlComments/anchor'
import { HtmlIndex, type IndexedElement } from '../htmlComments/htmlIndex'
import { analyzeCommentDocument, type CommentDocument } from '../htmlComments/parse'
import {
  htmlGrowthCheck,
  htmlSlotOf,
  spliceOriginOf,
  verifyHtmlElements,
  type SpliceOrigin
} from '../htmlComments/splice'
import type {
  CommentFileKind,
  KindDocument,
  KindOrigin,
  KindRefusal,
  PickedTarget
} from './fileKind'
import { HTML_AGENT_NOTE_LINES } from './agentNotes'
import { isAnchorSelection } from './anchorSel'
import type { CommentAnchor, TextQuote } from './format'
import { selectionHints } from './noteLines'
import { findAnchorTarget } from './reattach'
import type { IndexedTarget } from './targetIndex'

const NOT_FOUND: KindRefusal = { refused: 'not-found' }

/**
 * `doc` as the HTML document it must be. A document another kind parsed
 * reaching the HTML kind is a wiring bug, so it throws rather than guess.
 */
function htmlDocOf(doc: KindDocument): CommentDocument {
  if (!(doc.index instanceof HtmlIndex)) throw new Error('The HTML comment kind was given another kind\'s document')
  return { text: doc.text, index: doc.index, state: doc.state }
}

/** The HTML element a target names in `doc`, or `undefined` when none starts there. */
function elementOf(doc: CommentDocument, target: IndexedTarget): IndexedElement | undefined {
  return doc.index.elementAt(target.start)
}

/**
 * `anchor` with the selected words, when they are a valid `anchor.sel`
 * (`anchorSel.ts`); otherwise unchanged, so the comment is about the whole
 * element. Only the three fields are kept, after every anchor field.
 */
function withSelection(anchor: CommentAnchor, sel: TextQuote | undefined): CommentAnchor {
  if (!isAnchorSelection(sel)) return anchor
  return { ...anchor, sel: { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix } }
}

function isHtmlOrigin(origin: KindOrigin): origin is SpliceOrigin {
  return 'tagSequence' in origin && Array.isArray(origin.tagSequence)
}

/** The element a pick names by path, else by a unique `id`; the tag must match either way. */
function locateElement(doc: CommentDocument, pick: PickedTarget): IndexedElement | undefined {
  const byPath = pick.path === undefined ? undefined : doc.index.elementAtPath(pick.path)
  if (byPath?.tag === pick.tag) return byPath
  if (pick.id === undefined) return undefined
  const byId = doc.index.elementsWithId(pick.id).filter(el => el.tag === pick.tag)
  return byId.length === 1 ? byId[0] : undefined
}

/** HTML and HTM files: v0.23.1's behaviour, plus `anchor.sel`, its hint and the HTML agent note. */
export const htmlKind: CommentFileKind = {
  id: 'html',
  extensions: ['.html', '.htm'],
  agentNote: HTML_AGENT_NOTE_LINES,

  parse(text) {
    // The HTML index finds the BOM itself (`indexHtml`).
    return analyzeCommentDocument(text)
  },

  locate(doc, pick) {
    return locateElement(htmlDocOf(doc), pick) ?? NOT_FOUND
  },

  slots(doc, target, pick) {
    const html = htmlDocOf(doc)
    const el = elementOf(html, target)
    return el === undefined ? [] : [htmlSlotOf(html, el, pick?.ws)]
  },

  anchorOf(doc, target, sel) {
    const html = htmlDocOf(doc)
    const el = elementOf(html, target)
    if (el === undefined) throw new Error('The HTML comment kind was given a target outside its document')
    return withSelection(buildAnchor(html.index, el), sel)
  },

  hints: selectionHints,

  reattach(doc, anchor) {
    return findAnchorTarget(htmlDocOf(doc).index, anchor)
  },

  originOf(doc) {
    return spliceOriginOf(htmlDocOf(doc))
  },

  verify(origin, newDoc) {
    if (!isHtmlOrigin(origin)) throw new Error('The HTML comment kind was given another kind\'s origin')
    return verifyHtmlElements(origin, htmlDocOf(newDoc))
  },

  refuseGrowth: htmlGrowthCheck
}
