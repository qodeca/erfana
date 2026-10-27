// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A bounded scan of an HTML document's elements that builds no tree, for the
 * preview's link extractor (issue #124, security audit).
 *
 * Why no tree. `linkExtract` used to build a whole parse5 document on the main
 * thread at every preview load, and parse5's tree construction makes some small
 * pages very expensive: reconstructing the open formatting elements re-creates
 * every unclosed `<b>`, `<font>`, … inside each new block (23 KB, 5,402 start
 * tags: 2,005,405 elements), and an end tag that matches nothing walks the whole
 * stack of open elements (220 KB: 10 s). Links need only the start tags, their
 * attributes and the text of `<style>`. So this runs parse5's spec tokenizer
 * alone – one linear pass – and repeats the little feedback the tree builder
 * gives the tokenizer, after parse5's own `ParserFeedbackSimulator`
 * (`parse5-sax-parser`):
 *
 *   - a raw-text element switches the tokenizer's state, so the text of
 *     `<script>`, `<style>`, `<textarea>`, `<title>`, `<xmp>`, `<iframe>`,
 *     `<noembed>`, `<noframes>`, `<noscript>` and `<plaintext>` hides markup as
 *     it does in a browser;
 *   - `<svg>` and `<math>` content is foreign: there `<style>` is an ordinary
 *     element, CDATA sections are text, tag and attribute names are adjusted
 *     (`xlink:href` reads as `href`), and an HTML-only tag breaks back out;
 *   - `<image>` reads as `<img>`;
 *   - the content of an HTML `<template>` is inert and is not reported – the
 *     tree walk never saw it either, as it lives in the template's fragment.
 *
 * This is not a tree builder, so markup that only a tree builder repairs can
 * read differently: an element it drops inside `<select>`, a repeated `<body>`
 * whose attributes it merges, table content it moves ahead of the table, the
 * text after the first child tag of an SVG `<style>`. That can add, drop or
 * reorder a watch candidate, never more; each candidate is still confined to
 * the project before it is watched or read. `linkExtract.parity.test.ts` holds
 * the scan to the former tree walk over the preview corpus.
 *
 * Bounds. The tokenizer is linear in its input but for one step: it checks each
 * new attribute of a tag against every earlier one (40,000 attributes on one
 * tag: 6.5 s). That check is replaced by a set lookup, and attributes past
 * `MAX_ATTRIBUTES_PER_TAG` on a tag are dropped. A document is scanned up to
 * `MAX_SCAN_CHARS`, the bound the pipeline's reader already applies, so the scan
 * bounds its own work whoever calls it. A bound reached is reported once, never
 * thrown.
 */
import {
  Tokenizer,
  TokenizerMode,
  foreignContent,
  html,
  type Token,
  type TokenHandler
} from 'parse5'

import { PREVIEW } from '../../../shared/constants'

const $ = html.TAG_ID
const NS = html.NS

/**
 * Attributes kept on one tag; later ones are dropped. A real element carries
 * tens. The cap bounds what one element hands the extractor, whose attribute
 * lookups read the list.
 */
export const MAX_ATTRIBUTES_PER_TAG = 1024

/** The longest document scanned, in UTF-16 code units: never more than the bytes read. */
export const MAX_SCAN_CHARS = PREVIEW.MAX_ENTRY_HTML_BYTES

/** A bound a scan reached: attributes dropped past the cap, or a document cut short. */
export type HtmlScanLimit = 'attributes-per-tag' | 'document-length'

/** One element of a document, as the scan meets it. */
export interface ScannedElement {
  /** Lower-case for HTML; case-adjusted for SVG, as in the DOM (`foreignObject`). */
  readonly tagName: string
  /** The first of a repeated name wins; at most `MAX_ATTRIBUTES_PER_TAG`. */
  readonly attrs: readonly Token.Attribute[]
  /** A `<style>` element's text nodes, in order; empty for any other element. */
  readonly texts: readonly string[]
}

type TextMode = (typeof TokenizerMode)[keyof typeof TokenizerMode]

/** The tokenizer state the tree builder sets after each raw-text HTML start tag. */
const TEXT_MODES: ReadonlyMap<html.TAG_ID, TextMode> = new Map([
  [$.TITLE, TokenizerMode.RCDATA],
  [$.TEXTAREA, TokenizerMode.RCDATA],
  [$.STYLE, TokenizerMode.RAWTEXT],
  [$.XMP, TokenizerMode.RAWTEXT],
  [$.IFRAME, TokenizerMode.RAWTEXT],
  [$.NOEMBED, TokenizerMode.RAWTEXT],
  [$.NOFRAMES, TokenizerMode.RAWTEXT],
  // parse5 parses as a browser with scripting on: `<noscript>` holds raw text.
  [$.NOSCRIPT, TokenizerMode.RAWTEXT],
  [$.SCRIPT, TokenizerMode.SCRIPT_DATA],
  [$.PLAINTEXT, TokenizerMode.PLAINTEXT]
])

