// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One parse5 pass over an HTML file, shared by every comment module
 * (docs/designs/html-preview-comments.md §4.2 "one shared parse", §5.5, §5.6).
 *
 * The comment format is located, anchored, spliced and instrumented from the
 * same tree, so they can never disagree about where an element starts. The
 * index records, in one iterative walk (no recursion – a page nested thousands
 * of levels deep must not overflow the stack):
 *
 * - every **eligible** element – one that has its own start tag in the source
 *   (implied `html`/`head`/`body`/`tbody` have none), is not `html` or `head`,
 *   is not inside `head` and is not inside `<template>` content (§5.6). parse5
 *   gives an element rebuilt by "reconstruct the active formatting elements"
 *   the SAME start tag as the original; only the first element in tree order
 *   owns a start-tag offset, so two elements never claim one insertion point;
 * - every comment node, template content included, in **source** order;
 * - the readable text of the page (text nodes outside `script`, `style`,
 *   `noscript`, `noembed`, `noframes` and template content), with each eligible
 *   element's range in it, for text-quote anchors.
 *
 * Offsets are UTF-16 offsets into the text EXACTLY as passed in. A leading BOM
 * is kept in that text (so `encode(text)` gives the file's bytes back) but is
 * hidden from parse5, which would otherwise read U+FEFF as body text and drop
 * the doctype into quirks mode; every offset is shifted past it, so nothing can
 * ever be inserted before the BOM.
 */
import { parse, type DefaultTreeAdapterMap } from 'parse5-v0.23.1'
import { BOM_CHAR } from './encoding'
import { boundedTreeAdapter, parseLimitsFor, type HtmlParseLimits } from './parseBounds'

type ChildNode = DefaultTreeAdapterMap['childNode']
type ParentNode = DefaultTreeAdapterMap['parentNode']
type CommentNode = DefaultTreeAdapterMap['commentNode']
type TextNode = DefaultTreeAdapterMap['textNode']
type TemplateNode = DefaultTreeAdapterMap['template']
/** A parse5 element node. */
export type Parse5Element = DefaultTreeAdapterMap['element']
/** A parse5 document node. */
export type Parse5Document = DefaultTreeAdapterMap['document']

/** Ancestors that keep whitespace as written: a line-start target inside one is placed mid-line (R3-8). */
const PREFORMATTED_TAGS: ReadonlySet<string> = new Set(['pre', 'textarea', 'listing', 'plaintext'])

/** Elements whose text is not page text (never rendered, or script). */
const NON_TEXT_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'noscript',
  'noembed',
  'noframes',
  'template'
])

/** Unique per document, so a CSS path names them without `:nth-of-type`. */
const SINGLETON_TAGS: ReadonlySet<string> = new Set(['html', 'head', 'body'])

/** The characters the HTML tokenizer ends a tag name on. */
const TAG_NAME_END = /[\t\n\f\r />]/

/** ASCII whitespace, which splits a `class` attribute. */
const ASCII_WHITESPACE = /[\t\n\f\r ]+/

/** Joins the segments of a CSS path ({@link HtmlIndex.pathOf}); a tag name never holds a space. */
const PATH_SEPARATOR = ' > '
const NTH_OF_TYPE = ':nth-of-type('
/** A position as {@link HtmlIndex.segmentOf} writes it: no sign, no leading zero. */
const NTH_DIGITS = /^[1-9]\d*$/

/** One element that may receive a comment block before its start tag. */
export interface IndexedElement {
  readonly node: Parse5Element
  /** parse5's tag name (lowercase for HTML, adjusted case for SVG such as `foreignObject`). */
  readonly tag: string
  /** Offset of the start tag's `<`. */
  readonly start: number
  /** Offset just after the tag name as written, where an attribute can be inserted. */
  readonly nameEnd: number
  /** The `id` attribute, when present. */
  readonly id: string | undefined
  /** The `class` attribute's tokens, in order. */
  readonly classes: readonly string[]
  /** Has a `pre`, `textarea`, `listing` or `plaintext` ancestor. */
  readonly preformatted: boolean
  /** Start of the element's text in {@link HtmlIndex.visibleText}. */
  readonly textStart: number
  /** End of the element's text in {@link HtmlIndex.visibleText}. */
  readonly textEnd: number
}

