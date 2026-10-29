// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Draft tokens and the opaque keys of one preview view's comments
 * (docs/designs/comments/html-preview-comments.md §3 "Editing existing comments", §7.5
 * step 1, §8, §9.1 S23; tests M-051, M-053, M-057, SEC-08).
 *
 * The renderer never names a file, an offset or a block. A pick mints a
 * DRAFT (what main read from disk about the picked element) behind a random
 * token; a comment list mints a `fileKey`, a `threadKey` per thread and a
 * `blockKey` per damaged or newer block. Every one is bound to the window, the
 * panel and the view session it was minted for, and anything else –
 * an unknown key, a key of another window, panel or view, a key of another
 * kind – is `COMMENT_KEY_INVALID`, without saying which.
 *
 * Drafts are single use and live ten minutes: a claim marks the draft in
 * flight (a second save of the same draft is refused while the first runs),
 * and only a save that wrote consumes it – a refused save leaves the draft for
 * the next try, with the window's text (M-057). An expired draft is
 * `COMMENT_DRAFT_EXPIRED` while it is still held.
 *
 * Keys are stable: the same thread in the same view always gets the same key,
 * so a list read after a reload still matches the window that is open. A view
 * session ends with the view (`clear`): a suspended, closed or project-switched
 * view's drafts and keys are gone, and so is everything they named.
 *
 * Both stores are bounded, and what they forget first is what the renderer is
 * least likely to hold: a draft whose save is running is never forgotten, and
 * no key handed out or used since the current list began
 * ({@link CommentKeyStore.beginGeneration}) is – the keys of one list stay
 * valid until the next list, up to {@link MAX_KEYS_HARD}. Past that, the least
 * recently handed out or used goes first.
 */
import { randomBytes } from 'node:crypto'
import { ErrorCode } from '../../../shared/errors'

/** How long a draft may wait for its Save (§7.5 step 1). */
export const DRAFT_TTL_MS = 10 * 60 * 1000
/** Drafts one view holds; the oldest is forgotten past this. */
export const MAX_DRAFTS = 64
/** Keys one view holds; past this the oldest not handed out or used since the current list began is forgotten. */
export const MAX_KEYS = 8_192
/** Keys one view holds at most, current list or not: the oldest is forgotten past this. */
export const MAX_KEYS_HARD = 65_536

/** Who a draft or key was minted for. */
export interface CommentBinding {
  readonly windowId: number
  readonly panelId: string
  /** The view session: a new live view – a reopen, a resume – is a new session. */
  readonly session: number
}

/** What a key names. */
export type CommentKeyTarget =
  | { readonly kind: 'file'; readonly realPath: string }
  | { readonly kind: 'thread'; readonly realPath: string; readonly threadId: string }
  | {
      readonly kind: 'block'
      readonly realPath: string
      readonly rawHash: string
      /** The block's start when it was listed: picks one of several identical damaged blocks. */
      readonly start: number
    }

/** Why a draft or key was refused. */
export type CommentKeyRefusal = ErrorCode.COMMENT_KEY_INVALID | ErrorCode.COMMENT_DRAFT_EXPIRED

/** A lookup result. */
export type KeyLookup<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: CommentKeyRefusal }

/** The store's collaborators; production uses the defaults. */
export interface CommentKeyStoreDeps {
  readonly now?: () => number
  readonly random?: (bytes: number) => Uint8Array
}

interface DraftRecord<D> {
  readonly binding: CommentBinding
  readonly draft: D
  readonly mintedAt: number
  inFlight: boolean
}

interface KeyRecord {
  readonly binding: CommentBinding
  readonly target: CommentKeyTarget
  /** The list generation the key was last handed out or used in. */
  generation: number
}

const INVALID = { ok: false, code: ErrorCode.COMMENT_KEY_INVALID } as const
const PREFIX: Readonly<Record<CommentKeyTarget['kind'], string>> = { file: 'f', thread: 't', block: 'b' }

