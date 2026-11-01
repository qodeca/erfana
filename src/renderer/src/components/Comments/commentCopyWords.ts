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
 * string the HTML Preview showed before spec 024, except where the state table
 * rewords both previews (S-07, S-08, S-09 – the pin names each) or the
 * differences table aligns them ({@link KIND_COPY}, {@link HTML_WORDS}). No
 * Markdown string says "element", "page" or "block" (except "code block" and
 * "block quote"), names a bare tag, or uses "pin" or "pick" as a noun
 * (024-AC-008, `commentCopyWords.test.ts`).
 *
 * @module components/Comments/commentCopyWords
 */
import { ErrorCode } from '../../../../shared/errors'
import type { CommentUnavailableReason } from '../../../../shared/ipc/preview-comment-schema'
import { MARKDOWN_COMMENT_MAX_BYTES } from '../../../../shared/markdownComments/markdownLimits'
import {
  ANNOUNCE,
  COPY,
  DRAWER_COPY,
  FILE_LIMIT_TEXT,
  KIND_COPY,
  TOOL_COPY,
  deleteBlockText,
  modeTooltip,
  notFoundText,
  readOnlyReasonText,
  saveFailureCopy,
  threadsTitle,
  unavailableTooltip,
  type SaveFailureCopy
} from './commentCopy'
import { elementLabel, plural, type LabelSource } from './commentFormat'
import { markdownTargetNoun as mdNoun, type NounSource, type NounTarget } from './commentTargetNoun'

// The one Markdown noun function (C-03): every Markdown sentence below names its target through it.
export { markdownKindNoun, markdownTargetNoun, type NounSource } from './commentTargetNoun'

/** `text` with its first letter in upper case: a label or a row starts with one (C-03). */
export function capitalise(text: string): string {
  return text === '' ? text : text[0].toUpperCase() + text.slice(1)
}

/** The Markdown size limit as a reader reads it: `2 MB`. */
const MARKDOWN_SIZE_LIMIT = `${Math.round(MARKDOWN_COMMENT_MAX_BYTES / (1024 * 1024))} MB`
/** "Too complex" stands for the line and nesting limits; only the size is a number a reader can act on (P-F14). */
const MARKDOWN_LIMIT_WORDS = `too big or too complex for comments. The size limit is ${MARKDOWN_SIZE_LIMIT}.`

/** The Markdown limit sentence (024-NFR-008; the owner's plain wording, 2026-10-31: the limits stay in `markdownLimits.ts`). */
export const MARKDOWN_FILE_LIMIT_TEXT = `This file is ${MARKDOWN_LIMIT_WORDS}`

/** What a target is called in one preview: its tag (and place, C-03), and its line when the label carries one. */
export interface WordsTarget extends LabelSource, NounTarget {
  readonly line: number
}

/** The words one preview fills its comment templates with. */
export interface CommentWords {
  readonly preview: 'html' | 'markdown'
  /** The target word inside a sentence, lower case: "element", or the Markdown noun (C-03, `commentTargetNoun.ts`). */
  readonly noun: (target: NounSource) => string
  /** A drawer row's or the outline's label: the selector (HTML), "List item · line 14" (Markdown). */
  readonly label: (target: WordsTarget) => string
  /** The new-comment window's title. */
  readonly newCommentTitle: (target: NounSource) => string
  /** A thread window's title, for `count` threads on one target. */
  readonly threadsTitle: (target: LabelSource & NounTarget, count: number) => string
  /** The window's context line under the title. */
  readonly context: (target: WordsTarget, file: string) => string
  /** The target menu's accessible name (menu matrix "Menu label"). */
  readonly menuLabel: (target: NounSource) => string
  readonly showInPreview: string
  readonly drawerNone: string
  readonly notFoundTag: string
  readonly notOnScreen: string
  /** S-02: the hidden target's sentence, with the target's `{kind}` and this preview's cause (D-13). */
  readonly notVisibleText: (target: NounSource) => string
  readonly damagedText: string
  readonly conflictText: string
  readonly deleteBlock: string
  readonly deleteBlockAction: string
  readonly deleteBlockText: (file: string) => string
  readonly notFoundText: (file: string, line: number) => string
  readonly modeTooltip: (on: boolean) => string
  /** A right-click in comment mode on no target: the menu's name and its disabled item's reason (M-08 in both previews). */
  readonly noTarget: { readonly label: string; readonly reason: string }
  readonly pinsOff: string
  readonly modeOn: string
  readonly readOnlyReasonText: (reason: string | undefined, file: string) => string
  /** F-05: why nothing about the file can be read, as the toolbar's tooltip says it. */
  readonly unavailableText: (reason: CommentUnavailableReason) => string
  /**
   * A refused save as the window shows it. `tag` names the target (the
   * Markdown sentences use its noun); `reason` is main's finer reason (C-19).
   */
  readonly saveFailure: (code: string, file: string, tag?: NounSource, reason?: string) => SaveFailureCopy
}

