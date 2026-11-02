// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The parse of one Markdown file for comments (spec 024 024-FR-003; design
 * `markdown-format.md` § 1, § 4, § 4.6; architecture note 001 § 3, § 8 C3,
 * C11).
 *
 * One CommonMark/GFM parse of the body – the file after its BOM and its
 * frontmatter, split off by the preview's own expression, never YAML – gives
 * the syntax tree and the preview's tree (`mdRender.ts`). From them:
 *
 * - the BLOCKS – every block of the syntax tree with its source range, line,
 *   parent and, for a list item, its content column: what the placement
 *   rules (`mdSlots.ts`) climb and look behind;
 * - the TARGETS – every block the preview renders as an element a comment
 *   can be about, with its rendered path and text ({@link MdIndex} is the
 *   kind's {@link TargetIndex});
 * - the COMMENTS – every HTML comment inside an `html` node, found by the
 *   comment tokenizer (`mdCommentScan.ts`), so comment-shaped text in code,
 *   a code span or frontmatter is never one;
 * - what the slot preconditions need: the lines a new block must not follow
 *   (inside a fence, an open type-6/7 HTML block, a table) and the generated
 *   START/END regions.
 *
 * Every offset and line is the whole decoded file's, BOM included (C11).
 */
import type { Nodes as MdastNodes, Parent as MdastParent, RootContent } from 'mdast'
import { splitFrontmatter } from '../markdown/previewPipeline'
import type { IndexedCommentNode, IndexedTarget, TargetIndex } from '../comments/targetIndex'
import { pairGeneratedRegions, type GeneratedRegion, type RegionNameReaders } from '../comments/foreignComments'
import { htmlBlockClosed, htmlBlockType, isCommentOnly, regionEndName, regionStartName, scanComments } from './mdCommentScan'
import { renderedPage, type HastRecord } from './mdHast'
import { parseMarkdownBody, renderSignature } from './mdRender'
import { columnsBetween, LineTable } from './mdSource'

/** What a target is, in the words of the `@data` table and the hint lines. */
export type MdTargetKind =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'item'
  | 'table'
  | 'row'
  | 'cell'
  | 'quote'
  | 'code'
  | 'diagram'
  | 'divider'
  | 'html'
  | 'image'

/** One block of the syntax tree. */
export interface MdBlock {
  /** The mdast node type (`paragraph`, `listItem`, `html`, …). */
  readonly type: string
  readonly start: number
  readonly end: number
  /** 0-based first and last line. */
  readonly line: number
  readonly endLine: number
  readonly parent: MdBlock | undefined
  /** Index among the parent's children. */
  readonly index: number
  readonly children: MdBlock[]
  /** List item: the column its content starts at (design § 1). */
  readonly contentColumn: number
  /** HTML block: it holds comments and only whitespace besides. */
  readonly commentOnly: boolean
  /** HTML block: its comments. */
  readonly comments: readonly MdComment[]
  /** Code block: written with a fence. */
  readonly fenced: boolean
  /** The block's own target, when the preview renders it as one. */
  target?: MdTarget
}

/** One commentable target. */
export interface MdTarget extends IndexedTarget {
  readonly kind: MdTargetKind
  /** Its rendered path below the root. */
  readonly path: string
  /** 1-based first and last line. */
  readonly line: number
  readonly lineEnd: number
  /** The block it is; for an image, the paragraph that holds it alone. */
  readonly block: MdBlock
  /** Heading level 1–6. */
  readonly depth?: number
}

/** A comment node of a Markdown file. */
export interface MdComment extends IndexedCommentNode {
  readonly terminated: boolean
}

/** A generated region: from its START comment's `<!--` to its END comment's `-->` (`foreignComments.ts`). */
export type MdRegion = GeneratedRegion

/** The region names as `mdCommentScan` exports them, read through that module so its cost test can count them. */
const MD_REGION_NAMES: RegionNameReaders = {
  startName: data => regionStartName(data),
  endName: data => regionEndName(data)
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const NONE: readonly MdComment[] = []
const CONTAINER_TYPES = new Set(['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow'])
const PHRASING_HOLDERS = new Set(['paragraph', 'heading', 'tableCell'])
const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})/

