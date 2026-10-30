// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The per-preview words (spec 024 024-FR-007, C-03; 024-AC-008): every
 * Markdown sentence reads in Markdown words, and the HTML table still says
 * exactly what the HTML Preview said before spec 024.
 */
import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import { COPY, DRAWER_COPY, saveFailureCopy } from './commentCopy'
import {
  HTML_MENU_COPY,
  HTML_WORDS,
  MARKDOWN_COPY,
  MARKDOWN_FILE_LIMIT_TEXT,
  MARKDOWN_WORDS,
  MD_SURFACE_COPY,
  capitalise,
  markdownKindNoun,
  markdownReadOnlyReasonText,
  markdownSaveFailureCopy,
  menuReasonText
} from './commentCopyWords'

/** Every tag main indexes in a Markdown file (`mdIndex.ts`), plus a raw-HTML section. */
const TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'tr', 'th', 'td', 'blockquote', 'pre', 'hr', 'img', 'div', 'section']
const COMMENT_CODES = Object.values(ErrorCode).filter(code => code.startsWith('COMMENT_'))
const REASONS = [undefined, 'encoding', 'conflict-markers', 'too-large', 'too-many-blocks', 'unterminated-block', 'link', 'missing', 'generated-region', 'frontmatter', 'changed-during-save', 'comments-off']
const FILE = 'notes.md'

/**
 * The words no Markdown string may hold (024-AC-008): "element", "page",
 * "block" outside "code block" and "block quote", a bare tag as a word, and
 * "pin" or "pick" as nouns.
 */
function bannedWords(text: string): string[] {
  const found: string[] = []
  if (/\belements?\b/i.test(text)) found.push('element')
  if (/\bpages?\b/i.test(text)) found.push('page')
  if (/\bblocks?\b/i.test(text.replace(/\bcode blocks?\b/gi, '').replace(/\bblock quotes?\b/gi, ''))) found.push('block')
  const bareTag = /\b(?:p|li|ul|ol|tr|td|th|pre|hr|img|div|blockquote|h[1-6])\b/.exec(text.replace(/\bH[1-6] heading/g, ''))
  if (bareTag !== null) found.push(`tag ${bareTag[0]}`)
  if (/\b(?:a|the|this|your|each)\s+(?:pins?|picks?)\b/i.test(text) || /\bpins?\b/i.test(text)) found.push('pin/pick noun')
  return found
}

/** Every Markdown sentence the preview can show, with a name to fail by. */
function markdownStrings(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const add = (name: string, value: unknown): void => {
    if (typeof value === 'string') out.push([name, value])
  }
  for (const [key, value] of Object.entries(MARKDOWN_COPY)) {
    if (typeof value === 'function') {
      add(`MARKDOWN_COPY.${key}`, (value as (...args: unknown[]) => string)(FILE, 14))
      add(`MARKDOWN_COPY.${key}(noun)`, (value as (...args: unknown[]) => string)('list item', 14))
    } else add(`MARKDOWN_COPY.${key}`, value)
  }
  add('modeTooltip(on)', MARKDOWN_WORDS.modeTooltip(true))
  add('modeTooltip(off)', MARKDOWN_WORDS.modeTooltip(false))
  for (const tag of TAGS) {
    const target = { tag, classes: [], line: 14 }
    add(`label ${tag}`, MARKDOWN_WORDS.label(target))
    add(`newCommentTitle ${tag}`, MARKDOWN_WORDS.newCommentTitle(tag))
    add(`threadsTitle ${tag}`, MARKDOWN_WORDS.threadsTitle(target, 2))
    add(`context ${tag}`, MARKDOWN_WORDS.context(target, FILE))
    add(`menuLabel ${tag}`, MARKDOWN_WORDS.menuLabel(tag))
    add(`commentOn ${tag}`, MD_SURFACE_COPY.commentOn(markdownKindNoun(tag)))
    add(`modeTab ${tag}`, MD_SURFACE_COPY.modeTab({ noun: markdownKindNoun(tag), line: 14 }))
    add(`showing ${tag}`, MD_SURFACE_COPY.showing(markdownKindNoun(tag), 14))
    add(`iconName ${tag}`, MD_SURFACE_COPY.iconName(3, markdownKindNoun(tag), 14))
    for (const code of [...COMMENT_CODES, 'SOMETHING_NEW']) {
      for (const reason of REASONS) {
        add(`saveFailure ${code} ${tag} ${reason ?? '-'}`, MARKDOWN_WORDS.saveFailure(code, FILE, tag, reason).text)
      }
    }
  }
  for (const reason of REASONS) add(`readOnly ${reason ?? '-'}`, MARKDOWN_WORDS.readOnlyReasonText(reason, FILE))
  add('deleteBlockText', MARKDOWN_WORDS.deleteBlockText(FILE))
  add('notFoundText', MARKDOWN_WORDS.notFoundText(FILE, 14))
  for (const key of ['commentOnFrontmatter', 'addComment', 'goToEditor'] as const) add(key, MD_SURFACE_COPY[key])
  add('paused', MD_SURFACE_COPY.paused(FILE))
  add('pausedConflict', MD_SURFACE_COPY.pausedConflict(FILE))
  add('pausedConflictReason', MD_SURFACE_COPY.pausedConflictReason(FILE))
  add('saveFile', MD_SURFACE_COPY.saveFile(FILE))
  add('modeUnavailable', MD_SURFACE_COPY.modeUnavailable(MD_SURFACE_COPY.paused(FILE)))
  add('modeTab(null)', MD_SURFACE_COPY.modeTab(null))
  add('previewName', MD_SURFACE_COPY.previewName(FILE))
  add('limit', MARKDOWN_FILE_LIMIT_TEXT)
  return out
}

