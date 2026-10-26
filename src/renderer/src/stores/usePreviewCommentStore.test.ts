// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import {
  fileView,
  thread
} from '../components/Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import {
  INITIAL_PANEL_COMMENT_STATE,
  commentDrafts,
  usePanelCommentState,
  usePreviewCommentStore
} from './usePreviewCommentStore'

const P = 'preview-a'
const get = () => usePreviewCommentStore.getState()
const entry = () => get().panels.get(P) ?? INITIAL_PANEL_COMMENT_STATE

describe('usePreviewCommentStore', () => {
  afterEach(() => {
    get().reset()
    commentDrafts.reset()
  })

  it('starts a tab with mode off and icons on', () => {
    expect(entry()).toEqual(INITIAL_PANEL_COMMENT_STATE)
    expect(INITIAL_PANEL_COMMENT_STATE).toMatchObject({ mode: false, showIcons: true })
  })

  it('patches one tab without touching another', () => {
    get().patch(P, { mode: true })
    get().patch('preview-b', { drawerOpen: true })
    expect(entry()).toMatchObject({ mode: true, drawerOpen: false })
    expect(get().panels.get('preview-b')).toMatchObject({ mode: false, drawerOpen: true })
  })

  it('applies counts and the unavailable reason from commentsChanged', () => {
    get().applyChanged({
      panelId: P,
      counts: { open: 2, resolved: 1, attention: 1 },
      unavailable: 'too-large'
    })
    expect(entry()).toMatchObject({
      counts: { open: 2, resolved: 1, attention: 1 },
      unavailable: 'too-large'
    })
    get().applyChanged({ panelId: P, counts: { open: 0, resolved: 0, attention: 0 } })
    expect(entry().unavailable).toBeNull()
  })

  describe('R-015 store ignores stale responses', () => {
    it('stores only the answer to the newest request', () => {
      const first = get().beginList(P)
      const second = get().beginList(P)
      expect(
        get().finishList(P, second, { ok: true, files: [fileView({ threads: [thread(2)] })] })
      ).toBe(true)
      // The slow first answer lands last and must not put old threads back.
      expect(
        get().finishList(P, first, { ok: true, files: [fileView({ threads: [thread(1)] })] })
      ).toBe(false)
      expect(entry().list.files[0].threads.map(t => t.threadKey)).toEqual(['t2'])
    })

    it('keeps ready threads on screen while a refresh is in flight', () => {
      const g = get().beginList(P)
      expect(entry().list.status).toBe('loading')
      get().finishList(P, g, { ok: true, files: [fileView()] })
      get().beginList(P)
      expect(entry().list.status).toBe('ready')
    })

    it('records an error and keeps the last files', () => {
      const g1 = get().beginList(P)
      get().finishList(P, g1, { ok: true, files: [fileView()] })
      const g2 = get().beginList(P)
      get().finishList(P, g2, { ok: false, code: ErrorCode.UNKNOWN_ERROR })
      expect(entry().list).toMatchObject({ status: 'error', code: ErrorCode.UNKNOWN_ERROR })
      expect(entry().list.files).toHaveLength(1)
    })

    it('takes the unavailable reason from a list answer', () => {
      const g = get().beginList(P)
      get().finishList(P, g, { ok: true, files: [], unavailable: 'encoding' })
      expect(entry().unavailable).toBe('encoding')
    })
  })

  it('R-023 keeps the mode across a page change of the same tab', () => {
    get().patch(P, { mode: true })
    // A save reload or a same-tab move changes nothing in the store: the
    // entry is keyed by the panel id, which outlives the page.
    get().applyChanged({ panelId: P, counts: { open: 1, resolved: 0, attention: 0 } })
    expect(entry().mode).toBe(true)
  })

  it('drops a tab', () => {
    get().patch(P, { mode: true })
    get().drop(P)
    expect(get().panels.has(P)).toBe(false)
    get().drop(P)
    expect(get().panels.size).toBe(0)
  })

  it('returns the stable initial state from the hook for an unknown tab', () => {
    const { result } = renderHook(() => usePanelCommentState('nope'))
    expect(result.current).toBe(INITIAL_PANEL_COMMENT_STATE)
    act(() => get().patch('nope', { mode: true }))
    expect(result.current.mode).toBe(true)
  })

  it('keeps typed drafts per key for the session', () => {
    expect(commentDrafts.get('k')).toBe('')
    commentDrafts.set('k', 'Bigger')
    expect(commentDrafts.get('k')).toBe('Bigger')
    commentDrafts.set('k', '')
    expect(commentDrafts.get('k')).toBe('')
    commentDrafts.set('k', 'x')
    commentDrafts.clear('k')
    expect(commentDrafts.get('k')).toBe('')
  })
})
