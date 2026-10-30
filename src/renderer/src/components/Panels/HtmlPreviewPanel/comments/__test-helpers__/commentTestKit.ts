// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – fixtures and a fake `window.api.previewComments`
 * for the renderer's unit tests (docs/designs/comments/html-preview-comments.md §12).
 *
 * Every builder returns a value that satisfies the shared zod schema, so a
 * test that passes here is not leaning on a shape main could never send.
 *
 * @module HtmlPreviewPanel/comments/__test-helpers__/commentTestKit
 */
import { vi } from 'vitest'
import type {
  CommentAnchorStatus,
  CommentDraftOpened,
  CommentFileView,
  CommentModeChanged,
  CommentSaveSettled,
  CommentsChanged,
  CommentThreadView,
  PreviewCommentsBridge
} from '../../../../../../../shared/ipc/preview-comment-schema'
import type { CommentWindowRequest } from '../../../../Comments/commentWindowTypes'

type Message = CommentThreadView['messages'][number]

/** A hex string of `length` characters, distinct per `seed`. */
export function hex(seed: number, length: number): string {
  return seed.toString(16).padStart(length, '0').slice(-length)
}

/** A message id in the on-disk shape (`m-` + 16 base32 characters). */
export function messageId(seed: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  let out = ''
  let n = seed + 1
  for (let i = 0; i < 16; i += 1) {
    out += alphabet[n % 32]
    n = Math.floor(n / 32) + i
  }
  return `m-${out}`
}

/** A message, 2026-10-20 10:00 UTC by default. */
export function message(seed: number, patch: Partial<Message> = {}): Message {
  return {
    id: messageId(seed),
    by: { name: 'Ada Lovelace' },
    at: '2026-10-20T10:00:00.000Z',
    text: `Message ${seed}`,
    ...patch
  }
}

/** An open, attached thread with one message. */
export function thread(seed: number, patch: Partial<CommentThreadView> = {}): CommentThreadView {
  return {
    threadKey: `t${seed}`,
    rawHash: hex(seed, 64),
    status: 'open',
    line: 10 + seed,
    tag: 'button',
    elementId: undefined,
    classes: ['cta'],
    attached: true,
    notVisible: false,
    messages: [message(seed)],
    ...patch
  }
}

/** A writable page file with no comments. */
export function fileView(patch: Partial<CommentFileView> = {}): CommentFileView {
  return {
    fileKey: 'f1',
    displayPath: 'index.html',
    filePath: '/project/index.html',
    frame: false,
    writable: true,
    threads: [],
    damaged: [],
    newer: [],
    ...patch
  }
}

/** A damaged block. */
export function damaged(
  seed: number,
  patch: Partial<CommentFileView['damaged'][number]> = {}
): CommentFileView['damaged'][number] {
  return {
    blockKey: `b${seed}`,
    rawHash: hex(seed + 100, 64),
    reason: 'bad-json',
    line: 40 + seed,
    raw: '<!-- erfana:comment {not json -->',
    ...patch
  }
}

/** A 32-hex draft token. */
export const DRAFT_TOKEN = hex(0xabc, 32)
/** A 32-hex element key, as main mints it for a draft. */
export const DRAFT_KEY = hex(0xe1e, 32)

/** A `menu` draft event for a plain button. */
export function menuDraft(
  patch: Partial<Extract<CommentDraftOpened, { kind: 'menu' | 'open' }>> = {}
) {
  return {
    panelId: 'preview-index',
    kind: 'menu' as const,
    point: { x: 200, y: 150 },
    displayPath: 'index.html',
    filePath: '/project/index.html',
    frame: false,
    fileKey: 'f1',
    draftToken: DRAFT_TOKEN,
    draftKey: DRAFT_KEY,
    target: {
      tag: 'button',
      elementId: 'buy',
      classes: ['cta', 'primary'],
      line: 12,
      excerpt: '<button id="buy" class="cta primary">'
    },
    ...patch
  } satisfies CommentDraftOpened
}

