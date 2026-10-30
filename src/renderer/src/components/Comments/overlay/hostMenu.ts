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
 * With a selection (M-12, M-14, M-16, M-19, M-21) the items are "Comment on
 * selection" and "Comment on the whole {kind}"; on the frontmatter only the
 * first, disabled with its reason – the frontmatter is no commentable kind.
 *
 * @module components/Comments/overlay/hostMenu
 */
import { MD_SURFACE_COPY, SELECTION_COPY } from '../commentCopyWords'
import type { CommentWords, NounSource } from '../commentCopyWords'
import type { CommentTargetPlace } from '../../../../../shared/ipc/comment-common-schema'
import type { ContextMenuItem } from '../../ContextMenu/ContextMenu'
import { TEST_IDS } from '../../../constants/testids'
import type { HostMenu } from './hostTypes'

/** What the menu is about. */
export interface HostMenuInput {
  /** Comment mode is on. */
  readonly mode: boolean
  /** The target's tag; `'frontmatter'` for the frontmatter. */
  readonly tag: string
  /** Where the target sits when its tag does not name it (C-03): the menu names it as every other place does. */
  readonly place?: CommentTargetPlace
  /** Why no new comment can be written now (paused, read-only), or `null`. */
  readonly blocked: string | null
  /** Why this target cannot take one (the frontmatter), or `null`. */
  readonly refused: string | null
  readonly words: CommentWords
  /** Text is selected in the preview: the menu is about the selection (menu matrix "Selected: yes"). */
  readonly selection?: boolean
}

/** What the items do. */
export interface HostMenuActions {
  /** Open the new-comment window on the whole target (one step, A-01). */
  readonly open: () => void
  /** Open it on the selected words. */
  readonly openWords?: () => void
}

/** The menu's accessible name: the capitalised kind noun (menu matrix "Menu label"). */
export function hostMenuLabel(input: Pick<HostMenuInput, 'tag' | 'place' | 'words' | 'selection'>): string {
  if (input.selection === true) return SELECTION_COPY.menuLabel
  return input.tag === 'frontmatter' ? 'Frontmatter' : input.words.menuLabel(nounOf(input))
}

/** The menu's target as the preview's words read it: its tag and place. */
function nounOf(input: Pick<HostMenuInput, 'tag' | 'place'>): NounSource {
  return input.place === undefined ? input.tag : { tag: input.tag, place: input.place }
}

/**
 * The comment items, in order.
 *
 * @param input - {@link HostMenuInput}
 * @param actions - {@link HostMenuActions}
 * @returns Without a selection one item: "Comment on {kind}" outside comment
 *   mode, "Add comment" in it, "Comment on frontmatter" on the frontmatter.
 *   With one, "Comment on selection" then "Comment on the whole {kind}". Each
 *   disabled with its reason when it cannot be used.
 */
export function hostMenuItems(input: HostMenuInput, actions: HostMenuActions): ContextMenuItem[] {
  const frontmatter = input.tag === 'frontmatter'
  const reason = input.refused ?? input.blocked
  const withReason = (item: ContextMenuItem): ContextMenuItem => (reason === null ? item : { ...item, disabled: true, reason })
  if (input.selection === true) {
    const onWords: ContextMenuItem = {
      label: SELECTION_COPY.commentOnSelection,
      action: actions.openWords ?? actions.open,
      testId: TEST_IDS.COMMENT_MENU_SELECTION
    }
    if (frontmatter) return [withReason(onWords)]
    const onWhole: ContextMenuItem = {
      label: SELECTION_COPY.commentOnWhole(input.words.noun(nounOf(input))),
      action: actions.open,
      testId: TEST_IDS.COMMENT_MENU_WHOLE
    }
    return [withReason(onWords), withReason(onWhole)]
  }
  const label = input.mode
    ? MD_SURFACE_COPY.addComment
    : frontmatter
      ? MD_SURFACE_COPY.commentOnFrontmatter
      : MD_SURFACE_COPY.commentOn(input.words.noun(nounOf(input)))
  const testId = input.mode
    ? TEST_IDS.COMMENT_MENU_ADD
    : frontmatter
      ? TEST_IDS.COMMENT_MENU_FRONTMATTER
      : TEST_IDS.COMMENT_MENU_COMMENT_ON
  return [withReason({ label, action: actions.open, testId })]
}

/** A disabled item never runs its action. */
const NO_ACTION = (): void => {}

/**
 * The menu for a right-click in comment mode that lands on no target – a gap
 * between blocks, the margin: "Add comment", disabled with the preview's
 * reason. The HTML Preview answers every right-click in comment mode with its
 * menu, and a part of the page that cannot hold a comment with this item
 * disabled (M-03, M-08), so this host does the same rather than show nothing.
 *
 * @param words - The preview's words: the menu's name and the reason line.
 * @returns The menu, less its position.
 */
export function targetlessMenu(words: CommentWords): Omit<HostMenu, 'x' | 'y'> {
  const input = { mode: true, tag: '', blocked: null, refused: words.noTarget.reason, words }
  return { label: words.noTarget.label, items: hostMenuItems(input, { open: NO_ACTION }), mode: true, target: null }
}