/** The HTML Preview's `{kind}` (024-FR-007, D-04), bare and with its article. */
const HTML_NOUN = 'section'
const HTML_CLICK_TARGET = 'a section'
/** What a Markdown click in comment mode is taught to land on (C-16, A-08). */
const MARKDOWN_CLICK_TARGET = 'a paragraph'

/** S-02, one template in both previews; `where` is the preview's own cause (D-13). */
const hiddenTargetText = (noun: string, where: string): string =>
  `This ${noun} is hidden right now – it may be ${where}. Its icon comes back when it shows.`

/** The target is inside a START/END region another tool generates (024-FR-023, menu matrix § 1): both previews. */
export const GENERATED_REGION_TEXT = 'A tool creates this part, so a comment here could be lost. Comment on the text before or after it.'

/** A refusal both previews word the same whatever the code (D-27), or `undefined`. */
function sharedReasonCopy(reason: string | undefined): SaveFailureCopy | undefined {
  return reason === 'generated-region' ? { text: GENERATED_REGION_TEXT, action: 'close' } : undefined
}

/** HTML reason lines the shared sentences do not cover (menu matrix § 3, C-19). */
export const HTML_MENU_COPY = {
  /** M-08: `html`, `head`, template content, an element no comment can stand before; also no target (§ 4: "preview" in both). */
  notCommentable: "You can't add a comment here. Try a nearby section.",
  /** Not in the matrix: the file changed since the page was served, so the pick no longer names its element. */
  moved: (file: string): string => `${file} changed after the page opened. Reload the preview, then comment.`,
  /** Not in the matrix: the parse did not run (a full queue, a crash) – nothing about the file itself. */
  busy: "Erfana couldn't read the file just now. Try again in a moment.",
  /** Not in the matrix: any other refusal the menu can meet. */
  refused: "Erfana doesn't add comments to this file."
} as const

/**
 * The HTML Preview's words: the strings it showed before spec 024, except
 * where the differences table aligns both previews (A-02, A-05, A-06, A-08,
 * A-10, C-16, § 4) – there the shared sentence, "element" in any `{kind}` slot.
 */
