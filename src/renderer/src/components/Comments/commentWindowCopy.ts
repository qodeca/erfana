// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the comment window's v2 sentences, in both previews (spec 024
 * state table S-02 – S-05, W-02 – W-11; comments-v2 C-05, C-06, C-13, C-14,
 * C-18, C-19, C-21, OD-05; docs/designs/comments/comments-v2/window.html).
 *
 * `commentCopy.ts` stays the one home of the shared strings; this module is
 * the window's half, kept beside it only because of the 500-line ratchet, as
 * `commentCopyWords.ts` is. It imports from there one way. Every `{kind}` slot
 * takes the preview's noun (`CommentWords.noun`): "element" in the HTML
 * Preview, the kind noun in the Markdown Preview (C-03) – so no Markdown
 * sentence says "element", "page" or "block".
 *
 * The refusal table (C-19.2) is {@link refusalCopy}: a finer reason main
 * names picks its own sentence and next step; anything else falls through to
 * the preview's own `saveFailure`.
 *
 * @module components/Comments/commentWindowCopy
 */
import { ErrorCode } from '../../../../shared/errors'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import type { CommentSaveRequest, CommentSaveResult, CommentThreadView } from '../../../../shared/ipc/preview-comment-schema'
import { unsavedSourceText, type SaveFailureCopy } from './commentCopy'
import { SELECTION_COPY, type CommentWords } from './commentCopyWords'
import type { NounSource } from './commentTargetNoun'

/** Megabytes of the file limit, as the C-19 size sentence prints it. */
const FILE_LIMIT_MB = Math.round(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES / (1024 * 1024))
/** Characters of a heading's text a Markdown window title quotes (C-03). */
export const TITLE_HEADING_MAX_CHARS = 40

/** The window's v2 strings. */
export const WINDOW_COPY = {
  // ---- C-05 not found (S-05) ----
  notFound: (noun: string, file: string): string =>
    `This ${noun} is no longer in ${file}. Someone may have changed it as you asked. Check it, then resolve the comment.`,
  commentLine: (line: number, file: string): string => `The comment itself is on line ${line} of ${file}.`,
  notFoundContext: (label: string, file: string): string => `${label}, not found · ${file}`,
  // ---- C-06 changed (S-03, S-04) ----
  changed: 'Someone changed this text after you commented.',
  /** P-F10: Changed with the same text (HTML only). It names no person: a build can do this as well. */
  restyled: 'This part was restyled or moved. Its text is the same.',
  wordsGone: (_noun: string): string => 'The words this comment is about are no longer here.',
  was: 'Was',
  now: 'Now',
  // ---- C-13 stepper ----
  stepCount: (at: number, of: number): string => `${at} of ${of}`,
  stepGroup: (at: number, of: number): string => `Comment ${at} of ${of}`,
  previous: 'Previous comment',
  next: 'Next comment',
  stepAnnounce: (at: number, of: number, noun: string, line: number): string =>
    `Comment ${at} of ${of}, on ${noun}, line ${line}.`,
  moreActions: 'More actions',
  resolveAndNext: 'Resolve and next',
  replyAndResolve: 'Reply and resolve',
  allDone: 'All open comments are resolved',
  // ---- C-14 the file changed under the window (W-02 – W-05) ----
  carried: 'Your text from the last comment is here.',
  updated: (_file: string): string => 'Updated just now',
  newSince: 'New since you opened',
  removed: (file: string): string => `Someone removed this comment from ${file}. Your reply is still here.`,
  copyText: 'Copy text',
  textCopied: 'Text copied.',
  newCommentOn: (noun: string): string => `New comment on this ${noun}`,
  blockChangedReply: (_file: string): string =>
    'This conversation changed. You see the new version above. Your reply is still here, so send it again.',
  // ---- C-19 refusals ----
  keyInvalid: 'This comment changed or was removed. Close this window and open the comment again.',
  tooManyBlocks: (file: string): string =>
    `${file} has 500 comments, which is the limit. Delete resolved comments to add more. Your text is still here.`,
  replies: 'This conversation has 200 replies, which is the limit. Start a new comment. Your text is still here.',
  fileSize: (file: string): string =>
    `This comment would make ${file} larger than ${FILE_LIMIT_MB} MB, so Erfana didn't save it. Your text is still here.`,
  metaCharset:
    'A comment here could make some letters on the page show incorrectly. Comment on a section further down.',
  notCommentable: 'Erfana adds comments only to HTML and Markdown files.',
  outsideProject: (file: string): string => `${file} is not in this project, so you can't comment on it here.`,
  renderChanged: (_noun: string, file: string, parent: string | null): string =>
    `A comment here would change how ${file} looks. ` +
    (parent === null
      ? 'Copy your text and comment on a nearby paragraph.'
      : `Comment on the whole ${parent} instead – your text is kept.`),
  commentOnWhole: (parent: string): string => `Comment on the whole ${parent}`,
  // ---- C-21 blocked buttons: what is missing, read with the button ----
  writeCommentFirst: 'Write a comment first.',
  writeReplyFirst: 'Write a reply first.',
  saveFileFirst: (file: string): string => `Save ${file} first.`,
  // ---- 024-FR-015 unsaved edits main knows of and this window does not ----
  unsavedElsewhere: (file: string): string => `${file} has unsaved changes in another window – save it there, then try again.`,
  shortenFirst: 'Shorten the comment to save it.',
  // ---- C-10 the picker's Tab at either end of a level, one template in both previews (D-04) ----
  pickerLast: (kind: string): string => `Last ${kind} at this level – Alt+Up for the parent.`,
  pickerFirst: (kind: string): string => `First ${kind} at this level.`,
  // ---- K-26 a step key with nothing to step to ----
  noStepTarget: 'No comments to go to.',
  // ---- C-19.5 the counter's crossings, said once each in the polite region ----
  charsLeft: (left: number): string => `${left.toLocaleString('en-US')} characters left`,
  overBy: (over: number): string => `Over the limit by ${over.toLocaleString('en-US')}`,
  moved: (noun: string): string => `This ${noun} changed after you selected it. Select it again. Your text is safe.`,
  // ---- C-18 the Markdown window's edge tab ----
  edgeTab: (noun: string, line: number, above: boolean): string => `Comment on ${noun}, line ${line} ${above ? '↑' : '↓'}`,
  edgeTabName: (noun: string, line: number): string => `Comment on ${noun}, line ${line}. Show it.`,
  // ---- OD-05 Rebuild from data ----
  rebuildAction: 'Repair comment…',
  rebuildIntro: 'Erfana can repair this comment from a saved copy in the file. Check both versions before you repair it.',
  fileSays: 'What you see now',
  dataSays: 'Saved copy',
  rebuild: 'Repair comment',
  markResolved: 'Mark resolved',
  keepOpen: 'Keep open'
} as const

