// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The two word tables, side by side (spec 024 024-FR-006, 024-FR-007, C-19;
 * differences table D-04, D-27): one template per sentence, so swapping the
 * `{kind}` word turns one preview's string into the other's, and what stays
 * different is listed here with its D-row. The expected text is written out,
 * never built with the function under test.
 */
import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import { CommentUnavailableReasonSchema } from '../../../../shared/ipc/preview-comment-schema'
import { bannedHtmlWords, bannedMarkdownWords } from './__test-utils__/commentWordBans'
import { COPY, DRAWER_COPY, IDENTITY_COPY, SETTINGS_COPY, TOOL_COPY } from './commentCopy'
import { COMMENT_LIST_COPY, HTML_WORDS, MARKDOWN_WORDS, SELECTION_COPY, type CommentWords } from './commentCopyWords'
import { WINDOW_COPY } from './commentWindowCopy'
import { headingOf } from './commentWindowHeading'
import type { CommentWindowRequest } from './commentWindowTypes'
import type { selectThreads } from './ThreadsView'

const FILE = 'notes.md'
const TARGET = { tag: 'p', classes: ['lead'], elementId: 'intro', line: 14 }
/** Every reason main can name, and one a later main adds. */
const REASONS = [
  'not-commentable', 'encoding', 'conflict-markers', 'too-large', 'too-many-blocks', 'unterminated-block', 'link', 'missing',
  'read-only', 'not-owner', 'outside-project', 'target-moved', 'changed', 'busy', 'parse-failed', 'from-a-later-main'
]
const CODES = Object.values(ErrorCode).filter(code => code.startsWith('COMMENT_'))

/** One preview's string with its `{kind}` word turned into the HTML one. */
const asHtml = (text: string): string =>
  text.replace(/\bparagraphs\b/g, 'sections').replace(/\bparagraph\b/g, 'section').replace(/\bParagraph\b/g, 'Section')

/** Every field of a word table, as text; a field added to the table does not compile until it is listed here. */
const FIELDS: { readonly [K in keyof CommentWords]: (words: CommentWords) => string } = {
  preview: () => 'same by construction: it names the table',
  noun: words => words.noun('p'),
  label: words => words.label(TARGET),
  code: () => 'D-03, asserted below',
  newCommentTitle: words => words.newCommentTitle('p'),
  threadsTitle: words => `${words.threadsTitle(TARGET, 1)} | ${words.threadsTitle(TARGET, 2)}`,
  context: words => words.context(TARGET, FILE),
  menuLabel: words => words.menuLabel('p'),
  showInPreview: words => words.showInPreview,
  drawerNone: words => words.drawerNone,
  notFoundTag: words => words.notFoundTag,
  notOnScreen: words => words.notOnScreen,
  notVisibleText: () => 'D-13, asserted below',
  damagedText: words => words.damagedText,
  conflictText: words => words.conflictText,
  deleteBlock: words => words.deleteBlock,
  deleteBlockAction: words => words.deleteBlockAction,
  deleteBlockText: words => words.deleteBlockText(FILE),
  notFoundText: words => words.notFoundText(FILE, 14),
  modeTooltip: words => `${words.modeTooltip(true)} | ${words.modeTooltip(false)}`,
  noTarget: words => words.noTarget.reason,
  pinsOff: words => words.pinsOff,
  modeOn: words => words.modeOn,
  reasonText: words => REASONS.filter(reason => !FORCED_REASONS.has(reason)).map(reason => words.reasonText(reason, FILE)).join(' | '),
  unavailableText: words =>
    CommentUnavailableReasonSchema.options.filter(reason => !FORCED_UNAVAILABLE.has(reason)).map(words.unavailableText).join(' | '),
  saveFailure: words =>
    CODES.filter(code => !FORCED_SAVE_CODES.has(code)).map(code => words.saveFailure(code, FILE, 'p').text).join(' | ')
}

/** Reasons with a preview's own words: its limit (D-27), and "page" only in HTML (D-04). */
const FORCED_REASONS: ReadonlySet<string> = new Set(['too-large', 'target-moved', 'changed'])
/** Toolbar reasons each preview says in its own way: its limits (D-27), and "page" only in HTML. */
const FORCED_UNAVAILABLE: ReadonlySet<string> = new Set(['too-large', 'prepare-failed'])
/** Save refusals with their own sentence by preview: D-23 (a moved target), D-27 (the limit). */
const FORCED_SAVE_CODES: ReadonlySet<string> = new Set([ErrorCode.COMMENT_TARGET_MOVED, ErrorCode.COMMENT_DRAFT_EXPIRED, ErrorCode.COMMENT_FILE_TOO_LARGE])