export const HTML_WORDS: CommentWords = {
  preview: 'html',
  noun: () => HTML_NOUN,
  label: target => elementLabel(target),
  newCommentTitle: () => COPY.newComment,
  threadsTitle: (_target, count) => threadsTitle('this section', count),
  context: (target, file) => `${file}, line ${target.line}`,
  menuLabel: () => COPY.menuLabel,
  showInPreview: COPY.showInPreview,
  drawerNone: KIND_COPY.drawerNone(HTML_CLICK_TARGET),
  notFoundTag: DRAWER_COPY.notFound,
  notOnScreen: DRAWER_COPY.notOnScreen,
  notVisibleText: () => hiddenTargetText(HTML_NOUN, 'on another slide or tab'),
  damagedText: COPY.damagedText,
  conflictText: COPY.conflictText,
  deleteBlock: COPY.deleteBlock,
  deleteBlockAction: COPY.deleteBlockAction,
  deleteBlockText,
  notFoundText,
  modeTooltip,
  noTarget: { label: COPY.menuLabel, reason: HTML_MENU_COPY.notCommentable },
  pinsOff: TOOL_COPY.pinsOff,
  modeOn: KIND_COPY.modeOn(HTML_CLICK_TARGET),
  readOnlyReasonText,
  unavailableText: unavailableTooltip,
  saveFailure: (code, file, _tag, reason) => sharedReasonCopy(reason) ?? saveFailureCopy(code, file)
}

/** Markdown sentences that differ from the shared ones (C-03, menu matrix § 3, state table W-01, W-08). */
export const MARKDOWN_COPY = {
  showInPreview: COPY.showInPreview,
  drawerNone: KIND_COPY.drawerNone(MARKDOWN_CLICK_TARGET),
  notFoundTag: DRAWER_COPY.notFound,
  notOnScreen: DRAWER_COPY.notOnScreen,
  notVisibleText: (target: NounSource): string => hiddenTargetText(mdNoun(target), 'inside a collapsed section'),
  damagedText: COPY.damagedText,
  conflictText: COPY.conflictText,
  deleteBlock: COPY.deleteBlock,
  deleteBlockAction: COPY.deleteBlockAction,
  pinsOff: TOOL_COPY.pinsOff,
  modeOn: KIND_COPY.modeOn(MARKDOWN_CLICK_TARGET),
  pickerTop: ANNOUNCE.pickerTop,
  pickerNoChild: ANNOUNCE.pickerNoChild,
  frontmatter: "You can't comment on the settings at the top of this file.",
  /** Not in the matrix: comment mode, a right-click off every block (a gap, the margin) – HTML M-08 in Markdown words. */
  noTarget: HTML_MENU_COPY.notCommentable,
  generated: GENERATED_REGION_TEXT,
  /** The shared sentence (C-19.4: errors never say "reopen"). */
  blockChanged: saveFailureCopy(ErrorCode.COMMENT_BLOCK_CHANGED, '').text,
  deleteBlockText,
  notFoundText,
  unterminated: (file: string): string => readOnlyReasonText('unterminated-block', file),
  /** Main read the file again after the write and it differed (C12): the comment may have landed, so no retry. */
  changedDuringSave: (file: string): string =>
    `${file} changed during the save, so your comment may already be there. Check the comment list. Your text is still here.`,
  /** The list refused because Markdown comments were turned off in Settings meanwhile (024-FR-022). */
  off: "You can't comment on this file: comments are turned off in Settings.",
  tooMany: (file: string): string => readOnlyReasonText('too-many-blocks', file),
  moved: (noun: string): string =>
    `This ${noun} changed after you selected it. Select it again. Your text is safe.`,
  expired: (noun: string): string => `This window was open too long. Select the ${noun} again. Your text is safe.`,
  modeTooltip: (on: boolean): string => modeTooltip(on, MARKDOWN_CLICK_TARGET)
} as const

/**
 * Why no new comment can be written – a disabled menu item's reason line and,
 * through `MD_SURFACE_COPY.modeUnavailable`, the comment-mode toggle's
 * (menu matrix § 2, § 3; C-19: the menu and the window say the same sentence
 * for the same reason). `reason` is main's refusal code (the draft event's
 * `reason`, or a listed file's `readOnlyReason`); `undefined` with no draft
 * is a part of the page that cannot hold a comment.
 *
 * @param reason - Main's refusal reason; a reason a later main adds reads as {@link HTML_MENU_COPY}.refused.
 * @param file - The file, as the reader knows it.
 * @returns The reason line, ending with its full stop.
 *
 * @example
 * ```ts
 * menuReasonText('conflict-markers', 'index.html') // 'index.html has unresolved git conflicts. Resolve them first.'
 * ```
 */
