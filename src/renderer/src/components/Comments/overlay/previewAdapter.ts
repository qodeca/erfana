// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The seam between the renderer's comment overlay host and one preview
 * (spec 024 architecture note 001 § 3 `PreviewCommentAdapter`, 024-FR-002).
 *
 * The host – comment mode, outline, icons, keyboard picking, the menu, the
 * window – knows nothing about a file type. A preview that Erfana draws in
 * its own DOM (the Markdown Preview now, a later `<!-- -->` text preview)
 * supplies one adapter that answers "which rendered element is a target,
 * how is it described to main, and where is a listed thread now". The HTML
 * Preview is the exception: it draws through its sealed preload instead.
 *
 * Every answer is read from the DOM the preview rendered; nothing here
 * writes to it, so the exported and copied content stays the preview's own
 * (024-FR-024).
 *
 * @module components/Comments/overlay/previewAdapter
 */
import type { PickedTargetRequest, ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentWords } from '../commentCopyWords'

/** Why a target cannot take a comment, as a sentence for the menu and the toggle. */
export type CanComment = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** One preview's answers about its rendered DOM. */
export interface PreviewCommentAdapter {
  /** The words this preview fills the shared sentences with (C-03). */
  readonly words: CommentWords
  /** The target that holds `node` (pointer, focus), climbing to the nearest one; `null` outside every target. */
  targetAt(node: Node | null): HTMLElement | null
  /** Every target in document order: the keyboard picker's Tab order (C-08). */
  targetsInOrder(): HTMLElement[]
  /** The target that holds `target`, or `null` at the top level. */
  parentOf(target: HTMLElement): HTMLElement | null
  /** The first target inside `target`, or `null` when there is none. */
  childOf(target: HTMLElement): HTMLElement | null
  /** The tag main indexes `target` by. */
  tagOf(target: HTMLElement): string
  /** `target`'s first source line (1-based). */
  lineOf(target: HTMLElement): number
  /** Whether a comment can be added on `target` at all (the frontmatter cannot, M-18). */
  canComment(target: HTMLElement): CanComment
  /** `target` as main's file kind locates it; `null` when it cannot be described. */
  describe(target: HTMLElement): PickedTargetRequest | null
  /** The element a listed thread is attached to now, or `null` when it is not rendered. */
  attach(placement: ThreadPlacement): HTMLElement | null
  /** The rendered text column (C-18: a docked window sits in the margin beside it); `null` when unmounted. */
  root?(): HTMLElement | null
  /**
   * A refusal the pick already knows, before anything is typed (W-08): the
   * target lies in a generated START/END region (024-FR-023). `null` when
   * none is known – main still decides at save.
   */
  refusalOf?(target: HTMLElement): 'generated-region' | null
}
