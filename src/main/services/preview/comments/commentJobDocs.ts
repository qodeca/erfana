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
 * The cache is keyed by the SHA-256 of the bytes, not by path: the parse
 * depends on the bytes alone, so two files with the same bytes share one
 * entry, a changed file misses, and the worker never learns a path. It is
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
} from '../../../../shared/htmlComments'
import type { CommentRefusal } from './commentRefusals'

/** Source bytes the cache may hold: two 4 MB pages, about 120 MB of tree (S9). */
export const DOC_CACHE_MAX_BYTES = 8 * 1024 * 1024
/** Documents the cache may hold. */
export const DOC_CACHE_MAX_ENTRIES = 16

/** A job's document: parsed, or why its bytes cannot be read for comments. */
export type JobDocument =
  | { readonly ok: true; readonly hash: string; readonly doc: CommentDocument }
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

interface CacheEntry {
  readonly doc: CommentDocument
  readonly bytes: number
}

/** Parsed documents by content hash, least recently used first out. */
export class CommentDocCache {
  private readonly entries = new Map<string, CacheEntry>()
  private heldBytes = 0

  constructor(
    private readonly maxBytes = DOC_CACHE_MAX_BYTES,
    private readonly maxEntries = DOC_CACHE_MAX_ENTRIES
  ) {}

  /** Documents held now. */
  get size(): number {
    return this.entries.size
  }

  /** The document for `hash`, now the most recently used; `undefined` on a miss. */
  get(hash: string): CommentDocument | undefined {
    const entry = this.entries.get(hash)
    if (entry === undefined) return undefined
    this.entries.delete(hash)
    this.entries.set(hash, entry)
    return entry.doc
  }

  /** Keep `doc`, parsed from `bytes` source bytes; one over the byte budget is not kept. */
  set(hash: string, doc: CommentDocument, bytes: number): void {
    if (bytes > this.maxBytes) return
    this.drop(hash)
    this.entries.set(hash, { doc, bytes })
    this.heldBytes += bytes
    for (const [oldest] of this.entries) {
      if (this.heldBytes <= this.maxBytes && this.entries.size <= this.maxEntries) break
      this.drop(oldest)
    }
  }

  private drop(hash: string): void {
    const entry = this.entries.get(hash)
    if (entry === undefined) return
    this.entries.delete(hash)
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
export function documentOf(bytes: Uint8Array, cache: CommentDocCache): JobDocument {
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