/** One comment node of the document. */
export interface IndexedComment {
  /** Offset of `<!--`. */
  readonly start: number
  /** Offset just after the comment's closing `>` (the end of the file when unterminated). */
  readonly end: number
  /** The comment text between `<!--` and `-->`, as parse5 reports it. */
  readonly data: string
  /** Lies inside `<template>` content. */
  readonly inTemplate: boolean
  /** The parent element, or `null` at document or template-content level. */
  readonly parent: Parse5Element | null
}

interface WalkContext {
  readonly inTemplate: boolean
  readonly inHead: boolean
  readonly preformatted: boolean
  readonly skipText: boolean
}

type Visit =
  | { readonly kind: 'enter'; readonly node: ChildNode; readonly ctx: WalkContext }
  | { readonly kind: 'exit'; readonly record: MutableElement }

type MutableElement = { -readonly [K in keyof IndexedElement]: IndexedElement[K] }

const ROOT_CONTEXT: WalkContext = {
  inTemplate: false,
  inHead: false,
  preformatted: false,
  skipText: false
}

function isElement(node: ChildNode): node is Parse5Element {
  return 'tagName' in node
}

function isTemplate(node: Parse5Element): node is TemplateNode {
  return node.tagName === 'template' && 'content' in node
}

/** The value of attribute `name` on a parse5 element, if present. */
export function attributeOf(node: Parse5Element, name: string): string | undefined {
  return node.attrs.find(attr => attr.name === name)?.value
}

/**
 * The parsed document plus the lookups every comment module needs. Build it
 * with {@link indexHtml}; it is immutable once built.
 */
export class HtmlIndex {
  readonly elements: readonly IndexedElement[]
  readonly comments: readonly IndexedComment[]
  /** The tag of EVERY element, implied and template ones included, in tree order. */
  readonly tagSequence: readonly string[]
  private readonly byStart: ReadonlyMap<number, IndexedElement>
  private readonly byNode: ReadonlyMap<Parse5Element, IndexedElement>
  private readonly nthOfType: WeakMap<Parse5Element, number>
  private idMap: Map<string, IndexedElement[]> | undefined
  /** Per parent visited by {@link HtmlIndex.elementAtPath}: its element children by tag, in order. */
  private readonly childrenByTag = new Map<ParentNode, Map<string, Parse5Element[]>>()

  constructor(
    readonly text: string,
    readonly bomLength: number,
    readonly document: Parse5Document,
    readonly visibleText: string,
    parts: {
      elements: IndexedElement[]
      comments: IndexedComment[]
      tagSequence: string[]
      nthOfType: WeakMap<Parse5Element, number>
    }
  ) {
    this.elements = parts.elements
    this.comments = parts.comments
    this.tagSequence = parts.tagSequence
    this.nthOfType = parts.nthOfType
    this.byStart = new Map(parts.elements.map(el => [el.start, el]))
    this.byNode = new Map(parts.elements.map(el => [el.node, el]))
  }

  /** The eligible element whose start tag begins at `offset`. */
  elementAt(offset: number): IndexedElement | undefined {
    return this.byStart.get(offset)
  }

  /** The index entry of a parse5 element, when it is eligible. */
  elementOf(node: Parse5Element): IndexedElement | undefined {
    return this.byNode.get(node)
  }

  /** Eligible elements carrying `id`. */
  elementsWithId(id: string): readonly IndexedElement[] {
    if (!this.idMap) {
      this.idMap = new Map()
      for (const el of this.elements) {
        if (el.id === undefined) continue
        const list = this.idMap.get(el.id)
        if (list) list.push(el)
        else this.idMap.set(el.id, [el])
      }
    }
    return this.idMap.get(id) ?? []
  }

  /**
   * The eligible element at an absolute CSS path from {@link HtmlIndex.pathOf}.
   *
   * The path is walked down from the document one segment at a time, each
   * parent's children grouped by tag once, so a lookup costs about its own
   * length, not the page's: a map of every element's path cost about 190 ms
   * at 4 MB, and time and memory in the square of the depth on a deeply
   * nested page. Two elements can share a path only through a bare singleton
   * segment (an SVG `<html>` repeated under one parent) – the one case where a
   * step visits more than one element; the last eligible one in tree order
   * answers, as such a map would.
   */
  elementAtPath(path: string): IndexedElement | undefined {
    let level: readonly ParentNode[] = [this.document]
    for (const segment of path.split(PATH_SEPARATOR)) {
      level = level.flatMap(parent => this.childrenAt(parent, segment))
      if (level.length === 0) return undefined
    }
    for (let i = level.length - 1; i >= 0; i -= 1) {
      const el = this.byNode.get(level[i] as Parse5Element)
      if (el) return el
    }
    return undefined
  }