/** The parse of one Markdown file. Build it with {@link indexMarkdown}. */
export class MdIndex implements TargetIndex<MdTarget> {
  private readonly byStart = new Map<number, MdTarget[]>()
  private readonly byPath = new Map<string, MdTarget>()

  constructor(
    readonly text: string,
    readonly bomLength: number,
    readonly lines: LineTable,
    /** Offset of the body's first character: the end of the BOM and the frontmatter. */
    readonly bodyStart: number,
    readonly root: MdBlock | undefined,
    readonly visibleText: string,
    readonly elements: readonly MdTarget[],
    readonly comments: readonly MdComment[],
    readonly regions: readonly MdRegion[],
    /** 1 for each line a new block must never directly follow (design § 4.3). */
    readonly unsafeLines: Uint8Array,
    /** The preview's render (breaks off) as `renderSignature` writes it; '' when not parsed. */
    readonly signature: string
  ) {
    for (const target of elements) {
      const list = this.byStart.get(target.start)
      if (list) list.push(target)
      else this.byStart.set(target.start, [target])
      if (target.path !== '' && !this.byPath.has(target.path)) this.byPath.set(target.path, target)
    }
  }

  /** The outermost target that starts at `offset`. */
  elementAt(offset: number): MdTarget | undefined {
    return this.byStart.get(offset)?.[0]
  }

  /** Every target that starts at `offset`, outermost first. */
  targetsAt(offset: number): readonly MdTarget[] {
    return this.byStart.get(offset) ?? []
  }

  elementAtPath(path: string): MdTarget | undefined {
    return this.byPath.get(path)
  }

  pathOfTarget(target: MdTarget): string {
    return target.path
  }

  /** The body's first line (0-based): the line after the frontmatter. */
  get bodyLine(): number {
    return this.lines.lineOf(this.bodyStart)
  }
}

/** An index with nothing in it: a file past the limits, never parsed. */
export function emptyMdIndex(text: string, bomLength: number): MdIndex {
  const lines = new LineTable(text, bomLength)
  return new MdIndex(text, bomLength, lines, bomLength, undefined, '', [], [], [], new Uint8Array(lines.count), '')
}

/** Marker width and the content column of the list item whose marker starts at `start`. */
function contentColumnOf(text: string, lines: LineTable, start: number): number {
  const markerColumn = lines.columnOf(start)
  let width = 1
  if (!/[-*+]/.test(text[start] ?? '')) {
    while (/\d/.test(text[start + width - 1] ?? '')) width += 1
  }
  const after = start + width
  const line = lines.lineOf(start)
  const end = lines.contentEnd(line)
  let p = after
  while (p < end && (text[p] === ' ' || text[p] === '\t')) p += 1
  const base = markerColumn + width
  const spaces = columnsBetween(text, after, p, base) - base
  return p === end || spaces >= 5 || spaces === 0 ? base + 1 : base + spaces
}

