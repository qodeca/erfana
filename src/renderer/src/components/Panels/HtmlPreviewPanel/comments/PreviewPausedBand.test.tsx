// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The HTML Preview's paused band (024-FR-015, open decision 9). */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentDirtyGuard } from '../../../../hooks/useCommentDirtyGuard'
import { TEST_IDS } from '../../../../constants/testids'

const guard = vi.hoisted(() => ({ current: null as unknown as CommentDirtyGuard }))
vi.mock('../../../../hooks/useCommentDirtyGuard', () => ({ useCommentDirtyGuard: () => guard.current }))

import { PreviewPausedBand } from './PreviewPausedBand'

describe('PreviewPausedBand', () => {
  beforeEach(() => {
    guard.current = { state: 'clean', justSaved: false, cleared: null, goToTab: vi.fn(), save: vi.fn(async () => true), holdForWrite: () => () => {} }
  })

  it('is absent while no editor holds unsaved edits', () => {
    render(<PreviewPausedBand filePath="/project/index.html" />)
    expect(screen.queryByTestId(TEST_IDS.COMMENT_HOST_PAUSED)).toBeNull()
  })

  it('F-02 says the same sentence as Markdown, and Save {file} saves', async () => {
    const user = userEvent.setup()
    guard.current = { ...guard.current, state: 'dirty' }
    render(<PreviewPausedBand filePath="/project/index.html" />)
    const band = screen.getByTestId(TEST_IDS.COMMENT_HOST_PAUSED)
    expect(band).toHaveAttribute('data-state', 'paused')
    expect(band).toHaveTextContent('index.html has unsaved changes. Save the file to change comments.')
    screen.getByRole('button', { name: 'Save index.html' }).focus()
    await user.keyboard('{Enter}')
    expect(guard.current.save).toHaveBeenCalledTimes(1)
  })

  it('F-03 changed on disk too: Go to tab, never a Save that overwrites', async () => {
    const user = userEvent.setup()
    guard.current = { ...guard.current, state: 'conflict' }
    render(<PreviewPausedBand filePath="/project/index.html" />)
    expect(screen.getByTestId(TEST_IDS.COMMENT_HOST_PAUSED)).toHaveAttribute('data-state', 'conflict')
    expect(screen.queryByRole('button', { name: 'Save index.html' })).toBeNull()
    screen.getByRole('button', { name: 'Go to tab' }).focus()
    await user.keyboard('{Enter}')
    expect(guard.current.goToTab).toHaveBeenCalledTimes(1)
  })
})