export function menuReasonText(reason: string | undefined, file: string): string {
  switch (reason) {
    case undefined:
    case 'not-commentable':
      return HTML_MENU_COPY.notCommentable
    case 'too-large':
      return FILE_LIMIT_TEXT
    case 'conflict-markers':
    case 'unterminated-block':
    case 'too-many-blocks':
    case 'encoding':
    case 'link':
      // One sentence per reason in the menu, the window and the mode tooltip (C-19, F-04).
      return readOnlyReasonText(reason, file)
    case 'read-only':
    case 'not-owner':
      return readOnlyReasonText(undefined, file)
    case 'outside-project':
      return `${file} is not in this project, so you can't comment on it here.`
    case 'missing':
      return `${file} no longer exists.`
    case 'target-moved':
    case 'changed':
      return HTML_MENU_COPY.moved(file)
    case 'busy':
    case 'parse-failed':
      return HTML_MENU_COPY.busy
    default:
      return HTML_MENU_COPY.refused
  }
}

/** The Markdown Preview's words (C-03 kind nouns; differences table D-03, D-04, D-13). */
export const MARKDOWN_WORDS: CommentWords = {
  preview: 'markdown',
  noun: mdNoun,
  label: target => `${capitalise(mdNoun(target))} · line ${target.line}`,
  newCommentTitle: target => KIND_COPY.newCommentTitle(mdNoun(target)),
  threadsTitle: (target, count) => threadsTitle(mdNoun(target), count),
  context: (target, file) => `${file}, line ${target.line}`,
  menuLabel: target => capitalise(mdNoun(target)),
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
  noTarget: { label: 'Preview', reason: MARKDOWN_COPY.noTarget },
  pinsOff: MARKDOWN_COPY.pinsOff,
  modeOn: MARKDOWN_COPY.modeOn,
  readOnlyReasonText: markdownReadOnlyReasonText,
  unavailableText: markdownUnavailableText,
  saveFailure: markdownSaveFailureCopy
}

/** {@link readOnlyReasonText} in Markdown words (menu matrix § 3). */
export function markdownReadOnlyReasonText(reason: string | undefined, file: string): string {
  return reason === 'too-large' ? `${file} is ${MARKDOWN_LIMIT_WORDS}` : readOnlyReasonText(reason, file)
}

/** {@link unavailableTooltip} in Markdown words: never "page" (024-AC-008), and this preview's limit. */
export function markdownUnavailableText(reason: CommentUnavailableReason): string {
  if (reason === 'too-large') return `You can't comment on this file: it is too big or too complex. The size limit is ${MARKDOWN_SIZE_LIMIT}.`
  return reason === 'prepare-failed' ? "You can't comment on this file: Erfana couldn't read it." : unavailableTooltip(reason)
}

/**
 * {@link saveFailureCopy} in Markdown words: the sentences that would say
 * "element" or "block" are the Markdown ones (C-03, W-01, W-08), a finer
 * reason main names (C-19) picks its own sentence; every other code reads as
 * in the HTML Preview.
 *
 * @param code - Main's error code.
 * @param file - The file, as the reader knows it.
 * @param tag - The target (or its tag), for its noun.
 * @param reason - Main's finer reason, when it sent one.
 * @returns The sentence and what the window offers next.
 */
