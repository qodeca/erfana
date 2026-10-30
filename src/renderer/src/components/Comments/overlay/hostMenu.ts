// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment items of a renderer-hosted preview's right-click menu, per
 * cell of the menu matrix (spec 024 design `menu-matrix.md` § 1 – § 3,
 * 024-FR-027 (a), A-01; differences table D-11).
 *
 * Pure: the host passes what it knows about the target and the file, and
 * gets the items in order. A disabled item keeps its action name and carries
 * its reason line (Menu card `#reason`). Outside comment mode the host puts
 * the preview's own prompt items after these; in comment mode these are the
 * whole menu (R-13).
 *
 * Selection rows (M-12, M-14, M-16, M-19, M-21) arrive with selection
 * comments (spec 024 commit 14): until then a selection outside comment mode
 * keeps the preview's shipped menu, and in comment mode a selection is not
 * looked at.
 *
 * @module components/Comments/overlay/hostMenu
 */
import { MD_SURFACE_COPY } from '../commentCopyWords'
import type { CommentWords } from '../commentCopyWords'
import type { ContextMenuItem } from '../../ContextMenu/ContextMenu'
import { TEST_IDS } from '../../../constants/testids'

/** What the menu is about. */
export interface HostMenuInput {
  /** Comment mode is on. */
  readonly mode: boolean
  /** The target's tag; `'frontmatter'` for the frontmatter. */
  readonly tag: string
  /** Why no new comment can be written now (paused, read-only), or `null`. */
  readonly blocked: string | null
  /** Why this target cannot take one (the frontmatter), or `null`. */
  readonly refused: string | null
  readonly words: CommentWords
}

/** The menu's accessible name: the capitalised kind noun (menu matrix "Menu label"). */
export function hostMenuLabel(input: Pick<HostMenuInput, 'tag' | 'words'>): string {
  return input.tag === 'frontmatter' ? 'Frontmatter' : input.words.menuLabel(input.tag)
}

/**
 * The comment items, in order.
 *
 * @param input - {@link HostMenuInput}
 * @param open - Opens the new-comment window on the target (one step, A-01).
 * @returns One item: "Comment on {kind}" outside comment mode, "Add comment"
 *   in it, "Comment on frontmatter" on the frontmatter – disabled with its
 *   reason when it cannot be used.
 */
export function hostMenuItems(input: HostMenuInput, open: () => void): ContextMenuItem[] {
  const frontmatter = input.tag === 'frontmatter'
  const reason = input.refused ?? input.blocked
  const label = input.mode
    ? MD_SURFACE_COPY.addComment
    : frontmatter
      ? MD_SURFACE_COPY.commentOnFrontmatter
      : MD_SURFACE_COPY.commentOn(input.words.noun(input.tag))
  const testId = input.mode
    ? TEST_IDS.COMMENT_MENU_ADD
    : frontmatter
      ? TEST_IDS.COMMENT_MENU_FRONTMATTER
      : TEST_IDS.COMMENT_MENU_COMMENT_ON
  const item: ContextMenuItem = { label, action: open, testId }
  return [reason === null ? item : { ...item, disabled: true, reason }]
}