/** A new-comment window request built from {@link menuDraft}. */
export function newRequest(
  patch: Partial<Extract<CommentWindowRequest, { kind: 'new' }>> = {}
): Extract<CommentWindowRequest, { kind: 'new' }> {
  const draft = menuDraft()
  return {
    kind: 'new',
    panelId: draft.panelId,
    draftToken: draft.draftToken,
    draftKey: draft.draftKey,
    target: draft.target,
    file: draft,
    point: draft.point,
    opener: 'page',
    ...patch
  }
}

/** A threads window request for `t1` in `f1`. */
export function threadsRequest(
  patch: Partial<Extract<CommentWindowRequest, { kind: 'threads' }>> = {}
): Extract<CommentWindowRequest, { kind: 'threads' }> {
  return {
    kind: 'threads',
    panelId: 'preview-index',
    fileKey: 'f1',
    threadKeys: ['t1'],
    blockKeys: [],
    point: { x: 200, y: 150 },
    opener: 'page',
    listAfter: 0,
    ...patch
  }
}

/** The fake bridge plus a way to raise each main → renderer event. */
export interface FakeCommentsBridge {
  readonly bridge: { [K in keyof PreviewCommentsBridge]: ReturnType<typeof vi.fn> }
  emitDraft: (payload: CommentDraftOpened) => void
  emitChanged: (payload: CommentsChanged) => void
  emitAnchors: (payload: CommentAnchorStatus) => void
  emitMode: (payload: CommentModeChanged) => void
  emitSettled: (payload: CommentSaveSettled) => void
  /** Removes the bridge (and every other `window.api` domain this put there). */
  uninstall: () => void
}

/**
 * Installs a fake `window.api.previewComments`, keeping any other domain a
 * test already put on `window.api`.
 *
 * @returns The bridge's spies and event emitters.
 */
export function installCommentsBridge(): FakeCommentsBridge {
  const listeners = {
    draft: new Set<(p: CommentDraftOpened) => void>(),
    changed: new Set<(p: CommentsChanged) => void>(),
    anchors: new Set<(p: CommentAnchorStatus) => void>(),
    mode: new Set<(p: CommentModeChanged) => void>(),
    settled: new Set<(p: CommentSaveSettled) => void>()
  }
  const subscribe =
    <T>(set: Set<(p: T) => void>) =>
    (callback: (p: T) => void) => {
      set.add(callback)
      return () => set.delete(callback)
    }
  const bridge = {
    setMode: vi.fn(async (r: { on: boolean; showIcons: boolean }) => ({
      ok: true as const,
      on: r.on,
      showIcons: r.showIcons
    })),
    list: vi.fn(async () => ({ ok: true as const, files: [] as CommentFileView[] })),
    reveal: vi.fn(async () => ({ ok: true as const })),
    keepDraft: vi.fn(async () => ({ ok: true as const })),
    save: vi.fn(async () => ({ ok: true as const, threadKey: 't9' })),
    setUnsavedSources: vi.fn(async () => ({ ok: true as const })),
    onDraftOpened: vi.fn(subscribe(listeners.draft)),
    onCommentsChanged: vi.fn(subscribe(listeners.changed)),
    onAnchorStatus: vi.fn(subscribe(listeners.anchors)),
    onModeChanged: vi.fn(subscribe(listeners.mode)),
    onSaveSettled: vi.fn(subscribe(listeners.settled))
  }
  const holder = window as unknown as { api?: Record<string, unknown> }
  const before = holder.api
  holder.api = { ...(before ?? {}), previewComments: bridge }
  return {
    bridge,
    emitDraft: p => listeners.draft.forEach(l => l(p)),
    emitChanged: p => listeners.changed.forEach(l => l(p)),
    emitAnchors: p => listeners.anchors.forEach(l => l(p)),
    emitMode: p => listeners.mode.forEach(l => l(p)),
    emitSettled: p => [...listeners.settled].forEach(l => l(p)),
    uninstall: () => {
      holder.api = before
    }
  }
}