/**
 * A refused save as the window shows it: the C-19 table first
 * ({@link refusalCopy}), then the preview's own `saveFailure`.
 *
 * @param words - The preview's words.
 * @param code - Main's error code.
 * @param file - The file, its controls as tokens.
 * @param tag - The target (or its tag).
 * @param reason - Main's finer reason.
 * @param parentTag - The target's commentable parent (W-07), when known: its tag and place.
 * @returns The sentence, the next step, and whether it re-targets the draft.
 */
export function windowRefusal(
  words: CommentWords,
  code: string,
  file: string,
  tag: NounSource | undefined,
  reason?: string,
  parentTag?: NounSource
): RefusalCopy {
  const noun = words.noun(tag ?? '')
  const parent = parentTag === undefined ? null : words.noun(parentTag)
  return refusalCopy(code, reason, { file, noun, parent }) ?? words.saveFailure(code, file, tag, reason)
}

/**
 * A Markdown window title's heading text, cut at {@link TITLE_HEADING_MAX_CHARS}
 * on a whole character (C-03: 'Comments on H2 heading “Next steps”').
 *
 * @param text - The heading's text as stored or rendered.
 * @returns `“text”`, or `''` when there is no text.
 */
export function headingQuote(text: string | undefined): string {
  const trimmed = (text ?? '').trim()
  if (trimmed === '') return ''
  const chars = [...trimmed]
  const cut = chars.length > TITLE_HEADING_MAX_CHARS ? `${chars.slice(0, TITLE_HEADING_MAX_CHARS).join('').trimEnd()}…` : trimmed
  return ` “${cut}”`
}

/** What a refusal needs to be worded: the file, the target's noun, and the noun of its parent (render check). */
export interface RefusalContext {
  readonly file: string
  readonly noun: string
  /** The parent's kind noun, for "Comment on the whole {parent}" (C-19.3); `null` when there is none. */
  readonly parent?: string | null
}

/** What the window does next with a refusal it words itself (C-19.2): `whole` re-targets the draft to the parent. */
export type RefusalCopy = SaveFailureCopy & { readonly retarget?: true }

/**
 * The C-19 refusal table: main's finer reason (and the codes C-14/C-19 reword)
 * as a sentence and a next step. `undefined` when the window has nothing finer
 * to say than the preview's own `saveFailure`.
 *
 * @param code - Main's error code.
 * @param reason - Main's finer reason, when it sent one.
 * @param context - {@link RefusalContext}
 * @returns The sentence and action, or `undefined`.
 */
