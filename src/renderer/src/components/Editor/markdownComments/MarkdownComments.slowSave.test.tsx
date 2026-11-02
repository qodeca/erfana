// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Preview comments – a slow save says so (spec 024 state table W-10;
 * I-29, P-F17; differences table D-62). Past main's time limit the window says
 * "Still saving", as in the HTML Preview, and the panel says how it ended; a
 * save that answered but whose icon is not drawn yet shows a waiting sign on
 * the count, because the window has closed and a large file renders for seconds.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../shared/errors'
import { editorSaveRegistry } from '../../../services/editorSaveRegistry'
import { useProjectStore } from '../../../stores/useProjectStore'
import { TEST_IDS } from '../../../constants/testids'
import { resetCommentPendingWrites } from '../../Comments/commentPendingWrites'
import { noteCommentPinsDrawn, resetCommentTiming } from '../../Comments/overlay/commentTiming'
import { DRAFT_TOKEN, FILE_PATH, Harness, PANEL_ID, fileView, installApi, resetStores, setSettings, type FileCommentsMock } from './__test-utils__/harness'

const DOC = ['# Plan', '', 'First paragraph.', ''].join('\n')
const STILL_SAVING = 'Still saving to notes.md. Your comment appears here once it is written – no need to save again.'
const count = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST)
const paragraph = (): HTMLElement => document.querySelector<HTMLElement>('.markdown-preview-content p[data-line-start="3"]')!

async function saveNewComment(): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE))
  await user.click(paragraph())
  await user.type(await screen.findByTestId('comment-new-field'), 'Tighten this')
  await user.click(screen.getByTestId('comment-save'))
}

describe('Markdown Preview comments – a slow save (W-10, P-F17)', () => {
  let api: FileCommentsMock
  let portalRoot: HTMLDivElement
  let unregister: () => void

  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    Element.prototype.scrollIntoView ??= vi.fn()
    resetStores()
    resetCommentPendingWrites()
    resetCommentTiming()
    api = installApi(fileView())
    setSettings()
    const panel = { id: PANEL_ID, params: { filePath: FILE_PATH }, view: { contentComponent: 'editor' }, api: { setActive: vi.fn() }, group: { focus: vi.fn(), element: document.createElement('div') } }
    unregister = editorSaveRegistry.register(PANEL_ID, { save: vi.fn(async () => true), hasConflict: () => false, holdAutosave: vi.fn(() => vi.fn()) })
    useProjectStore.setState({ dockviewApi: { panels: [panel], getPanel: (id: string) => (id === PANEL_ID ? panel : undefined) } as unknown as DockviewApi, dirtyPanelIds: new Set() })
  })
  afterEach(() => {
    unregister()
    portalRoot.remove()
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
    vi.restoreAllMocks()
  })

  describe('W-10 past the time limit', () => {
    beforeEach(() => {
      api.save.mockResolvedValue({ ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    })

    it('W-10 the window says Still saving, with no second Save', async () => {
      render(<Harness content={DOC} />)
      await saveNewComment()
      expect(await screen.findByTestId(TEST_IDS.COMMENT_SAVE_ERROR)).toHaveTextContent(STILL_SAVING)
      expect(screen.queryByTestId('comment-save')).toBeNull()
    })

    it('W-10 a write that lands closes the window, reads the list and the file again', async () => {
      const onFileWritten = vi.fn()
      render(<Harness content={DOC} onFileWritten={onFileWritten} />)
      await saveNewComment()
      await screen.findByTestId(TEST_IDS.COMMENT_SAVE_ERROR)
      const reads = api.list.mock.calls.length
      act(() => api.emitSettled({ op: 'add', draftToken: DRAFT_TOKEN, ok: true }))
      await waitFor(() => expect(screen.queryByTestId(TEST_IDS.COMMENT_SAVE_ERROR)).toBeNull())
      await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(reads))
      expect(onFileWritten).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_ANNOUNCE)).toHaveTextContent('Comment saved to notes.md.'))
    })

    it('W-10 a write refused with main\'s reason keeps its Markdown sentence: no invitation to save a landed comment again', async () => {
      render(<Harness content={DOC} />)
      await saveNewComment()
      await screen.findByTestId(TEST_IDS.COMMENT_SAVE_ERROR)
      act(() => api.emitSettled({ op: 'add', draftToken: DRAFT_TOKEN, ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'changed-during-save' }))
      await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_SAVE_ERROR)).toHaveTextContent('notes.md changed during the save, so your comment may already be there.'))
    })
  })

  describe('P-F17 the wait between the save and the icon', () => {
    const SIGN_MS = 2_000

    it('P-F17 the count shows Saving… once the window has closed, until the new icon is drawn', async () => {
      render(<Harness content={DOC} />)
      await saveNewComment()
      await waitFor(() => expect(screen.queryByTestId('comment-save')).toBeNull())
      await waitFor(() => expect(within(count()).getByText('Saving…')).toBeVisible(), { timeout: SIGN_MS })
      expect(count()).toHaveAttribute('aria-busy', 'true')
      act(() => noteCommentPinsDrawn({}, ['new-thread']))
      await waitFor(() => expect(within(count()).queryByText('Saving…')).toBeNull())
      expect(count()).not.toHaveAttribute('aria-busy')
    })

    it('P-F17 an icon drawn at once never flashes the sign', async () => {
      render(<Harness content={DOC} />)
      await saveNewComment()
      await waitFor(() => expect(screen.queryByTestId('comment-save')).toBeNull())
      act(() => noteCommentPinsDrawn({}, ['new-thread']))
      await new Promise(resolve => setTimeout(resolve, 600))
      expect(within(count()).queryByText('Saving…')).toBeNull()
    })

    it('P-F17 a refused save shows no sign', async () => {
      api.save.mockResolvedValue({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED, reason: 'target-moved' })
      render(<Harness content={DOC} />)
      await saveNewComment()
      await screen.findByTestId(TEST_IDS.COMMENT_SAVE_ERROR)
      await new Promise(resolve => setTimeout(resolve, 600))
      expect(within(count()).queryByText('Saving…')).toBeNull()
    })
  })
})