/** Every string of a copy table, its functions called with sample words. */
function stringsOf(table: string, source: object): Array<[string, string]> {
  return Object.entries(source).flatMap(([key, value]): Array<[string, string]> => {
    if (typeof value === 'string') return [[`${table}.${key}`, value]]
    if (typeof value === 'function') return [[`${table}.${key}`, String((value as (...args: unknown[]) => unknown)(FILE, 14, 14))]]
    return typeof value === 'object' && value !== null ? stringsOf(`${table}.${key}`, value as object) : []
  })
}

/** What a preview's chrome can show, from the tables both share. */
const SHARED_TABLES: ReadonlyArray<[string, object]> = [
  ['COPY', COPY],
  ['DRAWER_COPY', DRAWER_COPY],
  ['TOOL_COPY', TOOL_COPY],
  ['IDENTITY_COPY', IDENTITY_COPY],
  ['WINDOW_COPY', WINDOW_COPY],
  ['SELECTION_COPY', SELECTION_COPY],
  ['COMMENT_LIST_COPY', COMMENT_LIST_COPY]
]

/** What one word table shows, for each reason and code. */
function wordTableStrings(words: CommentWords, noun: string): Array<[string, string]> {
  return [
    ...Object.entries(FIELDS).map(([key, read]): [string, string] => [`words.${key}`, read(words)]),
    ...REASONS.map((reason): [string, string] => [`reasonText ${reason}`, words.reasonText(reason, FILE)]),
    ...CommentUnavailableReasonSchema.options.map((reason): [string, string] => [`unavailableText ${reason}`, words.unavailableText(reason)]),
    ...CODES.map((code): [string, string] => [`saveFailure ${code}`, words.saveFailure(code, FILE, 'p').text]),
    ['notVisibleText', words.notVisibleText('p')],
    ['notFoundContext', headingFor(words, true).context ?? ''],
    ['threads heading', headingFor(words, false).title],
    ['commentOnWhole', SELECTION_COPY.commentOnWhole(noun)]
  ]
}

/** A thread window's heading in `words`. */
function headingFor(words: CommentWords, lost: boolean): ReturnType<typeof headingOf> {
  const request = { kind: 'threads', panelId: 'p', threadKeys: ['t'] } as unknown as CommentWindowRequest
  const selection = {
    file: { displayPath: FILE, frame: false },
    threads: [{ ...TARGET, attached: !lost, status: 'open' }],
    damaged: [],
    newer: []
  } as unknown as ReturnType<typeof selectThreads>
  return headingOf(request, selection, words)
}

/**
 * Shared strings only one preview's chrome reaches, each with its D-row. In
 * Markdown these never show, so they are outside its ban.
 */
const HTML_ONLY: ReadonlySet<string> = new Set([
  'IDENTITY_COPY.notice', // A-09: the one notice names the page scripts that can read it.
  'TOOL_COPY.modeNotReady', // D-27: only a page loads.
  'WINDOW_COPY.metaCharset', // D-20: the `<meta charset>` refusal.
  'COMMENT_LIST_COPY.changeLimit', // D-32: the HTML drawer's note.
  'SELECTION_COPY.wordsFromScript', // D-14: only pages run scripts.
  'COPY.menuLabel', // The HTML `{kind}` as a menu's name.
  'unavailableText overlay-removed', // D-27: reasons that exist only for a page.
  'unavailableText page-too-large',
  'unavailableText document-replaced',
  'words.unavailableText' // Those three again, joined for the table comparison; each reason is checked on its own above.
])

describe('the two word tables', () => {
  it('024-AC-007 D-04 every field is one template: only the {kind} word differs', () => {
    for (const [key, read] of Object.entries(FIELDS)) {
      expect(asHtml(read(MARKDOWN_WORDS)), key).toBe(read(HTML_WORDS))
    }
  })

  it('024-AC-007 the rows the table keeps apart are the listed ones', () => {
    expect(HTML_WORDS.notVisibleText('p')).toContain('on another slide or tab') // D-13
    expect(MARKDOWN_WORDS.notVisibleText('p')).toContain('inside a collapsed section')
    expect(HTML_WORDS.reasonText('too-large', FILE)).toBe('notes.md is too big for comments. The limit is 25 MB.') // D-27
    expect(MARKDOWN_WORDS.reasonText('too-large', FILE)).toBe('notes.md is too big or too complex for comments. The size limit is 2 MB.')
    expect(HTML_WORDS.unavailableText('too-large')).toBe("You can't comment on this file: it is too big. The limit is 25 MB.")
    expect(MARKDOWN_WORDS.unavailableText('too-large')).toBe("You can't comment on this file: it is too big or too complex. The size limit is 2 MB.")
  })

  it('P-F03 P-F04 I-7 K-13 A-01 A-02 the plain kind word, as literal text', () => {
    expect(HTML_WORDS.newCommentTitle('p')).toBe('New comment on section')
    expect(MARKDOWN_WORDS.newCommentTitle('p')).toBe('New comment on paragraph')
    expect(HTML_WORDS.threadsTitle(TARGET, 1)).toBe('Comment on section')
    expect(HTML_WORDS.threadsTitle(TARGET, 2)).toBe('Comments on section')
    expect(MARKDOWN_WORDS.threadsTitle(TARGET, 1)).toBe('Comment on paragraph')
    expect(WINDOW_COPY.newCommentOn('section')).toBe('New comment on section')
  })

  it('P-F19 K-17 D-03 an HTML label is plain words, and its code is apart, for hover', () => {
    expect(HTML_WORDS.label(TARGET)).toBe('Section · line 14')
    expect(MARKDOWN_WORDS.label(TARGET)).toBe('Paragraph · line 14')
    expect(HTML_WORDS.code(TARGET)).toBe('p#intro.lead')
    expect(MARKDOWN_WORDS.code(TARGET)).toBeUndefined()
  })

  it('P-F31 the not-found line starts with a capital in both previews', () => {
    expect(headingFor(HTML_WORDS, true).context).toBe('Section, not found · notes.md')
    expect(headingFor(MARKDOWN_WORDS, true).context).toBe('Paragraph, not found · notes.md')
  })

  it('P-F18 P-F30 P-F11 the leftovers', () => {
    expect(DRAWER_COPY.notVisible).toBe('Hidden right now')
    expect(COPY.pickAgain).toBe('Select again')
  })
})