export function markdownSaveFailureCopy(code: string, file: string, tag: NounSource = 'p', reason?: string): SaveFailureCopy {
  const shared = saveFailureCopy(code, file)
  const noun = mdNoun(tag)
  const sharedReason = sharedReasonCopy(reason)
  if (sharedReason !== undefined) return sharedReason
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
  commentOnFrontmatter: 'Comment on file settings',
  /** F-02 band, and the reason a disabled action shows. */
  paused: (file: string): string => `${file} has unsaved changes. Save the file to change comments.`,
  /** F-03 band. */
  pausedConflict: (file: string): string =>
    `${file} changed outside Erfana. You see your unsaved version here. Go to the editor and choose which version to keep.`,
  /** The F-03 reason line in a menu (menu matrix § 3). */
  pausedConflictReason: (file: string): string => `${file} changed outside Erfana. Go to the editor and choose which version to keep.`,
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
    `${plural(count, 'comment', 'comments')} on ${noun}, line ${line}. Open.`,
  /** comments-v2 marks.html: the S-07 warning icon, the C-17 stack and the C-05 ghost (R-16), the C-17 title over marked words. */
  damagedName: (noun: string, line: number): string => `Damaged comment on ${noun}, line ${line}. Open.`,
  stackName: (count: number): string => `${plural(count, 'more comment', 'more comments')} in this row. Open.`,
  ghostName: (line: number): string => `Comment not found, line ${line}. Open.`,
  markTitle: (name: string): string => `Comment by ${name} – click to open`
} as const

/**
 * Selection comments, in both previews (spec 024 024-FR-004; comments-v2
 * C-07, C-16, C-21; menu matrix M-02, M-04, M-12, M-14, M-16, M-19, M-21).
 * `{kind}` is the preview's noun ("element" in HTML, the kind in Markdown).
 */
export const SELECTION_COPY = {
  commentOnSelection: 'Comment on selection',
  commentOnWhole: (noun: string): string => `Comment on the whole ${noun}`,
  menuLabel: 'Selection',
  button: 'Comment',
  narrow: 'Comment on specific words',
  narrowLabel: (_noun: string, _line: number): string => 'Select the words this comment is about',
  result: (exact: string): string => `Comment on: “${exact}”`,
  whole: (noun: string): string => `Whole ${noun}`,
  showAll: 'Show all',
  showLess: 'Show less',
  cut: (max: number): string => `Erfana keeps only the first ${max} characters of your selection.`,
  crossed: (noun: string): string => `Your selection went past this ${noun}. The comment covers only the words inside it.`,
  tie: (noun: string): string =>
    `These words appear more than once here, so Erfana can't tell which ones you mean. Select more words, or comment on the whole ${noun}.`,
  blank: (noun: string): string => `Only spaces are selected. Select some words, or comment on the whole ${noun}.`,
  wordsDropped: (noun: string): string =>
    `Comment saved on the whole ${noun}. Erfana can't attach it to the words you selected.`,
  /** D-16, both previews (HTML before the save, 024-AC-004 (g); Markdown when main dropped the words). */
  wordsNotInFile: (noun: string): string =>
    `Erfana can't attach this comment to the words you selected. The comment goes on the whole ${noun}.`,
  /** The same note on a part a script creates, where the cause is known. */
  wordsFromScript: (noun: string): string =>
    `Erfana can't attach this comment to the words you selected, because a script creates them when the page opens. The comment goes on the whole ${noun}.`
} as const

/** The drawer's order of rows (C-15 sort menu). */
export type CommentSortOrder = 'file' | 'changed' | 'latest'

/**
 * The comment list in both previews – the drawer and the toolbar's count
 * (comments-v2 C-15, C-20, OD-04, OD-06; state table § 1 "Toolbar", § 2
 * "Drawer note"; R-09, R-14).
 */
