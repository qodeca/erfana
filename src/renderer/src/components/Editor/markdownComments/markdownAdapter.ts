// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown Preview's comment adapter (spec 024 architecture note 001 § 1
 * "markdownAdapter", § 3, § 8 C7; 024-FR-003; design `markdown-format.md`).
 *
 * The preview stamps every block it renders with `data-line-start`, the real
 * file line (`MarkdownPreview.tsx`, `rehypeShiftLines`). This module reads
 * those stamps to answer the overlay host's questions, in the words the
 * Markdown file kind (`src/shared/markdownComments/`) uses:
 *
 * - **Targets** are the blocks main indexes (`mdIndex.ts`): paragraphs,
 *   headings, lists and items, block quotes, code blocks and diagrams,
 *   tables, rows and cells, dividers, an image alone in its paragraph, and
 *   the outermost element of a raw-HTML section the sanitizer kept. A target
 *   sits directly in the content or inside containers only (lists, items,
 *   quotes, tables); anything inside a paragraph, a heading or raw HTML is
 *   part of that target, never one of its own.
 * - The preview wraps two blocks: a table in `div.table-wrapper` (main's
 *   `table`) and a diagram in `div.mermaid-wrapper` (main's `pre`).
 * - The frontmatter is drawn but never commentable (M-18).
 * - **A place** (C-03) names a row, a cell or a diagram as main's index does
 *   (`mdPlace.ts`): a body row by its number among the `tbody` rows, the
 *   `thead` row as the header row, a cell by its row and its column among
 *   its row's cells, and the diagram by the Mermaid render's wrapper – so the
 *   picker, the menu and the icons say "row 2, column 3" where the window
 *   does.
 * - **A pick** is `{ lineStart, lineEnd, tag, ordinal, quote, baseHash }`:
 *   the ordinal counts targets of the tag that start on the line (1-based,
 *   document order – main's walk order), the quote is the target's text with
 *   whitespace collapsed, NFC, cut to {@link PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS}
 *   (`quoteText.ts`'s rule), and `baseHash` is `markdownTextHash` of the text
 *   the preview rendered. Main uses the line while the hash matches its own
 *   parse, else the one target with that quote (C7).
 * - **No parse here** (§ 8 C19, Q3): the adapter reads the rendered DOM and
 *   hashes the text, nothing more. Whether a pick sits in a generated
 *   START/END region (W-08, 024-FR-023) is main's answer to the draft the
 *   window opens with (`file-comment:openDraft` with the pick), from the
 *   parse main already runs in its worker.
 *
 * @module Editor/markdownComments/markdownAdapter
 */
import { markdownTextHash } from '../../../../../shared/markdownComments/mdLocate'
import { PREVIEW_LIMITS } from '../../../../../shared/preview-limits'
import type { PickedTargetRequest, ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentTargetPlace } from '../../../../../shared/ipc/comment-common-schema'
import { MARKDOWN_COPY, MARKDOWN_WORDS } from '../../Comments/commentCopyWords'
import type { CanComment, PreviewCommentAdapter } from '../../Comments/overlay/previewAdapter'

/** Tags that are a target wherever a container holds them. */
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'TR', 'TH', 'TD'])
/** Raw-HTML tags the preview stamps with a line: a target when outermost. */
const RAW_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'MAIN', 'DETAILS', 'FIGURE', 'ADDRESS'])
/** Elements a target may sit inside. */
const CONTAINER_TAGS = new Set(['UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR'])
const TABLE_WRAPPER = 'table-wrapper'
const DIAGRAM_WRAPPER = 'mermaid-wrapper'
const FRONTMATTER = '.frontmatter-wrapper, .frontmatter-error-wrapper'
const IMAGE_PLACEHOLDER = 'markdown-image-placeholder'

/** The tag main indexes a rendered element by, or `null` when it is no target kind at all. */
function kindTag(el: Element): string | null {
  if (!el.hasAttribute('data-line-start')) return null
  if (el.matches(FRONTMATTER)) return 'frontmatter'
  const tag = el.tagName
  if (tag === 'DIV' && el.classList.contains(TABLE_WRAPPER)) return 'table'
  if (tag === 'DIV' && el.classList.contains(DIAGRAM_WRAPPER)) return 'pre'
  if (tag === 'PRE' && el.classList.contains('code-block')) return 'pre'
  if (tag === 'IMG' || el.classList.contains(IMAGE_PLACEHOLDER)) return 'img'
  if (BLOCK_TAGS.has(tag) || RAW_TAGS.has(tag)) return tag.toLowerCase()
  return null
}

