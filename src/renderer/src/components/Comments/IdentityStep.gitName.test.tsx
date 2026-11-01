// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** P-F33: the identity step suggests the name git knows; it changes nothing else about the step. */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDENTITY_COPY } from './commentCopy'
import { IdentityStep } from './IdentityStep'
import { TEST_IDS } from '../../constants/testids'

const gitName = vi.hoisted(() => vi.fn())
vi.mock('../../services/comments/fileCommentGateway', () => ({ fileCommentGateway: { gitName } }))

const field = (id: string): HTMLInputElement => screen.getByTestId<HTMLInputElement>(id).closest('input') ?? screen.getByTestId<HTMLInputElement>(id)
const nameField = (): HTMLInputElement => field(TEST_IDS.COMMENT_IDENTITY_NAME)
const onSubmit = vi.fn(async () => true)

function draw(initialName = ''): void {
  render(<IdentityStep initialName={initialName} initialEmail="" noticeId="notice" onSubmit={onSubmit} onCancel={() => {}} />)
}

beforeEach(() => {
  gitName.mockReset()
  onSubmit.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe('IdentityStep – the git name', () => {
  it('P-F33 fills an empty name, stores nothing until Continue, and leaves the e-mail empty', async () => {
    gitName.mockResolvedValue({ ok: true, name: 'Grace Hopper' })
    draw()
    await waitFor(() => expect(nameField().value).toBe('Grace Hopper'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(field(TEST_IDS.COMMENT_IDENTITY_EMAIL).value).toBe('')
    await userEvent.setup().click(screen.getByTestId(TEST_IDS.COMMENT_IDENTITY_CONTINUE))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Grace Hopper', email: '' })
  })

  it('P-F33 the privacy notice is unchanged', async () => {
    gitName.mockResolvedValue({ ok: true, name: 'Grace Hopper' })
    draw()
    await waitFor(() => expect(nameField().value).toBe('Grace Hopper'))
    expect(screen.getByText(IDENTITY_COPY.notice)).toHaveAttribute('id', 'notice')
  })

  it('P-F33 a name already in Settings is kept, and git is not asked', () => {
    draw('Ada')
    expect(nameField().value).toBe('Ada')
    expect(gitName).not.toHaveBeenCalled()
  })

  it('P-F33 what the person typed first stays', async () => {
    let answer: (value: unknown) => void = () => {}
    gitName.mockReturnValue(new Promise(resolve => (answer = resolve)))
    draw()
    await userEvent.setup().type(nameField(), 'Ada')
    await act(async () => answer({ ok: true, name: 'Grace Hopper' }))
    expect(nameField().value).toBe('Ada')
  })

  it('P-F33 no git name leaves the field empty, as before', async () => {
    gitName.mockResolvedValue({ ok: true })
    draw()
    await act(async () => {})
    expect(nameField().value).toBe('')
  })
})
