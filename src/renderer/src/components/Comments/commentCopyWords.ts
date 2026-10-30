// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the words each preview fills the shared sentences with (spec 024
 * 024-FR-007, C-03, differences table D-03, D-04, A-01 – A-07).
 *
 * `commentCopy.ts` stays the one home of every comment string; this module is
 * its per-preview half, kept beside it only because of the 500-line ratchet.
 * It imports the shared sentences from there – never the other way round – and
 * adds the slot fills: the HTML Preview's "element" and selector, the
 * Markdown Preview's kind nouns ("list item", "H2 heading").
 *
 * A component reads its preview's table from `CommentWordsContext`
 * (`commentWords.ts`). `HTML_WORDS` is the default, and every HTML value is the
 * string the HTML Preview showed before spec 024, so its pin is unchanged. No
 * Markdown string says "element", "page" or "block" (except "code block" and
 * "block quote"), names a bare tag, or uses "pin" or "pick" as a noun
 * (024-AC-008, `commentCopyWords.test.ts`).
 *
 * @module components/Comments/commentCopyWords
 */
import { ErrorCode } from '../../../../shared/errors'
import {
  MARKDOWN_COMMENT_MAX_BYTES,
  MARKDOWN_COMMENT_MAX_HTML_NODES,
  MARKDOWN_COMMENT_MAX_LINES,
  MARKDOWN_COMMENT_MAX_NESTING
} from '../../../../shared/markdownComments/markdownLimits'
import {
  ANNOUNCE,
  COPY,
  DRAWER_COPY,
  TOOL_COPY,
  commentModeShortcutLabel,
  deleteBlockText,
  modeTooltip,
  notFoundText,
  readOnlyReasonText,
  saveFailureCopy,
  threadsTitle,
  type SaveFailureCopy
} from './commentCopy'
import { elementLabel, plural, type LabelSource } from './commentFormat'

/** Bytes in one megabyte, for the limit sentence. */
const MEGABYTE = 1024 * 1024

const MARKDOWN_NOUNS: Readonly<Record<string, string>> = {
  p: 'paragraph',
  li: 'list item',
  ul: 'list',
  ol: 'list',
  pre: 'code block',
  img: 'image',
  blockquote: 'block quote',
  table: 'table',
  tr: 'table row',
  td: 'table cell',
  th: 'table cell',
  hr: 'divider'
}

/**
 * The Markdown kind noun of a rendered tag (C-03 kind map), lower case.
 * `pre` is "code block" whether or not it draws a diagram: the list names a
 * target by its tag only, and a diagram is a code block in the source.
 * Raw HTML the sanitizer kept is an "HTML section" – never its tag.
 *
 * @param tag - The target's tag as main indexes it (`p`, `li`, `h2`, …).
 * @returns e.g. "list item", "H2 heading".
 */
export function markdownKindNoun(tag: string): string {
  const lower = tag.toLowerCase()
  const heading = /^h([1-6])$/.exec(lower)
  if (heading !== null) return `H${heading[1]} heading`
  return MARKDOWN_NOUNS[lower] ?? 'HTML section'
}

/** `text` with its first letter in upper case: a label or a row starts with one (C-03). */
export function capitalise(text: string): string {
  return text === '' ? text : text[0].toUpperCase() + text.slice(1)
}

/** The Markdown limit sentence (024-NFR-008): its size, line, nesting and raw-HTML limits (`markdownLimits.ts`). */
export const MARKDOWN_FILE_LIMIT_TEXT =
  `Erfana adds comments only to files of up to ${Math.round(MARKDOWN_COMMENT_MAX_BYTES / MEGABYTE)} MB, ` +
  `${MARKDOWN_COMMENT_MAX_LINES.toLocaleString('en-US')} lines, ${MARKDOWN_COMMENT_MAX_NESTING} levels of nesting ` +
  `and ${MARKDOWN_COMMENT_MAX_HTML_NODES.toLocaleString('en-US')} pieces of raw HTML.`

/** What a target is called in one preview: its tag, and its line when the label carries one. */
export interface WordsTarget extends LabelSource {
  readonly line: number
}