/**
 * A container a target may sit inside: a list, an item, a quote, a table and
 * its parts – and the bare `<pre>` react-markdown puts around the preview's
 * own code block or diagram, which carries no line of its own.
 */
function isContainer(el: Element): boolean {
  if (CONTAINER_TAGS.has(el.tagName)) return true
  if (el.tagName === 'DIV') return el.classList.contains(TABLE_WRAPPER)
  return el.tagName === 'PRE' && !el.hasAttribute('data-line-start')
}

/** An image that is the only thing in its paragraph, optionally inside a link (`mdIndex.ts` § image). */
function isLoneImage(el: Element, root: Element): boolean {
  let holder = el.parentElement
  if (holder?.tagName === 'A') {
    if (holder.childElementCount !== 1 || (holder.textContent ?? '').trim() !== '') return false
    holder = holder.parentElement
  }
  if (holder?.tagName !== 'P' || holder.childElementCount !== 1) return false
  return (holder.textContent ?? '').trim() === '' && holder.parentElement !== null && inContainers(holder, root)
}

/** Every ancestor of `el` below `root` is a container. */
function inContainers(el: Element, root: Element): boolean {
  for (let up = el.parentElement; up !== null && up !== root; up = up.parentElement) {
    if (!isContainer(up)) return false
  }
  return true
}

/** Whether `el` is a target of the preview rooted at `root`. */
function isTarget(el: Element, root: Element): boolean {
  const tag = kindTag(el)
  // The frontmatter is never outlined or reached by Tab (M-20); `targetAt` still names it, for its menu.
  if (tag === null || tag === 'frontmatter') return false
  if (tag === 'img') return isLoneImage(el, root)
  return inContainers(el, root)
}

/**
 * Whether a closed `<details>` hides `el`: the only collapsed section the
 * preview draws (`MarkdownPreview.tsx` keeps raw `details`; S-02, D-13). A
 * closed section still shows its own `<summary>`.
 */
function collapsedIn(el: Element, root: Element): boolean {
  for (let up = el.parentElement; up !== null && up !== root; up = up.parentElement) {
    if (!(up instanceof HTMLDetailsElement) || up.open) continue
    const summary = up.querySelector(':scope > summary')
    if (summary === null || !summary.contains(el)) return true
  }
  return false
}

/** What one scan of the rendered content's line stamps answers. */
interface TargetIndex {
  /** The targets, in document order. */
  readonly order: readonly HTMLElement[]
  /** The first target of each line and tag ({@link lineTagKey}): what `attach` finds. */
  readonly firstByLineTag: ReadonlyMap<string, HTMLElement>
  /**
   * The first stamped element of each `data-line-start` value and kind tag,
   * target or not ({@link lineTagKey} on the raw value): what `hiddenNow`
   * finds, as its `[data-line-start="…"]` query did.
   */
  readonly firstByStampKind: ReadonlyMap<string, Element>
}

/**
 * The DOM changes that can change {@link TargetIndex}: a node added, removed
 * or re-parented (containers, a lone image's paragraph), text (a lone image's
 * paragraph must be empty), a line stamp or a class (the wrappers, the
 * frontmatter, the image placeholder). The overlay's own writes into the
 * content (`aria-details`, `tabindex` and their markers) are none of these.
 */
const TARGET_MUTATIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['data-line-start', 'class']
}

function lineTagKey(line: number | string, tag: string): string {
  return `${line}\u0000${tag}`
}

/** Keep the first element of each key, in the order given. */
function firstByKey<E extends Element>(elements: readonly E[], keyOf: (el: E) => string | null): Map<string, E> {
  const first = new Map<string, E>()
  for (const el of elements) {
    const key = keyOf(el)
    if (key !== null && !first.has(key)) first.set(key, el)
  }
  return first
}

/** One scan of `root`'s line stamps: every answer of {@link TargetIndex}. */
function scanTargets(root: HTMLElement): TargetIndex {
  const stamped = [...root.querySelectorAll<HTMLElement>('[data-line-start]')]
  const order = stamped.filter(el => isTarget(el, root))
  return {
    order,
    firstByLineTag: firstByKey(order, el => lineTagKey(lineOfStamp(el), tagOfTarget(el))),
    firstByStampKind: firstByKey(stamped, el => {
      const kind = kindTag(el)
      return kind === null ? null : lineTagKey(el.getAttribute('data-line-start') ?? '', kind)
    })
  }
}

