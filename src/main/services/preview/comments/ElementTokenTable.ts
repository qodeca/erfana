// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Element tokens of the documents one preview view served, kept per LOAD
 * (docs/designs/html-preview-comments.md §4.2 "ElementTokenTable", §6, §19
 * R3-12, R3-13; tests M-031–033, M-059).
 *
 * Every instrumented document load registers its own table: token → the
 * element's start-tag offset and tag in the bytes that were served, plus the
 * file's real path and hash. Keying per load (not per file) is what lets one
 * file shown twice – as the page and inside a frame – keep two independent
 * tables (M-059).
 *
 * Lifecycle:
 * - `register` – the protocol handler served an instrumented document.
 * - `bind` – the load's frame said hello (P5): a load is bound to exactly one
 *   frame, the first one; a later bind of the same load is refused.
 * - `evictFrame` – that frame navigated away or was destroyed: its tables go,
 *   and only its tables.
 *
 * Generations (M-032): the view's own page keeps its newest two loads, and so
 * does every frame – the current document plus the one before it, so a pick
 * sent just before a reload still finds its token (main re-validates every
 * token from disk at Save anyway). Older loads are evicted. On top of that the
 * view holds at most {@link MAX_LOADS} loads and {@link MAX_TOKENS} tokens,
 * oldest first, so loads that are never bound cannot grow memory.
 *
 * Lookups (S9): a load keeps the worker's arrays as they arrived – one token
 * string, offsets, tag codes – and finds a token with an aligned `indexOf`
 * instead of a `Map` built per load. Picks are at most five per second, so a
 * linear search is cheap where a map rebuild was most of the main-thread cost.
 *
 * Tokens are not authoritative: a page can read and replay them (S1c, S1d).
 * A lookup only says which element the served copy marked; the writer
 * re-reads and re-locates from disk at Save.
 */
import { ELEMENT_TOKEN_PATTERN } from '../../../../shared/htmlComments'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import { NO_TARGET, TOKEN_CHARS, type CommentLoadBlock } from './commentParseCore'

/** Loads kept per page and per frame: the current one and the one before it. */
export const TOKEN_TABLE_GENERATIONS = 2
/** Two full generations of a page at the frame cap (`MAX_FRAMES_PER_PAGE` is 50). */
export const MAX_LOADS = 102
/**
 * Twice the per-document cap (§19 Rev 4): the largest page served with tokens
 * still fits beside its frames, or beside its own previous load – frames load
 * after the page, so a smaller budget would evict the page's tokens first. A
 * token costs about 20 bytes (12 characters, an offset, a tag code), so at
 * most about 26 MB of tables per view. A 4 MB element-dense page has 64,187
 * tokens (S9), a dense 25 MB page about 456,000.
 */
export const MAX_TOKENS = 2 * PREVIEW_LIMITS.COMMENT_MAX_TOKENS_PER_DOCUMENT

/** Which frame of the view a load was served to, as far as the request kind tells. */
export type CommentLoadScope = 'page' | 'frame'

/** One instrumented document load, as the worker produced it. */
export interface CommentLoadInput {
  /** The confined real path of the file served (`resolveConfined`). */
  readonly realPath: string
  readonly scope: CommentLoadScope
  readonly fileHash: string
  readonly tokens: string
  readonly offsets: Int32Array
  /** 1-based line of each token's start tag. */
  readonly lines: Uint32Array
  readonly tagCodes: Uint32Array
  readonly tagNames: readonly string[]
  readonly blocks: readonly CommentLoadBlock[]
}

/** What one token names. */
export interface ElementTokenEntry {
  readonly realPath: string
  readonly loadId: string
  readonly fileHash: string
  /** UTF-16 offset of the start tag's `<` in the decoded file as served. */
  readonly startOffset: number
  /** 1-based line of the start tag in the file as served. */
  readonly line: number
  readonly tagName: string
}

/** A load's blocks with their element tokens resolved – what a pin needs (§8 `icons`). */
export interface CommentLoadView {
  readonly loadId: string
  readonly realPath: string
  readonly scope: CommentLoadScope
  readonly fileHash: string
  readonly tokenCount: number
  /** The frame the load is bound to, once bound. */
  readonly frameKey?: string
  readonly blocks: ReadonlyArray<Omit<CommentLoadBlock, 'target'> & { readonly token?: string }>
}

/** Result of {@link ElementTokenTable.bind}. */
export type BindResult = 'bound' | 'already-bound' | 'unknown'

interface LoadRecord {
  readonly id: string
  readonly seq: number
  readonly input: CommentLoadInput
  readonly tokenCount: number
  frameKey?: string
}

/** Token `index` of a load's token string. */
function tokenAt(tokens: string, index: number): string {
  return tokens.slice(index * TOKEN_CHARS, (index + 1) * TOKEN_CHARS)
}

