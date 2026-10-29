// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The dirty-source guard behind the comment window's unsaved banner
 * (docs/designs/comments/html-preview-comments.md §7.8, decision 13; R-007, R-024).
 */
import { act, renderHook } from '@testing-library/react'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { editorSaveRegistry } from '../services/editorSaveRegistry'
import { useProjectStore } from '../stores/useProjectStore'
import { useCommentDirtyGuard } from './useCommentDirtyGuard'

const FILE = '/project/index.html'

/** Go to tab focuses a frame and one task later: wait past both. */
const afterFocusMove = (): Promise<void> =>
  new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))

function fakePanel(id: string, filePath: string, component = 'editor') {
  return {
    id,
    params: { filePath },
    view: { contentComponent: component },
    api: { setActive: vi.fn() },
    group: { focus: vi.fn(), element: document.createElement('div') }
  }
}

describe('useCommentDirtyGuard', () => {
  const editor = fakePanel('editor-index', FILE)
  const other = fakePanel('editor-about', '/project/about.html')
  const preview = fakePanel('preview-index', FILE, 'htmlPreview')
  const panels = [editor, other, preview]
  const api = {
    panels,
    getPanel: (id: string) => panels.find(p => p.id === id)
  } as unknown as DockviewApi
  let conflict = false
  const save = vi.fn(async () => true)
  const release = vi.fn()
  const holdAutosave = vi.fn(() => release)
  let unregister: () => void

  beforeEach(() => {
    conflict = false
    unregister = editorSaveRegistry.register(editor.id, {
      save,
      hasConflict: () => conflict,
      holdAutosave
    })
    useProjectStore.setState({ dockviewApi: api, dirtyPanelIds: new Set() })
  })
  afterEach(() => {
    unregister()
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
    vi.clearAllMocks()
  })

  it('is clean with no dirty tab for the file', () => {
    useProjectStore.setState({ dirtyPanelIds: new Set([other.id]) })
    const { result } = renderHook(() => useCommentDirtyGuard(FILE))
    expect(result.current.state).toBe('clean')
    expect(result.current.justSaved).toBe(false)
  })

  it('is clean without a dockview or a file', () => {
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set([editor.id]) })
    expect(renderHook(() => useCommentDirtyGuard(FILE)).result.current.state).toBe('clean')
    useProjectStore.setState({ dockviewApi: api })
    expect(renderHook(() => useCommentDirtyGuard(null)).result.current.state).toBe('clean')
  })

  it('R-007 reports dirty, goes to the tab, saves it, then clears with "just saved"', async () => {
    useProjectStore.setState({ dirtyPanelIds: new Set([editor.id]) })
    const { result } = renderHook(() => useCommentDirtyGuard(FILE))
    expect(result.current.state).toBe('dirty')
    act(() => result.current.goToTab())
    expect(editor.api.setActive).toHaveBeenCalled()
    // The focus waits a frame for a closing comment window to unmount.
    await act(afterFocusMove)
    expect(editor.group.focus).toHaveBeenCalled()
    await act(async () => {
      await expect(result.current.save()).resolves.toBe(true)
    })
    expect(save).toHaveBeenCalled()
    act(() => useProjectStore.setState({ dirtyPanelIds: new Set() }))
    expect(result.current.state).toBe('clean')
    expect(result.current.justSaved).toBe(true)
    expect(result.current.cleared).toBe('saved')
  })

  it('H2 Go to tab focuses the editor input itself when the tab has one', async () => {
    const input = document.createElement('textarea')
    const monaco = document.createElement('div')
    monaco.className = 'monaco-editor'
    monaco.appendChild(input)
    editor.group.element.appendChild(monaco)
    document.body.appendChild(editor.group.element)
    useProjectStore.setState({ dirtyPanelIds: new Set([editor.id]) })
    const { result } = renderHook(() => useCommentDirtyGuard(FILE))
    act(() => result.current.goToTab())
    await act(afterFocusMove)
    expect(document.activeElement).toBe(input)
    expect(editor.group.focus).not.toHaveBeenCalled()
    editor.group.element.remove()
    monaco.remove()
  })

  it('L11 a tab that turns clean without our save reports "clean", not "saved"', async () => {
    useProjectStore.setState({ dirtyPanelIds: new Set([editor.id]) })
    const { result } = renderHook(() => useCommentDirtyGuard(FILE))
    expect(result.current.cleared).toBeNull()
    act(() => useProjectStore.setState({ dirtyPanelIds: new Set() }))
    expect(result.current.cleared).toBe('clean')
  })

  it('a save of ours that does not land does not count as saved', async () => {
    save.mockResolvedValueOnce(false)
    useProjectStore.setState({ dirtyPanelIds: new Set([editor.id]) })
    const { result } = renderHook(() => useCommentDirtyGuard(FILE))
    await act(async () => {
      await expect(result.current.save()).resolves.toBe(false)
    })
    act(() => useProjectStore.setState({ dirtyPanelIds: new Set() }))
    expect(result.current.cleared).toBe('clean')
  })

  it('R-024 a tab in the changed-on-disk conflict is "conflict" and is never saved from here', async () => {
    conflict = true
    useProjectStore.setState({ dirtyPanelIds: new Set([editor.id]) })
    const { result } = renderHook(() => useCommentDirtyGuard(FILE))
    expect(result.current.state).toBe('conflict')
    await expect(result.current.save()).resolves.toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('Go to tab does nothing when the dirty tab has gone from the layout', () => {
    useProjectStore.setState({
      dockviewApi: { panels, getPanel: () => undefined } as unknown as DockviewApi,
      dirtyPanelIds: new Set([editor.id])
    })
    const { result } = renderHook(() => useCommentDirtyGuard(FILE))
    expect(result.current.state).toBe('dirty')
    act(() => result.current.goToTab())
    expect(editor.api.setActive).not.toHaveBeenCalled()
  })

  it('save and Go to tab do nothing when clean', async () => {
    const { result } = renderHook(() => useCommentDirtyGuard(FILE))
    await expect(result.current.save()).resolves.toBe(false)
    act(() => result.current.goToTab())
    expect(editor.api.setActive).not.toHaveBeenCalled()
  })

  it('holds every tab of the file for the write and releases them together', () => {
    const { result } = renderHook(() => useCommentDirtyGuard(FILE))
    const done = result.current.holdForWrite()
    expect(holdAutosave).toHaveBeenCalledTimes(1)
    done()
    expect(release).toHaveBeenCalledTimes(1)
  })
})