/** A target's tag as main names it; the element's own tag when it is no target kind. */
function tagOfTarget(el: HTMLElement): string {
  return kindTag(el) ?? el.tagName.toLowerCase()
}

/** 1 + the index of `el` among `list`; 0 when it is not in it. */
function positionIn(list: ArrayLike<Element>, el: Element): number {
  return Array.prototype.indexOf.call(list, el) + 1
}

/** A row's place: the header row in `thead`, else its number among its section's rows (`mdPlace.ts`). */
function rowPlace(row: HTMLTableRowElement): { readonly header: true } | { readonly header: false; readonly row: number } | undefined {
  const section = row.parentElement
  if (section instanceof HTMLTableSectionElement && section.tagName === 'THEAD') return { header: true }
  const at = section instanceof HTMLTableSectionElement ? positionIn(section.rows, row) : 0
  return at === 0 ? undefined : { header: false, row: at }
}

/**
 * Where a rendered target sits when its tag does not name it (C-03), as
 * main's index places the same block: a row, a cell, a diagram.
 */
function placeOfTarget(el: HTMLElement): CommentTargetPlace | undefined {
  if (el.tagName === 'DIV' && el.classList.contains(DIAGRAM_WRAPPER)) return { kind: 'diagram' }
  if (el instanceof HTMLTableRowElement) {
    const row = rowPlace(el)
    return row === undefined ? undefined : row.header ? { kind: 'header-row' } : { kind: 'row', row: row.row }
  }
  if (!(el instanceof HTMLTableCellElement) || !(el.parentElement instanceof HTMLTableRowElement)) return undefined
  const row = rowPlace(el.parentElement)
  const column = positionIn(el.parentElement.cells, el)
  if (row === undefined || column === 0) return undefined
  return row.header ? { kind: 'header-cell', column } : { kind: 'cell', row: row.row, column }
}

/** A target's line: its stamp, or 1 when the stamp is missing or not a number. */
function lineOfStamp(el: HTMLElement): number {
  return Number.parseInt(el.dataset.lineStart ?? '', 10) || 1
}

/**
 * The line stamps of the content `rootOf` names, scanned once and kept until
 * the content changes (spec 024 024-NFR-001). The overlay attaches every
 * listed thread on each draw, and the drawer asks each one whether a closed
 * section hides it; a full scan per thread made one draw of a 1 MB document
 * with 200 comments take seconds.
 *
 * A `MutationObserver` drops the index on the first change that can alter it,
 * and every read first takes the observer's undelivered records, so a change
 * made earlier in the same task (a React commit before an effect) is seen
 * too: a read always answers what a fresh scan would. Without
 * `MutationObserver` nothing is kept.
 *
 * @param rootOf - The rendered content element, when mounted
 * @returns A reader of the current index; `null` while there is no content
 */
function createTargetIndex(rootOf: () => HTMLElement | null): () => TargetIndex | null {
  let kept: { readonly root: HTMLElement; readonly index: TargetIndex } | null = null
  let observer: MutationObserver | null = null
  const forget = (): void => {
    observer?.disconnect()
    observer = null
    kept = null
  }
  return () => {
    const root = rootOf()
    if (kept !== null && (kept.root !== root || (observer?.takeRecords().length ?? 0) > 0)) forget()
    if (root === null) return null
    if (kept !== null) return kept.index
    const index = scanTargets(root)
    if (typeof MutationObserver === 'undefined') return index
    observer = new MutationObserver(forget)
    observer.observe(root, TARGET_MUTATIONS)
    kept = { root, index }
    return index
  }
}

/** Whitespace runs to one space, trimmed, NFC, at most the quote limit – `quoteText.ts`'s rule. */
export function collapsedText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim().normalize('NFC')
  const max = PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS
  if (collapsed.length <= max) return collapsed
  const end = /[\uD800-\uDBFF]/.test(collapsed[max - 1]) ? max - 1 : max
  return collapsed.slice(0, end).trimEnd()
}

