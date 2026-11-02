// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `useMarkdownComments` – what one editor panel's comments cost and leave
 * behind (spec 024 024-NFR-001, 024-NFR-008; review findings M2, L1, L3):
 *
 * - a closed panel tells main to forget it (`file-comment:release`), so its
 *   record and file watch do not hold the 64-watch budget until the window
 *   closes;
 * - the preview's scroller is found after the commit, never by a DOM query
 *   while React renders;
 * - the UTF-8 count of the editor's text runs only while that text is sent
 *   (comments on and paused), never per keystroke otherwise.
 *
 * `encoding` is wrapped only to count `utf8Length` calls.
 */
import { act, render, waitFor } from '@testing-library/react'
import type { DockviewApi } from 'dockview'
import { useInsertionEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { utf8Length } from '../../../../../shared/comments/encoding'
import { editorSaveRegistry } from '../../../services/editorSaveRegistry'
import { useProjectStore } from '../../../stores/useProjectStore'
import { DialogProvider } from '../../Dialog'
import { ToastProvider } from '../../Toast/ToastContext'
import { MarkdownPreview } from '../MarkdownPreview'
import { useMarkdownComments } from './useMarkdownComments'
import { FILE_PATH, Harness, PANEL_ID, fileView, installApi, resetStores, setSettings, type FileCommentsMock } from './__test-utils__/harness'

vi.mock('../../../../../shared/comments/encoding', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../../shared/comments/encoding')>()
  return { ...actual, utf8Length: vi.fn(actual.utf8Length) }
})

const DOC = ['# Plan', '', 'Ship the first slice.', ''].join('\n')
const SCROLLER = ':scope > .markdown-preview'

/** Where React is when `querySelector` runs: set to `render` by the test right before a render, to `commit` by a child's insertion effect. */
let phase: 'render' | 'commit' = 'commit'

/** A child: its insertion effect runs once the whole tree has rendered, before any ref is attached or layout effect runs. */
function CommitMarker(): null {
  useInsertionEffect(() => {
    phase = 'commit'
  })
  return null
}

/** The harness's panel with a commit marker inside it. */
function Probe({ content }: { readonly content: string }): React.JSX.Element {
  const [editorRef] = useState(() => ({ current: null }))
  const comments = useMarkdownComments({
    panelId: PANEL_ID,
    filePath: FILE_PATH,
    content,
    viewMode: 'preview',
    setViewMode: () => {},
    editorRef,
    isActivePanel: true,
    isVisible: true
  })
  return (
    <ToastProvider>
      <DialogProvider>
        <div className="preview-pane">
          <MarkdownPreview content={content} filePath={FILE_PATH} />
          {comments.overlay}
        </div>
        <CommitMarker />
      </DialogProvider>
    </ToastProvider>
  )
}

/** Mark the panel's file dirty in the dockview the guard reads, so comments pause and the buffer is sent. */
function dirtyPanel(): () => void {
  const panel = { id: PANEL_ID, params: { filePath: FILE_PATH }, view: { contentComponent: 'editor' }, api: { setActive: vi.fn() } }
  const unregister = editorSaveRegistry.register(PANEL_ID, { save: vi.fn(async () => true), hasConflict: () => false, holdAutosave: vi.fn(() => () => {}) })
  useProjectStore.setState({
    dockviewApi: { panels: [panel], getPanel: (id: string) => (id === PANEL_ID ? panel : undefined) } as unknown as DockviewApi,
    dirtyPanelIds: new Set([PANEL_ID])
  })
  return unregister
}

describe('useMarkdownComments – release, render purity and the buffer count', () => {
  let api: FileCommentsMock

  beforeEach(() => {
    Element.prototype.scrollIntoView ??= vi.fn()
    resetStores()
    api = installApi(fileView())
    setSettings()
    vi.mocked(utf8Length).mockClear()
  })
  afterEach(() => {
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
    vi.restoreAllMocks()
  })

  it('024-AC-036 a closed panel asks main to forget it and its watch, once, by panel id only', async () => {
    const view = render(<Harness content={DOC} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    expect(api.release).not.toHaveBeenCalled()
    view.unmount()
    expect(api.release).toHaveBeenCalledTimes(1)
    expect(api.release).toHaveBeenCalledWith({ panelId: PANEL_ID })
  })

  it('024-AC-036 a panel with comments off releases too: main may still hold its record from before the switch', async () => {
    setSettings(undefined, false)
    const view = render(<Harness content={DOC} />)
    view.unmount()
    expect(api.release).toHaveBeenCalledWith({ panelId: PANEL_ID })
  })

  it('024-AC-024 the scroller is found after the commit, never by a DOM query while the panel renders', async () => {
    const real = Element.prototype.querySelector
    const calls: string[] = []
    Element.prototype.querySelector = function (this: Element, selector: string) {
      if (selector === SCROLLER) calls.push(phase)
      return real.call(this, selector)
    } as typeof real
    try {
      phase = 'render'
      const view = render(<Probe content={DOC} />)
      await waitFor(() => expect(api.list).toHaveBeenCalled())
      act(() => {
        phase = 'render'
        view.rerender(<Probe content={`${DOC}More.\n`} />)
      })
      expect(calls).not.toContain('render')
      // Found – after a commit: the host listed with it shown, and the scroller is the one drawn.
      expect(calls).toContain('commit')
    } finally {
      Element.prototype.querySelector = real
      phase = 'commit'
    }
  })

  it('024-AC-024 typing with comments off, or on and not paused, never counts the buffer\'s UTF-8 bytes', async () => {
    setSettings(undefined, false)
    const view = render(<Harness content={DOC} />)
    view.rerender(<Harness content={`${DOC}a`} />)
    view.rerender(<Harness content={`${DOC}ab`} />)
    expect(utf8Length).not.toHaveBeenCalled()
    view.unmount()

    setSettings()
    const on = render(<Harness content={DOC} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    on.rerender(<Harness content={`${DOC}a`} />)
    on.rerender(<Harness content={`${DOC}ab`} />)
    expect(utf8Length).not.toHaveBeenCalled()
  })

  it('024-AC-016 paused, the buffer is counted and sent for display', async () => {
    const unregister = dirtyPanel()
    try {
      render(<Harness content={DOC} />)
      await waitFor(() => expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ bufferText: DOC })))
      expect(utf8Length).toHaveBeenCalledWith(DOC)
    } finally {
      unregister()
    }
  })
})
