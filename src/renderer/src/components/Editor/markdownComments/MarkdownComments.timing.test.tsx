// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Preview comments – the large-file timing's renderer side (spec 024
 * 024-NFR-001, 024-AC-024): the comment read starts with the file's load, in
 * parallel with the preview's render, and the `performance.mark` points the
 * e2e timing test reads.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_IDS } from '../../../constants/testids'
import { usePreviewCommentStore } from '../../../stores/usePreviewCommentStore'
import { DialogProvider } from '../../Dialog'
import { ToastProvider } from '../../Toast/ToastContext'
import { COMMENT_TIMING_MARKS, resetCommentTiming } from '../../Comments/overlay/commentTiming'
import { MarkdownPreview } from '../MarkdownPreview'
import type { ViewMode } from '../MarkdownEditorPanel/types'
import { useMarkdownComments } from './useMarkdownComments'
import { FILE_PATH, PANEL_ID, fileView, installApi, resetStores, setSettings, thread, type FileCommentsMock } from './__test-utils__/harness'

const DOC = ['# Plan', '', 'First paragraph.', '', '- one', '- two', ''].join('\n')

/** The panel's load, reduced: `load` is what `MarkdownEditorPanel`'s `onLoaded` does. */
function LoadingPanel({ mode, onLoad }: { mode: ViewMode; onLoad: (load: () => void) => void }): React.JSX.Element {
  const [file, setFile] = useState<{ path: string; content: string } | null>(null)
  const [editorRef] = useState(() => ({ current: null }))
  const comments = useMarkdownComments({
    panelId: PANEL_ID,
    filePath: file?.path,
    content: file?.content ?? '',
    viewMode: mode,
    setViewMode: () => {},
    editorRef,
    isActivePanel: true,
    isVisible: true
  })
  onLoad(() => {
    comments.prefetch(FILE_PATH, mode)
    setFile({ path: FILE_PATH, content: DOC })
  })
  return (
    <ToastProvider>
      <DialogProvider>
        <div role="toolbar" aria-label="Markdown formatting">
          {comments.tools}
        </div>
        {file !== null && (
          <div className="preview-pane">
            <MarkdownPreview content={file.content} filePath={file.path} />
            {mode === 'preview' && comments.overlay}
          </div>
        )}
      </DialogProvider>
    </ToastProvider>
  )
}

function renderLoading(mode: ViewMode = 'preview') {
  let load: () => void = () => {}
  const view = render(<LoadingPanel mode={mode} onLoad={next => (load = next)} />)
  return { ...view, load: () => act(() => load()) }
}

const marks = (name: string): PerformanceEntryList => performance.getEntriesByName(name, 'mark')