/** What a NUL in foreign content becomes, as in the tree builder. */
const REPLACEMENT_CHARACTER = '\uFFFD'

const NO_TEXT: readonly string[] = Object.freeze([])

/**
 * parse5's tokenizer, checking a tag's attribute names in constant time and
 * keeping at most `MAX_ATTRIBUTES_PER_TAG` of them.
 */
class BoundedTokenizer extends Tokenizer {
  /** Whether an attribute past the cap was dropped. */
  droppedAttributes = false
  /** The tag `names` belongs to. */
  private namesOf: Token.TagToken | null = null
  /** The names of the attributes kept on `namesOf`. */
  private readonly names = new Set<string>()

  /**
   * The one place parse5 adds an attribute to a tag. parse5 first looks for the
   * name among all the tag's earlier attributes, so a tag of many attributes is
   * quadratic – 40,000 took 6.5 s, and even 256 per tag kept 4 MiB busy for
   * 1.6 s. A set of the tag's names makes that check constant. As in parse5,
   * the first of a repeated name wins; without source locations, which the scan
   * never asks for, keeping the attribute is all parse5's own step does.
   */
  protected override _leaveAttrName(): void {
    const token = this.currentToken
    if (token === null || !('attrs' in token)) {
      super._leaveAttrName()
      return
    }
    if (token !== this.namesOf) {
      this.namesOf = token
      this.names.clear()
    }
    const attribute = this.currentAttr
    if (this.names.has(attribute.name)) {
      return
    }
    if (token.attrs.length >= MAX_ATTRIBUTES_PER_TAG) {
      this.droppedAttributes = true
      return
    }
    this.names.add(attribute.name)
    token.attrs.push(attribute)
  }
}

/** A `<style>` element still being read. */
interface OpenStyle {
  readonly tagName: string
  readonly attrs: readonly Token.Attribute[]
  readonly texts: string[]
  /** The text node being read. */
  text: string
}

/** The token handler: tracks what the tree builder would tell the tokenizer. */
class ElementScan implements TokenHandler {
  readonly tokenizer: BoundedTokenizer
  private readonly onElement: (element: ScannedElement) => void
  /** The namespaces entered, innermost last; push and pop, so a deep nest costs no shifting. */
  private readonly namespaces: html.NS[] = [NS.HTML]
  /** HTML `<template>` elements open: their content is inert. */
  private templateDepth = 0
  private style: OpenStyle | null = null

  constructor(onElement: (element: ScannedElement) => void) {
    this.onElement = onElement
    this.tokenizer = new BoundedTokenizer({ sourceCodeLocationInfo: false }, this)
  }

  onStartTag(token: Token.TagToken): void {
    this.closeStyle()
    const inert = this.templateDepth > 0
    const root = token.tagID === $.SVG ? NS.SVG : token.tagID === $.MATH ? NS.MATHML : null
    if (root !== null) {
      this.enter(root)
    }
    if (!this.inForeign()) {
      this.startHtml(token)
    } else if (foreignContent.causesExit(token)) {
      // An HTML-only tag closes the foreign elements up to the nearest HTML context.
      while (this.inForeign()) {
        this.leave()
      }
      this.startHtml(token)
    } else {
      this.startForeign(token)
    }
    // A self-closed `<svg/>` holds nothing, so it opens no namespace.
    if (root !== null && token.selfClosing) {
      this.leave()
    }
    if (!inert) {
      this.report(token)
    }
  }

  onEndTag(token: Token.TagToken): void {
    this.closeStyle()
    if (!this.inForeign()) {
      if (token.tagID === $.TEMPLATE && this.templateDepth > 0) {
        this.templateDepth -= 1
      }
      this.leaveIntegrationPoint(token)
      return
    }
    const current = this.namespace()
    if (
      (token.tagID === $.SVG && current === NS.SVG) ||
      (token.tagID === $.MATH && current === NS.MATHML)
    ) {
      this.leave()
    }
  }

  onCharacter(token: Token.CharacterToken): void {
    this.appendText(token.chars)
  }

  onWhitespaceCharacter(token: Token.CharacterToken): void {
    this.appendText(token.chars)
  }

  onNullCharacter(): void {
    // Raw text turns a NUL into U+FFFD itself; in foreign content the tree
    // builder does, and in HTML content it drops it.
    if (this.inForeign()) {
      this.appendText(REPLACEMENT_CHARACTER)
    }
  }

