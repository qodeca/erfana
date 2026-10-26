// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_MESSAGES, ErrorCode } from '../../../../../../shared/errors'
import { CommentUnavailableReasonSchema } from '../../../../../../shared/ipc/preview-comment-schema'

const platform = vi.hoisted(() => ({ mac: false }))
vi.mock('../../../../utils/platform', () => ({
  isMacOS: () => platform.mac,
  isWindows: () => !platform.mac
}))

import {
  ANNOUNCE,
  UNAVAILABLE_REASON_TEXT,
  commentModeAriaShortcut,
  commentModeShortcutLabel,
  deleteBlockText,
  deleteThreadText,
  fillFile,
  listButtonName,
  modeTooltip,
  readOnlyReasonText,
  saveFailureCopy,
  saveShortcutAria,
  saveShortcutLabel,
  threadsTitle,
  unavailableTooltip
} from './commentCopy'

describe('commentCopy', () => {
  beforeEach(() => {
    platform.mac = false
  })

  it('names the shortcuts per platform', () => {
    expect(commentModeShortcutLabel()).toBe('Ctrl+Alt+M')
    expect(commentModeAriaShortcut()).toBe('Control+Alt+M')
    expect(saveShortcutLabel()).toBe('Ctrl+Enter')
    platform.mac = true
    expect(commentModeShortcutLabel()).toBe('Cmd+Option+M')
    expect(commentModeAriaShortcut()).toBe('Meta+Alt+M')
    expect(saveShortcutLabel()).toBe('Cmd+Enter')
    expect(saveShortcutAria()).toBe('Meta+Enter')
    platform.mac = false
    expect(saveShortcutAria()).toBe('Control+Enter')
  })

  describe('R-021 unavailable tooltip with each reason', () => {
    it.each(CommentUnavailableReasonSchema.options)('has wording for %s', reason => {
      const text = unavailableTooltip(reason)
      expect(text.startsWith('Comments are unavailable for this page: ')).toBe(true)
      expect(text).toContain(UNAVAILABLE_REASON_TEXT[reason])
    })

    it('falls back to the prepare-failed wording for an unknown reason', () => {
      expect(unavailableTooltip('???' as never)).toBe(
        `Comments are unavailable for this page: ${UNAVAILABLE_REASON_TEXT['prepare-failed']}`
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
        'your text is kept'
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
    undefined
  ])('states the read-only reason %s', reason => {
    expect(readOnlyReasonText(reason, 'a.html').length).toBeGreaterThan(10)
  })

  it('titles a thread window by count', () => {
    expect(threadsTitle('button.cta', 1)).toBe('Comment on button.cta')
    expect(threadsTitle('button.cta', 2)).toBe('Comments on button.cta')
  })

  it('words the delete confirmations', () => {
    expect(deleteThreadText(1)).toBe('Delete this thread and its 1 reply?')
    expect(deleteThreadText(4)).toBe('Delete this thread and its 4 replies?')
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

  it('describes the mode in its tooltip', () => {
    expect(modeTooltip(false)).toBe('Comment mode (Ctrl+Alt+M) – off')
    expect(modeTooltip(true)).toContain('– on: click an element to comment, Esc to leave')
  })
})
