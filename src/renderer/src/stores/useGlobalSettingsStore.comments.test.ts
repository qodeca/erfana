// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The two HTML Preview comments settings actions
 * (docs/designs/comments/html-preview-comments.md §10.8; R-014).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { globalSettings } from '../test-utils/globalSettings'
import { useGlobalSettingsStore } from './useGlobalSettingsStore'

const api = { get: vi.fn(), set: vi.fn(), reset: vi.fn(), onSettingsChanged: vi.fn() }

describe('useGlobalSettingsStore – comments (R-014)', () => {
  let before: unknown
  beforeEach(() => {
    const holder = window as unknown as { api?: Record<string, unknown> }
    before = holder.api
    holder.api = { ...(holder.api ?? {}), globalSettings: api }
    useGlobalSettingsStore.setState({ settings: globalSettings(), error: null })
  })
  afterEach(() => {
    ;(window as unknown as { api?: unknown }).api = before
    useGlobalSettingsStore.setState({ settings: null })
    vi.clearAllMocks()
  })

  it('persists the identity and reports it stored', async () => {
    api.set.mockResolvedValue({ success: true })
    const identity = { authorName: 'Ada', authorEmail: 'a@b.io', identityNoticeSeen: true }
    await expect(useGlobalSettingsStore.getState().updateCommentIdentity(identity)).resolves.toBe(
      true
    )
    expect(api.set).toHaveBeenCalledWith('comments', identity)
    expect(useGlobalSettingsStore.getState().settings?.comments).toEqual(identity)
  })

  it('reports a refused write after rolling it back', async () => {
    api.set.mockResolvedValue({ success: false, error: 'nope' })
    const before = useGlobalSettingsStore.getState().settings?.comments
    await expect(
      useGlobalSettingsStore
        .getState()
        .updateCommentIdentity({ authorName: 'Ada', identityNoticeSeen: true })
    ).resolves.toBe(false)
    expect(useGlobalSettingsStore.getState().settings?.comments).toEqual(before)
  })

  it('reports false before settings load', async () => {
    useGlobalSettingsStore.setState({ settings: null })
    await expect(
      useGlobalSettingsStore
        .getState()
        .updateCommentIdentity({ authorName: 'Ada', identityNoticeSeen: true })
    ).resolves.toBe(false)
  })

  it('persists the feature flag inside the htmlPreview section', async () => {
    api.set.mockResolvedValue({ success: true })
    await useGlobalSettingsStore.getState().updateHtmlPreviewCommentsEnabled(false)
    const [section, value] = api.set.mock.calls[0]
    expect(section).toBe('htmlPreview')
    expect(value.comments).toEqual({ enabled: false })
    expect(value.enabled).toBe(globalSettings().htmlPreview.enabled)
  })
})
