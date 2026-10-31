// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment window's pure v2 parts: thread states, the stepper's position
 * and keys, the C-19 refusal table, the Markdown title's heading text and the
 * docked placement (comments-v2 C-03, C-05, C-06, C-13, C-18, C-19; spec 024
 * state table S-02 – S-05, W-07).
 */
import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import { fileView, thread, threadsRequest } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { HTML_WORDS, MARKDOWN_WORDS } from './commentCopyWords'
import { MARGIN_MIN_PX, inFixedFrame, placeDocked, type DockInput } from './commentDockPlacement'
import { stepKeyOf } from './CommentStepper'
import { TITLE_HEADING_MAX_CHARS, WINDOW_COPY, headingQuote, refusalCopy, windowRefusal } from './commentWindowCopy'
import { headingOf, headingText } from './commentWindowHeading'
import { allResolved, resolveLeads, stepPosition, threadStateOf } from './commentWindowStates'

const was = { state: 'changed' as const, was: 'Buy now', now: 'Buy today' }

describe('thread states (state table § 4)', () => {
  it('S-02 an attached open thread is open, and not-visible when main says so', () => {
    expect(threadStateOf(thread(1))).toBe('open')
    expect(threadStateOf(thread(1, { notVisible: true }))).toBe('not-visible')
    expect(threadStateOf(thread(1), new Set(['t1']))).toBe('not-visible')
  })

  it('C-06 S-03 / S-04 changed and words changed rank above not visible', () => {
    expect(threadStateOf(thread(1, { change: was, notVisible: true }))).toBe('changed')
    expect(threadStateOf(thread(1, { change: { state: 'words', was: 'cheap' } }))).toBe('words')
  })

  it('C-05 S-05 not found ranks above changed; resolved ranks above all', () => {
    expect(threadStateOf(thread(1, { attached: false, change: was }))).toBe('not-found')
    expect(threadStateOf(thread(1, { attached: false, status: 'resolved' }))).toBe('resolved')
  })

  it('C-05 / C-06 Resolve leads only where the work was probably done', () => {
    expect(resolveLeads('not-found')).toBe(true)
    expect(resolveLeads('words')).toBe(true)
    expect(resolveLeads('changed')).toBe(true)
    expect(resolveLeads('open')).toBe(false)
    expect(resolveLeads('not-visible')).toBe(false)
    expect(resolveLeads('resolved')).toBe(false)
  })
})

describe('C-13 stepper position', () => {
  const file = fileView({
    threads: [thread(1), thread(2, { status: 'resolved' }), thread(3), thread(4)]
  })

  it('C-13 counts open threads only and wraps at both ends', () => {
    expect(stepPosition(file, ['t1'])).toEqual({ at: 1, of: 3, previous: 't4', next: 't3' })
    expect(stepPosition(file, ['t4'])).toEqual({ at: 3, of: 3, previous: 't3', next: 't1' })
  })

  it('C-13 a shown resolved thread has place 0 and still steps to its neighbours', () => {
    expect(stepPosition(file, ['t2'])).toEqual({ at: 0, of: 3, previous: 't1', next: 't3' })
  })

  it('C-13 one open thread has nowhere to go; an unknown key has no position', () => {
    const one = fileView({ threads: [thread(1)] })
    expect(stepPosition(one, ['t1'])).toEqual({ at: 1, of: 1, previous: null, next: null })
    expect(stepPosition(one, ['t9'])).toBeNull()
  })

  it('W-11 all resolved only when no thread is open (an empty file counts)', () => {
    expect(allResolved(file)).toBe(false)
    expect(allResolved(fileView({ threads: [thread(2, { status: 'resolved' })] }))).toBe(true)
    expect(allResolved(fileView())).toBe(true)
  })

  it('C-13 Alt+F9 steps forward, Alt+Shift+F9 back, and nothing else does', () => {
    const key = (patch: Partial<Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>>) =>
      stepKeyOf({ code: 'F9', altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, ...patch })
    expect(key({})).toBe('next')
    expect(key({ shiftKey: true })).toBe('previous')
    expect(key({ altKey: false })).toBeNull()
    expect(key({ ctrlKey: true })).toBeNull()
    expect(key({ metaKey: true })).toBeNull()
    expect(key({ code: 'F8' })).toBeNull()
  })
})

