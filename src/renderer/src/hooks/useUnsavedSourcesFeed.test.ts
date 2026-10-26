// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The unsaved-HTML-sources feed to main (docs/designs/html-preview-comments.md
 * §7.8, decision 13; R-007).
 */
import { act, renderHook } from '@testing-library/react'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COMMENT_UNSAVED_SOURCES_MAX } from '../../../shared/ipc/preview-comment-schema'
import {
  installCommentsBridge,
  type FakeCommentsBridge
} from '../components/Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { useProjectStore } from '../stores/useProjectStore'
import { unsavedHtmlSources, useUnsavedSourcesFeed } from './useUnsavedSourcesFeed'

const panelsBy = (entries: Record<string, unknown>) =>
  ({ getPanel: (id: string) => (id in entries ? { params: entries[id] } : undefined) }) as Pick<
    DockviewApi,
    'getPanel'
  >

describe('unsavedHtmlSources', () => {
  it('lists the dirty HTML files once each, sorted', () => {
    const api = panelsBy({
      a: { filePath: '/p/b.html' },
      b: { filePath: '/p/a.htm' },
      c: { filePath: '/p/b.html' },
      d: { filePath: '/p/notes.md' },
      e: {},
      f: { filePath: `/p/${'x'.repeat(5000)}.html` }
    })
    expect(unsavedHtmlSources(api, new Set(['a', 'b', 'c', 'd', 'e', 'f', 'gone']))).toEqual([
      '/p/a.htm',
      '/p/b.html'
    ])
  })

  it('is empty without a dockview', () => {
    expect(unsavedHtmlSources(null, new Set(['a']))).toEqual([])
  })

  it('caps the list at the schema maximum', () => {
    const entries: Record<string, unknown> = {}
    for (let i = 0; i < COMMENT_UNSAVED_SOURCES_MAX + 5; i += 1)
      entries[`p${i}`] = { filePath: `/p/${i}.html` }
    expect(unsavedHtmlSources(panelsBy(entries), new Set(Object.keys(entries)))).toHaveLength(
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
        e2: { filePath: '/p/x.md' }
      }) as DockviewApi,
      dirtyPanelIds: new Set()
    })
  })
  afterEach(() => {
    fake.uninstall()
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
  })

  it('sends the list on mount and on every change, never the same list twice', () => {
    renderHook(() => useUnsavedSourcesFeed())
    expect(fake.bridge.setUnsavedSources).toHaveBeenLastCalledWith([])
    act(() => useProjectStore.setState({ dirtyPanelIds: new Set(['e1']) }))
    expect(fake.bridge.setUnsavedSources).toHaveBeenLastCalledWith(['/p/index.html'])
    // A Markdown tab going dirty changes nothing main cares about.
    act(() => useProjectStore.setState({ dirtyPanelIds: new Set(['e1', 'e2']) }))
    expect(fake.bridge.setUnsavedSources).toHaveBeenCalledTimes(2)
    act(() => useProjectStore.setState({ dirtyPanelIds: new Set() }))
    expect(fake.bridge.setUnsavedSources).toHaveBeenLastCalledWith([])
    expect(fake.bridge.setUnsavedSources).toHaveBeenCalledTimes(3)
  })

  it('sends nothing without the comments bridge', () => {
    fake.uninstall()
    renderHook(() => useUnsavedSourcesFeed())
    expect(fake.bridge.setUnsavedSources).not.toHaveBeenCalled()
  })
})
