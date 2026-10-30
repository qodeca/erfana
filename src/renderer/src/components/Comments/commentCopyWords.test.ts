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
  HTML_WORDS,
  MARKDOWN_COPY,
  MARKDOWN_FILE_LIMIT_TEXT,
  MARKDOWN_WORDS,
  MD_SURFACE_COPY,
  capitalise,
  markdownKindNoun,
  markdownReadOnlyReasonText,
  markdownSaveFailureCopy
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

  it('keeps the HTML words exactly as the HTML Preview showed them', () => {
    const target = { tag: 'div', classes: ['note'], line: 7 }
    expect(HTML_WORDS.noun('p')).toBe('element')
    expect(HTML_WORDS.newCommentTitle('p')).toBe(COPY.newComment)
    expect(HTML_WORDS.menuLabel('p')).toBe(COPY.menuLabel)
    expect(HTML_WORDS.showInPreview).toBe(COPY.showOnPage)
    expect(HTML_WORDS.drawerNone).toBe(DRAWER_COPY.none)
    expect(HTML_WORDS.context(target, 'index.html')).toBe(`${HTML_WORDS.label(target)} · index.html, line 7`)
    for (const code of COMMENT_CODES) expect(HTML_WORDS.saveFailure(code, 'index.html')).toEqual(saveFailureCopy(code, 'index.html'))
  })
})