  /** The element children of `parent` whose {@link HtmlIndex.segmentOf} is `segment`, in order. */
  private childrenAt(parent: ParentNode, segment: string): readonly Parse5Element[] {
    const byTag = this.childTable(parent)
    if (SINGLETON_TAGS.has(segment)) return byTag.get(segment) ?? []
    const open = segment.lastIndexOf(NTH_OF_TYPE)
    if (open <= 0 || !segment.endsWith(')')) return []
    const tag = segment.slice(0, open)
    const digits = segment.slice(open + NTH_OF_TYPE.length, -1)
    // A singleton is always written bare, so `body:nth-of-type(1)` names nothing.
    if (!NTH_DIGITS.test(digits) || SINGLETON_TAGS.has(tag)) return []
    const child = byTag.get(tag)?.[Number(digits) - 1]
    return child ? [child] : []
  }

  private childTable(parent: ParentNode): Map<string, Parse5Element[]> {
    let table = this.childrenByTag.get(parent)
    if (!table) {
      table = new Map()
      for (const child of parent.childNodes) {
        if (!isElement(child)) continue
        const list = table.get(child.tagName)
        if (list) list.push(child)
        else table.set(child.tagName, [child])
      }
      this.childrenByTag.set(parent, table)
    }
    return table
  }

  /** 1-based position among the parent's element children with the same tag. */
  nthOf(node: Parse5Element): number {
    return this.nthOfType.get(node) ?? 1
  }

  /** The CSS path segment of one element: `body`, or `li:nth-of-type(3)`. */
  segmentOf(node: Parse5Element): string {
    return SINGLETON_TAGS.has(node.tagName)
      ? node.tagName
      : `${node.tagName}:nth-of-type(${this.nthOf(node)})`
  }

  /**
   * The absolute structural path of an element, from `html` down, as a valid
   * CSS selector: `html > body > main:nth-of-type(1) > button:nth-of-type(2)`.
   */
  pathOf(node: Parse5Element): string {
    const segments: string[] = []
    for (let cur: ParentNode | null = node; cur && 'tagName' in cur; cur = cur.parentNode) {
      segments.push(this.segmentOf(cur))
    }
    return segments.reverse().join(' > ')
  }
}

function countNthOfType(parent: ParentNode, nthOfType: WeakMap<Parse5Element, number>): void {
  const seen = new Map<string, number>()
  for (const child of parent.childNodes) {
    if (!isElement(child)) continue
    const n = (seen.get(child.tagName) ?? 0) + 1
    seen.set(child.tagName, n)
    nthOfType.set(child, n)
  }
}

function tagNameEnd(text: string, start: number): number {
  let i = start + 1
  while (i < text.length && !TAG_NAME_END.test(text[i])) i += 1
  return i
}

const LESS_THAN = 0x3c
/** OR-ed into an ASCII letter, this bit makes it lower case. */
const ASCII_LOWER_BIT = 0x20
const LOWER_A = 0x61
const LOWER_Z = 0x7a

/**
 * Whether `bytes` hold more than `limit` start tags – a `<` followed by an
 * ASCII letter – counted without parsing (design §19 Rev 4). Every eligible
 * element owns a start tag, so this bounds what {@link indexHtml} would index
 * before a parse builds a tree: parse5 holds about 30 bytes of tree per byte
 * of page, and the element count, more than the file size, decides whether a
 * parse fits the parse worker's heap. An upper bound only: a `<` and a letter
 * inside a script, a comment or an attribute value counts too. Both bytes are
 * ASCII, which never occurs inside a UTF-8 multi-byte sequence.
 */
export function hasMoreStartTagsThan(bytes: Uint8Array, limit: number): boolean {
  let count = 0
  for (let at = bytes.indexOf(LESS_THAN); at !== -1; at = bytes.indexOf(LESS_THAN, at + 1)) {
    // Past the end, `undefined | 0x20` is 0x20: not a letter.
    const next = bytes[at + 1] | ASCII_LOWER_BIT
    if (next >= LOWER_A && next <= LOWER_Z && ++count > limit) return true
  }
  return false
}

