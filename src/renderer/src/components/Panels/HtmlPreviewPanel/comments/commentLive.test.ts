// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the page's keyboard picker says (docs/designs/comments/html-preview-comments.md
 * §10.8, §10.10). The shared live-region and inner-step tests moved with their
 * code to `components/Comments/commentLive.test.ts` (spec 024 § 8 C22).
 */
import { describe, expect, it } from 'vitest'
import { pickerAnnouncement } from './commentLive'

describe('commentLive', () => {
  it('E-022 words where the keyboard picker moved (§10.10 "Announce"), and nothing for another event', () => {
    // S-L-A: main's facts – the parsed tag and its line – never the page's ids or classes.
    expect(pickerAnnouncement({ say: 'showing', element: { tag: 'p', line: 12 } })).toBe('Showing p, line 12.')
    expect(pickerAnnouncement({ say: 'showing', element: { tag: 'ul', line: 3, added: true } })).toBe(
      'Showing an element added by a script, inside ul on line 3.'
    )
    expect(pickerAnnouncement({ say: 'showing', element: { line: 5 } })).toBe('Showing an element, line 5.')
    expect(pickerAnnouncement({ say: 'top' })).toBe('Top of page – no parent to select.')
    expect(pickerAnnouncement({ say: 'no-child' })).toBe('No child elements.')
    expect(pickerAnnouncement({})).toBeUndefined()
    expect(pickerAnnouncement({ say: 'showing' })).toBeUndefined()
  })
})
