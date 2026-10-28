// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Settings → Comments (docs/designs/html-preview-comments.md §10.8; R-014).
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../../shared/ipc/global-settings-schema'
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { IDENTITY_COPY, SETTINGS_COPY } from '../../Panels/HtmlPreviewPanel/comments/commentCopy'
import { CommentsSection } from './CommentsSection'

const settingsWith = (comments: object, enabled = true): GlobalSettings =>
  ({ comments, htmlPreview: { comments: { enabled } } }) as unknown as GlobalSettings

describe('CommentsSection – R-014', () => {
  const updateCommentIdentity = vi.fn(async () => true)
  const updateHtmlPreviewCommentsEnabled = vi.fn(async () => {})
  beforeEach(() => {
    useGlobalSettingsStore.setState({
      settings: settingsWith({ authorName: 'Ada', identityNoticeSeen: true }),
      updateCommentIdentity,
      updateHtmlPreviewCommentsEnabled
    })
  })
  afterEach(() => {
    useGlobalSettingsStore.setState({ settings: null })
    vi.clearAllMocks()
  })

  const name = () => screen.getByTestId('settings-comment-name')
  const email = () => screen.getByTestId('settings-comment-email')

  it('shows the stored identity, the hints and the visibility notice', () => {
    render(<CommentsSection />)
    expect(screen.getByRole('region', { name: SETTINGS_COPY.title })).toBeVisible()
    expect(name()).toHaveValue('Ada')
    expect(email()).toHaveValue('')
    expect(screen.getByTestId('settings-comment-notice')).toHaveTextContent(SETTINGS_COPY.notice)
    expect(name()).toHaveAccessibleDescription(SETTINGS_COPY.nameHint)
  })

  it('saves the name on blur, trimmed, keeping the rest of the identity', async () => {
    const user = userEvent.setup()
    render(<CommentsSection />)
    await user.clear(name())
    await user.type(name(), '  Grace  ')
    expect(updateCommentIdentity).not.toHaveBeenCalled()
    await user.tab()
    expect(updateCommentIdentity).toHaveBeenCalledWith({
      authorName: 'Grace',
      identityNoticeSeen: true
    })
  })

  it('does not write an unchanged name', async () => {
    const user = userEvent.setup()
    render(<CommentsSection />)
    await user.click(name())
    await user.tab()
    expect(updateCommentIdentity).not.toHaveBeenCalled()
  })

  it('clears the name when emptied, and says what that means', async () => {
    const user = userEvent.setup()
    render(<CommentsSection />)
    await user.clear(name())
    expect(screen.getByText(SETTINGS_COPY.nameEmpty)).toBeVisible()
    await user.tab()
    expect(updateCommentIdentity).toHaveBeenCalledWith({
      authorName: undefined,
      identityNoticeSeen: true
    })
  })

  it('refuses a name with a direction override and does not save it', async () => {
    const user = userEvent.setup()
    render(<CommentsSection />)
    await user.clear(name())
    await user.type(name(), `Eve${String.fromCodePoint(0x202e)}`)
    await user.tab()
    expect(name()).toHaveAccessibleDescription(expect.stringContaining(IDENTITY_COPY.nameControl))
    expect(updateCommentIdentity).not.toHaveBeenCalled()
    // L12: said out loud too – focus has already left the field.
    await waitFor(() =>
      expect(screen.getByTestId('settings-comment-alert')).toHaveTextContent(
        IDENTITY_COPY.nameControl
      )
    )
    await user.type(name(), 'x')
    expect(name()).not.toHaveAccessibleDescription(
      expect.stringContaining(IDENTITY_COPY.nameControl)
    )
  })

  it('L12 says so under the field and out loud when the settings write fails', async () => {
    updateCommentIdentity.mockResolvedValueOnce(false)
    const user = userEvent.setup()
    render(<CommentsSection />)
    await user.clear(name())
    await user.type(name(), 'Grace')
    await user.tab()
    await waitFor(() =>
      expect(name()).toHaveAccessibleDescription(expect.stringContaining(SETTINGS_COPY.saveFailed))
    )
    await waitFor(() =>
      expect(screen.getByTestId('settings-comment-alert')).toHaveTextContent(
        SETTINGS_COPY.saveFailed
      )
    )
    expect(name()).toHaveValue('Grace')
  })

  it('validates and saves the email on blur, and clears it when emptied', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CommentsSection />)
    await user.type(email(), 'nope')
    await user.tab()
    expect(email()).toHaveAccessibleDescription(expect.stringContaining(IDENTITY_COPY.emailInvalid))
    expect(updateCommentIdentity).not.toHaveBeenCalled()
    await user.clear(email())
    await user.type(email(), ' ada@example.com ')
    await user.tab()
    expect(updateCommentIdentity).toHaveBeenCalledWith({
      authorName: 'Ada',
      identityNoticeSeen: true,
      authorEmail: 'ada@example.com'
    })

    act(() =>
      useGlobalSettingsStore.setState({
        settings: settingsWith({
          authorName: 'Ada',
          authorEmail: 'ada@example.com',
          identityNoticeSeen: true
        })
      })
    )
    rerender(<CommentsSection />)
    expect(email()).toHaveValue('ada@example.com')
    await user.clear(email())
    await user.tab()
    expect(updateCommentIdentity).toHaveBeenLastCalledWith({
      authorName: 'Ada',
      authorEmail: undefined,
      identityNoticeSeen: true
    })
  })

  it('follows an identity changed elsewhere (the comment window)', () => {
    render(<CommentsSection />)
    act(() =>
      useGlobalSettingsStore.setState({
        settings: settingsWith({ authorName: 'Bo', identityNoticeSeen: true })
      })
    )
    expect(name()).toHaveValue('Bo')
  })

  it('switches the feature flag and disables the fields when off', async () => {
    const user = userEvent.setup()
    render(<CommentsSection />)
    const flag = screen.getByTestId('settings-toggle-html-comments')
    expect(flag).toBeChecked()
    expect(flag).toHaveAccessibleName(SETTINGS_COPY.flagLabel)
    await user.click(flag)
    expect(updateHtmlPreviewCommentsEnabled).toHaveBeenCalledWith(false)
    act(() =>
      useGlobalSettingsStore.setState({
        settings: settingsWith({ authorName: 'Ada', identityNoticeSeen: true }, false)
      })
    )
    expect(flag).not.toBeChecked()
    expect(name()).toBeDisabled()
    expect(email()).toBeDisabled()
    // The label and hint dim with the field (a class, not `:has()`).
    expect(name().closest('.erf-comment-field')).toHaveClass('erf-comment-field--disabled')
  })

  it('is inert before settings load', () => {
    useGlobalSettingsStore.setState({ settings: null })
    render(<CommentsSection />)
    expect(screen.getByTestId('settings-toggle-html-comments')).toBeDisabled()
    expect(name()).toBeDisabled()
  })
})
