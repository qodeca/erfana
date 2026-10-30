// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The note area in the serializer and the planners, and the readable-line
 * extension readers tolerate (spec 024, 024-FR-008, 024-FR-010; architecture
 * note 001 § 8 C1; comments-v2 § C-01).
 */
import { describe, expect, it } from 'vitest'
import { ADA, FIXED_NOW, makeComment, pageWith } from './__fixtures__/commentTestData'
import { lineDocument } from './__fixtures__/lineIndex'
import { HTML_AGENT_NOTE_LINES } from './agentNotes'
import { agentNoteProblem } from './fileKind'
import { AGENT_NOTE_LINES, isSafeNoteLine, renderAgentNote, serializeBlock, type CommentData } from './format'
import { htmlKind } from './htmlKind'
import { wordsHint } from './noteLines'
import { applySplice, planReplace, planSlotInsert } from './splice'
import { addReply } from './thread'
import { analyzeCommentDocument } from '../htmlComments/parse'
import { planInsert, planReplace as planHtmlReplace } from '../htmlComments/splice'

const SEL = { exact: 'Buy now', prefix: '', suffix: '' }
const WITH_SEL: CommentData = makeComment({ anchor: { ...makeComment().anchor, sel: SEL } })
const LF = { indent: '  ', eol: '\n' } as const

function serialized(data: CommentData, note?: readonly string[]): string {
  const result = serializeBlock(data, LF, note)
  if (!result.ok) throw new Error(result.reason)
  return result.block
}

function readBack(block: string) {
  return analyzeCommentDocument(pageWith(block)).state.blocks
}

describe('isSafeNoteLine (C1)', () => {
  it('accepts plain note text and the hint lines', () => {
    for (const line of [...HTML_AGENT_NOTE_LINES, wordsHint('x'), 'a - b', 'status:open', 'data @data']) {
      expect(isSafeNoteLine(line), line).toBe(true)
    }
  })

  it('refuses a line readers could misread, or one that hides text', () => {
    for (const line of [
      'status: open',
      '  status: resolved',
      '@data {}',
      '\\escaped',
      '<<<<<<< HEAD',
      '=======',
      '>>>>>>> theirs',
      '||||||| base',
      'a -- b',
      'a\nstatus: open',
      'a\rb',
      `rlo ${String.fromCharCode(0x202e)}`,
      `ls ${String.fromCharCode(0x2028)}status: open`,
      `${String.fromCharCode(0xfeff)}status: open`
    ]) {
      expect(isSafeNoteLine(line), JSON.stringify(line)).toBe(false)
    }
  })

  it('agentNoteProblem refuses a note line that starts like a status, data or marker line', () => {
    expect(agentNoteProblem(['note to agents: hi.', 'status: open'])).toMatch(/line 2/)
    expect(agentNoteProblem(['note to agents: hi.', '@data x'])).toMatch(/line 2/)
  })
})

describe('serializeBlock note area', () => {
  it('defaults to the v0.23.1 note: the same bytes as before the note parameter', () => {
    expect(serialized(makeComment())).toBe(serialized(makeComment(), AGENT_NOTE_LINES))
    expect(renderAgentNote(LF)).toBe(renderAgentNote(LF, AGENT_NOTE_LINES))
  })

  it('writes the kind note, then the hint lines two blanks deeper, before status', () => {
    const block = serialized(WITH_SEL, [...HTML_AGENT_NOTE_LINES, wordsHint(SEL.exact)])
    const lines = block.split('\n')
    expect(lines[1]).toBe(`  ${HTML_AGENT_NOTE_LINES[0]}`)
    expect(lines[HTML_AGENT_NOTE_LINES.length + 1]).toBe(`    ${wordsHint('Buy now')}`)
    expect(lines[HTML_AGENT_NOTE_LINES.length + 2]).toBe('  status: open')
    expect(readBack(block)[0]).toMatchObject({ kind: 'ok', data: WITH_SEL })
  })

  it('refuses a note without its first line or with an unsafe line: invalid, never a broken block', () => {
    for (const note of [[], ['written by Erfana.'], [AGENT_NOTE_LINES[0], 'status: open'], [AGENT_NOTE_LINES[0], 'a\nb']]) {
      expect(serializeBlock(WITH_SEL, LF, note)).toEqual({ ok: false, reason: 'invalid' })
    }
  })
})