/** What the adapter reads from the preview. */
export interface MarkdownAdapterSource {
  /** The rendered content element (`.markdown-preview-content`), when mounted. */
  readonly root: () => HTMLElement | null
  /** The Markdown text the preview rendered: its hash is the pick's `baseHash`. */
  readonly text: () => string
}

/**
 * The Markdown Preview's adapter.
 *
 * @param source - {@link MarkdownAdapterSource}
 * @returns The adapter the overlay host drives.
 *
 * @example
 * ```ts
 * const adapter = createMarkdownAdapter({ root: () => contentEl, text: () => buffer })
 * adapter.describe(adapter.targetAt(event.target as Node)!) // { lineStart: 12, tag: 'li', ordinal: 1, … }
 * ```
 */
export function createMarkdownAdapter(source: MarkdownAdapterSource): PreviewCommentAdapter {
  // The rendered text's hash, recomputed only when the text changes.
  let hashed: { text: string; hash: string } | null = null
  const hashOf = (text: string): string => {
    if (hashed?.text !== text) hashed = { text, hash: markdownTextHash(text) }
    return hashed.hash
  }

  const tagOf = tagOfTarget
  const lineOf = lineOfStamp

  const indexNow = createTargetIndex(source.root)
  // A copy: the caller may sort or splice it, the index stays as scanned.
  const targetsInOrder = (): HTMLElement[] => [...(indexNow()?.order ?? [])]

  const targetAt = (node: Node | null): HTMLElement | null => {
    const root = source.root()
    if (root === null || node === null || !root.contains(node)) return null
    // The nearest target on the way up: text inside a paragraph is the
    // paragraph's, a paragraph inside raw HTML is the raw section's.
    for (let el: Element | null = node instanceof Element ? node : node.parentElement; el !== null && el !== root; el = el.parentElement) {
      if (el.matches(FRONTMATTER) || isTarget(el, root)) return el as HTMLElement
    }
    return null
  }

  const parentOf = (target: HTMLElement): HTMLElement | null => {
    const root = source.root()
    for (let up = target.parentElement; up !== null && up !== root; up = up.parentElement) {
      if (root !== null && isTarget(up, root)) return up
    }
    return null
  }

  const childOf = (target: HTMLElement): HTMLElement | null => {
    const root = source.root()
    if (root === null) return null
    for (const el of target.querySelectorAll<HTMLElement>('[data-line-start]')) if (isTarget(el, root)) return el
    return null
  }

  const canComment = (target: HTMLElement): CanComment =>
    tagOf(target) === 'frontmatter' ? { ok: false, reason: MARKDOWN_COPY.frontmatter } : { ok: true }

  const describe = (target: HTMLElement): PickedTargetRequest | null => {
    const tag = tagOf(target)
    if (tag === 'frontmatter') return null
    const lineStart = lineOf(target)
    const lineEnd = Math.max(lineStart, Number.parseInt(target.dataset.lineEnd ?? '', 10) || lineStart)
    const sameLine = targetsInOrder().filter(el => lineOf(el) === lineStart && tagOf(el) === tag)
    const ordinal = Math.max(1, sameLine.indexOf(target) + 1)
    const exact = collapsedText(target.textContent ?? '')
    return {
      lineStart,
      lineEnd,
      tag,
      ordinal,
      ...(exact === '' ? {} : { quote: { exact, prefix: '', suffix: '' } }),
      baseHash: hashOf(source.text())
    }
  }

  // The first target of the placement's line and tag, in document order (see `createTargetIndex`).
  const attach = (placement: ThreadPlacement): HTMLElement | null =>
    indexNow()?.firstByLineTag.get(lineTagKey(placement.line, placement.tag)) ?? null

  // S-02: main found the target in the file; the preview drew an element of its kind on its line inside a closed section.
  const hiddenNow = (placement: ThreadPlacement): boolean => {
    const root = source.root()
    const drawn = indexNow()?.firstByStampKind.get(lineTagKey(String(placement.line), placement.tag))
    // Open or closed is read now, on the found element: a toggle changes no index.
    return root !== null && drawn !== undefined && collapsedIn(drawn, root)
  }

  return {
    words: MARKDOWN_WORDS,
    targetAt,
    targetsInOrder,
    parentOf,
    childOf,
    tagOf,
    placeOf: placeOfTarget,
    lineOf,
    canComment,
    describe,
    attach,
    hiddenNow,
    root: source.root
  }
}