function sameBinding(a: CommentBinding, b: CommentBinding): boolean {
  return a.windowId === b.windowId && a.panelId === b.panelId && a.session === b.session
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

/** The identity a stable key is kept under. */
function identityOf(binding: CommentBinding, target: CommentKeyTarget): string {
  const head = `${binding.windowId}\u0000${binding.panelId}\u0000${binding.session}\u0000${target.kind}\u0000${target.realPath}`
  if (target.kind === 'file') return head
  if (target.kind === 'thread') return `${head}\u0000${target.threadId}`
  return `${head}\u0000${target.rawHash}\u0000${target.start}`
}

/**
 * Forget the oldest entries of `map` past `max` (insertion order is age),
 * skipping those `spare` keeps; stop at the first that `keepRest` keeps,
 * with everything newer than it.
 */
function trim<V>(
  map: Map<string, V>,
  max: number,
  rules: { spare?: (value: V) => boolean; keepRest?: (value: V) => boolean; onDrop?: (key: string, value: V) => void } = {}
): void {
  for (const [key, value] of map) {
    if (map.size <= max || rules.keepRest?.(value) === true) return
    if (rules.spare?.(value) === true) continue
    map.delete(key)
    rules.onDrop?.(key, value)
  }
}

/** Move `key` to the newest end of `map`. */
function touch<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key)
  map.set(key, value)
}

/** One view's drafts and keys. `D` is the draft the pick handler recorded. */
export class CommentKeyStore<D> {
  private readonly drafts = new Map<string, DraftRecord<D>>()
  private readonly keys = new Map<string, KeyRecord>()
  private readonly identities = new Map<string, string>()
  private generation = 0
  private readonly now: () => number
  private readonly random: (bytes: number) => Uint8Array

  constructor(deps: CommentKeyStoreDeps = {}) {
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? (bytes => randomBytes(bytes))
  }

  /** Mint a draft token (128 random bits, lower-case hex). */
  mintDraft(binding: CommentBinding, draft: D): string {
    const token = hex(this.random(16))
    this.drafts.set(token, { binding, draft, mintedAt: this.now(), inFlight: false })
    trim(this.drafts, MAX_DRAFTS, { spare: record => record.inFlight })
    return token
  }

  /** Take a draft for a save: refused when unknown, foreign, in flight or expired. */
  claimDraft(token: string, binding: CommentBinding): KeyLookup<D> {
    const record = this.drafts.get(token)
    if (record === undefined || !sameBinding(record.binding, binding) || record.inFlight) return INVALID
    if (this.now() - record.mintedAt > DRAFT_TTL_MS) {
      return { ok: false, code: ErrorCode.COMMENT_DRAFT_EXPIRED }
    }
    record.inFlight = true
    return { ok: true, value: record.draft }
  }

  /** The save settled: a write consumes the draft, a refusal hands it back. */
  settleDraft(token: string, consumed: boolean): void {
    const record = this.drafts.get(token)
    if (record === undefined) return
    if (consumed) this.drafts.delete(token)
    else record.inFlight = false
  }

  /** A comment list begins: every key it hands out, and every key used from now on, is kept until the next list. */
  beginGeneration(): void {
    this.generation += 1
  }

  /** The stable key for `target` in this binding. */
  keyFor(binding: CommentBinding, target: CommentKeyTarget): string {
    const identity = identityOf(binding, target)
    const known = this.identities.get(identity)
    const record = known === undefined ? undefined : this.keys.get(known)
    if (known !== undefined && record !== undefined) {
      this.used(known, record)
      return known
    }
    const key = `${PREFIX[target.kind]}${hex(this.random(12))}`
    this.keys.set(key, { binding, target, generation: this.generation })
    this.identities.set(identity, key)
    const onDrop = (_dropped: string, dropped: KeyRecord): void => {
      this.identities.delete(identityOf(dropped.binding, dropped.target))
    }
    trim(this.keys, MAX_KEYS, { keepRest: kept => kept.generation === this.generation, onDrop })
    trim(this.keys, MAX_KEYS_HARD, { onDrop })
    return key
  }

  /** What `key` names, when it is a `kind` key of this binding. */
  resolve<K extends CommentKeyTarget['kind']>(
    binding: CommentBinding,
    key: string,
    kind: K
  ): KeyLookup<Extract<CommentKeyTarget, { kind: K }>> {
    const record = this.keys.get(key)
    if (record === undefined || !sameBinding(record.binding, binding) || record.target.kind !== kind) {
      return INVALID
    }
    this.used(key, record)
    return { ok: true, value: record.target as Extract<CommentKeyTarget, { kind: K }> }
  }

  /** A key was handed out or used: newest, and kept through this generation. */
  private used(key: string, record: KeyRecord): void {
    record.generation = this.generation
    touch(this.keys, key, record)
  }

  /** Drafts and keys held (tests, the e2e hook). */
  get size(): { readonly drafts: number; readonly keys: number } {
    return { drafts: this.drafts.size, keys: this.keys.size }
  }

  /** The view session ended: every draft and key is gone. */
  clear(): void {
    this.drafts.clear()
    this.keys.clear()
    this.identities.clear()
  }
}
