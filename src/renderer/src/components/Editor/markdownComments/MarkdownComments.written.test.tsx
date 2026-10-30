// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Preview comments – the preview takes the written text from the
 * save itself (spec 024 024-AC-024, 024-NFR-001).
 *
 * A macOS run saved a comment, but the preview kept the old text: the editor
 * panel heard of main's atomic write only through its file watcher, and that
 * word never came. The panel now re-reads the file as soon as the save is
 * answered – unless it holds unsaved edits of its own, which a re-read would
 * overwrite (the watcher's conflict path stays in charge of those).
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../shared/errors'
import { editorSaveRegistry } from '../../../services/editorSaveRegistry'
import { useProjectStore } from '../../../stores/useProjectStore'
import { TEST_IDS } from '../../../constants/testids'
import { FILE_PATH, Harness, PANEL_ID, fileView, installApi, resetStores, setSettings, type FileCommentsMock } from './__test-utils__/harness'

const DOC = ['# Plan', '', 'First paragraph.', ''].join('\n')

const paragraph = (): HTMLElement => document.querySelector<HTMLElement>('.markdown-preview-content p[data-line-start="3"]')!

/** The panel in the dockview the dirty guard reads, clean. */
function dockClean(): () => void {
  const panel = {
    id: PANEL_ID,
    params: { filePath: FILE_PATH },
    view: { contentComponent: 'editor' },
    api: { setActive: vi.fn() },
    group: { focus: vi.fn(), element: document.createElement('div') }
  }
  const unregister = editorSaveRegistry.register(PANEL_ID, { save: vi.fn(async () => true), hasConflict: () => false, holdAutosave: vi.fn(() => vi.fn()) })
  useProjectStore.setState({
    dockviewApi: { panels: [panel], getPanel: (id: string) => (id === PANEL_ID ? panel : undefined) } as unknown as DockviewApi,
    dirtyPanelIds: new Set()
  })
  return unregister
}

/** A new comment on the paragraph, typed and saved. */
async function saveNewComment(): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE))
  await user.click(paragraph())
  await user.type(await screen.findByTestId('comment-new-field'), 'Tighten this')
  await user.click(screen.getByTestId('comment-save'))
}

describe('Markdown Preview comments – the written text reaches the preview from the save (024-AC-024)', () => {
  let api: FileCommentsMock
  let portalRoot: HTMLDivElement
  let unregister: () => void

  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    Element.prototype.scrollIntoView ??= vi.fn()
    resetStores()
    api = installApi(fileView())
    setSettings()
    unregister = dockClean()
  })
  afterEach(() => {
    portalRoot.remove()
    unregister()
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
    vi.restoreAllMocks()
  })

  it('024-AC-024 a saved comment asks the panel to read the file once, without waiting for the file watcher', async () => {
    const onFileWritten = vi.fn()
    render(<Harness content={DOC} onFileWritten={onFileWritten} />)
    await saveNewComment()
    await waitFor(() => expect(onFileWritten).toHaveBeenCalledTimes(1))
    // Asked only after main answered: its write had finished.
    expect(api.save.mock.invocationCallOrder[0]).toBeLessThan(onFileWritten.mock.invocationCallOrder[0])
  })

  it('024-AC-024 a refused save wrote nothing, so the panel is not asked to read the file', async () => {
    api.save.mockResolvedValue({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED, reason: 'target-moved' })
    const onFileWritten = vi.fn()
    render(<Harness content={DOC} onFileWritten={onFileWritten} />)
    await saveNewComment()
    expect(await screen.findByTestId(TEST_IDS.COMMENT_SAVE_ERROR)).toBeInTheDocument()
    expect(onFileWritten).not.toHaveBeenCalled()
  })

  it('024-AC-024 edits made in the panel while the save ran are never overwritten by the re-read', async () => {
    // The editor took a keystroke while main was writing: the watcher's conflict path decides.
    api.save.mockImplementation(async () => {
      useProjectStore.setState({ dirtyPanelIds: new Set([PANEL_ID]) })
      return { ok: true, threadKey: 'new-thread' }
    })
    const onFileWritten = vi.fn()
    render(<Harness content={DOC} onFileWritten={onFileWritten} />)
    await saveNewComment()
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByTestId('comment-save')).toBeNull())
    expect(onFileWritten).not.toHaveBeenCalled()
  })
})
