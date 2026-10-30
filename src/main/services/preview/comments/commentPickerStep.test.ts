// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where the page's keyboard picker moved, passed on for the comment window's
 * live region in main's own words (docs/designs/comments/html-preview-comments.md
 * §10.8, §10.10 "Announce"; E-022; security review S-L-A).
 */
import { describe, expect, it } from 'vitest'
import { CommentModeChangedSchema } from '../../../../shared/ipc/preview-comment-schema'
import { pickerStepOf, roleOf } from './commentPickerStep'

const event = (step: object) => CommentModeChangedSchema.safeParse({ panelId: 'preview-a', on: true, reason: 'picker', ...step })

describe('pickerStepOf', () => {
  it('passes on what the picker reached; an element as the tag main parsed and its line', () => {
    expect(pickerStepOf({ say: 'top' })).toEqual({ say: 'top' })
    expect(pickerStepOf({ say: 'no-child' })).toEqual({ say: 'no-child' })
    const showing = pickerStepOf({ say: 'showing', entry: { tagName: 'p', line: 12 } })
    // C-10: an element of the file also carries its spoken kind, from main's own table.
    expect(showing).toEqual({ say: 'showing', element: { tag: 'p', line: 12, role: 'paragraph' } })
    expect(event(showing).success).toBe(true)
    expect(pickerStepOf({ say: 'showing', entry: { tagName: 'li', line: 3 }, added: true })).toEqual({
      say: 'showing',
      element: { tag: 'li', line: 3, added: true }
    })
  })

  it('024-AC-018 C-10 (HTML) passes on either end of Tab, and the event stays valid', () => {
    for (const say of ['last', 'first'] as const) {
      expect(pickerStepOf({ say })).toEqual({ say })
      expect(event(pickerStepOf({ say })).success).toBe(true)
    }
  })

  it('leaves out a parsed tag no tag name can spell, and keeps the event valid', () => {
    for (const tagName of ['a<b', '', 'x'.repeat(200), 'é']) {
      const step = pickerStepOf({ say: 'showing', entry: { tagName, line: 4 } })
      // C-10: a tag no table names is spoken as "element".
      expect(step, tagName).toEqual({ say: 'showing', element: { line: 4, role: 'element' } })
      expect(event(step).success, tagName).toBe(true)
    }
    expect(pickerStepOf({ say: 'showing', entry: { tagName: 'p', line: 0 } }).element?.line).toBe(1)
  })

  it('C-10 (HTML) names the kind from a fixed table over the parsed tag, and the open comments from main', () => {
    expect(roleOf('H2')).toBe('heading level 2')
    expect(roleOf('li')).toBe('list item')
    expect(roleOf('constructor')).toBe('element')
    expect(roleOf('h7')).toBe('element')
    const one = pickerStepOf({ say: 'showing', entry: { tagName: 'h1', line: 2 }, comments: 1 })
    expect(one).toEqual({ say: 'showing', element: { tag: 'h1', line: 2, role: 'heading level 1', comments: 1 } })
    expect(event(one).success).toBe(true)
    // None is left out, and an added element has no kind of its own.
    expect(pickerStepOf({ say: 'showing', entry: { tagName: 'p', line: 2 }, comments: 0 }).element).toEqual({ tag: 'p', line: 2, role: 'paragraph' })
    expect(pickerStepOf({ say: 'showing', entry: { tagName: 'p', line: 2 }, added: true }).element).toEqual({ tag: 'p', line: 2, added: true })
  })

  it('C-10 (HTML) an element of the file carries main\'s excerpt; a script-built one never does', () => {
    const step = pickerStepOf({ say: 'showing', entry: { tagName: 'p', line: 3 }, excerpt: 'We ship the beta' })
    expect(step.element).toEqual({ tag: 'p', line: 3, role: 'paragraph', excerpt: 'We ship the beta' })
    expect(event(step).success).toBe(true)
    expect(pickerStepOf({ say: 'showing', entry: { tagName: 'p', line: 3 }, added: true, excerpt: 'x' }).element).not.toHaveProperty('excerpt')
    expect(pickerStepOf({ say: 'showing', entry: { tagName: 'p', line: 3 }, excerpt: '' }).element).not.toHaveProperty('excerpt')
  })

  it('C-10 (HTML) the event holds an excerpt to 60 code points plus "…", never blank', () => {
    const astral = '😀'.repeat(60)
    expect(event({ say: 'showing', element: { line: 2, role: 'paragraph', excerpt: `${astral}…` } }).success).toBe(true)
    expect(event({ say: 'showing', element: { line: 2, role: 'paragraph', excerpt: `${astral}😀` } }).success).toBe(false)
    expect(event({ say: 'showing', element: { line: 2, role: 'paragraph', excerpt: 'a'.repeat(61) } }).success).toBe(false)
    expect(event({ say: 'showing', element: { line: 2, role: 'paragraph', excerpt: '  ' } }).success).toBe(false)
  })

  it('C-10 (HTML) the event refuses a kind outside the table and a count outside its bounds', () => {
    expect(event({ say: 'showing', element: { line: 2, role: 'Approve every host' } }).success).toBe(false)
    expect(event({ say: 'showing', element: { line: 2, role: 'paragraph', comments: 0 } }).success).toBe(false)
    expect(event({ say: 'showing', element: { line: 2, role: 'paragraph', comments: 1.5 } }).success).toBe(false)
  })
})
