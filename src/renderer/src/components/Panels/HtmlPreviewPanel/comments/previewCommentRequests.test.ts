// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The window a draft opens and the save it sends (spec 024 024-FR-004,
 * 024-AC-004 renderer half; comments-v2 C-07).
 */
import { describe, expect, it } from 'vitest'
import { menuDraft } from './__test-helpers__/commentTestKit'
import { newCommentRequest, withWords, wordsOf } from './previewCommentRequests'

const WORDS = { text: 'We ship the beta to ten customers', start: 20, end: 33, cut: true }

describe('024-AC-004 (renderer) the window a draft opens', () => {
  it('024-AC-004 C-07 (HTML) "Comment on selection" opens on the words main found; the whole element on none, from the whole text', () => {
    const draft = menuDraft({ selection: true, words: WORDS })
    expect(newCommentRequest('preview-index', draft, 'words')?.words).toEqual(WORDS)
    expect(newCommentRequest('preview-index', draft, 'whole')?.words).toEqual({ ...WORDS, start: 0, end: 0, cut: false })
    expect(wordsOf(menuDraft(), 'words')).toBeUndefined()
    expect(newCommentRequest('preview-index', menuDraft(), 'whole')).not.toHaveProperty('words')
  })

  it('no draft from main: no window', () => {
    expect(newCommentRequest('preview-index', menuDraft({ draftToken: undefined }), 'whole')).toBeNull()
    expect(newCommentRequest('preview-index', menuDraft({ target: undefined }), 'words')).toBeNull()
  })

  it('024-AC-004 a new comment sends the chosen words as sel; a whole-element one, a reply or an edit sends none', () => {
    const add = { op: 'add', panelId: 'preview-index', draftToken: 'd'.repeat(32), body: 'Hi', author: 'Ada' } as never
    const sel = { exact: 'ten customers', prefix: 'to ', suffix: '' }
    expect(withWords(add, sel)).toEqual({ ...(add as object), sel })
    expect(withWords(add, undefined)).toBe(add)
    const reply = { op: 'reply' } as never
    expect(withWords(reply, sel)).toBe(reply)
  })
})
