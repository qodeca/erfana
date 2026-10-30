// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One noun for one Markdown target, everywhere (comments-v2 C-03 kind map:
 * "body tr → row 2", "thead tr → header row", "td/th → row 2, column 3",
 * "Mermaid → diagram"; spec 024 024-FR-007). The noun function itself, then
 * each place that names a target: the window title and its new-comment
 * title, the drawer row and the removed-outside note, the menu label and its
 * items, a picker step, an icon's name, the mode tab, the edge tab, a
 * stepper announcement, the hidden-target line and a refused save.
 */
import { describe, expect, it } from 'vitest'
import type { CommentTargetPlace } from '../../../../shared/ipc/comment-common-schema'
import { fileView, thread } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { ErrorCode } from '../../../../shared/errors'
import { HTML_WORDS, MARKDOWN_WORDS, MD_SURFACE_COPY } from './commentCopyWords'
import { drawerRows } from './commentRows'
import { openThreadsOf } from './commentRemovedOutside'
import { headingOf } from './commentWindowHeading'
import { WINDOW_COPY, windowRefusal } from './commentWindowCopy'
import { markdownKindNoun, markdownTargetNoun, nounTagOf, placeNoun } from './commentTargetNoun'
import { hostMenuItems, hostMenuLabel } from './overlay/hostMenu'
import { spokenTarget } from './overlay/hostParts'
import { newRequestExtras } from './overlay/hostWindow'
import { targetNounOf, type PreviewCommentAdapter } from './overlay/previewAdapter'
import { takePreviewStep } from './commentStepKeys'
import type { CommentWindowRequest } from './commentWindowTypes'

const ROW_2: CommentTargetPlace = { kind: 'row', row: 2 }
const CELL: CommentTargetPlace = { kind: 'cell', row: 2, column: 3 }
const HEADER: CommentTargetPlace = { kind: 'header-row' }
const DIAGRAM: CommentTargetPlace = { kind: 'diagram' }

/** A Markdown thread on a cell: its block sits before the table, the cell is its inner target. */
const cellThread = thread(1, { tag: 'table', classes: [], line: 5, runtime: { tag: 'td', path: 'tbody > tr:nth-of-type(2) > td:nth-of-type(3)' }, place: CELL })

describe('024-AC-008 C-03 the Markdown noun of a target', () => {
  it.each([
    [ROW_2, 'row 2'],
    [HEADER, 'header row'],
    [CELL, 'row 2, column 3'],
    [{ kind: 'header-cell', column: 1 } as CommentTargetPlace, 'header row, column 1'],
    [DIAGRAM, 'diagram']
  ])('024-AC-008 C-03 %j is "%s"', (place, noun) => {
    expect(placeNoun(place)).toBe(noun)
    expect(markdownTargetNoun({ tag: 'tr', place })).toBe(noun)
  })

  it('024-AC-008 C-03 without a place: the kind noun of the target a comment is about, else of its tag', () => {
    expect(markdownTargetNoun('pre')).toBe('code block')
    expect(markdownTargetNoun({ tag: 'ul', runtime: { tag: 'li' } })).toBe('list item')
    expect(markdownTargetNoun({ tag: 'table', runtime: { tag: 'td' } })).toBe('table cell')
    expect(markdownTargetNoun({ tag: 'h2' })).toBe('H2 heading')
    expect(markdownKindNoun('tr')).toBe('table row')
    expect(nounTagOf({ tag: 'ul', runtime: { tag: 'li' } })).toBe('li')
  })

  it('024-AC-008 C-03 the HTML Preview keeps "element" whatever the place (D-04)', () => {
    expect(HTML_WORDS.noun({ tag: 'tr', place: ROW_2 })).toBe('element')
  })
})