describe('commentCopyWords', () => {
  it('024-AC-008: no Markdown string says element, page or block, names a bare tag, or uses pin or pick as a noun', () => {
    const strings = markdownStrings()
    expect(strings.length).toBeGreaterThan(500)
    const offenders = strings.flatMap(([name, text]) => bannedWords(text).map(word => `${name}: ${word} – "${text}"`))
    expect(offenders).toEqual([])
  })

  it('024-AC-008: the ban catches what it is for', () => {
    expect(bannedWords('Click an element on the page')).toEqual(['element', 'page'])
    expect(bannedWords('This block changed')).toEqual(['block'])
    expect(bannedWords('A code block and a block quote')).toEqual([])
    expect(bannedWords('New comment on li')).toEqual(['tag li'])
    expect(bannedWords('Show the pin')).toEqual(['pin/pick noun'])
    expect(bannedWords('Pick it again')).toEqual([])
    expect(bannedWords('H2 heading · line 3')).toEqual([])
  })

  it('024-AC-008: names each kind with its C-03 noun, and anything raw as an HTML section', () => {
    expect(TAGS.map(markdownKindNoun)).toEqual([
      'paragraph',
      'H1 heading',
      'H2 heading',
      'H3 heading',
      'H4 heading',
      'H5 heading',
      'H6 heading',
      'list',
      'list',
      'list item',
      'table',
      'table row',
      'table cell',
      'table cell',
      'block quote',
      'code block',
      'divider',
      'image',
      'HTML section',
      'HTML section'
    ])
    expect(markdownKindNoun('LI')).toBe('list item')
    expect(capitalise('list item')).toBe('List item')
    expect(capitalise('')).toBe('')
  })

  it('024-AC-008: labels, titles and the mode tab read in Markdown words', () => {
    const target = { tag: 'li', classes: [], line: 14 }
    expect(MARKDOWN_WORDS.label(target)).toBe('List item · line 14')
    expect(MARKDOWN_WORDS.newCommentTitle('h2')).toBe('New comment on H2 heading')
    expect(MARKDOWN_WORDS.context(target, FILE)).toBe('notes.md, line 14')
    expect(MARKDOWN_WORDS.menuLabel('blockquote')).toBe('Block quote')
    expect(MD_SURFACE_COPY.modeTab({ noun: 'list item', line: 14 })).toBe('Comment mode · List item, line 14 · Esc to leave')
    expect(MD_SURFACE_COPY.modeUnavailable('notes.md has unsaved changes.')).toBe(
      'Comment mode is unavailable: notes.md has unsaved changes.'
    )
    expect(MD_SURFACE_COPY.iconName(1, 'paragraph', 3)).toBe('1 comment on paragraph, line 3. Open.')
  })

  it('024-AC-008: a refused save names the kind and keeps the window action main implies', () => {
    expect(markdownSaveFailureCopy(ErrorCode.COMMENT_TARGET_MOVED, FILE, 'li')).toEqual({
      text: 'This list item changed in the file since you picked it. Pick it again – your text comes with you.',
      action: 'pick-again'
    })
    expect(markdownSaveFailureCopy(ErrorCode.COMMENT_DRAFT_EXPIRED, FILE, 'pre').text).toContain('Pick the code block again')
    expect(markdownSaveFailureCopy(ErrorCode.COMMENT_TARGET_MOVED, FILE, 'p', 'generated-region')).toEqual({
      text: MARKDOWN_COPY.generated,
      action: 'close'
    })
    expect(markdownSaveFailureCopy(ErrorCode.COMMENT_TARGET_MOVED, FILE, 'p', 'frontmatter').action).toBe('close')
    expect(markdownSaveFailureCopy(ErrorCode.COMMENT_FILE_TOO_LARGE, FILE).text).toBe(MARKDOWN_FILE_LIMIT_TEXT)
    expect(markdownSaveFailureCopy(ErrorCode.COMMENT_BLOCK_CHANGED, FILE).action).toBe('close')
    // Codes whose sentence holds no HTML word read as in the HTML Preview.
    expect(markdownSaveFailureCopy(ErrorCode.COMMENT_UNSAVED_SOURCE, FILE)).toEqual(
      saveFailureCopy(ErrorCode.COMMENT_UNSAVED_SOURCE, FILE)
    )
    expect(markdownSaveFailureCopy(ErrorCode.COMMENT_WRITE_FAILED, FILE, 'p', 'changed-during-save')).toEqual({
      text: MARKDOWN_COPY.changedDuringSave(FILE),
      action: 'close'
    })
    expect(MARKDOWN_FILE_LIMIT_TEXT).toBe(
      'Erfana adds comments only to files of up to 2 MB, 100,000 lines, 32 levels of nesting and 5,000 pieces of raw HTML.'
    )
    expect(markdownReadOnlyReasonText('too-many-blocks', FILE)).toBe(MARKDOWN_COPY.tooMany(FILE))
    expect(markdownReadOnlyReasonText('encoding', FILE)).toBe('Erfana can only add comments to UTF-8 files.')
  })

  it('C-19 M-05 M-06 M-08 M-10 each menu reason line is menu matrix § 3\'s sentence, word for word', () => {
    const file = 'index.html'
    const MATRIX: ReadonlyArray<[string | undefined, string]> = [
      ['conflict-markers', 'index.html has unresolved git conflicts. Resolve them first.'],
      ['unterminated-block', "A comment in index.html has no end, so Erfana won't add comments. Fix it in the source."],
      ['too-many-blocks', 'index.html already has 500 comments, the most Erfana adds to one file. Delete resolved threads to add more.'],
      ['too-large', 'Erfana adds comments only to files of up to 25 MB and 640,000 elements.'],
      ['encoding', 'Erfana can only add comments to UTF-8 files.'],
      ['link', "index.html is a link to another file, so Erfana won't write to it."],
      ['read-only', 'index.html is read-only.'],
      ['not-owner', 'index.html is read-only.'],
      ['outside-project', "index.html is outside this project, so Erfana won't write to it."],
      // Changed expectation under 024-FR-006 § 4 (was "This part of the page can't hold a comment.").
      ['not-commentable', "This part of the preview can't hold a comment."],
      [undefined, "This part of the preview can't hold a comment."]
    ]
    for (const [reason, sentence] of MATRIX) expect(menuReasonText(reason, file), String(reason)).toBe(sentence)
  })

  it('C-19 a reason the matrix has no row for still names a cause and a next step, never a bare refusal', () => {
    expect(menuReasonText('target-moved', 'index.html')).toBe(HTML_MENU_COPY.moved('index.html'))
    expect(menuReasonText('busy', 'index.html')).toBe(HTML_MENU_COPY.busy)
    expect(menuReasonText('missing', 'index.html')).toBe('index.html no longer exists.')
    for (const later of ['excluded', 'a-reason-from-a-later-main']) expect(menuReasonText(later, 'index.html')).toBe(HTML_MENU_COPY.refused)
    for (const text of Object.values(HTML_MENU_COPY)) {
      const sentence = typeof text === 'function' ? text('index.html') : text
      expect(sentence).toMatch(/\.$/)
      expect(sentence).not.toMatch(/comment block/)
    }
  })

  // Changed expectation under 024-FR-006 (was "keeps the HTML words exactly as the HTML Preview showed them",
  // with "New comment", "Show on page" and the old empty drawer): the aligned rows read the shared template.
  it('keeps the HTML words the HTML Preview showed, apart from the rows the differences table aligns', () => {
    const target = { tag: 'div', classes: ['note'], line: 7 }
    expect(HTML_WORDS.noun('p')).toBe('element')
    expect(HTML_WORDS.menuLabel('p')).toBe(COPY.menuLabel)
    expect(HTML_WORDS.notFoundTag).toBe(DRAWER_COPY.notFound)
    expect(HTML_WORDS.context(target, 'index.html')).toBe(`${HTML_WORDS.label(target)} · index.html, line 7`)
    for (const code of COMMENT_CODES) expect(HTML_WORDS.saveFailure(code, 'index.html')).toEqual(saveFailureCopy(code, 'index.html'))
  })

  it('024-AC-007 A-02 titles the window "{…} on element" in the HTML Preview, the kind noun in Markdown', () => {
    const target = { tag: 'button', classes: ['cta'], line: 7 }
    expect(HTML_WORDS.newCommentTitle('button')).toBe('New comment on element')
    expect(HTML_WORDS.threadsTitle(target, 1)).toBe('Comment on element')
    expect(HTML_WORDS.threadsTitle(target, 3)).toBe('Comments on element')
    expect(MARKDOWN_WORDS.newCommentTitle('li')).toBe('New comment on list item')
    expect(MARKDOWN_WORDS.threadsTitle({ tag: 'li', classes: [] }, 1)).toBe('Comment on list item')
    // D-03: the selector is not a title word; it stays in the context line.
    expect(HTML_WORDS.newCommentTitle('button')).not.toContain('button')
    expect(HTML_WORDS.context(target, 'index.html')).toBe('button.cta · index.html, line 7')
  })

  it('024-AC-007 D-04 every aligned sentence is one template; only the {kind} word differs', () => {
    const swap = (text: string): string => text.replace(/\ban element\b/g, 'a paragraph').replace(/\belement\b/g, 'paragraph')
    expect(swap(HTML_WORDS.newCommentTitle('div'))).toBe(MARKDOWN_WORDS.newCommentTitle('p'))
    expect(swap(HTML_WORDS.threadsTitle({ tag: 'div', classes: [] }, 2))).toBe(MARKDOWN_WORDS.threadsTitle({ tag: 'p', classes: [] }, 2))
    expect(swap(HTML_WORDS.drawerNone)).toBe(MARKDOWN_WORDS.drawerNone)
    expect(swap(HTML_WORDS.modeOn)).toBe(MARKDOWN_WORDS.modeOn)
    expect(swap(HTML_WORDS.modeTooltip(true))).toBe(MARKDOWN_WORDS.modeTooltip(true))
    expect(HTML_WORDS.modeTooltip(false)).toBe(MARKDOWN_WORDS.modeTooltip(false))
    expect(HTML_WORDS.showInPreview).toBe(MARKDOWN_WORDS.showInPreview)
    expect(HTML_WORDS.notFoundTag).toBe(MARKDOWN_WORDS.notFoundTag)
  })

  it('024-AC-007 § 4: not found, delete damaged, not on screen, icons off and no target read the same in both previews', () => {
    expect(HTML_WORDS.notFoundText('a.html', 4)).toBe(
      "Erfana can't find what this comment was about any more. The comment stays in a.html, line 4."
    )
    expect(MARKDOWN_WORDS.notFoundText('a.html', 4)).toBe(HTML_WORDS.notFoundText('a.html', 4))
    for (const words of [HTML_WORDS, MARKDOWN_WORDS]) {
      expect(words.deleteBlock).toBe('Delete damaged comment')
      expect(words.deleteBlockAction).toBe('Delete damaged comment…')
      expect(words.deleteBlockText('a.html')).toBe(
        'Delete this damaged comment? Erfana removes exactly the text shown above from a.html.'
      )
      expect(words.notOnScreen).toBe("This comment's target isn't on screen right now")
      expect(words.pinsOff).toBe('Show comment icons – off: icons hidden in this preview')
      expect(words.noTarget.reason).toBe("This part of the preview can't hold a comment.")
    }
  })

  it('024-AC-007 A-05 A-06 A-08 A-10 C-16: the HTML Preview reads the table strings', () => {
    expect(HTML_WORDS.showInPreview).toBe('Show in preview')
    expect(HTML_WORDS.notFoundTag).toBe('Not found')
    expect(HTML_WORDS.drawerNone).toBe(
      'No comments in this file yet. Select text and right-click, or turn on comment mode and click an element.'
    )
    expect(MARKDOWN_WORDS.drawerNone).toBe(
      'No comments in this file yet. Select text and right-click, or turn on comment mode and click a paragraph.'
    )
    expect(HTML_WORDS.modeOn).toBe('Comment mode on. Click an element, select text, or press Tab to pick one. Esc to leave.')
    expect(HTML_WORDS.modeTooltip(true)).toMatch(
      /^Comment mode \([^)]+\) – on: click an element or select text to comment, Esc to leave$/
    )
    expect(MARKDOWN_COPY.pickerTop).toBe('Top level – no parent to select.')
    expect(MARKDOWN_COPY.pickerNoChild).toBe('Nothing inside to select.')
  })
})
