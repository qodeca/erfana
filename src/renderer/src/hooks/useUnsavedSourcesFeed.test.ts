// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The unsaved-sources feed to main (docs/designs/comments/html-preview-comments.md
 * §7.8, decision 13; R-007), widened to every commentable file and gated on
 * either preview's comments being on (spec 024 024-FR-026, § 8 C6).
 */
import { act, renderHook } from '@testing-library/react'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { COMMENT_UNSAVED_SOURCES_MAX } from '../../../shared/ipc/preview-comment-schema'
import {
  installCommentsBridge,
  type FakeCommentsBridge
} from '../components/Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { useGlobalSettingsStore } from '../stores/useGlobalSettingsStore'
import { useProjectStore } from '../stores/useProjectStore'
import { getDefaultGlobalSettings } from '../../../shared/ipc/global-settings-schema'
import {
  UNSAVED_SOURCES_ATTEMPTS,
  UNSAVED_SOURCES_RETRY_MS,
  unsavedCommentSources,
  useUnsavedSourcesFeed
} from './useUnsavedSourcesFeed'

const panelsBy = (entries: Record<string, unknown>) =>
  ({ getPanel: (id: string) => (id in entries ? { params: entries[id] } : undefined) }) as Pick<
    DockviewApi,
    'getPanel'
  >

describe('unsavedCommentSources', () => {
  it('lists the dirty commentable files once each, sorted: HTML and Markdown (024-FR-026)', () => {
    const api = panelsBy({
      a: { filePath: '/p/b.html' },
      b: { filePath: '/p/a.htm' },
      c: { filePath: '/p/b.html' },
      d: { filePath: '/p/notes.md' },
      e: {},
      f: { filePath: `/p/${'x'.repeat(5000)}.html` },
      g: { filePath: '/p/plan.MARKDOWN' },
      h: { filePath: '/p/notes.txt' }
    })
    expect(unsavedCommentSources(api, new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'gone']))).toEqual([
      '/p/a.htm',
      '/p/b.html',
      '/p/notes.md',
      '/p/plan.MARKDOWN'
    ])
  })

  it('is empty without a dockview', () => {
    expect(unsavedCommentSources(null, new Set(['a']))).toEqual([])
  })

  it('caps the list at the schema maximum', () => {
    const entries: Record<string, unknown> = {}
    for (let i = 0; i < COMMENT_UNSAVED_SOURCES_MAX + 5; i += 1)
      entries[`p${i}`] = { filePath: `/p/${i}.html` }
    expect(unsavedCommentSources(panelsBy(entries), new Set(Object.keys(entries)))).toHaveLength(
      COMMENT_UNSAVED_SOURCES_MAX
    )
  })
})

