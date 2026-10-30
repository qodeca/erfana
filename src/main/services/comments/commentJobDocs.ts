// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The parsed document a comment file job works on, and the parse worker's
 * cache of them (docs/designs/comments/html-preview-comments.md §19 R3-12).
 *
 * Pure apart from a hash: no Electron, no file system, no worker API, so the
 * worker shell (`commentParseWorker.ts`) and the in-process runner the suites
 * use (`commentFileJobs.ts`) share it.
 *
 * The cache is keyed by file kind and the SHA-256 of the bytes, not by path
 * (spec 024 architecture note 001 § 8 C19): the parse depends on the kind and
 * the bytes alone, so two files of one kind with the same bytes share one
 * entry, a changed file misses, the same bytes read as another kind never
 * meet the first kind's document, and the worker never learns a path. A job
 * sees only its own kind's slice ({@link CommentDocCache.forKind}). It is
 * bounded by entries and by the source bytes it holds – a 4 MB page holds
 * about 60 MB of tree while it is alive (spike S9), a dense 25 MB page about
 * 760 MB (§19 Rev 4), against the worker's heap ceiling (`WORKER_HEAP_MB`).
 * A file over {@link DOC_CACHE_MAX_BYTES} is never cached, so every pick,
 * pin and list of one parses it again.
 *
 * What may be cached: a document straight from `parseCommentFile`, whose
 * anchor lookup tables (`anchorLookup.ts`) have been used by the block parse
 * only. Those tables are shared by every later lookup on the same index and
 * carry ONE quote-read budget, so a job that runs backup-tier lookups of its
 * own (the writer's re-location of a draft) must not take a cached document –
 * its answer would depend on what earlier jobs spent. That job parses afresh
 * (`freshDocumentOf`); the read-only jobs (draft, pin, list) never run such a
 * lookup and use the cache.
 */
import { createHash } from 'node:crypto'
import {
  parseCommentFile,
  type CommentDocument,
  type FileCommentState
} from '../../../shared/htmlComments'
import { decodeLossless } from '../../../shared/comments/encoding'
import type { CommentFileKind, CommentFileKindId, KindDocument } from '../../../shared/comments/fileKind'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import type { CommentRefusal } from './commentRefusals'

/** Source bytes the cache may hold: two 4 MB pages, about 120 MB of tree (S9). */
export const DOC_CACHE_MAX_BYTES = 8 * 1024 * 1024
/** Documents the cache may hold. */
export const DOC_CACHE_MAX_ENTRIES = 16

/** A job's document: parsed, or why its bytes cannot be read for comments. `D` is the kind's document. */
export type JobDocument<D extends KindDocument = CommentDocument> =
  | { readonly ok: true; readonly hash: string; readonly doc: D }
  | { readonly ok: false; readonly hash: string; readonly refusal: CommentRefusal }

/** SHA-256 (hex) of `bytes` – the same digest the token table and the writer use. */
export function sha256HexOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Why a read-only comment state may not be written: its reason, or `read-only`. */
export function readOnlyRefusal(state: FileCommentState): CommentRefusal {
  return state.readOnlyReason ?? 'read-only'
}

/** Why a parsed file may not be written, or `null` when it may. */
export function writableRefusal(state: FileCommentState): CommentRefusal | null {
  return state.writable ? null : readOnlyRefusal(state)
}

/**
 * Why no NEW comment may be added to a parsed file, or `null` when one may:
 * read-only, or already at `COMMENT_MAX_BLOCKS_PER_FILE` blocks – where
 * replies, edits and resolves still work (spec 024 state table F-04). The
 * planners refuse the same (`insertRefusal`); this lets the list, the HTML
 * draft and `openDraft` say so before anything is typed.
 */
export function addRefusal(state: FileCommentState): CommentRefusal | null {
  const blocked = writableRefusal(state)
  if (blocked !== null) return blocked
  return state.blocks.length >= PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE ? 'too-many-blocks' : null
}

interface CacheEntry {
  readonly doc: unknown
  readonly bytes: number
}

/** One file kind's slice of a {@link CommentDocCache}: that kind's documents, by content hash. */
export interface KindDocCache<D> {
  /** The document for `hash`, now the most recently used; `undefined` on a miss. */
  get(hash: string): D | undefined
  /** Keep `doc`, parsed from `bytes` source bytes; one over the byte budget is not kept. */
  set(hash: string, doc: D, bytes: number): void
}

/**
 * Parsed documents by file kind and content hash, least recently used first
 * out. Every kind shares the one budget: the worker has one heap.
 */
export class CommentDocCache {
  private readonly entries = new Map<string, CacheEntry>()
  private heldBytes = 0

  constructor(
    private readonly maxBytes = DOC_CACHE_MAX_BYTES,
    private readonly maxEntries = DOC_CACHE_MAX_ENTRIES
  ) {}

  /** Documents held now, of every kind. */
  get size(): number {
    return this.entries.size
  }

  /**
   * The slice of file kind `kind`. Each kind's jobs keep one document type
   * under its own keys, so what a slice reads back is what that kind stored.
   */
  forKind<D>(kind: CommentFileKindId): KindDocCache<D> {
    // A content hash is 64 hex characters, so the key splits one way only, whatever the kind id holds.
    const keyOf = (hash: string): string => `${kind}:${hash}`
    return {
      get: hash => this.get(keyOf(hash)) as D | undefined,
      set: (hash, doc, bytes) => this.set(keyOf(hash), doc, bytes)
    }
  }

  private get(key: string): unknown {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.doc
  }

  private set(key: string, doc: unknown, bytes: number): void {
    if (bytes > this.maxBytes) return
    this.drop(key)
    this.entries.set(key, { doc, bytes })
    this.heldBytes += bytes
    for (const [oldest] of this.entries) {
      if (this.heldBytes <= this.maxBytes && this.entries.size <= this.maxEntries) break
      this.drop(oldest)
    }
  }

  private drop(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    this.entries.delete(key)
    this.heldBytes -= entry.bytes
  }
}

function parsed(bytes: Uint8Array, hash: string): JobDocument {
  const result = parseCommentFile(bytes)
  return result.ok
    ? { ok: true, hash, doc: result.doc }
    : { ok: false, hash, refusal: readOnlyRefusal(result.state) }
}

/** The document for `bytes` from `cache`, parsed and kept on a miss. For read-only jobs. */
export function documentOf(bytes: Uint8Array, cache: KindDocCache<CommentDocument>): JobDocument {
  const hash = sha256HexOf(bytes)
  const cached = cache.get(hash)
  if (cached !== undefined) return { ok: true, hash, doc: cached }
  const document = parsed(bytes, hash)
  if (document.ok) cache.set(hash, document.doc, bytes.length)
  return document
}

/** A fresh parse of `bytes`, never from the cache (see the module comment). */
export function freshDocumentOf(bytes: Uint8Array): JobDocument {
  return parsed(bytes, sha256HexOf(bytes))
}

/** The read-only document a kind's parse ends in when the file is past what it may parse. */
function isTooLargeState(doc: KindDocument): boolean {
  return doc.state.readOnlyReason === 'too-large'
}

/**
 * Any file kind's document for `bytes`, parsed afresh (spec 024 architecture
 * note 001 § 5 steps 4–5): over `COMMENT_FILE_MAX_BYTES` is `too-large` before
 * any decode, anything but a lossless UTF-8 round trip is `encoding`, and a
 * kind that marks the file `too-large` itself (its own bounds, NFR-008) is
 * refused the same way. The HTML kind keeps its own reader
 * ({@link freshDocumentOf}), which adds the parse5 token pre-checks.
 */
export function freshKindDocumentOf(bytes: Uint8Array, kind: CommentFileKind): JobDocument<KindDocument> {
  return kindDocumentWithHash(bytes, kind, sha256HexOf(bytes))
}

/** {@link freshKindDocumentOf} with the hash of `bytes` already worked out. */
function kindDocumentWithHash(bytes: Uint8Array, kind: CommentFileKind, hash: string): JobDocument<KindDocument> {
  if (bytes.length > PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES) return { ok: false, hash, refusal: 'too-large' }
  const decoded = decodeLossless(bytes)
  if (!decoded.ok) return { ok: false, hash, refusal: 'encoding' }
  const doc = kind.parse(decoded.text, decoded.hasBom ? 1 : 0)
  return isTooLargeState(doc) ? { ok: false, hash, refusal: 'too-large' } : { ok: true, hash, doc }
}

/**
 * {@link freshKindDocumentOf} through `cache`: a kind's list, and the
 * planning read of its write (`kindCommentJobs.ts`), which runs no budgeted
 * lookup of its own.
 */
export function kindDocumentOf(bytes: Uint8Array, kind: CommentFileKind, cache: KindDocCache<KindDocument>): JobDocument<KindDocument> {
  const hash = sha256HexOf(bytes)
  const cached = cache.get(hash)
  if (cached !== undefined) return { ok: true, hash, doc: cached }
  const document = kindDocumentWithHash(bytes, kind, hash)
  if (document.ok) cache.set(hash, document.doc, bytes.length)
  return document
}
