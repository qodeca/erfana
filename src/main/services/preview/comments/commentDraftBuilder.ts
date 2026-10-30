// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A draft from a pick, read from disk (docs/designs/comments/html-preview-comments.md
 * §6, §7.3 step 3, decisions 16–17, 34, §19 R3-8, R3-11; tests M-033, M-054,
 * M-055, SEC-04, SEC-09).
 *
 * The page names an element by a token; main recorded what that token marks
 * in the bytes it served. Here the file is read again – confined like every
 * comment read – and the token's element is looked up in a fresh parse of it:
 * at the recorded offset, with the recorded tag, in bytes that still hash to
 * what was served. Anything else – the file changed since the page loaded,
 * the offset names another element, the file cannot take comments – opens no
 * draft. The menu's excerpt and line come from disk, never from the page.
 *
 * Main reads the bytes; the parse and everything worked out from it – the
 * placement, the anchor, the excerpt – run in the comment parse worker as the
 * `draft` job (`commentDraftCore.ts`, §19 R3-12), or, for a pin click, as the
 * `pin` job that also finds the blocks on the pin's element in the same parse.
 * The draft that results, paths included, stays on main; the renderer gets
 * only its token and an opaque element key ({@link draftKeyOf}).
 */
import { createHash } from 'node:crypto'
import { ErrorCode } from '../../../../shared/errors'
import type { CommentAnchor, CommentView } from '../../../../shared/htmlComments'
import type { CommentPick } from '../../../../shared/ipc/preview-comment-schema'
import { stablePathDigest } from '../../../../shared/stablePathDigest'
import { logger } from '../../LoggingService'
import type { DraftJobResult, DraftPickPart, DraftTargetView, PinBlock } from './commentDraftCore'
import { loadCommentBytes } from '../../comments/commentFileAccess'
import type { HtmlFileJobRunner } from './htmlCommentJobs'
import { jobFailureRefusal, refusalCode } from '../../comments/commentRefusals'
import { samePathKey } from '../../comments/commentUnsavedSources'
import type { ElementTokenEntry } from './ElementTokenTable'
import type { DraftWordsPart } from './commentWordsCore'
import type { FrameFile } from './frameFileMap'

export { cutText } from '../../../../shared/comments/cutText'
export { EXCERPT_MAX_CHARS, lineAt, type DraftTargetView } from './commentDraftCore'

/** What a draft remembers for its Save; main-only, never sent anywhere. */
export interface CommentDraft {
  readonly realRoot: string
  /** The file, as main recorded it for the frame: the writer's target. */
  readonly realPath: string
  readonly file: FrameFile
  /** A frame's file rather than the page's own. */
  readonly frame: boolean
  /** UTF-16 offset of the start tag the block goes before. */
  readonly offset: number
  readonly fileHash: string
  readonly anchor: CommentAnchor
  readonly ws?: 'collapse' | 'preserve'
  readonly view: CommentView
  /** The page's real path when the pick was made: a save restores only onto that page. */
  readonly pageRealPath?: string
  /** The target's text the window chose its words from: a save keeps words found once in it (024-FR-004). */
  readonly wordsText?: string
}

/** A built draft, or why there is none (`code` absent: the element cannot take comments). */
export type BuiltDraft =
  | ({ readonly ok: true; readonly draft: CommentDraft; readonly target: DraftTargetView } & DraftWordsPart)
  | { readonly ok: false; readonly code?: ErrorCode }

/** What a draft is built from. */
export interface DraftInput {
  readonly realRoot: string
  readonly file: FrameFile
  readonly entry: ElementTokenEntry
  readonly pick: CommentPick
  readonly frame: boolean
  readonly pageRealPath?: string
  /** Where the parse runs: the comment parse worker in the app. */
  readonly jobs: HtmlFileJobRunner
  readonly platform?: NodeJS.Platform
}

const MOVED = { ok: false, code: ErrorCode.COMMENT_TARGET_MOVED } as const

/** The pick's runtime description and whitespace – all the parse needs of it. */
function pickPartOf(pick: CommentPick): DraftPickPart {
  return {
    ...(pick.runtime === undefined ? {} : { runtime: pick.runtime }),
    ...(pick.ws === undefined ? {} : { ws: pick.ws }),
    ...(pick.sel === undefined ? {} : { sel: pick.sel }),
    ...(pick.long === undefined ? {} : { long: pick.long }),
    ...(pick.crossed === undefined ? {} : { crossed: pick.crossed })
  }
}

/**
 * The element key a draft's typed text is kept under in the renderer (the
 * session drafts, §10.4 "Draft restored"): an opaque digest of the file and
 * the element's place in it – the in-file element's CSS path (its offset when
 * the path was too long to store), and the JS-built element below it. Two
 * elements never share one, two id-less `div`s on one line included; the same
 * element picked again gets the same one while its place in the file holds –
 * also after an edit elsewhere in the file, so "pick it again – your text will
 * be restored" (§10.10) keeps its word. Never a path: a SHA-256, cut to 128 bits.
 *
 * @example
 * ```ts
 * draftKeyOf(draft) // '3f1c…' – 32 hex characters
 * ```
 */