describe('useUnsavedSourcesFeed', () => {
  let fake: FakeCommentsBridge
  beforeEach(() => {
    fake = installCommentsBridge()
    useProjectStore.setState({
      dockviewApi: panelsBy({
        e1: { filePath: '/p/index.html' },
        e2: { filePath: '/p/x.txt' }
      }) as DockviewApi,
      dirtyPanelIds: new Set()
    })
  })
  afterEach(() => {
    fake.uninstall()
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
    vi.useRealTimers()
  })

  it('sends the list on mount and on every change, never the same list twice', () => {
    renderHook(() => useUnsavedSourcesFeed())
    expect(fake.bridge.setUnsavedSources).toHaveBeenLastCalledWith([])
    act(() => useProjectStore.setState({ dirtyPanelIds: new Set(['e1']) }))
    expect(fake.bridge.setUnsavedSources).toHaveBeenLastCalledWith(['/p/index.html'])
    // A tab of a file no preview comments on changes nothing main cares about.
    act(() => useProjectStore.setState({ dirtyPanelIds: new Set(['e1', 'e2']) }))
    expect(fake.bridge.setUnsavedSources).toHaveBeenCalledTimes(2)
    act(() => useProjectStore.setState({ dirtyPanelIds: new Set() }))
    expect(fake.bridge.setUnsavedSources).toHaveBeenLastCalledWith([])
    expect(fake.bridge.setUnsavedSources).toHaveBeenCalledTimes(3)
  })

  describe('L4 a list main did not take is not "sent"', () => {
    const REFUSED = { ok: false as const, code: ErrorCode.UNKNOWN_ERROR }
    beforeEach(() => {
      vi.useFakeTimers()
    })
    const wait = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms))

    it('goes again a moment later, gives up after the last try, and goes again on the next change', async () => {
      fake.bridge.setUnsavedSources.mockResolvedValue(REFUSED)
      renderHook(() => useUnsavedSourcesFeed())
      for (let tries = 1; tries < UNSAVED_SOURCES_ATTEMPTS; tries += 1) {
        await wait(UNSAVED_SOURCES_RETRY_MS)
      }
      expect(fake.bridge.setUnsavedSources).toHaveBeenCalledTimes(UNSAVED_SOURCES_ATTEMPTS)
      await wait(UNSAVED_SOURCES_RETRY_MS * 5)
      expect(fake.bridge.setUnsavedSources).toHaveBeenCalledTimes(UNSAVED_SOURCES_ATTEMPTS)
      // A change that leaves the same list still sends it: main never had it.
      fake.bridge.setUnsavedSources.mockResolvedValue({ ok: true })
      await act(async () => useProjectStore.setState({ dirtyPanelIds: new Set(['e2']) }))
      expect(fake.bridge.setUnsavedSources).toHaveBeenCalledTimes(UNSAVED_SOURCES_ATTEMPTS + 1)
      expect(fake.bridge.setUnsavedSources).toHaveBeenLastCalledWith([])
      // Taken now: the same list is not sent again.
      await act(async () => useProjectStore.setState({ dirtyPanelIds: new Set() }))
      await wait(UNSAVED_SOURCES_RETRY_MS * 5)
      expect(fake.bridge.setUnsavedSources).toHaveBeenCalledTimes(UNSAVED_SOURCES_ATTEMPTS + 1)
    })

    it('a newer list supersedes the retries of an older one', async () => {
      fake.bridge.setUnsavedSources.mockResolvedValueOnce(REFUSED)
      renderHook(() => useUnsavedSourcesFeed())
      await act(async () => useProjectStore.setState({ dirtyPanelIds: new Set(['e1']) }))
      await wait(UNSAVED_SOURCES_RETRY_MS * 5)
      expect(fake.bridge.setUnsavedSources.mock.calls).toEqual([[[]], [['/p/index.html']]])
    })

    it('an unmounted feed sends nothing more', async () => {
      fake.bridge.setUnsavedSources.mockResolvedValue(REFUSED)
      const { unmount } = renderHook(() => useUnsavedSourcesFeed())
      await act(async () => {})
      unmount()
      await wait(UNSAVED_SOURCES_RETRY_MS * 5)
      expect(fake.bridge.setUnsavedSources).toHaveBeenCalledTimes(1)
    })
  })

  describe('024-FR-026 runs while either preview comments are on', () => {
    const withComments = (html: boolean, markdown: boolean): void => {
      const defaults = getDefaultGlobalSettings()
      useGlobalSettingsStore.setState({
        settings: {
          ...defaults,
          htmlPreview: { ...defaults.htmlPreview, comments: { enabled: html } },
          markdownPreview: { comments: { enabled: markdown } }
        }
      })
    }
    afterEach(() => useGlobalSettingsStore.setState({ settings: null }))

    it('reports with only Markdown comments on', () => {
      withComments(false, true)
      useProjectStore.setState({ dirtyPanelIds: new Set(['e1']) })
      renderHook(() => useUnsavedSourcesFeed())
      expect(fake.bridge.setUnsavedSources).toHaveBeenLastCalledWith(['/p/index.html'])
    })

    it('sends nothing with both off, and the current list once one is turned on', () => {
      withComments(false, false)
      useProjectStore.setState({ dirtyPanelIds: new Set(['e1']) })
      renderHook(() => useUnsavedSourcesFeed())
      expect(fake.bridge.setUnsavedSources).not.toHaveBeenCalled()
      act(() => withComments(true, false))
      expect(fake.bridge.setUnsavedSources).toHaveBeenLastCalledWith(['/p/index.html'])
    })
  })

  it('sends nothing without the comments bridge', () => {
    fake.uninstall()
    renderHook(() => useUnsavedSourcesFeed())
    expect(fake.bridge.setUnsavedSources).not.toHaveBeenCalled()
  })
})