describe('C-19 refusal table', () => {
  const context = { file: 'notes.md', noun: 'paragraph', parent: null }

  it('C-19 each finer reason names the limit and a next step', () => {
    expect(refusalCopy(ErrorCode.COMMENT_LIMIT, 'too-many-blocks', context)).toEqual({
      text: WINDOW_COPY.tooManyBlocks('notes.md'),
      action: 'banner'
    })
    expect(refusalCopy(ErrorCode.COMMENT_LIMIT, 'replies', context)?.text).toContain('200 replies')
    expect(refusalCopy(ErrorCode.COMMENT_LIMIT, 'file-size', context)?.text).toContain('larger than 25 MB')
    expect(refusalCopy(ErrorCode.COMMENT_LIMIT, 'meta-charset', context)?.action).toBe('banner')
    expect(refusalCopy(ErrorCode.COMMENT_PATH_REFUSED, 'outside-project', context)).toEqual({
      text: 'notes.md is outside this project, so Erfana won\'t write to it.',
      action: 'close'
    })
    expect(refusalCopy(ErrorCode.COMMENT_PATH_REFUSED, 'kind-mismatch', context)?.text).toBe(WINDOW_COPY.notCommentable)
  })

  it('C-19 an out-of-date window says to open the comment again', () => {
    expect(refusalCopy(ErrorCode.COMMENT_KEY_INVALID, undefined, context)).toEqual({
      text: WINDOW_COPY.keyInvalid,
      action: 'close'
    })
  })

  it('C-14 a moved target offers Pick again with the text kept', () => {
    expect(refusalCopy(ErrorCode.COMMENT_TARGET_MOVED, undefined, context)).toEqual({
      text: 'This paragraph changed in the file since you picked it. Pick it again – your text comes with you.',
      action: 'pick-again'
    })
  })

  it('W-07 a render change re-targets to the parent when there is one, and says copy otherwise', () => {
    const none = refusalCopy(ErrorCode.COMMENT_RENDER_CHANGED, undefined, context)
    expect(none?.retarget).toBeUndefined()
    expect(none?.text).toContain('comment on a nearby paragraph')
    const whole = refusalCopy(ErrorCode.COMMENT_RENDER_CHANGED, 'render-changed', { ...context, parent: 'list' })
    expect(whole).toMatchObject({ action: 'banner', retarget: true })
    expect(whole?.text).toContain('Comment on the whole list instead')
  })

  it('C-19 an unknown reason falls through to the preview\'s own sentence', () => {
    expect(refusalCopy(ErrorCode.COMMENT_LIMIT, 'something-new', context)).toBeUndefined()
    expect(windowRefusal(HTML_WORDS, ErrorCode.COMMENT_LIMIT, 'index.html', 'button', 'something-new')).toEqual(
      HTML_WORDS.saveFailure(ErrorCode.COMMENT_LIMIT, 'index.html', 'button', 'something-new')
    )
  })

  it('C-19 (Markdown) the window words a refusal with the kind noun, never "element"', () => {
    const copy = windowRefusal(MARKDOWN_WORDS, ErrorCode.COMMENT_TARGET_MOVED, 'notes.md', 'h2')
    expect(copy.text).toContain('This H2 heading changed')
    expect(copy.text).not.toMatch(/element|page|block/)
    const parent = windowRefusal(MARKDOWN_WORDS, ErrorCode.COMMENT_RENDER_CHANGED, 'notes.md', 'li', 'render-changed', 'ul')
    expect(parent.retarget).toBe(true)
  })
})

describe('C-03 (window) heading text in Markdown titles', () => {
  it('C-03 (window) a heading title quotes its text, cut at 40 characters', () => {
    expect(headingQuote('Next steps')).toBe(' “Next steps”')
    expect(headingQuote('  ')).toBe('')
    expect(headingQuote(undefined)).toBe('')
    const long = 'x'.repeat(TITLE_HEADING_MAX_CHARS + 5)
    expect(headingQuote(long)).toBe(` “${'x'.repeat(TITLE_HEADING_MAX_CHARS)}…”`)
  })

  it('C-03 (window) only headings get their text; other kinds add nothing', () => {
    expect(headingText('h2', 'Next steps')).toBe(' “Next steps”')
    expect(headingText('p', 'A paragraph')).toBe('')
  })

  it('C-03 (window) a Markdown thread title names the heading; the HTML title does not change', () => {
    const file = fileView({ displayPath: 'notes.md', threads: [thread(1, { tag: 'h2', quote: 'Next steps' })] })
    const selection = { file, threads: file.threads, damaged: [], newer: [] }
    expect(headingOf(threadsRequest(), selection, MARKDOWN_WORDS).title).toBe('Comment on H2 heading “Next steps”')
    expect(headingOf(threadsRequest(), selection, HTML_WORDS).title).not.toContain('Next steps')
  })

  it('C-05 the context line of a lost target says not found', () => {
    const file = fileView({ displayPath: 'notes.md', threads: [thread(1, { tag: 'p', attached: false })] })
    const selection = { file, threads: file.threads, damaged: [], newer: [] }
    expect(headingOf(threadsRequest(), selection, MARKDOWN_WORDS).context).toBe('paragraph, not found · notes.md')
  })
})