export function draftKeyOf(draft: Pick<CommentDraft, 'realPath' | 'offset' | 'anchor'>): string {
  const { anchor } = draft
  const place = anchor.path === '' ? `offset:${draft.offset}` : `path:${anchor.path}`
  const identity = JSON.stringify([draft.realPath, place, anchor.runtime?.path ?? null, anchor.runtime?.tag ?? null])
  return createHash('sha256').update(identity).digest('hex').slice(0, 32)
}

/** The file's bytes, read again and confined, or why a draft cannot be built from them. */
async function loadFor(input: Pick<DraftInput, 'realRoot' | 'file' | 'platform'>) {
  const loaded = await loadCommentBytes({ realRoot: input.realRoot, filePath: input.file.realPath }, { platform: input.platform })
  if (!loaded.ok) return { ok: false, refused: { ok: false, code: refusalCode(loaded.reason) } } as const
  if (samePathKey(loaded.realPath, input.platform) !== samePathKey(input.file.realPath, input.platform)) {
    return { ok: false, refused: MOVED } as const
  }
  return { ok: true, bytes: loaded.bytes } as const
}

/** A failed job, logged by its failure and the file's digest. */
function jobFailed(failure: Parameters<typeof jobFailureRefusal>[0], realPath: string): BuiltDraft {
  logger.warn('Preview comments: a draft could not be prepared', { failure, file: stablePathDigest(realPath) })
  return { ok: false, code: refusalCode(jobFailureRefusal(failure).reason) }
}

/** The worker's entry for a token: where it was served, as what, in which bytes. */
function entryOf(entry: ElementTokenEntry) {
  return { startOffset: entry.startOffset, tagName: entry.tagName, fileHash: entry.fileHash }
}

/** Read the file again and build the draft for a pick's token. Never throws. */
export async function buildDraft(input: DraftInput): Promise<BuiltDraft> {
  const loaded = await loadFor(input)
  if (!loaded.ok) return loaded.refused
  const built = await input.jobs.runJob(loaded.bytes, { kind: 'draft', entry: entryOf(input.entry), pick: pickPartOf(input.pick) })
  if (built.kind === 'failed') return jobFailed(built.failure, input.file.realPath)
  return draftFrom(input, input.pick, built)
}

/** What a pin click is built from: a draft's input, the pick only when "New comment" can be offered. */
export interface PinInput extends Omit<DraftInput, 'pick'> {
  /** The pick "New comment" is built from; absent: no draft. */
  readonly pick?: CommentPick
  /** Look for the damaged and newer blocks standing on the element. */
  readonly blocks: boolean
}

/** A pin click's draft and blocks. */
export interface BuiltPin {
  readonly draft: BuiltDraft
  readonly blocks: readonly PinBlock[]
}

/**
 * Read the file once and, in ONE worker job, find the blocks standing on the
 * pin's element and build the draft for its "New comment" (M4). Never throws.
 */
export async function buildPin(input: PinInput): Promise<BuiltPin> {
  if (input.pick === undefined && !input.blocks) return { draft: { ok: false }, blocks: [] }
  const loaded = await loadFor(input)
  if (!loaded.ok) return { draft: loaded.refused, blocks: [] }
  const found = await input.jobs.runJob(loaded.bytes, {
    kind: 'pin',
    entry: entryOf(input.entry),
    blocks: input.blocks,
    ...(input.pick === undefined ? {} : { pick: pickPartOf(input.pick) })
  })
  if (found.kind === 'failed') return { draft: jobFailed(found.failure, input.file.realPath), blocks: [] }
  const draft = input.pick === undefined || found.draft === undefined ? { ok: false as const } : draftFrom(input, input.pick, found.draft)
  return { draft, blocks: found.blocks }
}

/** The draft from the worker's half of it. */
function draftFrom(input: Omit<DraftInput, 'pick' | 'jobs'>, pick: CommentPick, built: DraftJobResult): BuiltDraft {
  if (!built.ok) return built.refusal === undefined ? { ok: false } : { ok: false, code: refusalCode(built.refusal) }
  const { file } = input
  const draft: CommentDraft = {
    realRoot: input.realRoot,
    realPath: file.realPath,
    file,
    frame: input.frame,
    offset: built.offset,
    fileHash: built.fileHash,
    anchor: built.anchor,
    ...(built.ws === undefined ? {} : { ws: built.ws }),
    view: pick.view,
    ...(input.pageRealPath === undefined ? {} : { pageRealPath: input.pageRealPath }),
    ...(built.words === undefined ? {} : { wordsText: built.words.text })
  }
  return {
    ok: true,
    draft,
    target: built.target,
    ...(built.words === undefined ? {} : { words: built.words }),
    ...(built.wordsMissing === undefined ? {} : { wordsMissing: built.wordsMissing })
  }
}