/** A code block's node starts at its fence; an indented one starts at its indentation. */
function isFenced(text: string, start: number): boolean {
  return /^(?:`{3}|~{3})/.test(text.slice(start, start + 3))
}

/** A fenced code block's last line closes it (it did not run to its container's end). */
function fenceClosed(block: MdBlock, lines: LineTable): boolean {
  if (block.endLine === block.line) return false
  const open = FENCE_LINE.exec(lines.lineText(block.line).replace(/^(?:[ \t]*>)*/, ''))
  const last = lines.lineText(block.endLine).replace(/^(?:[ \t]*>)*/, '').trim()
  return open !== null && new RegExp(`^${open[1][0] === '`' ? '`' : '~'}{${open[1].length},}$`).test(last)
}

/** Builds an {@link MdIndex}: the walk of the syntax tree against the rendered page. */
class IndexBuilder {
  readonly targets: MdTarget[] = []
  readonly comments: MdComment[] = []
  readonly regions: MdRegion[] = []
  readonly unsafe: Uint8Array
  private readonly claimed = new Set<HastRecord>()
  private readonly recordsAt = new Map<number, HastRecord[]>()
  private readonly sorted: readonly HastRecord[]

  constructor(
    private readonly text: string,
    private readonly lines: LineTable,
    private readonly base: number,
    records: readonly HastRecord[]
  ) {
    this.unsafe = new Uint8Array(lines.count)
    for (const record of records) {
      if (record.start < 0) continue
      const list = this.recordsAt.get(record.start)
      if (list) list.push(record)
      else this.recordsAt.set(record.start, [record])
    }
    this.sorted = records.filter(r => r.start >= 0).sort((a, b) => a.start - b.start || a.order - b.order)
  }

  block(node: MdastNodes, parent: MdBlock | undefined, index: number): MdBlock {
    const start = this.base + (node.position?.start.offset ?? 0)
    const end = this.base + (node.position?.end.offset ?? 0)
    const line = this.lines.lineOf(start)
    const block: Mutable<MdBlock> = {
      type: node.type,
      start,
      end,
      line,
      endLine: Math.max(line, this.lines.lineOf(Math.max(start, end - 1))),
      parent,
      index,
      children: [],
      contentColumn: node.type === 'listItem' ? contentColumnOf(this.text, this.lines, start) : 0,
      commentOnly: false,
      comments: NONE,
      fenced: node.type === 'code' && isFenced(this.text, start)
    }
    if (node.type === 'html') this.html(block, node.value)
    else if (PHRASING_HOLDERS.has(node.type)) this.inlineComments(node as MdastParent)
    if (node.type === 'code' && block.fenced) this.markUnsafe(block.line, fenceClosed(block, this.lines) ? block.endLine - 1 : block.endLine)
    if (node.type === 'table') this.markUnsafe(block.line, block.endLine)
    this.target(block, node)
    if (CONTAINER_TYPES.has(node.type)) {
      const children = (node as MdastParent).children
      children.forEach((child, i) => block.children.push(this.block(child, block, i)))
      this.pairRegions(block)
    }
    return block
  }

  private markUnsafe(from: number, to: number): void {
    for (let line = from; line <= to; line += 1) this.unsafe[line] = 1
  }

  private html(block: Mutable<MdBlock>, value: string): void {
    const comments = scanComments(this.text, block.start, block.end).map(c => ({ ...c, inTemplate: false }))
    block.comments = comments
    block.commentOnly = isCommentOnly(value)
    this.comments.push(...comments)
    const type = htmlBlockType(value)
    if (!htmlBlockClosed(value, type)) this.markUnsafe(block.line, block.endLine)
  }

  /** Comments in inline `html` nodes of a paragraph, heading or cell (never in code spans). */
  private inlineComments(node: MdastParent): void {
    const stack: RootContent[] = [...node.children].reverse()
    for (let child = stack.pop(); child; child = stack.pop()) {
      if (child.type === 'html') {
        const start = this.base + (child.position?.start.offset ?? 0)
        const end = this.base + (child.position?.end.offset ?? 0)
        this.comments.push(...scanComments(this.text, start, end).map(c => ({ ...c, inTemplate: false })))
      } else if ('children' in child) {
        for (let i = child.children.length - 1; i >= 0; i -= 1) stack.push(child.children[i])
      }
    }
  }

  /** The rendered element of `tag` that starts at `start`, not yet taken by another block. */
  private recordAt(start: number, tag: string): HastRecord | undefined {
    const record = this.recordsAt.get(start)?.find(r => r.tag === tag && !this.claimed.has(r))
    if (record) this.claimed.add(record)
    return record
  }

  /** The first rendered element that starts inside an HTML block (a raw block the sanitizer kept). */
  private recordInside(start: number, end: number): HastRecord | undefined {
    let lo = 0
    let hi = this.sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.sorted[mid].start < start) lo = mid + 1
      else hi = mid
    }
    const record = this.sorted[lo]
    if (record === undefined || record.start >= end || this.claimed.has(record)) return undefined
    this.claimed.add(record)
    return record
  }

  private addTarget(block: MdBlock, kind: MdTargetKind, record: HastRecord, start = block.start, depth?: number): MdTarget {
    const target: MdTarget = {
      kind,
      tag: record.tag,
      start,
      id: record.id,
      textStart: record.textStart,
      textEnd: record.textEnd,
      path: record.path,
      line: this.lines.lineOf(start) + 1,
      lineEnd: block.endLine + 1,
      block,
      ...(depth === undefined ? {} : { depth })
    }
    this.targets.push(target)
    return target
  }

  private target(block: Mutable<MdBlock>, node: MdastNodes): void {
    const own = (kind: MdTargetKind, tag: string, depth?: number): void => {
      const record = this.recordAt(block.start, tag)
      if (record) block.target = this.addTarget(block, kind, record, block.start, depth)
    }
    switch (node.type) {
      case 'paragraph':
        own('paragraph', 'p')
        if (block.target) this.image(block, node)
        return
      case 'heading':
        return own('heading', `h${node.depth}`, node.depth)
      case 'list':
        return own('list', node.ordered ? 'ol' : 'ul')
      case 'listItem':
        return own('item', 'li')
      case 'table':
        return own('table', 'table')
      case 'tableRow':
        return own('row', 'tr')
      case 'tableCell': {
        const header = block.parent?.index === 0
        return own('cell', header ? 'th' : 'td')
      }
      case 'blockquote':
        return own('quote', 'blockquote')
      case 'code':
        return own(node.lang === 'mermaid' ? 'diagram' : 'code', 'pre')
      case 'thematicBreak':
        return own('divider', 'hr')
      case 'html': {
        const record = block.commentOnly ? undefined : this.recordInside(block.start, block.end)
        if (record) block.target = this.addTarget(block, 'html', record)
        return
      }
      default:
        return
    }
  }

  /** An image alone in its paragraph (optionally inside a link) is its own target. */
  private image(block: MdBlock, node: Extract<MdastNodes, { type: 'paragraph' }>): void {
    const solid = node.children.filter(child => child.type !== 'text' || child.value.trim() !== '')
    if (solid.length !== 1) return
    const only = solid[0]
    const linked = only.type === 'link' ? only.children.filter(c => c.type !== 'text' || c.value.trim() !== '') : []
    const image = only.type === 'image' ? only : linked.length === 1 && linked[0].type === 'image' ? linked[0] : undefined
    if (image?.position === undefined) return
    const start = this.base + image.position.start.offset!
    const record = this.recordAt(start, 'img')
    if (record) this.addTarget(block, 'image', record, start)
  }

  /**
   * START/END regions among the comment-only HTML blocks directly inside
   * `container` (design § 4.4): each START pairs with the first END of its
   * name after it. One pass – the STARTs still waiting are kept by name – so
   * a file of many STARTs costs linear time, not a search per START.
   */
  private pairRegions(container: MdBlock): void {
    const comments = container.children.filter(child => child.type === 'html').flatMap(child => child.comments)
    // A loop, not a spread: a file of many regions must not overflow the argument stack.
    for (const region of pairGeneratedRegions(comments, MD_REGION_NAMES)) this.regions.push(region)
  }
}

/** Parse a decoded Markdown file (`bomLength` 1 when it starts with a BOM) for comments. */
export function indexMarkdown(text: string, bomLength: number): MdIndex {
  const lines = new LineTable(text, bomLength)
  const split = splitFrontmatter(text.slice(bomLength))
  const base = bomLength + split.bodyOffset
  const { mdast, hast } = parseMarkdownBody(split.body)
  const page = renderedPage(hast, base)
  const builder = new IndexBuilder(text, lines, base, page.records)
  const root = builder.block(mdast, undefined, 0)
  const comments = [...builder.comments].sort((a, b) => a.start - b.start)
  return new MdIndex(
    text,
    bomLength,
    lines,
    base,
    root,
    page.visibleText,
    builder.targets,
    comments,
    builder.regions,
    builder.unsafe,
    renderSignature(hast)
  )
}
