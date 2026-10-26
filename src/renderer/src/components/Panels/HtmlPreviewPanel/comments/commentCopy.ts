// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – every string the comment chrome shows
 * (docs/designs/html-preview-comments.md §10.10 is the source of truth).
 *
 * WHY THE RENDERER MAPS ERROR CODES ITSELF. `src/shared/errors.ts` carries a
 * fallback sentence per code, written without the file name ("This file has
 * unresolved git conflicts"). §10.10 names the file and, in two places, words
 * the sentence differently ("This block changed on disk"). The window shows
 * the §10.10 sentence, so the mapping lives here; an unknown code – one a
 * later main adds – falls back to the generic "Couldn't save" sentence rather
 * than to nothing.
 *
 * Strings §10.10 does not give (marked `not in §10.10` below) are written in
 * its voice: what happened, then what to do, and that the text is safe.
 *
 * @module HtmlPreviewPanel/comments/commentCopy
 */
import { ERROR_MESSAGES, ErrorCode } from '../../../../../../shared/errors'
import type { CommentUnavailableReason } from '../../../../../../shared/ipc/preview-comment-schema'
import { isMacOS } from '../../../../utils/platform'
import { plural } from './commentFormat'

/** The comment-mode shortcut as §10.10 prints it, per platform. */
export function commentModeShortcutLabel(): string {
  return isMacOS() ? 'Cmd+Option+M' : 'Ctrl+Alt+M'
}

/** `aria-keyshortcuts` for the comment-mode toggle. */
export function commentModeAriaShortcut(): string {
  return isMacOS() ? 'Meta+Alt+M' : 'Control+Alt+M'
}

/** The save shortcut as the Save button's tooltip prints it. */
export function saveShortcutLabel(): string {
  return isMacOS() ? 'Cmd+Enter' : 'Ctrl+Enter'
}

/** `aria-keyshortcuts` for Save and Reply (Cmd/Ctrl+Enter in the field). */
export function saveShortcutAria(): string {
  return isMacOS() ? 'Meta+Enter' : 'Control+Enter'
}

/** Why comments are unavailable for the page, as the toolbar tooltip ends. */
export const UNAVAILABLE_REASON_TEXT: Readonly<Record<CommentUnavailableReason, string>> = {
  'too-large': 'file too large',
  encoding: 'not a UTF-8 file',
  'prepare-failed': "couldn't prepare the page",
  'overlay-removed': "the page keeps removing Erfana's overlay",
  // not in §10.10 (§19 R3-13): over the element cap.
  'page-too-large': 'page too large – it has too many elements',
  // not in §10.10: `document.open()` erased the overlay's listeners.
  'document-replaced': 'the page replaced its own document',
  // not in §10.10: the feature flag was turned off while the tab was open.
  disabled: 'comments are turned off in Settings'
}

/**
 * The toolbar's "unavailable" tooltip (§10.10 "Unavailable").
 *
 * @param reason - Main's reason.
 * @returns `Comments are unavailable for this page: {reason}`.
 */
export function unavailableTooltip(reason: CommentUnavailableReason): string {
  return `Comments are unavailable for this page: ${UNAVAILABLE_REASON_TEXT[reason] ?? UNAVAILABLE_REASON_TEXT['prepare-failed']}`
}

/**
 * Not in §10.10: the tooltip for a page Erfana cannot comment on at all
 * because it is not a file in this project (the plan's "remote page" state).
 * No preview tab shows such a page today – a remote document only ever sits in
 * a frame, where the menu says "Can't comment here" – so this is exported for
 * the toolbar card and for the day one does.
 */
export const REMOTE_PAGE_TOOLTIP =
  "Comments are unavailable for this page: it isn't a file in this project"

/** Readable-reason for a file main marks read-only (`CommentFileView.readOnlyReason`). */
export function readOnlyReasonText(reason: string | undefined, file: string): string {
  switch (reason) {
    case 'encoding':
      return 'Erfana can only add comments to UTF-8 files.'
    case 'conflict-markers':
      return `${file} has unresolved git conflicts. Resolve them first.`
    case 'too-large':
      // not in §10.10
      return `Erfana adds comments only to files up to 4 MB. ${file} is larger, so its comments are read-only.`
    case 'too-many-blocks':
      // not in §10.10
      return `${file} holds more comment blocks than Erfana edits, so its comments are read-only.`
    case 'unterminated-block':
      // not in §10.10
      return `${file} has a comment block that never ends, so Erfana won't change the file. Fix it in the source.`
    case 'link':
      return `${file} is a link to another file, so Erfana won't write to it.`
    case 'missing':
      return `${file} no longer exists. Copy your text before closing.`
    default:
      return `Couldn't save: ${file} is read-only. Your text is still here.`
  }
}

/** What the window does with a refused save, besides showing its sentence. */
export type SaveFailureAction =
  /** Error banner; Save stays. */
  | 'banner'
  /** Error banner; the only way on is Close (the draft cannot be saved any more). */
  | 'close'
  /** Error banner with "Pick again". */
  | 'pick-again'
  /** The warning banner with Go to tab / Save {file}. */
  | 'unsaved'
  /** Back to the identity step. */
  | 'identity'
  /**
   * Still being written past main's 15 s answer limit (COMMENT_SAVE_PENDING):
   * an info banner, no second Save – main holds the draft, and re-lists when
   * the write lands.
   */
  | 'pending'

/** A refused save as the window shows it. */
export interface SaveFailureCopy {
  readonly text: string
  readonly action: SaveFailureAction
}

/** What the window does next for each code; anything else is `'banner'`. */
const SAVE_FAILURE_ACTIONS: Readonly<Partial<Record<string, SaveFailureAction>>> = {
  [ErrorCode.COMMENT_TARGET_MOVED]: 'close',
  [ErrorCode.COMMENT_FILE_GONE]: 'close',
  [ErrorCode.COMMENT_BLOCK_CHANGED]: 'close',
  [ErrorCode.COMMENT_KEY_INVALID]: 'close',
  [ErrorCode.COMMENT_DRAFT_EXPIRED]: 'pick-again',
  [ErrorCode.COMMENT_UNSAVED_SOURCE]: 'unsaved',
  [ErrorCode.COMMENT_IDENTITY_REQUIRED]: 'identity',
  [ErrorCode.COMMENT_SAVE_PENDING]: 'pending'
}

/** The sentence for a code main did not name, or one this build does not know. */
const GENERIC_SAVE_FAILURE = "Couldn't save the comment. Your text is still here – try again."

/**
 * A sentence with its `{file}` placeholder filled. Every occurrence is
 * replaced, so no literal `{file}` can reach the reader.
 *
 * @param message - A sentence from `ERROR_MESSAGES`.
 * @param file - The file's name as the reader knows it.
 * @returns The sentence with the file named.
 *
 * @example
 * ```ts
 * fillFile('{file} no longer exists.', 'index.html') // 'index.html no longer exists.'
 * ```
 */
export function fillFile(message: string, file: string): string {
  return message.split('{file}').join(file)
}

/**
 * The §10.10 sentence for a refused save, with the file named.
 *
 * The sentence is `src/shared/errors.ts`'s – §10.10's own wording since P5
 * rev 3, pinned by `errors.comments.test.ts` – with `{file}` filled. Only what
 * the window DOES next is decided here.
 *
 * @param code - Main's error code; any value, so a code added later still reads.
 * @param file - The file the comment was going into, as the reader knows it.
 * @returns The sentence and what the window offers next.
 */
export function saveFailureCopy(code: string, file: string): SaveFailureCopy {
  const message = isCommentCode(code) ? ERROR_MESSAGES[code] : GENERIC_SAVE_FAILURE
  return { text: fillFile(message, file), action: SAVE_FAILURE_ACTIONS[code] ?? 'banner' }
}

/** A comment error code `ERROR_MESSAGES` words. */
function isCommentCode(code: string): code is ErrorCode {
  return code.startsWith('COMMENT_') && Object.hasOwn(ERROR_MESSAGES, code)
}

/** §10.10 "Unsaved source" body. */
export function unsavedSourceText(file: string): string {
  return fillFile(ERROR_MESSAGES[ErrorCode.COMMENT_UNSAVED_SOURCE], file)
}

/**
 * Not in §10.10 (copy fix, reported): the "Unsaved source" body when the tab
 * is ALSO changed on disk. Erfana offers no Save there – saving would
 * overwrite the outside edit – so the sentence sends the reader to the tab.
 */
export function unsavedConflictText(file: string): string {
  return `${file} has unsaved changes in another tab, and the file changed on disk too. Go to the tab and decide which version to keep, then add your comment.`
}

/** §10.10 field and window strings. */
export const COPY = {
  newComment: 'New comment',
  damagedComment: 'Damaged comment',
  fieldLabel: 'Comment',
  placeholder: 'What should change here?',
  emptyError: 'Write a comment first.',
  draftRestored: 'Draft restored',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  reply: 'Reply',
  resolve: 'Resolve',
  reopen: 'Re-open',
  edit: 'Edit',
  delete: 'Delete…',
  saveChanges: 'Save changes',
  close: 'Close',
  open: 'Open',
  showOnPage: 'Show on page',
  openInSource: 'Open in source',
  tryAgain: 'Try again',
  pickAgain: 'Pick again',
  change: 'Change',
  edited: 'edited',
  unsavedTitle: 'Save your edits first',
  goToTab: 'Go to tab',
  unsavedCleared: 'Saved. You can add your comment now.',
  // not in §10.10: the tab became clean without a save we made (its changes
  // were discarded, or saved some other way we cannot tell apart).
  unsavedGone: 'The other tab has no unsaved changes now. You can add your comment.',
  addComment: 'Add comment',
  cantCommentHere: "Can't comment here",
  menuLabel: 'Element',
  deleteComment: 'Delete comment',
  deleteThread: 'Delete thread',
  deleteBlock: 'Delete block',
  deleteBlockAction: 'Delete block…',
  copyRaw: 'Copy raw text',
  rawLabel: 'Raw text (read-only)',
  damagedText:
    "Erfana can't read this comment block, so it won't change it. Fix it in the source, or delete it.",
  conflictText: 'This block contains git conflict markers. Resolve the conflict in the source.',
  notVisibleText:
    "This element isn't on screen right now – it may be on another slide or tab. Its icon comes back when it does.",
  // not in §10.10
  newerText:
    'A newer version of Erfana wrote this comment, so this version only shows it. Update Erfana to change it, or edit it in the source.',
  newerTag: 'Newer format – read-only',
  attachedTo: 'It was attached to:',
  rawCopied: 'Raw text copied.',
  // not in §10.10: the read-error sentence when no file name is known yet.
  thisFile: 'this file',
  // not in §10.10: the clipboard refused the raw text.
  copyFailed: "Couldn't copy the raw text."
} as const

/** "Plain text. Saved inside {file}." */
export function fieldHint(file: string): string {
  return `Plain text. Saved inside ${file}.`
}

/** "Comments can be up to 4,000 characters. This one is {n}." */
export function tooLongText(count: number): string {
  return `Comments can be up to 4,000 characters. This one is ${count.toLocaleString('en-US')}.`
}

/** "Comment saved to {file}." – the polite announcement after a save (R-013). */
export function savedAnnouncement(file: string): string {
  return `Comment saved to ${file}.`
}

/**
 * The window title (§10.10 "Window titles"; designer call: one thread reads
 * "Comment on", several "Comments on").
 *
 * @param label - The element label.
 * @param threads - Threads on that element.
 * @returns The title.
 */
export function threadsTitle(label: string, threads: number): string {
  return threads === 1 ? `Comment on ${label}` : `Comments on ${label}`
}

/** "Delete this comment? It is removed from {file}. Git history keeps earlier versions." */
export function deleteCommentText(file: string): string {
  return `Delete this comment? It is removed from ${file}. Git history keeps earlier versions.`
}

/** "Delete this thread and its {n} replies?" with a real singular. */
export function deleteThreadText(replies: number): string {
  return `Delete this thread and its ${plural(replies, 'reply', 'replies')}?`
}

/** "Delete this damaged block? Erfana removes exactly the text shown above from {file}." */
export function deleteBlockText(file: string): string {
  return `Delete this damaged block? Erfana removes exactly the text shown above from ${file}.`
}

/** "Erfana can't find this element any more. The comment stays in {file}, line {n}." */
export function notFoundText(file: string, line: number): string {
  return `Erfana can't find this element any more. The comment stays in ${file}, line ${line}.`
}

/** "Added by a script – saved before <{ancestor}>." */
export function scriptBuiltText(ancestor: string): string {
  return `Added by a script – saved before ${ancestor}.`
}

/** "Saved in {frame file}." */
export function frameFileText(file: string): string {
  return `Saved in ${file}.`
}

/** §10.7 / §10.10 identity strings. */
export const IDENTITY_COPY = {
  title: 'Before your first comment',
  notice:
    'Erfana writes your name – and your email, if you add one – into the HTML file next to each comment. ' +
    'Anyone who can open the file can read them: in Erfana, in the page source, and in git history once the file is ' +
    'committed and pushed. Scripts in pages previewed in this project can read them too. Deleting a comment later does ' +
    'not remove it from git history.',
  nameLabel: 'Name',
  nameHint: 'Shown next to your comments.',
  emailLabel: 'Email (optional)',
  emailHint: 'Leave empty to keep your email out of the file.',
  continue: 'Continue',
  nameRequired: 'Enter a name to continue.',
  emailInvalid: "That doesn't look like an email address.",
  // not in §10.10 (SEC-18)
  nameControl:
    "Names can't contain invisible or direction-changing characters – they could make it read as someone else's.",
  // not in §10.10 (SEC-18)
  emailControl: "Emails can't contain invisible or direction-changing characters.",
  // not in §10.10: the settings schema reads a longer value as unset.
  nameTooLong: 'Names can be up to 100 characters.',
  emailTooLong: 'Emails can be up to 254 characters.',
  commentingAs: 'Commenting as'
} as const

/** §10.10 "Settings" strings. */
export const SETTINGS_COPY = {
  title: 'Comments',
  flagLabel: 'Comments in HTML preview',
  flagHint: 'Lets you add comments to elements of a previewed page.',
  nameLabel: 'Your name',
  nameHint:
    'Saved into HTML files next to each comment you write. Changing it affects new comments only.',
  emailLabel: 'Your email (optional)',
  emailHint: 'Also saved into the file. Leave empty to keep it out.',
  notice:
    'Both are visible to anyone who can open the file – in the page source and in git history once pushed.',
  nameEmpty: 'Enter a name to add comments. Existing comments keep the name they were saved with.',
  // not in §10.10: the settings write failed.
  saveFailed: "Couldn't save this setting. Your text is still here – try again."
} as const

/** §10.10 "Drawer" strings. */
export const DRAWER_COPY = {
  title: 'Comments',
  close: 'Close comments',
  show: 'Show',
  showIcons: 'Show comment icons',
  loading: 'Reading comments…',
  none: 'No comments in this file yet. Turn on comment mode and click an element.',
  emptyOpen: 'No open comments.',
  emptyResolved: 'No resolved comments.',
  emptyAttention: 'Nothing needs attention.',
  notVisible: 'Not visible now',
  notFound: 'Element not found',
  damaged: 'Damaged',
  resolved: 'Resolved',
  notOnScreen: "This element isn't on screen right now"
} as const

/** "Couldn't read comments from {file}." */
export function readErrorText(file: string): string {
  return `Couldn't read comments from ${file}.`
}

/** "In frame: {file}" */
export function inFrameTag(file: string): string {
  return `In frame: ${file}`
}

/** The toolbar tools' accessible names and tooltips (§10.1, §10.10). */
export const TOOL_COPY = {
  mode: 'Comment mode',
  modeNotReady: 'Comment mode – available once the page has loaded',
  pins: 'Show comment icons',
  pinsOn: 'Show comment icons – on',
  pinsOff: 'Show comment icons – off: icons hidden on this page'
} as const

/** The comment-mode toggle's tooltip in its two ordinary states. */
export function modeTooltip(on: boolean): string {
  const key = commentModeShortcutLabel()
  return on
    ? `Comment mode (${key}) – on: click an element to comment, Esc to leave`
    : `Comment mode (${key}) – off`
}

/**
 * The comments list button's accessible name (§10.10 "List button").
 *
 * Copy fix to §10.10 (reported): "1 needs attention" takes the singular verb,
 * and a file whose comments are all resolved reads "none open" – "none yet"
 * would claim there never were any.
 *
 * @param open - Open threads.
 * @param attention - Items that need attention.
 * @param resolved - Resolved threads.
 * @returns e.g. "Comments, 3 open, 1 needs attention".
 */
export function listButtonName(open: number, attention: number, resolved = 0): string {
  if (open === 0 && attention === 0)
    return resolved > 0 ? 'Comments, none open' : 'Comments, none yet'
  if (attention === 0) return `Comments, ${open} open`
  return `Comments, ${open} open, ${attention} ${attention === 1 ? 'needs' : 'need'} attention`
}

/** §10.10 "Announce". */
export const ANNOUNCE = {
  modeOn: 'Comment mode on. Click an element, or press Tab to pick one. Esc to leave.',
  modeOff: 'Comment mode off.',
  // not in §10.10
  resolved: 'Comment resolved.',
  reopened: 'Comment re-opened.',
  deleted: (file: string): string => `Comment deleted from ${file}.`
} as const
