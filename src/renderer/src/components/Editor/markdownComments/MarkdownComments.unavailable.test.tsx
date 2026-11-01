// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Preview comments – the toolbar when nothing can be read (spec 024
 * state table F-05, F-07; I-28, P-F14; differences table D-63, D-64). A control
 * must not look usable when it is not: the count goes `aria-disabled` with the
 * reason as its tooltip, as the HTML Preview's does. A failure that may pass by
 * itself stays F-07, so the drawer's Try again can still be reached.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../shared/errors'
import type { CommentRefusalReason } from '../../../../../shared/ipc/comment-common-schema'
import { TEST_IDS } from '../../../constants/testids'
import { FILE_PATH, Harness, fileView, installApi, resetStores, setSettings, type FileCommentsMock } from './__test-utils__/harness'

const DOC = ['# Plan', '', 'First paragraph.', ''].join('\n')
const count = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST)
const mode = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE)

describe('Markdown Preview comments – F-05 in the toolbar (I-28, P-F14)', () => {
  let api: FileCommentsMock

  const refuse = (reason: CommentRefusalReason): void => {
    api.list.mockResolvedValue({ ok: false, code: ErrorCode.COMMENT_PATH_REFUSED, reason } as never)
  }
  const listed = (readOnlyReason: 'too-large' | 'encoding'): void => {
    api.list.mockResolvedValue({ ok: true, file: fileView([], { writable: false, readOnlyReason, filePath: FILE_PATH }), placements: [] } as never)
  }

  beforeEach(() => {
    resetStores()
    api = installApi(fileView())
    setSettings()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each<[string, () => void, string, string]>([
    ['a file past the limit (P-F14)', () => listed('too-large'), "You can't comment on this file: it is too big or too complex. The size limit is 2 MB.", 'Comment mode is unavailable: notes.md is too big or too complex for comments. The size limit is 2 MB.'],
    ['a file that is not UTF-8', () => listed('encoding'), "You can't comment on this file: Erfana can't read its text format.", "Comment mode is unavailable: Erfana can't add comments to this file because of its text format. Save the file as UTF-8, then try again."],
    ['a file comments can never reach', () => refuse('kind-mismatch'), "You can't comment on this file: Erfana couldn't read it.", "You can't comment on this file: Erfana couldn't read it."],
    ['comments turned off in Settings meanwhile', () => refuse('comments-off'), "You can't comment on this file: comments are turned off in Settings.", "Comment mode is unavailable: You can't comment on this file: comments are turned off in Settings."]
  ])('I-28 %s: the count and the mode are disabled with the reason', async (_name, answer, reason, modeReason) => {
    answer()
    const user = userEvent.setup()
    render(<Harness content={DOC} />)
    await waitFor(() => expect(count()).toHaveAttribute('aria-disabled', 'true'))
    expect(count()).toHaveAttribute('title', reason)
    expect(mode()).toHaveAttribute('aria-disabled', 'true')
    expect(mode()).toHaveAttribute('title', modeReason)
    await user.click(count())
    expect(screen.queryByTestId(TEST_IDS.COMMENT_DRAWER)).toBeNull()
  })

  it.each<[string, () => void]>([
    ['a parse that failed', () => refuse('parse-failed')],
    ['a read that failed', () => refuse('io')],
    ['a bridge that did not answer', () => api.list.mockResolvedValue({ ok: false, code: ErrorCode.UNKNOWN_ERROR } as never)]
  ])('F-07 %s may pass by itself: the count stays, so Try again can be reached', async (_name, answer) => {
    answer()
    const user = userEvent.setup()
    render(<Harness content={DOC} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    expect(count()).not.toHaveAttribute('aria-disabled')
    await user.click(count())
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_DRAWER)).toHaveTextContent('Try again'))
  })

  it('I-28 F-05 ends when the file can be read again', async () => {
    refuse('kind-mismatch')
    render(<Harness content={DOC} />)
    await waitFor(() => expect(count()).toHaveAttribute('aria-disabled', 'true'))
    api.list.mockResolvedValue({ ok: true, file: fileView(), placements: [] } as never)
    api.emitChanged()
    await waitFor(() => expect(count()).not.toHaveAttribute('aria-disabled'))
  })
})