describe('C-18 docked placement', () => {
  const base: DockInput = {
    anchor: { left: 100, top: 200, width: 400, height: 40 },
    point: { x: 120, y: 210 },
    size: { width: 360, height: 300 },
    area: { left: 0, top: 0, width: 1200, height: 800 },
    column: { left: 60, top: 0, width: 640, height: 2000 },
    viewportHeight: 800
  }

  it('C-18 a wide pane holds the window in the right margin, level with its target', () => {
    const placed = placeDocked(base)
    expect(placed).toMatchObject({ kind: 'margin', top: 200 })
    if (placed.kind !== 'margin') throw new Error('expected margin')
    expect(placed.left).toBeGreaterThanOrEqual(700)
    expect(placed.maxWidth).toBeLessThanOrEqual(1200 - 700)
  })

  it('C-18 the margin needs the minimum free width; one pixel less falls back to the shipped placement', () => {
    const edgeOfMargin = 1200 - MARGIN_MIN_PX
    expect(placeDocked({ ...base, column: { left: 0, top: 0, width: edgeOfMargin, height: 2000 } }).kind).toBe('margin')
    expect(placeDocked({ ...base, column: { left: 0, top: 0, width: edgeOfMargin + 1, height: 2000 } }).kind).not.toMatch(
      /margin|edge/
    )
    expect(placeDocked({ ...base, column: null }).kind).not.toMatch(/margin|edge/)
  })

  it('C-18 a target scrolled out of the pane shows the edge tab on the side it went', () => {
    expect(placeDocked({ ...base, anchor: { left: 100, top: -90, width: 400, height: 40 } })).toMatchObject({
      kind: 'edge',
      above: true
    })
    expect(placeDocked({ ...base, anchor: { left: 100, top: 800, width: 400, height: 40 } })).toMatchObject({
      kind: 'edge',
      above: false
    })
  })

  it('C-18 a margin window stays inside the pane at the bottom', () => {
    const placed = placeDocked({ ...base, anchor: { left: 100, top: 780, width: 400, height: 10 } })
    if (placed.kind !== 'margin') throw new Error('expected margin')
    expect(placed.top + Math.min(300, placed.maxHeight)).toBeLessThanOrEqual(800)
  })
})

describe('C-18 docked placement inside a containing block', () => {
  // dockview's `.dv-dockview { contain: layout }` makes its grid the box `position: fixed` resolves against.
  const grid = { left: 477, top: 30, width: 900, height: 700 }

  it('C-18 a float or margin window moves by the frame offset, so it lands where it was placed', () => {
    const placed = { kind: 'float' as const, side: 'below' as const, left: 643, top: 145, maxWidth: 480, maxHeight: 560 }
    expect(inFixedFrame(placed, grid, 800)).toEqual({ ...placed, left: 166, top: 115 })
    const margin = { kind: 'margin' as const, left: 900, top: 200, maxWidth: 400, maxHeight: 560 }
    expect(inFixedFrame(margin, grid, 800)).toMatchObject({ left: 423, top: 170 })
  })

  it('C-18 a sheet keeps its foot: bottom is measured from the frame bottom, not the viewport', () => {
    const sheet = { kind: 'sheet' as const, left: 500, width: 300, bottom: 100, maxHeight: 400 }
    // The frame ends 70px above the viewport foot (800 - 30 - 700).
    expect(inFixedFrame(sheet, grid, 800)).toEqual({ ...sheet, left: 23, bottom: 30 })
  })

  it('C-18 an edge tab moves with the frame; the viewport as frame changes nothing', () => {
    const edge = { kind: 'edge' as const, above: true, left: 1200, top: 50 }
    expect(inFixedFrame(edge, grid, 800)).toEqual({ ...edge, left: 723, top: 20 })
    expect(inFixedFrame(edge, { left: 0, top: 0, width: 1384, height: 800 }, 800)).toEqual(edge)
  })
})
