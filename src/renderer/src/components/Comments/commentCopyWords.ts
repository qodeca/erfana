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
 * rewords both previews (S-07, S-08, S-09 – the pin names each). No
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
  FILE_LIMIT_TEXT,
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
  drawerNone: 'No comments in this file yet. Select text and click Comment, or turn on comment mode and click a paragraph.',
  notFoundTag: 'Not found',
  notOnScreen: "This comment's target isn't on screen right now",
  notVisibleText:
    'This part is hidden right now – it may be inside a collapsed section. Its icon comes back when it shows.',
  damagedText: "Erfana can't read this comment, so it won't change it. Fix it in the source, or delete it.",
  conflictText: 'This comment contains git conflict markers. Resolve the conflict in the source.',
  deleteBlock: 'Delete damaged comment',
  deleteBlockAction: 'Delete damaged comment…',
  pinsOff: 'Show comment icons – off: icons hidden in this preview',
  modeOn: 'Comment mode on. Click a paragraph, select text, or press Tab to pick one. Esc to leave.',
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
    return on ? `Comment mode (${key}) – on: click a paragraph or select text to comment, Esc to leave` : `Comment mode (${key}) – off`
  }
} as const

/** HTML reason lines the shared sentences do not cover (menu matrix § 3, C-19). */
export const HTML_MENU_COPY = {
  /** M-08: `html`, `head`, template content, an element no comment can stand before. */
  notCommentable: "This part of the page can't hold a comment.",
  /** Not in the matrix: the file changed since the page was served, so the pick no longer names its element. */
  moved: (file: string): string => `${file} changed since the page loaded. Reload the preview to comment on it.`,
  /** Not in the matrix: the parse did not run (a full queue, a crash) – nothing about the file itself. */
  busy: "Erfana couldn't read the file just now. Try again in a moment.",
  /** Not in the matrix: any other refusal the menu can meet. */
  refused: "Erfana doesn't add comments to this file."
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
    case 'conflict-markers':
      return `${file} has unresolved git conflicts. Resolve them first.`
    case 'unterminated-block':
      return MARKDOWN_COPY.unterminated(file)
    case 'too-many-blocks':
      return MARKDOWN_COPY.tooMany(file)
    case 'too-large':
      return FILE_LIMIT_TEXT
    case 'encoding':
      return 'Erfana can only add comments to UTF-8 files.'
    case 'link':
      return `${file} is a link to another file, so Erfana won't write to it.`
    case 'read-only':
    case 'not-owner':
      return `${file} is read-only.`
    case 'outside-project':
      return `${file} is outside this project, so Erfana won't write to it.`
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
  narrow: 'Narrow to words',
  narrowLabel: (noun: string, line: number): string => `Text of ${noun}, line ${line} – select words to narrow this comment`,
  result: (exact: string): string => `Comment on: “${exact}”`,
  whole: (noun: string): string => `Whole ${noun}`,
  showAll: 'Show all',
  showLess: 'Show less',
  cut: (max: number): string => `Only the first ${max} characters are kept.`,
  crossed: (noun: string): string => `The selection ran past this ${noun}, so the comment is about the words in this ${noun} only.`,
  tie: (noun: string): string =>
    `These words appear more than once in this ${noun} with the same text around them, so Erfana could not find them again. Select more words, or comment on the whole ${noun}.`,
  blank: (noun: string): string => `Only spaces are selected. Select some words, or comment on the whole ${noun}.`,
  wordsDropped: (noun: string, file: string): string =>
    `Comment saved on the whole ${noun} – the selected words are not in ${file} as written.`,
  /** HTML, 024-AC-004 (g): words a script added are not in the file, so the new comment is on the whole element. */
  wordsNotInFile: (file: string): string =>
    `The selected words are not in ${file} as written, so this comment is about the whole element.`
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
  filterCantEdit: "Can't edit",
  emptyCantEdit: 'Every comment in this file can be edited.',
  changedTag: 'Changed',
  wordsChangedTag: 'Words changed',
  /** C-20: the drawer's checkbox, which took over from the toolbar's icons toggle. */
  showIcons: 'Show comment icons and underlines',
  sortMenu: 'Sort comments',
  sortOrder: { file: 'File order', changed: 'Changed first', latest: 'Latest activity' } as Readonly<Record<CommentSortOrder, string>>,
  sortButton: (order: CommentSortOrder): string => `Sort: ${COMMENT_LIST_COPY.sortOrder[order]}`,
  /** The toolbar count's visible text: "Comments" with none, else "7 comments" (the ▲ counter is drawn beside it). */
  count: (open: number): string => (open === 0 ? 'Comments' : plural(open, 'comment', 'comments')),
  /** Its accessible name: the visible text first, then only the non-zero parts (R-14, WCAG 2.5.3). */
  countName: (open: number, changed: number, damaged: number): string =>
    [COMMENT_LIST_COPY.count(open), changed > 0 ? `${changed} changed` : '', damaged > 0 ? `${damaged} damaged` : '']
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
  copyTextFailed: "Couldn't copy the text."
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
  /** Tab at either end of the preview. */
  last: 'End of the preview – Shift+Tab goes back.',
  first: 'Start of the preview.',
  /** C-16: turning the mode on with words selected only turns the mode on. */
  modeOnSelected: 'Comment mode on. Text is selected – press Enter or click Comment to comment on it.',
  /** C-10: the keyboard entry, in one sentence. */
  modeOnAt: (target: string): string => `Comment mode on. ${target}`
} as const

/** Characters of a target's text the picker speaks (C-10 "first 60 characters"). */
export const SPOKEN_EXCERPT_MAX_CHARS = 60

/** The Changed state on the overlay's icons (comments-v2 C-06; the notch is the shape, these words the name). */
export const CHANGE_MARK_COPY = {
  /** "2 comments on list item, line 18, 1 changed. Open." */
  iconName: (count: number, noun: string, line: number, changed: number): string =>
    `${plural(count, 'comment', 'comments')} on ${noun}, line ${line}, ${changed} changed. Open.`
} as const
