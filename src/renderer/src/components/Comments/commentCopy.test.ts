// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_MESSAGES, ErrorCode } from '../../../../shared/errors'
import { CommentUnavailableReasonSchema } from '../../../../shared/ipc/preview-comment-schema'

const platform = vi.hoisted(() => ({ mac: false }))
vi.mock('../../utils/platform', () => ({
  isMacOS: () => platform.mac,
  isWindows: () => !platform.mac
}))

import {
  ANNOUNCE,
  COPY,
  DRAWER_COPY,
  FILE_LIMIT_TEXT,
  UNAVAILABLE_REASON_TEXT,
  commentModeAriaShortcut,
  commentModeShortcutLabel,
  deleteBlockText,
  deleteThreadText,
  fillFile,
  listButtonName,
  modeTooltip,
  saveFailureCopy,
  saveShortcutAria,
  saveShortcutLabel,
  threadsTitle,
  unavailableTooltip,
  unreadFilesText,
  writtenAnnouncement
} from './commentCopy'
import { HTML_WORDS } from './commentCopyWords'

describe('commentCopy', () => {
  beforeEach(() => {
    platform.mac = false
  })

  it('C-13 a reply that also resolves is announced as resolved; a plain reply as saved', () => {
    const reply = { panelId: 'p', op: 'reply', fileKey: 'f', threadKey: 't', rawHash: 'h', text: 'x' } as const
    expect(writtenAnnouncement({ ...reply, resolve: true }, 'a.html')).toBe(ANNOUNCE.resolved)
    expect(writtenAnnouncement(reply, 'a.html')).not.toBe(ANNOUNCE.resolved)
  })

  it('names the shortcuts per platform', () => {
    expect(commentModeShortcutLabel()).toBe('Ctrl+Alt+M')
    expect(commentModeAriaShortcut()).toBe('Control+Alt+M')
    expect(saveShortcutLabel()).toBe('Ctrl+Enter')
    platform.mac = true
    expect(commentModeShortcutLabel()).toBe('⌥⌘M')
    expect(commentModeAriaShortcut()).toBe('Meta+Alt+M')
    expect(saveShortcutLabel()).toBe('⌘Enter')
    expect(saveShortcutAria()).toBe('Meta+Enter')
    platform.mac = false
    expect(saveShortcutAria()).toBe('Control+Enter')
  })

  describe('R-021 M-10 unavailable sentence with each reason – "for this file" (menu matrix § 3)', () => {
    it.each(CommentUnavailableReasonSchema.options)('has wording for %s', reason => {
      expect(unavailableTooltip(reason)).toBe(`You can't comment on this file: ${UNAVAILABLE_REASON_TEXT[reason]}.`)
    })

    it('falls back to the prepare-failed wording for an unknown reason', () => {
      expect(unavailableTooltip('???' as never)).toBe(
        `You can't comment on this file: ${UNAVAILABLE_REASON_TEXT['prepare-failed']}.`
      )
    })
  })

  describe('R-022 save failures keep the text and say what to do', () => {
    const cases: Array<[ErrorCode, string]> = [
      [ErrorCode.COMMENT_FILE_READ_ONLY, 'banner'],
      [ErrorCode.COMMENT_TARGET_MOVED, 'close'],
      [ErrorCode.COMMENT_FILE_GONE, 'close'],
      [ErrorCode.COMMENT_ENCODING_UNSUPPORTED, 'banner'],
      [ErrorCode.COMMENT_FILE_CONFLICTED, 'banner'],
      [ErrorCode.COMMENT_WRITE_REFUSED_LINK, 'banner'],
      [ErrorCode.COMMENT_WRITE_UNSUPPORTED_FS, 'banner'],
      [ErrorCode.COMMENT_DRAFT_EXPIRED, 'pick-again'],
      [ErrorCode.COMMENT_BLOCK_CHANGED, 'close'],
      [ErrorCode.COMMENT_UNSAVED_SOURCE, 'unsaved'],
      [ErrorCode.COMMENT_IDENTITY_REQUIRED, 'identity'],
      [ErrorCode.COMMENT_LIMIT, 'banner'],
      [ErrorCode.COMMENT_FILE_TOO_LARGE, 'banner'],
      [ErrorCode.COMMENT_KEY_INVALID, 'close'],
      [ErrorCode.COMMENT_PATH_REFUSED, 'banner'],
      [ErrorCode.COMMENT_WRITE_FAILED, 'banner'],
      [ErrorCode.COMMENT_SAVE_PENDING, 'pending'],
      [ErrorCode.UNKNOWN_ERROR, 'banner']
    ]
    it.each(cases)('%s → %s', (code, action) => {
      const copy = saveFailureCopy(code, 'index.html')
      expect(copy.action).toBe(action)
      expect(copy.text.length).toBeGreaterThan(10)
    })

    it('names the file where the wording has one', () => {
      expect(saveFailureCopy(ErrorCode.COMMENT_FILE_GONE, 'a.html').text).toBe(
        'a.html no longer exists. Copy your text before closing.'
      )
      expect(saveFailureCopy(ErrorCode.COMMENT_DRAFT_EXPIRED, 'a.html').text).toContain(
        'Your text is safe'
      )
    })

    it('C: every comment code is errors.ts\'s sentence with {file} filled – never a literal {file}', () => {
      const codes = Object.values(ErrorCode).filter(code => code.startsWith('COMMENT_'))
      expect(codes.length).toBeGreaterThan(10)
      for (const code of codes) {
        const text = saveFailureCopy(code, 'pricing.html').text
        expect(text, code).not.toContain('{file}')
        expect(text, code).toBe(ERROR_MESSAGES[code].split('{file}').join('pricing.html'))
        if (ERROR_MESSAGES[code].includes('{file}')) expect(text, code).toContain('pricing.html')
      }
      // Every occurrence, not just the first.
      expect(fillFile('{file} and {file}', 'a.html')).toBe('a.html and a.html')
    })

    it('B: a save still being written says so, with the file', () => {
      expect(saveFailureCopy(ErrorCode.COMMENT_SAVE_PENDING, 'a.html')).toEqual({
        text: 'Still saving to a.html. Your comment appears here once it is written – no need to save again.',
        action: 'pending'
      })
    })

    it('an unknown or non-comment code reads as the generic sentence', () => {
      expect(saveFailureCopy('COMMENT_FROM_THE_FUTURE', 'a.html').text).toBe(
        "Couldn't save the comment. Your text is still here – try again."
      )
    })
  })

  it.each([
    'encoding',
    'conflict-markers',
    'too-large',
    'too-many-blocks',
    'unterminated-block',
    'link',
    'missing',
    'read-only'
  ])('states the read-only reason %s', reason => {
    expect(HTML_WORDS.reasonText(reason, 'a.html').length).toBeGreaterThan(10)
  })

  it('§19 Rev 4 states the file limits the code enforces, in the drawer and in the save error alike', () => {
    expect(FILE_LIMIT_TEXT).toBe('This file is too big for comments. The limit is 25 MB.')
    expect(HTML_WORDS.reasonText('too-large', 'a.html')).toBe('a.html is too big for comments. The limit is 25 MB.')
    expect(ERROR_MESSAGES[ErrorCode.COMMENT_FILE_TOO_LARGE]).toBe(FILE_LIMIT_TEXT)
  })

  it('§19 Rev 4 says how many files a list left out, with a real singular', () => {
    expect(unreadFilesText(1)).toBe(
      'This page has too many parts to list all comments. 1 file is missing here. Open each file in its own tab to see its comments.'
    )
    expect(unreadFilesText(3)).toContain('3 files are missing here')
  })

  // Changed expectation under 024-FR-006 A-02 (was the selector in the title: "Comment on button.cta").
  it('titles a thread window by count, the target word in its {kind} slot', () => {
    expect(threadsTitle('section', 1)).toBe('Comment on section')
    expect(threadsTitle('section', 2)).toBe('Comments on section')
  })

  it('words the delete confirmations', () => {
    expect(deleteThreadText(1)).toBe('Delete this conversation and its 1 reply?')
    expect(deleteThreadText(4)).toBe('Delete this conversation and its 4 replies?')
    expect(deleteBlockText('a.html')).toContain('from a.html')
    expect(ANNOUNCE.deleted('a.html')).toBe('Comment deleted from a.html.')
  })

  it('names the list button with open and attention counts', () => {
    expect(listButtonName(0, 0)).toBe('Comments, none yet')
    expect(listButtonName(3, 0)).toBe('Comments, 3 open')
    expect(listButtonName(3, 2)).toBe('Comments, 3 open, 2 need attention')
    expect(listButtonName(0, 1)).toBe('Comments, 0 open, 1 needs attention')
    expect(listButtonName(0, 0, 2)).toBe('Comments, none open')
  })

  // Changed expectation under C-16 (was "– on: click an element to comment, Esc to leave").
  it('describes the mode in its tooltip', () => {
    expect(modeTooltip(false)).toBe('Comment mode (Ctrl+Alt+M) – off')
    expect(modeTooltip(true)).toBe('Comment mode is on (Ctrl+Alt+M). Click a section or select text. Press Esc to stop.')
  })

  it('024-AC-007 A-05 A-06 A-10: the drawer action, the picker ends and the not-found tag read the Markdown words', () => {
    expect(COPY.showInPreview).toBe('Show in preview')
    expect(ANNOUNCE.pickerTop).toBe('Top level – no parent to select.')
    expect(ANNOUNCE.pickerNoChild).toBe('Nothing inside to select.')
    expect(DRAWER_COPY.notFound).toBe('Not found')
  })
})