export function refusalCopy(code: string, reason: string | undefined, context: RefusalContext): RefusalCopy | undefined {
  const { file, noun } = context
  switch (reason) {
    case 'too-many-blocks':
      return { text: WINDOW_COPY.tooManyBlocks(file), action: 'banner' }
    case 'replies':
      return { text: WINDOW_COPY.replies, action: 'banner' }
    case 'file-size':
      return { text: WINDOW_COPY.fileSize(file), action: 'banner' }
    case 'meta-charset':
      return { text: WINDOW_COPY.metaCharset, action: 'banner' }
    case 'not-html':
    case 'kind-mismatch':
      return { text: WINDOW_COPY.notCommentable, action: 'close' }
    case 'outside-project':
      return { text: WINDOW_COPY.outsideProject(file), action: 'close' }
    case 'render-changed': {
      const parent = context.parent ?? null
      return parent === null
        ? { text: WINDOW_COPY.renderChanged(noun, file, null), action: 'banner' }
        : { text: WINDOW_COPY.renderChanged(noun, file, parent), action: 'banner', retarget: true }
    }
    default:
      break
  }
  if (code === ErrorCode.COMMENT_KEY_INVALID) return { text: WINDOW_COPY.keyInvalid, action: 'close' }
  // C-14.1 (W-01): the window stays with the text; Pick again carries it to the next window.
  if (code === ErrorCode.COMMENT_TARGET_MOVED && (reason === undefined || reason === 'target-moved')) {
    return { text: WINDOW_COPY.moved(noun), action: 'pick-again' }
  }
  if (code === ErrorCode.COMMENT_RENDER_CHANGED) {
    const parent = context.parent ?? null
    return parent === null
      ? { text: WINDOW_COPY.renderChanged(noun, file, null), action: 'banner' }
      : { text: WINDOW_COPY.renderChanged(noun, file, parent), action: 'banner', retarget: true }
  }
  return undefined
}

/**
 * What the window says when main kept the comment but not its words (024-FR-004).
 * HTML: "Comment saved on the whole section. …". Markdown (D-16): the check
 * should never fail there, and when it does the window says the HTML window's
 * sentence with the target's `{kind}`.
 *
 * @param words - The preview's words.
 * @param tag - The target (or its tag).
 * @returns The sentence.
 */
export function wordsDroppedText(words: CommentWords, tag: NounSource): string {
  const noun = words.noun(tag)
  return words.preview === 'markdown' ? SELECTION_COPY.wordsNotInFile(noun) : SELECTION_COPY.wordsDropped(noun)
}

/**
 * Main refused for unsaved edits and no tab in this window holds them. Markdown
 * asks about every window, so they are elsewhere. HTML asks about this window
 * only, so a tab here just changed: the usual sentence.
 *
 * @param words - The preview's words.
 * @param file - The file, its controls as tokens.
 * @returns The sentence.
 */
export function unsavedElsewhereText(words: CommentWords, file: string): string {
  return words.preview === 'markdown' ? WINDOW_COPY.unsavedElsewhere(file) : unsavedSourceText(file)
}

/** What a new comment's Save waits for, in the order the window checks it. */
export interface SaveBlockInput {
  /** W-08: the pick already knows the part is generated – that sentence. */
  readonly generated: string | null
  readonly unsaved: boolean
  readonly file: string
  readonly text: string
  readonly over: boolean
  readonly choice: 'whole' | 'words' | 'blank' | 'tie'
  /** The target's noun. */
  readonly noun: string
}

/**
 * C-21: what a blocked Save is waiting for, read with the button.
 *
 * @param input - {@link SaveBlockInput}
 * @returns The sentence, or `null` when nothing in the field or the file blocks it.
 */
export function saveBlockedReason(input: SaveBlockInput): string | null {
  if (input.generated !== null) return input.generated
  if (input.unsaved) return WINDOW_COPY.saveFileFirst(input.file)
  if (input.text.trim() === '') return WINDOW_COPY.writeCommentFirst
  if (input.over) return WINDOW_COPY.shortenFirst
  if (input.choice === 'blank') return SELECTION_COPY.blank(input.noun)
  if (input.choice === 'tie') return SELECTION_COPY.tie(input.noun)
  return null
}

/**
 * C-07 (D-16): what the window says when an edit of a thread's first message
 * asked for words main did not keep – they are not in the file as written, so
 * the comment is about the whole target now. `null` for any other answer.
 *
 * @param words - The preview's words.
 * @param save - The write sent.
 * @param result - Main's answer.
 * @param threads - The threads the window shows, for the target's noun.
 * @returns The note, or `null`.
 */
export function editWordsNotice(
  words: CommentWords,
  save: CommentSaveRequest,
  result: CommentSaveResult,
  threads: readonly CommentThreadView[]
): SaveFailureCopy | null {
  if (!result.ok || result.wordsDropped !== true || save.op !== 'editMessage') return null
  const thread = threads.find(t => t.threadKey === save.threadKey)
  return { text: SELECTION_COPY.wordsNotInFile(words.noun(thread ?? '')), action: 'notice' }
}