/** The words one preview fills its comment templates with. */
export interface CommentWords {
  readonly preview: 'html' | 'markdown'
  /** The target word inside a sentence, lower case: "element", or the kind noun. */
  readonly noun: (tag: string) => string
  /** A drawer row's or the outline's label: the selector (HTML), "List item · line 14" (Markdown). */
  readonly label: (target: WordsTarget) => string
  /** The new-comment window's title. */
  readonly newCommentTitle: (tag: string) => string
  /** A thread window's title, for `count` threads on one target. */
  readonly threadsTitle: (target: LabelSource, count: number) => string
  /** The window's context line under the title. */
  readonly context: (target: WordsTarget, file: string) => string
  /** The target menu's accessible name (menu matrix "Menu label"). */
  readonly menuLabel: (tag: string) => string
  readonly showInPreview: string
  readonly drawerNone: string
  readonly notFoundTag: string
  readonly notOnScreen: string
  readonly notVisibleText: string
  readonly damagedText: string
  readonly conflictText: string
  readonly deleteBlock: string
  readonly deleteBlockAction: string
  readonly deleteBlockText: (file: string) => string
  readonly notFoundText: (file: string, line: number) => string
  readonly modeTooltip: (on: boolean) => string
  readonly pinsOff: string
  readonly modeOn: string
  readonly readOnlyReasonText: (reason: string | undefined, file: string) => string
  /**
   * A refused save as the window shows it. `tag` names the target (the
   * Markdown sentences use its noun); `reason` is main's finer reason (C-19).
   */
  readonly saveFailure: (code: string, file: string, tag?: string, reason?: string) => SaveFailureCopy
}

/** The HTML Preview's words: exactly the strings it showed before spec 024. */
export const HTML_WORDS: CommentWords = {
  preview: 'html',
  noun: () => 'element',
  label: target => elementLabel(target),
  newCommentTitle: () => COPY.newComment,
  threadsTitle: (target, count) => threadsTitle(elementLabel(target), count),
  context: (target, file) => `${elementLabel(target)} · ${file}, line ${target.line}`,
  menuLabel: () => COPY.menuLabel,
  showInPreview: COPY.showOnPage,
  drawerNone: DRAWER_COPY.none,
  notFoundTag: DRAWER_COPY.notFound,
  notOnScreen: DRAWER_COPY.notOnScreen,
  notVisibleText: COPY.notVisibleText,
  damagedText: COPY.damagedText,
  conflictText: COPY.conflictText,
  deleteBlock: COPY.deleteBlock,
  deleteBlockAction: COPY.deleteBlockAction,
  deleteBlockText,
  notFoundText,
  modeTooltip,
  pinsOff: TOOL_COPY.pinsOff,
  modeOn: ANNOUNCE.modeOn,
  readOnlyReasonText,
  saveFailure: (code, file) => saveFailureCopy(code, file)
}

