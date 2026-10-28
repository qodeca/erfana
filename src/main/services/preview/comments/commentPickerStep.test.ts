// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where the page's keyboard picker moved, passed on for the comment window's
 * live region in main's own words (docs/designs/comments/html-preview-comments.md
 * §10.8, §10.10 "Announce"; E-022; security review S-L-A).
 */
import { describe, expect, it } from 'vitest'
import { CommentModeChangedSchema } from '../../../../shared/ipc/preview-comment-schema'
import { pickerStepOf } from './commentPickerStep'

const event = (step: object) => CommentModeChangedSchema.safeParse({ panelId: 'preview-a', on: true, reason: 'picker', ...step })

describe('pickerStepOf', () => {
  it('passes on what the picker reached; an element as the tag main parsed and its line', () => {
    expect(pickerStepOf({ say: 'top' })).toEqual({ say: 'top' })
    expect(pickerStepOf({ say: 'no-child' })).toEqual({ say: 'no-child' })
    const showing = pickerStepOf({ say: 'showing', entry: { tagName: 'p', line: 12 } })
    expect(showing).toEqual({ say: 'showing', element: { tag: 'p', line: 12 } })
    expect(event(showing).success).toBe(true)
    expect(pickerStepOf({ say: 'showing', entry: { tagName: 'li', line: 3 }, added: true })).toEqual({
      say: 'showing',
      element: { tag: 'li', line: 3, added: true }
    })
  })

  it('leaves out a parsed tag no tag name can spell, and keeps the event valid', () => {
    for (const tagName of ['a<b', '', 'x'.repeat(200), 'é']) {
      const step = pickerStepOf({ say: 'showing', entry: { tagName, line: 4 } })
      expect(step, tagName).toEqual({ say: 'showing', element: { line: 4 } })
      expect(event(step).success, tagName).toBe(true)
    }
    expect(pickerStepOf({ say: 'showing', entry: { tagName: 'p', line: 0 } }).element?.line).toBe(1)
  })
})
