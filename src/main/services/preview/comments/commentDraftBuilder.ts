// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A draft from a pick, read from disk (docs/designs/html-preview-comments.md
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
 * `draft` job (`commentDraftCore.ts`, §19 R3-12). The draft that results,
 * paths included, stays on main.
 */
import { ErrorCode } from '../../../../shared/errors'
import type { CommentAnchor, CommentView } from '../../../../shared/htmlComments'
import type { CommentPick } from '../../../../shared/ipc/preview-comment-schema'
import { stablePathDigest } from '../../../../shared/stablePathDigest'
import { logger } from '../../LoggingService'
import type { DraftPickPart, DraftTargetView } from './commentDraftCore'
import { loadCommentBytes } from './commentFileAccess'
import type { CommentFileJobRunner } from './commentFileJobs'
import { jobFailureRefusal, refusalCode } from './commentRefusals'
import { samePathKey } from './commentUnsavedSources'
import type { ElementTokenEntry } from './ElementTokenTable'
import type { FrameFile } from './frameFileMap'

export { cutText, EXCERPT_MAX_CHARS, lineAt, type DraftTargetView } from './commentDraftCore'

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
}

/** A built draft, or why there is none (`code` absent: the element cannot take comments). */
export type BuiltDraft =
  | { readonly ok: true; readonly draft: CommentDraft; readonly target: DraftTargetView }
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
  readonly jobs: CommentFileJobRunner
  readonly platform?: NodeJS.Platform
}

const MOVED = { ok: false, code: ErrorCode.COMMENT_TARGET_MOVED } as const

/** The pick's runtime description and whitespace – all the parse needs of it. */
function pickPartOf(pick: CommentPick): DraftPickPart {
  return {
    ...(pick.runtime === undefined ? {} : { runtime: pick.runtime }),
    ...(pick.ws === undefined ? {} : { ws: pick.ws })
  }
}

/** Read the file again and build the draft for a pick's token. Never throws. */
export async function buildDraft(input: DraftInput): Promise<BuiltDraft> {
  const { entry, pick, file } = input
  const loaded = await loadCommentBytes({ realRoot: input.realRoot, filePath: file.realPath }, { platform: input.platform })
  if (!loaded.ok) return { ok: false, code: refusalCode(loaded.reason) }
  if (samePathKey(loaded.realPath, input.platform) !== samePathKey(file.realPath, input.platform)) return MOVED
  const built = await input.jobs.runJob(loaded.bytes, {
    kind: 'draft',
    entry: { startOffset: entry.startOffset, tagName: entry.tagName, fileHash: entry.fileHash },
    pick: pickPartOf(pick)
  })
  if (built.kind === 'failed') {
    logger.warn('Preview comments: a draft could not be prepared', { failure: built.failure, file: stablePathDigest(file.realPath) })
    return { ok: false, code: refusalCode(jobFailureRefusal(built.failure).reason) }
  }
  if (!built.ok) return built.refusal === undefined ? { ok: false } : { ok: false, code: refusalCode(built.refusal) }
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
    ...(input.pageRealPath === undefined ? {} : { pageRealPath: input.pageRealPath })
  }
  return { ok: true, draft, target: built.target }
}