describe('024-AC-008 C-03 every place that names a Markdown target says the same noun', () => {
  it('024-AC-008 C-03 the thread window title and context line, and the new-comment title', () => {
    const selection = { file: fileView({ displayPath: 'plan.md', threads: [cellThread] }), threads: [cellThread], damaged: [], newer: [] }
    const request = { kind: 'threads', panelId: 'p', fileKey: 'f1', threadKeys: ['t1'], blockKeys: [], point: { x: 0, y: 0 }, opener: 'page', listAfter: 0 } as const
    expect(headingOf(request, selection as never, MARKDOWN_WORDS).title).toBe('Comment on row 2, column 3')
    const lost = { ...selection, threads: [{ ...cellThread, attached: false }] }
    expect(headingOf(request, lost as never, MARKDOWN_WORDS).context).toContain('row 2, column 3')
    const draft: CommentWindowRequest = {
      kind: 'new',
      panelId: 'p',
      draftToken: 'a'.repeat(32),
      draftKey: 'b'.repeat(32),
      target: { tag: 'pre', classes: [], line: 9, excerpt: '', place: DIAGRAM },
      file: { fileKey: 'f1', displayPath: 'plan.md', filePath: '/p/plan.md', frame: false },
      point: { x: 0, y: 0 },
      opener: 'page'
    }
    expect(headingOf(draft, null, MARKDOWN_WORDS).title).toBe('New comment on diagram')
  })

  it('024-AC-008 C-03 the drawer row and the removed-outside note: "Row 2, column 3 · line 5", never the bare tag', () => {
    const files = [fileView({ displayPath: 'plan.md', threads: [cellThread] })]
    expect(drawerRows(files, new Set(), MARKDOWN_WORDS).open[0].label).toBe('Row 2, column 3 · line 5')
    expect(openThreadsOf(files, MARKDOWN_WORDS).get('t1')?.label).toBe('Row 2, column 3 · line 5')
    // The HTML Preview still names a script-built element by its tag.
    expect(drawerRows(files, new Set(), HTML_WORDS).open[0].label).toBe('td')
  })

  it('024-AC-008 C-03 the menu label and its items', () => {
    const input = { mode: false, tag: 'tr', place: ROW_2, blocked: null, refused: null, words: MARKDOWN_WORDS }
    expect(hostMenuLabel(input)).toBe('Row 2')
    expect(hostMenuItems(input, { open: () => {} })[0].label).toBe('Comment on row 2')
    const words = hostMenuItems({ ...input, place: DIAGRAM, tag: 'pre', selection: true }, { open: () => {}, openWords: () => {} })
    expect(words[1].label).toBe('Comment on the whole diagram')
  })

  it('024-AC-008 C-03 a picker step, an icon name and the mode tab read the adapter\'s place', () => {
    const row = document.createElement('tr')
    row.textContent = 'Piotr Load test Fri'
    const adapter = {
      words: MARKDOWN_WORDS,
      tagOf: () => 'tr',
      placeOf: () => ROW_2,
      lineOf: () => 6,
      attach: () => null
    } as unknown as PreviewCommentAdapter
    expect(targetNounOf(adapter, row)).toBe('row 2')
    expect(spokenTarget(row, adapter, [], null)).toBe('Row 2, line 6: “Piotr Load test Fri”.')
    expect(MD_SURFACE_COPY.iconName(1, targetNounOf(adapter, row), 6)).toBe('1 comment on row 2, line 6. Open.')
    expect(MD_SURFACE_COPY.modeTab({ noun: targetNounOf(adapter, row), line: 6 })).toBe('Comment mode · Row 2, line 6 · Esc to leave')
  })

  it('024-AC-008 C-03 W-07 "Comment on the whole {parent}" names the row holding a cell by its place', () => {
    const cell = document.createElement('td')
    const row = document.createElement('tr')
    const adapter = {
      words: MARKDOWN_WORDS,
      parentOf: () => row,
      canComment: () => ({ ok: true }),
      tagOf: (el: HTMLElement) => el.tagName.toLowerCase(),
      placeOf: (el: HTMLElement) => (el === row ? ROW_2 : undefined)
    } as unknown as PreviewCommentAdapter
    const { parentTag } = newRequestExtras(cell, adapter)
    expect(parentTag).toEqual({ tag: 'tr', place: ROW_2 })
    expect(WINDOW_COPY.commentOnWhole(MARKDOWN_WORDS.noun(parentTag!))).toBe('Comment on the whole row 2')
  })

  it('024-AC-008 C-03 the stepper announcement, the hidden-target line and a refused save', () => {
    const file = fileView({ displayPath: 'plan.md', threads: [cellThread] })
    const said: string[] = []
    const host = { panelKey: 'p', files: () => [file], filter: 'open', open: () => {}, announce: (text: string) => said.push(text), noun: MARKDOWN_WORDS.noun }
    takePreviewStep(host as never, 'next')
    expect(said[0]).toBe(WINDOW_COPY.stepAnnounce(1, 1, 'row 2, column 3', 5))
    expect(MARKDOWN_WORDS.notVisibleText(cellThread)).toContain('This row 2, column 3 is hidden right now')
    expect(windowRefusal(MARKDOWN_WORDS, ErrorCode.COMMENT_TARGET_MOVED, 'plan.md', { tag: 'pre', place: DIAGRAM }).text).toContain('This diagram changed')
  })
})