export const COMMENT_LIST_COPY = {
  /** The filter's group name; no longer drawn (C-15). */
  filterGroup: 'Show',
  filterOpen: 'Open',
  filterResolved: 'Resolved',
  /** OD-04: damaged and newer-format comments. */
  filterCantEdit: 'Problems',
  emptyCantEdit: 'No comments have problems.',
  changedTag: 'Changed',
  wordsChangedTag: 'Words changed',
  /** C-20: the drawer's checkbox, which took over from the toolbar's icons toggle. */
  showIcons: 'Show comment icons and underlines',
  sortMenu: 'Sort comments',
  sortOrder: { file: 'File order', changed: 'Changed first', latest: 'Latest activity' } as Readonly<Record<CommentSortOrder, string>>,
  sortButton: (order: CommentSortOrder): string => `Sort: ${COMMENT_LIST_COPY.sortOrder[order]}`,
  /** The toolbar count's name and tooltip: "Comments" with none, else "7 comments" (the button draws only the number, and the ▲ counter beside it). */
  count: (open: number): string => (open === 0 ? 'Comments' : plural(open, 'comment', 'comments')),
  /** P-F22: the quiet hint beside the count, for comments with no place to show on a page. */
  notFoundCount: (count: number): string => `${count} not found`,
  /** Its accessible name: that count first, then only the non-zero parts (R-14). */
  countName: (open: number, changed: number, damaged: number, notFound = 0): string =>
    [
      COMMENT_LIST_COPY.count(open),
      changed > 0 ? `${changed} changed` : '',
      notFound > 0 ? COMMENT_LIST_COPY.notFoundCount(notFound) : '',
      damaged > 0 ? `${damaged} damaged` : ''
    ]
      .filter(part => part !== '')
      .join(', '),
  /** A row's description, after its name (C-10): what it is on. */
  rowOn: (label: string): string => `on ${label}`,
  /** OD-06: the drawer note. */
  removed: (count: number, file: string): string =>
    `${plural(count, 'open comment', 'open comments')} ${count === 1 ? 'was' : 'were'} removed from ${file} outside Erfana.`,
  removedShow: 'Show',
  removedHide: 'Hide',
  removedDismiss: 'Dismiss',
  removedList: 'Comments removed outside Erfana',
  copyText: 'Copy text',
  textCopied: 'Text copied.',
  copyTextFailed: "Couldn't copy the text.",
  /** C-06 / D-32 / P-F10: the HTML drawer's help note; Markdown blocks have no attributes or styles of their own. */
  changeLimit: "Erfana notices when a section's text changes, or when it is restyled or moved. It doesn't notice a change made only in a style sheet."
} as const

/**
 * What the Markdown picker says (comments-v2 C-10, C-16; Markdown words, C-03):
 * the target's kind, line, opening words and open comments – main's facts and
 * the rendered text, never a class or an id.
 */
export const MD_SPOKEN_COPY = {
  /** "Paragraph, line 42: “We ship the beta…”. 2 comments." */
  target: (noun: string, line: number, excerpt: string, comments: number): string =>
    `${capitalise(noun)}, line ${line}${excerpt === '' ? '' : `: “${excerpt}”`}.${comments > 0 ? ` ${plural(comments, 'comment', 'comments')}.` : ''}`,
  /** Added to the first steps after the mode turns on. */
  hint: ' Enter to comment, Shift+F10 for the menu.',
  /** A picker key in a preview with no target at all. */
  noTargets: 'Nothing here to comment on.',
  /** C-16: turning the mode on with words selected only turns the mode on. */
  modeOnSelected: 'Comment mode on. Text is selected – press Enter or click Comment to comment on it.',
  /** C-10: the keyboard entry, in one sentence. */
  modeOnAt: (target: string): string => `Comment mode on. ${target}`
} as const

/** Characters of a target's text the picker speaks (C-10 "first 60 characters"). */
export const SPOKEN_EXCERPT_MAX_CHARS = 60

/** The Changed state on the overlay's icons (comments-v2 C-06; the notch is the shape, these words the name). */
export const CHANGE_MARK_COPY = {
  /** R-17: "2 comments on list item, line 18, changed. Open." – how many changed is not said. */
  iconName: (count: number, noun: string, line: number, _changed?: number): string =>
    `${plural(count, 'comment', 'comments')} on ${noun}, line ${line}, changed. Open.`
} as const
