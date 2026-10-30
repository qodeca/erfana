// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The seam between the shared comment base and one kind of file
 * (spec 024 architecture note 001 § 3, § 5, § 8 C1, C2, C24; 024-FR-001,
 * 024-FR-002).
 *
 * A file kind is what a comment needs to know about one file type that uses
 * `<!-- -->` comments: how to parse it, find a target in it, where a block
 * may go, how a block's anchor is built and re-attached, and the kind's own
 * pre-write check. Everything else – the block format, the classifier, the
 * splice and its shared checks, the writer – is shared and never asks which
 * kind it serves. Kinds are registered once, in main's composition root
 * (`src/main/services/comments/commentFileKinds.ts`), which validates every
 * kind's agent note ({@link agentNoteProblem}).
 *
 * Pure: runs in main and in the parse worker.
 */
import type { FileCommentState } from './blocks'
import { AGENT_NOTE_PREFIX, type CommentAnchor, type CommentData, type TextQuote } from './format'
import type { TargetResolution } from './reattach'
import type { GrowthCheck, KindVerifyFailure, Placement, SpliceOrigin, SplicePlan } from './splice'
import type { IndexedTarget, TargetIndex } from './targetIndex'

/**
 * A kind's id: `'html'`, later `'markdown'`, and `'txt'` in the conformance
 * tests. A plain string, so a new kind adds no edit here (C24).
 */
export type CommentFileKindId = string

/** A decoded file with its kind's parse and its comment state – the input of every splice. */
export interface KindDocument {
  readonly text: string
  readonly index: TargetIndex
  readonly state: FileCommentState
}

/**
 * What the preview reports about the target a user picked (§ 3). A Markdown
 * pick names it by its source lines, tag and ordinal; HTML picks arrive as
 * page tokens instead (`commentDraftCore.ts`), so the HTML kind reads only
 * `path`, `id`, `tag` and `ws`.
 */
export interface PickedTarget {
  /** 1-based first source line of the target. */
  readonly lineStart: number
  /** 1-based last source line of the target. */
  readonly lineEnd: number
  readonly tag: string
  /** Which target with this tag on `lineStart` it is. */
  readonly ordinal: number
  readonly quote?: TextQuote
  readonly id?: string
  readonly path?: string
  /**
   * HTML only: the pick's computed `white-space-collapse` of the target's
   * parent (R3-8). Own-lines placement needs `collapse`; missing → mid-line.
   */
  readonly ws?: string
}

/**
 * One place a new block may go, in its kind's try order (§ 3, C2, C9). The
 * shape decides the exact bytes (`splice.ts`) and the delete range
 * (`blocks.ts`).
 */
export type Slot =
  | {
      /** The target's first character: the block goes right before it. */
      readonly offset: number
      readonly shape: 'before-target'
      /** The target line's leading blanks, repeated on the block's later lines. */
      readonly indent: string
      /** On its own lines (`block + eol + indent`) or mid-line (`block` alone). */
      readonly placement: Placement
    }
  | {
      /** A line start; never before a BOM. */
      readonly offset: number
      readonly shape: 'line-start'
      /** Spaces only, the container column; starts every line of the block. */
      readonly indent: string
    }

/** Why a kind found no target for a pick. */
export type KindRefusalReason = 'not-found' | 'not-eligible'

/** A kind's "no target" answer. */
export interface KindRefusal {
  readonly refused: KindRefusalReason
}

/** True when a {@link CommentFileKind.locate} answer is a refusal. */
export function isKindRefusal(found: IndexedTarget | KindRefusal): found is KindRefusal {
  return 'refused' in found
}

/** What a kind's pre-write check needs of the document a splice was planned on. */
export type KindOrigin = SpliceOrigin

/** A kind's own pre-write check: passed, or why not. */
export type KindVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: KindVerifyFailure }

/**
 * One kind of commentable file. Every method is pure and runs in the parse
 * worker; none may touch the file system.
 */
export interface CommentFileKind {
  readonly id: CommentFileKindId
  /** Lower-case extensions with the dot (`'.html'`); no two kinds share one. */
  readonly extensions: readonly string[]
  /** The agent note's lines, one wording per kind (C-02); checked by {@link agentNoteProblem}. */
  readonly agentNote: readonly string[]
  /** Parse a decoded file. `bomLength` is 1 when `text` starts with a BOM. */
  parse(text: string, bomLength: number): KindDocument
  /** The target a pick names, or why there is none ("find target"). */
  locate(doc: KindDocument, pick: PickedTarget): IndexedTarget | KindRefusal
  /**
   * Where a block about `target` may go, in try order; empty when nowhere.
   * `pick` carries what only the page knows (HTML: `ws`).
   */
  slots(doc: KindDocument, target: IndexedTarget, pick?: PickedTarget): readonly Slot[]
  /** The anchor a new block about `target` stores. */
  anchorOf(doc: KindDocument, target: IndexedTarget, sel?: TextQuote): CommentAnchor
  /** The note-area hint lines for a block (C-01); from `@data` only, so a rewrite can rebuild them. */
  hints(data: CommentData, target: IndexedTarget): readonly string[]
  /** Where an anchor's target is now, without the position rule (`reattach.ts`). */
  reattach(doc: KindDocument, anchor: CommentAnchor): TargetResolution
  /** What {@link CommentFileKind.verify} needs of the planned-on document; holds no parse tree. */
  originOf(doc: KindDocument): KindOrigin
  /** The kind's own pre-write check of the parsed new text; the shared checks run around it. */
  verify(origin: KindOrigin, newDoc: KindDocument, plan: SplicePlan): KindVerifyResult
  /**
   * The kind's own refusal of a block that grows the file, run on every
   * insert and replace (C10; HTML: a `<meta charset>` pushed out of the
   * prescan). Absent: the kind refuses nothing for growth.
   */
  readonly refuseGrowth?: GrowthCheck
}

/** What an agent-note line may hold: printable ASCII, U+0020 to U+007E. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/

/**
 * Why a kind's agent note may not be written into files, or `undefined` when
 * it may (C1): at least one line; the first starts `note to agents:`, which
 * is how readers find and skip the note (`blocks.ts`); every line printable
 * ASCII – no line break, control, bidi or zero-width character; and no `--`,
 * which could close or corrupt the comment.
 */
export function agentNoteProblem(lines: readonly string[]): string | undefined {
  if (lines.length === 0) return 'the agent note has no lines'
  if (!lines[0].startsWith(AGENT_NOTE_PREFIX)) {
    return `the agent note's first line must start with "${AGENT_NOTE_PREFIX}"`
  }
  const at = lines.findIndex(line => !PRINTABLE_ASCII.test(line) || line.includes('--'))
  return at < 0 ? undefined : `agent note line ${at + 1} must be printable ASCII without "--"`
}