/** Markdown sentences that differ from the shared ones (C-03, menu matrix § 3, state table W-01, W-08). */
export const MARKDOWN_COPY = {
  showInPreview: 'Show in preview',
  drawerNone: 'No comments in this file yet. Turn on comment mode and click a paragraph.',
  notFoundTag: 'Not found',
  notOnScreen: "This comment's target isn't on screen right now",
  notVisibleText:
    'This part is hidden right now – it may be inside a collapsed section. Its icon comes back when it shows.',
  damagedText: "Erfana can't read this comment, so it won't change it. Fix it in the source, or delete it.",
  conflictText: 'This comment contains git conflict markers. Resolve the conflict in the source.',
  deleteBlock: 'Delete damaged comment',
  deleteBlockAction: 'Delete damaged comment…',
  pinsOff: 'Show comment icons – off: icons hidden in this preview',
  modeOn: 'Comment mode on. Click a paragraph, or press Tab to choose one. Esc to leave.',
  pickerTop: 'Top level – no parent to select.',
  pickerNoChild: 'Nothing inside to select.',
  frontmatter: "Comments can't be added to the frontmatter.",
  generated: 'This part is generated by a tool. Comment on the text before or after it.',
  blockChanged: 'This comment changed on disk. Reopen it and try again.',
  deleteBlockText: (file: string): string =>
    `Delete this damaged comment? Erfana removes exactly the text shown above from ${file}.`,
  notFoundText: (file: string, line: number): string =>
    `Erfana can't find what this comment was about any more. The comment stays in ${file}, line ${line}.`,
  unterminated: (file: string): string =>
    `A comment in ${file} has no end, so Erfana won't add comments. Fix it in the source.`,
  /** Main read the file again after the write and it differed (C12): the comment may have landed, so no retry. */
  changedDuringSave: (file: string): string =>
    `${file} changed while Erfana was saving, so your comment may already be in it. Check the comment list – your text is still here to copy.`,
  /** The list refused because Markdown comments were turned off in Settings meanwhile (024-FR-022). */
  off: 'Comments are unavailable for this file: comments are turned off in Settings.',
  tooMany: (file: string): string =>
    `${file} already has 500 comments, the most Erfana adds to one file. Delete resolved threads to add more.`,
  moved: (noun: string): string =>
    `This ${noun} changed in the file since you picked it. Pick it again – your text comes with you.`,
  expired: (noun: string): string => `This comment window was open too long. Pick the ${noun} again – your text is kept.`,
  modeTooltip: (on: boolean): string => {
    const key = commentModeShortcutLabel()
    return on ? `Comment mode (${key}) – on: click a paragraph to comment, Esc to leave` : `Comment mode (${key}) – off`
  }
} as const

/** The Markdown Preview's words (C-03 kind nouns; differences table D-03, D-04, D-13). */
export const MARKDOWN_WORDS: CommentWords = {
  preview: 'markdown',
  noun: markdownKindNoun,
  label: target => `${capitalise(markdownKindNoun(target.tag))} · line ${target.line}`,
  newCommentTitle: tag => `New comment on ${markdownKindNoun(tag)}`,
  threadsTitle: (target, count) => threadsTitle(markdownKindNoun(target.tag), count),
  context: (target, file) => `${file}, line ${target.line}`,
  menuLabel: tag => capitalise(markdownKindNoun(tag)),
  showInPreview: MARKDOWN_COPY.showInPreview,
  drawerNone: MARKDOWN_COPY.drawerNone,
  notFoundTag: MARKDOWN_COPY.notFoundTag,
  notOnScreen: MARKDOWN_COPY.notOnScreen,
  notVisibleText: MARKDOWN_COPY.notVisibleText,
  damagedText: MARKDOWN_COPY.damagedText,
  conflictText: MARKDOWN_COPY.conflictText,
  deleteBlock: MARKDOWN_COPY.deleteBlock,
  deleteBlockAction: MARKDOWN_COPY.deleteBlockAction,
  deleteBlockText: MARKDOWN_COPY.deleteBlockText,
  notFoundText: MARKDOWN_COPY.notFoundText,
  modeTooltip: MARKDOWN_COPY.modeTooltip,
  pinsOff: MARKDOWN_COPY.pinsOff,
  modeOn: MARKDOWN_COPY.modeOn,
  readOnlyReasonText: markdownReadOnlyReasonText,
  saveFailure: markdownSaveFailureCopy
}

/** {@link readOnlyReasonText} in Markdown words (menu matrix § 3). */
export function markdownReadOnlyReasonText(reason: string | undefined, file: string): string {
  if (reason === 'too-large') return `${MARKDOWN_FILE_LIMIT_TEXT} ${file} is larger, so its comments are read-only.`
  if (reason === 'too-many-blocks') return MARKDOWN_COPY.tooMany(file)
  if (reason === 'unterminated-block') return MARKDOWN_COPY.unterminated(file)
  return readOnlyReasonText(reason, file)
}