  onComment(): void {
    // A comment in an SVG `<style>` splits its text into two text nodes.
    if (this.style !== null) {
      this.endText(this.style)
    }
  }

  onDoctype(): void {}

  onEof(): void {
    this.closeStyle()
  }

  private namespace(): html.NS {
    return this.namespaces[this.namespaces.length - 1]
  }

  private inForeign(): boolean {
    return this.namespace() !== NS.HTML
  }

  private enter(namespace: html.NS): void {
    this.namespaces.push(namespace)
    this.tokenizer.inForeignNode = this.inForeign()
  }

  private leave(): void {
    if (this.namespaces.length > 1) {
      this.namespaces.pop()
    }
    this.tokenizer.inForeignNode = this.inForeign()
  }

  /** An HTML start tag: `<image>` is `<img>`, a raw-text tag switches the tokenizer. */
  private startHtml(token: Token.TagToken): void {
    if (token.tagID === $.IMAGE) {
      token.tagName = html.TAG_NAMES.IMG
      token.tagID = $.IMG
    }
    const mode = TEXT_MODES.get(token.tagID)
    if (mode !== undefined) {
      this.tokenizer.state = mode
    }
    if (token.tagID === $.TEMPLATE) {
      this.templateDepth += 1
    }
  }

  /** A foreign start tag: the tree builder's name adjustments, then any integration point. */
  private startForeign(token: Token.TagToken): void {
    const current = this.namespace()
    if (current === NS.MATHML) {
      foreignContent.adjustTokenMathMLAttrs(token)
    } else if (current === NS.SVG) {
      foreignContent.adjustTokenSVGTagName(token)
      foreignContent.adjustTokenSVGAttrs(token)
    }
    foreignContent.adjustTokenXMLAttrs(token)
    if (!token.selfClosing && foreignContent.isIntegrationPoint(token.tagID, current, token.attrs)) {
      this.enter(NS.HTML)
    }
  }

  /** The end of an integration point (`</foreignObject>`, …) returns to its foreign parent. */
  private leaveIntegrationPoint(token: Token.TagToken): void {
    const outer = this.namespaces[this.namespaces.length - 2]
    if (outer === undefined) {
      return
    }
    let tagID = token.tagID
    if (outer === NS.SVG) {
      const adjusted = foreignContent.SVG_TAG_NAMES_ADJUSTMENT_MAP.get(token.tagName)
      if (adjusted !== undefined) {
        tagID = html.getTagID(adjusted)
      }
    }
    if (foreignContent.isIntegrationPoint(tagID, outer, token.attrs)) {
      this.leave()
    }
  }

  /** Report an element, or open a `<style>` to report once its text is read. */
  private report(token: Token.TagToken): void {
    // A self-closed SVG `<style/>` is empty; an HTML `<style/>` still opens raw text.
    if (token.tagName === 'style' && !(token.selfClosing && this.inForeign())) {
      this.style = { tagName: token.tagName, attrs: token.attrs, texts: [], text: '' }
      return
    }
    this.onElement({ tagName: token.tagName, attrs: token.attrs, texts: NO_TEXT })
  }

  private appendText(chars: string): void {
    if (this.style !== null) {
      this.style.text += chars
    }
  }

  private endText(style: OpenStyle): void {
    if (style.text !== '') {
      style.texts.push(style.text)
      style.text = ''
    }
  }

  /**
   * Report the open `<style>`. An HTML one ends at `</style>` (raw text admits
   * no other tag); an SVG one at its first tag, so its text after a child
   * element is not read.
   */
  private closeStyle(): void {
    const style = this.style
    if (style === null) {
      return
    }
    this.style = null
    this.endText(style)
    this.onElement({ tagName: style.tagName, attrs: style.attrs, texts: style.texts })
  }
}

/**
 * Call `onElement` for each element of `markup` outside template content, in
 * document order, and return the bounds the scan reached – each once, none
 * when the whole document was read in full.
 *
 * @param markup - an HTML document, or a `srcdoc` frame's markup
 * @param onElement - called once per element; a `<style>` once its text is read
 */
export function scanHtmlElements(
  markup: string,
  onElement: (element: ScannedElement) => void
): HtmlScanLimit[] {
  const scan = new ElementScan(onElement)
  const cut = markup.length > MAX_SCAN_CHARS
  scan.tokenizer.write(cut ? markup.slice(0, MAX_SCAN_CHARS) : markup, true)

  const limits: HtmlScanLimit[] = []
  if (scan.tokenizer.droppedAttributes) {
    limits.push('attributes-per-tag')
  }
  if (cut) {
    limits.push('document-length')
  }
  return limits
}
