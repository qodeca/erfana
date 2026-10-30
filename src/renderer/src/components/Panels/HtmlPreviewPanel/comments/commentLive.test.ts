// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the page's keyboard picker says (docs/designs/comments/html-preview-comments.md
 * §10.8, §10.10). The shared live-region and inner-step tests moved with their
 * code to `components/Comments/commentLive.test.ts` (spec 024 § 8 C22).
 */
import { describe, expect, it } from 'vitest'
import { PICKER_HINT_STEPS, pickerAnnouncement } from './commentLive'

describe('commentLive', () => {
  it('E-022 words where the keyboard picker moved (§10.10 "Announce"), and nothing for another event', () => {
    // S-L-A: main's facts – the parsed tag and its line – never the page's ids or classes.
    expect(pickerAnnouncement({ say: 'showing', element: { tag: 'p', line: 12 } })).toBe('Showing p, line 12.')
    expect(pickerAnnouncement({ say: 'showing', element: { tag: 'ul', line: 3, added: true } })).toBe(
      'Showing an element added by a script, inside ul on line 3.'
    )
    expect(pickerAnnouncement({ say: 'showing', element: { line: 5 } })).toBe('Showing an element, line 5.')
    expect(pickerAnnouncement({ say: 'top' })).toBe('Top level – no parent to select.')
    expect(pickerAnnouncement({ say: 'no-child' })).toBe('Nothing inside to select.')
    expect(pickerAnnouncement({})).toBeUndefined()
    expect(pickerAnnouncement({ say: 'showing' })).toBeUndefined()
  })

  it('C-10 (HTML) says the kind, the line and the open comments as the Markdown picker does, with the keys on the first steps only', () => {
    const element = { tag: 'h2', line: 4, role: 'heading level 2' as const, comments: 2 }
    expect(pickerAnnouncement({ say: 'showing', element }, 0)).toBe('Heading level 2, line 4. 2 comments. Enter to comment, Shift+F10 for the menu.')
    expect(pickerAnnouncement({ say: 'showing', element }, PICKER_HINT_STEPS - 1)).toMatch(/Shift\+F10 for the menu\.$/)
    expect(pickerAnnouncement({ say: 'showing', element })).toBe('Heading level 2, line 4. 2 comments.')
    expect(pickerAnnouncement({ say: 'showing', element: { tag: 'p', line: 9, role: 'paragraph' } }, PICKER_HINT_STEPS)).toBe('Paragraph, line 9.')
    // A script-built element keeps the "added by a script" sentence.
    expect(pickerAnnouncement({ say: 'showing', element: { tag: 'ul', line: 3, added: true } }, 0)).toBe(
      'Showing an element added by a script, inside ul on line 3.'
    )
  })

  it('C-10 (HTML) says the first words main read from the file, in the Markdown sentence form', () => {
    const element = { tag: 'p', line: 42, role: 'paragraph' as const, comments: 2, excerpt: 'We ship the beta on Friday…' }
    expect(pickerAnnouncement({ say: 'showing', element })).toBe('Paragraph, line 42: “We ship the beta on Friday…”. 2 comments.')
    expect(pickerAnnouncement({ say: 'showing', element }, 0)).toBe(
      'Paragraph, line 42: “We ship the beta on Friday…”. 2 comments. Enter to comment, Shift+F10 for the menu.'
    )
    // No words (none sent, or an element with no text): the sentence without them.
    expect(pickerAnnouncement({ say: 'showing', element: { line: 7, role: 'image' } })).toBe('Image, line 7.')
  })
})