describe('one sentence per reason (C-19)', () => {
  const MATRIX: ReadonlyArray<[string, string]> = [
    ['conflict-markers', 'notes.md has two versions mixed together. Fix this first, or ask a developer to help.'],
    ['unterminated-block', "One comment in notes.md is broken, so Erfana can't add new ones. Fix or delete the broken comment first."],
    ['too-many-blocks', 'notes.md has 500 comments, which is the limit. Delete resolved comments to add more.'],
    ['encoding', "Erfana can't add comments to this file because of its text format. Save the file as UTF-8, then try again."],
    ['link', 'notes.md is only a link to another file. Open the real file to comment.'],
    ['read-only', 'notes.md is read-only.'],
    ['not-owner', 'notes.md is read-only.'],
    ['outside-project', "notes.md is not in this project, so you can't comment on it here."],
    ['missing', 'notes.md no longer exists.']
  ]

  it.each(MATRIX)('P-F12 P-F32 menu matrix § 3: %s reads the same in both previews', (reason, sentence) => {
    expect(HTML_WORDS.reasonText(reason, FILE)).toBe(sentence)
    expect(MARKDOWN_WORDS.reasonText(reason, FILE)).toBe(sentence)
  })

  it('I-26 no target: each preview in its own word, and the limit is named', () => {
    expect(HTML_WORDS.noTarget.reason).toBe("You can't add a comment here. Try a nearby section.")
    expect(MARKDOWN_WORDS.noTarget.reason).toBe("You can't add a comment here. Try a nearby paragraph.")
  })

  it('a reason from a later main still reads as a refusal', () => {
    expect(HTML_WORDS.reasonText('from-a-later-main', FILE)).toBe("Erfana doesn't add comments to this file.")
  })
})

describe('what each preview shows (024-AC-008)', () => {
  const shared = SHARED_TABLES.flatMap(([table, source]) => stringsOf(table, source))

  it('the check reaches the shared chrome strings', () => {
    expect(shared.length).toBeGreaterThan(150)
    expect(shared.map(([name]) => name)).toContain('DRAWER_COPY.notVisible')
  })

  it('no Markdown string shown holds a banned word', () => {
    const shown = [...shared, ...wordTableStrings(MARKDOWN_WORDS, 'paragraph'), ['SETTINGS_COPY.markdownFlagHint', SETTINGS_COPY.markdownFlagHint]]
    const offenders = shown
      .filter(([name]) => !HTML_ONLY.has(name))
      .flatMap(([name, text]) => bannedMarkdownWords(text).map(word => `${name}: ${word} – "${text}"`))
    expect(offenders).toEqual([])
  })

  it('no HTML string shown holds a banned word', () => {
    const shown = [...shared, ...wordTableStrings(HTML_WORDS, 'section')]
    const offenders = shown.flatMap(([name, text]) => bannedHtmlWords(text).map(word => `${name}: ${word} – "${text}"`))
    expect(offenders).toEqual([])
  })

  it('the bans catch what they are for', () => {
    expect(bannedMarkdownWords('Hidden on the page')).toEqual(['page'])
    expect(bannedMarkdownWords('Try a nearby section.')).toEqual(['section'])
    expect(bannedMarkdownWords('inside a collapsed section')).toEqual([])
    expect(bannedHtmlWords('Comment on this section')).toEqual(['this section'])
    expect(bannedHtmlWords('on button.cta')).toEqual(['selector'])
    expect(bannedHtmlWords('Saves into index.html.')).toEqual([])
  })
})