/**
 * Parse `text` once and build the {@link HtmlIndex}.
 *
 * The parse is bounded (`parseBounds.ts`, security review S-M): past
 * `limits` – elements the parser creates, or its work – it throws
 * `HtmlParseLimitError`, which the callers turn into "page too large".
 *
 * @param text - The decoded file, BOM included when the file has one.
 * @param limits - What the parse may use; by default the limits for the page's length.
 */
export function indexHtml(text: string, limits: HtmlParseLimits = parseLimitsFor(text.length)): HtmlIndex {
  const bomLength = text.startsWith(BOM_CHAR) ? 1 : 0
  const document = parse(bomLength ? text.slice(1) : text, {
    sourceCodeLocationInfo: true,
    treeAdapter: boundedTreeAdapter(limits)
  })
  const elements: IndexedElement[] = []
  const comments: IndexedComment[] = []
  const tagSequence: string[] = []
  const nthOfType = new WeakMap<Parse5Element, number>()
  const ownedStarts = new Set<number>()
  const chunks: string[] = []
  let textLength = 0

  const pending: Visit[] = []
  const pushChildren = (parent: ParentNode, ctx: WalkContext): void => {
    countNthOfType(parent, nthOfType)
    for (let i = parent.childNodes.length - 1; i >= 0; i -= 1) {
      pending.push({ kind: 'enter', node: parent.childNodes[i], ctx })
    }
  }

  const enterElement = (node: Parse5Element, ctx: WalkContext): void => {
    tagSequence.push(node.tagName)
    const startTag = node.sourceCodeLocation?.startTag
    const start = startTag ? startTag.startOffset + bomLength : -1
    const owned = startTag !== undefined && !ownedStarts.has(start)
    if (owned) ownedStarts.add(start)
    const eligible =
      owned && !ctx.inTemplate && !ctx.inHead && node.tagName !== 'html' && node.tagName !== 'head'
    if (eligible) {
      const record: MutableElement = {
        node,
        tag: node.tagName,
        start,
        nameEnd: tagNameEnd(text, start),
        id: attributeOf(node, 'id'),
        classes: (attributeOf(node, 'class') ?? '').split(ASCII_WHITESPACE).filter(Boolean),
        preformatted: ctx.preformatted,
        textStart: textLength,
        textEnd: textLength
      }
      elements.push(record)
      pending.push({ kind: 'exit', record })
    }
    const childCtx: WalkContext = {
      inTemplate: ctx.inTemplate,
      inHead: ctx.inHead || node.tagName === 'head',
      preformatted: ctx.preformatted || PREFORMATTED_TAGS.has(node.tagName),
      skipText: ctx.skipText || NON_TEXT_TAGS.has(node.tagName)
    }
    if (isTemplate(node)) pushChildren(node.content, { ...childCtx, inTemplate: true })
    pushChildren(node, childCtx)
  }

  const enterComment = (node: CommentNode, ctx: WalkContext): void => {
    // parse5 gives every comment it parses a location when sourceCodeLocationInfo is on.
    const loc = node.sourceCodeLocation!
    const parent = node.parentNode && 'tagName' in node.parentNode ? node.parentNode : null
    comments.push({
      start: loc.startOffset + bomLength,
      // parse5 ends a comment cut off by the end of the file one past the text.
      end: Math.min(loc.endOffset + bomLength, text.length),
      data: node.data,
      inTemplate: ctx.inTemplate,
      parent
    })
  }

  pushChildren(document, ROOT_CONTEXT)
  for (let visit = pending.pop(); visit !== undefined; visit = pending.pop()) {
    if (visit.kind === 'exit') {
      visit.record.textEnd = textLength
      continue
    }
    const { node, ctx } = visit
    if (isElement(node)) enterElement(node, ctx)
    else if (node.nodeName === '#comment') enterComment(node as CommentNode, ctx)
    else if (node.nodeName === '#text' && !ctx.skipText && !ctx.inTemplate) {
      const value = (node as TextNode).value
      chunks.push(value)
      textLength += value.length
    }
  }

  comments.sort((a, b) => a.start - b.start)
  return new HtmlIndex(text, bomLength, document, chunks.join(''), {
    elements,
    comments,
    tagSequence,
    nthOfType
  })
}
