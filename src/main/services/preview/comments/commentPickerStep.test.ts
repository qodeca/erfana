// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where the page's keyboard picker moved, passed on for the comment window's
 * live region (docs/designs/html-preview-comments.md §10.8, §10.10
 * "Announce"; E-022).
 */
import { describe, expect, it } from 'vitest'
import { CommentModeChangedSchema, COMMENT_STEP_LABEL_MAX_CHARS } from '../../../../shared/ipc/preview-comment-schema'
import { pickerStepOf } from './commentPickerStep'

describe('pickerStepOf', () => {
  it('passes on what the picker reached, with the element\'s label for an element', () => {
    expect(pickerStepOf('top', undefined)).toEqual({ say: 'top' })
    expect(pickerStepOf('no-child', undefined)).toEqual({ say: 'no-child' })
    expect(pickerStepOf('showing', 'p#team-copy')).toEqual({ say: 'showing', label: 'p#team-copy' })
  })

  it('shows invisible and bidi characters in a label, and stays within the event\'s bound', () => {
    const step = pickerStepOf('showing', `div#a${String.fromCodePoint(0x202e)}b`)
    expect(step.label).not.toContain(String.fromCodePoint(0x202e))
    expect(step.label).toContain('\\u202e')
    // Every character escaped as `\uXXXX` grows six-fold; the step is still a valid event.
    const worst = pickerStepOf('showing', String.fromCodePoint(0x200b).repeat(COMMENT_STEP_LABEL_MAX_CHARS))
    expect(CommentModeChangedSchema.safeParse({ panelId: 'preview-a', on: true, reason: 'picker', ...worst }).success).toBe(true)
  })
})