/**
 * {@link saveFailureCopy} in Markdown words: the sentences that would say
 * "element" or "block" are the Markdown ones (C-03, W-01, W-08), a finer
 * reason main names (C-19) picks its own sentence; every other code reads as
 * in the HTML Preview.
 *
 * @param code - Main's error code.
 * @param file - The file, as the reader knows it.
 * @param tag - The target's tag, for its noun.
 * @param reason - Main's finer reason, when it sent one.
 * @returns The sentence and what the window offers next.
 */
export function markdownSaveFailureCopy(code: string, file: string, tag = 'p', reason?: string): SaveFailureCopy {
  const shared = saveFailureCopy(code, file)
  const noun = markdownKindNoun(tag)
  if (reason === 'generated-region') return { text: MARKDOWN_COPY.generated, action: 'close' }
  if (reason === 'frontmatter') return { text: MARKDOWN_COPY.frontmatter, action: 'close' }
  if (reason === 'unterminated-block') return { text: MARKDOWN_COPY.unterminated(file), action: 'close' }
  if (reason === 'too-many-blocks') return { text: MARKDOWN_COPY.tooMany(file), action: 'close' }
  if (reason === 'changed-during-save') return { text: MARKDOWN_COPY.changedDuringSave(file), action: 'close' }
  if (reason === 'comments-off') return { text: MARKDOWN_COPY.off, action: 'close' }
  switch (code) {
    case ErrorCode.COMMENT_TARGET_MOVED:
      return { text: MARKDOWN_COPY.moved(noun), action: 'pick-again' }
    case ErrorCode.COMMENT_DRAFT_EXPIRED:
      return { text: MARKDOWN_COPY.expired(noun), action: 'pick-again' }
    case ErrorCode.COMMENT_BLOCK_CHANGED:
      return { text: MARKDOWN_COPY.blockChanged, action: shared.action }
    case ErrorCode.COMMENT_FILE_TOO_LARGE:
      return { text: MARKDOWN_FILE_LIMIT_TEXT, action: shared.action }
    default:
      return shared
  }
}

/**
 * The Markdown Preview's own surface (menu matrix § 1 – § 4, state table
 * F-02, F-03, differences D-24, A-03, C-08).
 */
export const MD_SURFACE_COPY = {
  /** The menu item outside comment mode, no selection (A-01, M-11). */
  commentOn: (noun: string): string => `Comment on ${noun}`,
  /** The menu item in comment mode (M-13). */
  addComment: 'Add comment',
  /** M-18: the frontmatter's own item, always disabled. */
  commentOnFrontmatter: 'Comment on frontmatter',
  /** F-02 band, and the reason a disabled action shows. */
  paused: (file: string): string => `${file} has unsaved changes – comments are read-only until you save.`,
  /** F-03 band. */
  pausedConflict: (file: string): string =>
    `${file} changed on disk. The preview shows your unsaved version and its comments. Choose a version in the editor to continue. Comments are hidden in the editor view.`,
  /** The F-03 reason line in a menu (menu matrix § 3). */
  pausedConflictReason: (file: string): string => `${file} changed on disk. Choose a version in the editor to continue.`,
  saveFile: (file: string): string => `Save ${file}`,
  goToEditor: 'Go to editor',
  /** C-19.1: the toggle's tooltip and the polite sentence while no new comment can be written. */
  modeUnavailable: (reason: string): string => `Comment mode is unavailable: ${reason.replace(/\.$/, '')}.`,
  /** A-03: the comment-mode tab, before and while a target is outlined. */
  modeTab: (target: { readonly noun: string; readonly line: number } | null): string =>
    target === null
      ? 'Comment mode · Esc to leave'
      : `Comment mode · ${capitalise(target.noun)}, line ${target.line} · Esc to leave`,
  /** C-10 / C-03: the picker's announcement. */
  showing: (noun: string, line: number): string => `Showing ${noun}, line ${line}.`,
  /** C-08.1: the preview scroller's name. */
  previewName: (file: string): string => `Preview of ${file}`,
  /** D-07: a comment icon's name. */
  iconName: (count: number, noun: string, line: number): string =>
    `${plural(count, 'comment', 'comments')} on ${noun}, line ${line}. Open.`
} as const