describe('Markdown Preview comments – large-file timing (024-NFR-001)', () => {
  let api: FileCommentsMock

  beforeEach(() => {
    resetStores()
    resetCommentTiming()
    performance.clearMarks()
    api = installApi(fileView([thread('t1', 3, 'p')]), [{ threadKey: 't1', line: 3, tag: 'p' }])
    setSettings()
    // jsdom has no layout: give every box a size so the icon has room.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    performance.clearMarks()
  })

  it('024-NFR-001: the comment read starts with the load, before the preview renders, and is asked once', async () => {
    let answer: (value: unknown) => void = () => {}
    let askedAt = Number.NaN
    api.list.mockImplementation(() => {
      askedAt = performance.now()
      return new Promise(resolve => (answer = resolve))
    })
    const panel = renderLoading()
    panel.load()
    expect(api.list).toHaveBeenCalledTimes(1)
    expect(api.list).toHaveBeenCalledWith({ panelId: PANEL_ID, filePath: FILE_PATH })
    expect(marks(COMMENT_TIMING_MARKS.previewRendered)).toHaveLength(1)
    expect(screen.queryByTestId(TEST_IDS.COMMENT_HOST_ICON)).toBeNull()
    await act(async () => answer({ ok: true, file: fileView([thread('t1', 3, 'p')]), placements: [{ threadKey: 't1', line: 3, tag: 'p' }] }))
    expect(await screen.findByTestId(TEST_IDS.COMMENT_HOST_ICON)).toBeInTheDocument()
    // The host took the early answer: main was not asked a second time.
    expect(api.list).toHaveBeenCalledTimes(1)
    const [rendered] = marks(COMMENT_TIMING_MARKS.previewRendered)
    const [pins] = marks(COMMENT_TIMING_MARKS.pinsVisible)
    // Asked before the preview finished rendering: the read ran while it rendered.
    expect(askedAt).toBeLessThanOrEqual(rendered.startTime)
    expect(pins.startTime).toBeGreaterThanOrEqual(rendered.startTime)
  })

  it('024-NFR-001: "Reading comments…" shows in the drawer while the early read is in flight', async () => {
    const user = userEvent.setup()
    let answer: (value: unknown) => void = () => {}
    api.list.mockImplementation(() => new Promise(resolve => (answer = resolve)))
    const panel = renderLoading()
    panel.load()
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
    expect(await screen.findByText('Reading comments…')).toBeVisible()
    await act(async () => answer({ ok: true, file: fileView([thread('t1', 3, 'p')]), placements: [{ threadKey: 't1', line: 3, tag: 'p' }] }))
    await waitFor(() => expect(screen.queryByText('Reading comments…')).toBeNull())
  })

  it('024-NFR-001: no early read for a view that does not list (the editor view)', () => {
    const panel = renderLoading('editor')
    panel.load()
    expect(api.list).not.toHaveBeenCalled()
  })

  it('024-NFR-001: no early read while "Comments in Markdown preview" is off', () => {
    setSettings(undefined, false)
    const panel = renderLoading()
    panel.load()
    expect(api.list).not.toHaveBeenCalled()
  })

  it('024-NFR-001: a file change after the file is shown reads again – the early answer is taken once only', async () => {
    const panel = renderLoading()
    panel.load()
    expect(await screen.findByTestId(TEST_IDS.COMMENT_HOST_ICON)).toBeInTheDocument()
    expect(api.list).toHaveBeenCalledTimes(1)
    act(() => api.emitChanged())
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  })

  it('024-NFR-001: a closed tab drops its list, so the same file opened again reads afresh', async () => {
    const panel = renderLoading()
    panel.load()
    expect(await screen.findByTestId(TEST_IDS.COMMENT_HOST_ICON)).toBeInTheDocument()
    expect(usePreviewCommentStore.getState().panels.get(PANEL_ID)?.list.status).toBe('ready')
    panel.unmount()
    expect(usePreviewCommentStore.getState().panels.has(PANEL_ID)).toBe(false)
  })

  it('024-AC-024: Save on a new comment marks save-start, and the new thread\'s drawn icon marks saved-visible', async () => {
    const user = userEvent.setup()
    const panel = renderLoading()
    panel.load()
    expect(await screen.findByTestId(TEST_IDS.COMMENT_HOST_ICON)).toBeInTheDocument()
    // Main now lists the new thread too.
    api.list.mockResolvedValue({
      ok: true,
      file: fileView([thread('t1', 3, 'p'), thread('new-thread', 5, 'li')]),
      placements: [
        { threadKey: 't1', line: 3, tag: 'p' },
        { threadKey: 'new-thread', line: 5, tag: 'li' }
      ]
    })
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE))
    await user.click(document.querySelector<HTMLElement>('li[data-line-start="5"]')!)
    await user.type(await screen.findByTestId('comment-new-field'), 'Tighten this.')
    expect(marks(COMMENT_TIMING_MARKS.saveStart)).toHaveLength(0)
    await user.click(screen.getByTestId('comment-save'))
    await waitFor(() => expect(marks(COMMENT_TIMING_MARKS.savedVisible)).toHaveLength(1))
    const [start] = marks(COMMENT_TIMING_MARKS.saveStart)
    const [saved] = marks(COMMENT_TIMING_MARKS.savedVisible)
    expect(saved.startTime).toBeGreaterThanOrEqual(start.startTime)
    expect(screen.getAllByTestId(TEST_IDS.COMMENT_HOST_ICON)).toHaveLength(2)
  })
})