describe('planners and the note area (C1, 024-FR-010)', () => {
  const page = '<!doctype html><main>\n  <p>Pricing</p>\n  <button class="cta">Buy now</button>\n</main>'

  function added(note?: typeof htmlKind) {
    const doc = analyzeCommentDocument(page)
    const button = doc.index.elements.find(el => el.tag === 'button')!
    const planned = planInsert(doc, { targetStart: button.start, data: WITH_SEL, ws: 'collapse' }, note)
    if (!planned.ok) throw new Error(planned.reason)
    return applySplice(page, planned.plan)
  }

  function replied(text: string, note?: typeof htmlKind): string {
    const doc = analyzeCommentDocument(text)
    const block = doc.state.blocks[0]
    if (block.kind !== 'ok') throw new Error(block.kind)
    const data = addReply(block.data, 'Agreed.', { author: ADA, now: FIXED_NOW })
    const planned = planHtmlReplace(doc, { id: data.id, rawHash: block.rawHash, data }, note)
    if (!planned.ok) throw new Error(planned.reason)
    return applySplice(text, planned.plan)
  }

  it('without a kind: the v0.23.1 note and no hints, as the writer pins expect', () => {
    const text = added()
    expect(text).toContain(AGENT_NOTE_LINES[2])
    expect(text).not.toContain('comment is about the words')
  })

  it('with the HTML kind: its note and the words hint; a reply re-renders them from @data', () => {
    const text = added(htmlKind)
    expect(text).toContain(HTML_AGENT_NOTE_LINES[4])
    expect(text).toContain(wordsHint('Buy now'))
    // Dropped as v0.23.1 does, then restored by a reply that passes the kind.
    const dropped = replied(text)
    expect(dropped).not.toContain('comment is about the words')
    const restored = replied(dropped, htmlKind)
    expect(restored).toContain(wordsHint('Buy now'))
    expect(analyzeCommentDocument(restored).state.blocks[0]).toMatchObject({ kind: 'ok' })
  })

  it('the shared planners take the note too (line-start insert, replace)', () => {
    const doc = lineDocument('a\nb\n')
    const planned = planSlotInsert(doc, { offset: 2, shape: 'line-start', indent: '' }, WITH_SEL, undefined, htmlKind)
    if (!planned.ok) throw new Error(planned.reason)
    expect(planned.plan.insert).toContain(wordsHint('Buy now'))
    expect(planReplace(doc, { id: 'c-none', rawHash: '', data: WITH_SEL }, undefined, htmlKind)).toEqual({
      ok: false,
      reason: 'not-found'
    })
  })
})

describe('readable-line extensions (C-01)', () => {
  const block = serialized(makeComment())

  it('a status: or target: line with an unknown " (…)" at its end still reads ok', () => {
    expect(readBack(block.replace('target: <button class="cta">', 'target: <button class="cta"> (a later field)'))[0].kind).toBe('ok')
    expect(readBack(block.replace('status: open', 'status: open (pinned)'))[0].kind).toBe('ok')
  })

  it('any other change still reads readable-mismatch: message lines, an empty or unclosed extension, text without the space', () => {
    for (const edited of [
      block.replace('Make this button blue and bigger.', 'Make this button blue and bigger. (not red)'),
      block.replace('target: <button class="cta">', 'target: <button class="cta"> ()'),
      block.replace('target: <button class="cta">', 'target: <button class="cta"> (open'),
      block.replace('target: <button class="cta">', 'target: <button class="cta">(x)'),
      block.replace('target: <button class="cta">', 'target: <a> (x)'),
      block.replace(/comment by (.*):/, 'comment by $1: (x)')
    ]) {
      expect(readBack(edited)[0]).toMatchObject({ kind: 'damaged', reason: 'readable-mismatch' })
    }
  })
})