/** Index of `token` in a string of back-to-back tokens, or -1. Only aligned hits count. */
export function alignedTokenIndex(tokens: string, token: string): number {
  if (!ELEMENT_TOKEN_PATTERN.test(token)) return -1
  for (let from = 0; ;) {
    const at = tokens.indexOf(token, from)
    if (at < 0) return -1
    if (at % TOKEN_CHARS === 0) return at / TOKEN_CHARS
    from = at + 1
  }
}

/** The token tables of one preview view. */
export class ElementTokenTable {
  private readonly loads = new Map<string, LoadRecord>()
  private nextSeq = 1
  private tokenTotal = 0

  /** Number of loads held. */
  get size(): number {
    return this.loads.size
  }

  /** Keep a served document's table; returns its load id. */
  register(input: CommentLoadInput): string {
    const seq = this.nextSeq++
    const id = `load-${seq}`
    const tokenCount = input.offsets.length
    this.loads.set(id, { id, seq, input, tokenCount })
    this.tokenTotal += tokenCount
    if (input.scope === 'page') this.keepNewest(record => record.input.scope === 'page')
    this.enforceBudget()
    return id
  }

  /** Bind a load to the frame that said hello for it; the first bind wins. */
  bind(loadId: string, frameKey: string): BindResult {
    const record = this.loads.get(loadId)
    if (record === undefined) return 'unknown'
    if (record.frameKey !== undefined) return 'already-bound'
    record.frameKey = frameKey
    this.keepNewest(other => other.frameKey === frameKey)
    return 'bound'
  }

  /** The frame navigated away or was destroyed: drop every load bound to it, and only those. */
  evictFrame(frameKey: string): void {
    for (const record of [...this.loads.values()]) {
      if (record.frameKey === frameKey) this.drop(record)
    }
  }

  /** What `token` names in load `loadId`; `undefined` for a forged, foreign or evicted token. */
  lookup(loadId: string, token: string): ElementTokenEntry | undefined {
    const record = this.loads.get(loadId)
    if (record === undefined) return undefined
    const index = alignedTokenIndex(record.input.tokens, token)
    if (index < 0) return undefined
    const { realPath, fileHash, offsets, lines, tagCodes, tagNames } = record.input
    return {
      realPath,
      loadId,
      fileHash,
      startOffset: offsets[index],
      line: lines[index] ?? 1,
      tagName: tagNames[tagCodes[index]] ?? ''
    }
  }

  /** The newest load whose table holds `token`, if any. */
  loadOfToken(token: string): string | undefined {
    const newestFirst = [...this.loads.values()].sort((a, b) => b.seq - a.seq)
    return newestFirst.find(record => alignedTokenIndex(record.input.tokens, token) >= 0)?.id
  }

  /** One load's blocks with their tokens. */
  view(loadId: string): CommentLoadView | undefined {
    const record = this.loads.get(loadId)
    return record === undefined ? undefined : viewOf(record)
  }

  /** Every load held, oldest first. */
  views(): CommentLoadView[] {
    return [...this.loads.values()].sort((a, b) => a.seq - b.seq).map(viewOf)
  }

  /** Drop everything (the view is gone). */
  clear(): void {
    this.loads.clear()
    this.tokenTotal = 0
  }

  /** Of the loads matching `inGroup`, keep the newest {@link TOKEN_TABLE_GENERATIONS}. */
  private keepNewest(inGroup: (record: LoadRecord) => boolean): void {
    const group = [...this.loads.values()].filter(inGroup).sort((a, b) => b.seq - a.seq)
    for (const record of group.slice(TOKEN_TABLE_GENERATIONS)) this.drop(record)
  }

  /** Evict oldest first until the view is within its load and token budget. */
  private enforceBudget(): void {
    const oldestFirst = [...this.loads.values()].sort((a, b) => a.seq - b.seq)
    for (const record of oldestFirst) {
      if (this.loads.size <= MAX_LOADS && this.tokenTotal <= MAX_TOKENS) return
      // The newest load always stays: it is the document being served right now.
      if (this.loads.size === 1) return
      this.drop(record)
    }
  }

  private drop(record: LoadRecord): void {
    if (this.loads.delete(record.id)) this.tokenTotal -= record.tokenCount
  }
}

function viewOf(record: LoadRecord): CommentLoadView {
  const { realPath, scope, fileHash, tokens, blocks } = record.input
  return {
    loadId: record.id,
    realPath,
    scope,
    fileHash,
    tokenCount: record.tokenCount,
    ...(record.frameKey === undefined ? {} : { frameKey: record.frameKey }),
    blocks: blocks.map(({ target, ...block }) =>
      target === NO_TARGET || target >= record.tokenCount
        ? block
        : { ...block, token: tokenAt(tokens, target) }
    )
  }
}
