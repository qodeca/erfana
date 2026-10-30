// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Preview comments in one editor panel (spec 024 commit 13): the
 * real preview, host, drawer, menu and window, with only the bridge mocked.
 *
 * State-table and menu-matrix rows covered here (024-AC-035): M-11, M-13,
 * M-15 (read-only and paused), M-17, M-18, M-20, M-22, M-23; F-02, F-03,
 * F-04, F-06, F-07; S-01 (icon); W-01, W-06 (refused save keeps the text).
 *
 * The selection rows M-12, M-14, M-16, M-19 and M-21 are in
 * MarkdownComments.selection.test.tsx (spec 024 commit 14).
 *
 * Still pending (the comments-v2 states and window states not built yet):
 * S-02 – S-05 drawing (the ghost icon, the notched icon, "Words changed");
 * W-02 – W-05, W-07, W-08 before typing, W-10, W-11 in Markdown words; the
 * non-modal window (C-18).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../shared/errors'
import { editorSaveRegistry } from '../../../services/editorSaveRegistry'
import { usePreviewCommentStore } from '../../../stores/usePreviewCommentStore'
import { useProjectStore } from '../../../stores/useProjectStore'
import { TEST_IDS } from '../../../constants/testids'
import { MARKDOWN_COPY, MD_SPOKEN_COPY, MD_SURFACE_COPY } from '../../Comments/commentCopyWords'
import { IDENTITY_COPY } from '../../Comments/commentCopy'
import { htmlWithoutCommentAttributes } from '../../Comments/overlay/commentContentAttrs'
import type { ViewMode } from '../MarkdownEditorPanel/types'
import {
  DRAFT_TOKEN,
  FILE_PATH,
  Harness,
  PANEL_ID,
  fileView,
  installApi,
  resetStores,
  setSettings,
  thread,
  type FileCommentsMock
} from './__test-utils__/harness'

const DOC = ['---', 'title: Notes', '---', '# Plan', '', 'First paragraph.', '', '- one', '- two', ''].join('\n')

const modeTool = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE)
const content = (): HTMLElement => document.querySelector<HTMLElement>('.markdown-preview-content')!
const paragraph = (): HTMLElement => content().querySelector<HTMLElement>('p[data-line-start="6"]')!
const listItem = (line: number): HTMLElement => content().querySelector<HTMLElement>(`li[data-line-start="${line}"]`)!
const polite = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_ANNOUNCE)

/** The panel itself, in the dockview the dirty guard reads. */
function dockWith(conflict = false) {
  const panel = {
    id: PANEL_ID,
    params: { filePath: FILE_PATH },
    view: { contentComponent: 'editor' },
    api: { setActive: vi.fn() },
    group: { focus: vi.fn(), element: document.createElement('div') }
  }
  const save = vi.fn(async () => true)
  const release = vi.fn()
  const holdAutosave = vi.fn(() => release)
  const unregister = editorSaveRegistry.register(PANEL_ID, { save, hasConflict: () => conflict, holdAutosave })
  useProjectStore.setState({
    dockviewApi: { panels: [panel], getPanel: (id: string) => (id === PANEL_ID ? panel : undefined) } as unknown as DockviewApi,
    dirtyPanelIds: new Set()
  })
  return { save, release, holdAutosave, unregister }
}

function renderPanel(viewMode: ViewMode = 'preview', onViewMode = vi.fn()) {
  const view = render(<Harness content={DOC} viewMode={viewMode} onViewMode={onViewMode} />)
  return {
    ...view,
    onViewMode,
    show: (next: ViewMode) => view.rerender(<Harness content={DOC} viewMode={next} onViewMode={onViewMode} />)
  }
}

async function turnModeOn(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(modeTool())
  expect(modeTool()).toHaveAttribute('aria-pressed', 'true')
}

describe('Markdown Preview comments', () => {
  let api: FileCommentsMock
  let dock: ReturnType<typeof dockWith>

  let portalRoot: HTMLDivElement

  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    // jsdom has no layout: "Show in preview" and the picker scroll by hand.
    Element.prototype.scrollIntoView ??= vi.fn()
    resetStores()
    api = installApi(fileView([thread('t1', 9, 'li')]), [{ threadKey: 't1', line: 9, tag: 'li' }])
    setSettings()
    dock = dockWith()
  })
  afterEach(() => {
    portalRoot.remove()
    dock.unregister()
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
    vi.restoreAllMocks()
  })

  describe('024-AC-006: preview-only view', () => {
    it('024-AC-006: tools, overlay and band show in the preview-only view, never in the editor or split view', async () => {
      const panel = renderPanel('editor')
      expect(screen.queryByTestId(TEST_IDS.COMMENT_TOOL_MODE)).toBeNull()
      expect(screen.queryByTestId(TEST_IDS.COMMENT_HOST_OVERLAY)).toBeNull()
      panel.show('split')
      expect(screen.queryByTestId(TEST_IDS.COMMENT_TOOL_MODE)).toBeNull()
      expect(screen.queryByTestId(TEST_IDS.COMMENT_HOST_OVERLAY)).toBeNull()
      expect(api.list).not.toHaveBeenCalled()
      panel.show('preview')
      expect(modeTool()).toBeVisible()
      await waitFor(() => expect(api.list).toHaveBeenCalledWith({ panelId: PANEL_ID, filePath: FILE_PATH }))
      expect(screen.getByTestId(TEST_IDS.COMMENT_HOST_OVERLAY)).toBeInTheDocument()
    })

    it('024-AC-006: nothing at all while "Comments in Markdown preview" is off', () => {
      setSettings(undefined, false)
      renderPanel()
      expect(screen.queryByTestId(TEST_IDS.COMMENT_TOOL_MODE)).toBeNull()
      expect(screen.queryByTestId(TEST_IDS.COMMENT_HOST_OVERLAY)).toBeNull()
    })

    it('024-AC-006: leaving the view turns comment mode off, and the drawer and the draft come back with it', async () => {
      const user = userEvent.setup()
      const panel = renderPanel()
      await turnModeOn(user)
      await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
      expect(await screen.findByTestId(TEST_IDS.COMMENT_DRAWER)).toBeVisible()
      await user.click(paragraph())
      await user.type(await screen.findByTestId('comment-new-field'), 'half a thought')

      panel.show('editor')
      expect(screen.queryByTestId('comment-window')).toBeNull()
      panel.show('preview')
      expect(modeTool()).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByTestId(TEST_IDS.COMMENT_DRAWER)).toBeVisible()

      await turnModeOn(user)
      await user.click(paragraph())
      expect(await screen.findByTestId('comment-new-field')).toHaveValue('half a thought')
    })
  })

  describe('picking and writing (M-13, M-22, A-01)', () => {
    it('M-13: in comment mode a click on a paragraph opens "New comment on paragraph" and saves the pick main locates', async () => {
      const user = userEvent.setup()
      renderPanel()
      await turnModeOn(user)
      expect(screen.getByTestId(TEST_IDS.COMMENT_HOST_MODE_TAB)).toHaveTextContent('Comment mode · Esc to leave')
      await user.click(paragraph())
      const dialog = await screen.findByRole('dialog', { name: 'New comment on paragraph' })
      expect(within(dialog).getByText('notes.md, line 6')).toBeVisible()
      await user.type(screen.getByTestId('comment-new-field'), 'Tighten this')
      await user.click(screen.getByTestId('comment-save'))
      await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
      expect(api.save.mock.calls[0][0]).toMatchObject({
        panelId: PANEL_ID,
        filePath: FILE_PATH,
        op: 'add',
        draftToken: DRAFT_TOKEN,
        text: 'Tighten this',
        target: { lineStart: 6, lineEnd: 6, tag: 'p', ordinal: 1, quote: { exact: 'First paragraph.' } }
      })
      await waitFor(() => expect(screen.queryByTestId('comment-window')).toBeNull())
      expect(api.list.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('M-22: a click in comment mode never follows a link inside the target', async () => {
      const user = userEvent.setup()
      const onLink = vi.fn()
      render(<Harness content={'[go](https://example.com)\n'} />)
      content().addEventListener('click', onLink)
      await turnModeOn(user)
      await user.click(content().querySelector('a')!)
      expect(onLink).not.toHaveBeenCalled()
      expect(await screen.findByRole('dialog', { name: 'New comment on paragraph' })).toBeVisible()
    })

    it('M-11: outside comment mode a right-click offers "Comment on list item", which opens the window in one step', async () => {
      const user = userEvent.setup()
      renderPanel()
      fireEvent.contextMenu(listItem(8), { clientX: 10, clientY: 10 })
      const item = await screen.findByTestId(TEST_IDS.COMMENT_MENU_COMMENT_ON)
      expect(item).toHaveTextContent('Comment on list item')
      expect(screen.getByRole('menu', { name: 'List item' })).toBeVisible()
      await user.click(item)
      expect(await screen.findByRole('dialog', { name: 'New comment on list item' })).toBeVisible()
    })

    it('M-13: in comment mode the menu offers "Add comment" only', async () => {
      const user = userEvent.setup()
      renderPanel()
      await turnModeOn(user)
      fireEvent.contextMenu(paragraph(), { clientX: 10, clientY: 10 })
      const menu = await screen.findByTestId(TEST_IDS.COMMENT_CONTEXT_MENU)
      expect(within(menu).getAllByRole('menuitem').map(el => el.textContent)).toEqual(['Add comment'])
    })

    it('M-18: the frontmatter offers "Comment on frontmatter", disabled with its reason', async () => {
      renderPanel()
      const frontmatter = content().querySelector<HTMLElement>('.frontmatter-wrapper, .frontmatter-error-wrapper')!
      fireEvent.contextMenu(frontmatter, { clientX: 10, clientY: 10 })
      const item = await screen.findByTestId(TEST_IDS.COMMENT_MENU_FRONTMATTER)
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(within(item).getByTestId(TEST_IDS.COMMENT_MENU_REASON)).toHaveTextContent(MARKDOWN_COPY.frontmatter)
      expect(item).toHaveAccessibleDescription(MARKDOWN_COPY.frontmatter)
    })

    it('S-01: an open thread draws one icon on its list item, named in Markdown words; M-17 hides it', async () => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
      const user = userEvent.setup()
      renderPanel()
      const icon = await screen.findByTestId(TEST_IDS.COMMENT_HOST_ICON)
      expect(icon).toHaveAccessibleName('1 comment on list item, line 9. Open.')
      // C-20: the icons toggle is the drawer's checkbox now (was the toolbar's Show comment icons).
      await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
      await user.click(await screen.findByTestId(TEST_IDS.COMMENT_DRAWER_SHOW_ICONS))
      expect(screen.queryByTestId(TEST_IDS.COMMENT_HOST_ICON)).toBeNull()
    })
  })

  describe('024-AC-029: keyboard only', () => {
    it('024-AC-029: the shortcut turns the mode on and Tab, Alt+Up, Alt+Down and Enter pick a list item', async () => {
      const user = userEvent.setup()
      renderPanel()
      await waitFor(() => expect(api.list).toHaveBeenCalled())
      await user.keyboard('{Control>}{Alt>}m{/Alt}{/Control}')
      expect(modeTool()).toHaveAttribute('aria-pressed', 'true')
      const heading = content().querySelector<HTMLElement>('h1')!
      await waitFor(() => expect(heading).toHaveFocus())

      await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
      await waitFor(() => expect(polite()).toHaveTextContent(MARKDOWN_COPY.pickerTop))
      await user.keyboard('{Tab}')
      expect(paragraph()).toHaveFocus()
      // C-10: the step says the kind, line and opening words (was "Showing paragraph, line 6."), with the keys at first.
      await waitFor(() =>
        expect(polite()).toHaveTextContent(MD_SPOKEN_COPY.target('paragraph', 6, 'First paragraph.', 0) + MD_SPOKEN_COPY.hint)
      )
      await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
      await waitFor(() => expect(polite()).toHaveTextContent(MARKDOWN_COPY.pickerNoChild))
      await user.keyboard('{Tab}')
      await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
      expect(listItem(8)).toHaveFocus()
      expect(screen.getByTestId(TEST_IDS.COMMENT_HOST_MODE_TAB)).toHaveTextContent('Comment mode · List item, line 8 · Esc to leave')

      await user.keyboard('{Enter}')
      expect(await screen.findByRole('dialog', { name: 'New comment on list item' })).toBeVisible()
    })

    it('024-AC-029: Esc leaves comment mode and returns focus to the toggle; Shift+F10 opens the menu on the picked target', async () => {
      const user = userEvent.setup()
      renderPanel()
      await user.click(modeTool())
      act(() => listItem(9).focus())
      await user.keyboard('{Control>}{Alt>}m{/Alt}{/Control}')
      expect(modeTool()).toHaveAttribute('aria-pressed', 'false')

      act(() => modeTool().focus())
      await user.keyboard('{Enter}')
      expect(modeTool()).toHaveAttribute('aria-pressed', 'true')
      await waitFor(() => expect(content().querySelector('h1')).toHaveFocus())
      await user.keyboard('{Shift>}{F10}{/Shift}')
      expect(await screen.findByTestId(TEST_IDS.COMMENT_CONTEXT_MENU)).toBeVisible()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByTestId(TEST_IDS.COMMENT_CONTEXT_MENU)).toBeNull())
      act(() => content().querySelector<HTMLElement>('h1')!.focus())
      await user.keyboard('{Escape}')
      expect(modeTool()).toHaveAttribute('aria-pressed', 'false')
      expect(modeTool()).toHaveFocus()
    })
  })

  describe('024-AC-016: paused while an editor holds unsaved edits (F-02, F-03, M-15)', () => {
    it('024-AC-016 C-09: the band offers Save {file}; the toggle and the menu are disabled with its sentence; the list reads the buffer', async () => {
      const user = userEvent.setup()
      useProjectStore.setState({ dirtyPanelIds: new Set([PANEL_ID]) })
      renderPanel()
      const band = await screen.findByTestId(TEST_IDS.COMMENT_HOST_PAUSED)
      expect(band).toHaveAttribute('data-state', 'paused')
      expect(band).toHaveTextContent(MD_SURFACE_COPY.paused('notes.md'))
      const sentence = MD_SURFACE_COPY.modeUnavailable(MD_SURFACE_COPY.paused('notes.md'))
      expect(modeTool()).toHaveAttribute('aria-disabled', 'true')
      expect(modeTool()).toHaveAttribute('title', sentence)
      await user.click(modeTool())
      expect(modeTool()).toHaveAttribute('aria-pressed', 'false')
      await waitFor(() => expect(api.list).toHaveBeenCalledWith({ panelId: PANEL_ID, filePath: FILE_PATH, bufferText: DOC }))

      fireEvent.contextMenu(paragraph(), { clientX: 10, clientY: 10 })
      const item = await screen.findByTestId(TEST_IDS.COMMENT_MENU_COMMENT_ON)
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(within(item).getByTestId(TEST_IDS.COMMENT_MENU_REASON)).toHaveTextContent(MD_SURFACE_COPY.paused('notes.md'))

      await user.click(within(band).getByRole('button', { name: 'Save notes.md' }))
      expect(dock.save).toHaveBeenCalledTimes(1)
    })

    it('024-AC-016 C-09: a thread opened while paused is read-only with the band sentence', async () => {
      const user = userEvent.setup()
      useProjectStore.setState({ dirtyPanelIds: new Set([PANEL_ID]) })
      renderPanel()
      await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
      await user.click(await screen.findByTestId(TEST_IDS.COMMENT_DRAWER_ROW_OPEN))
      const banner = await screen.findByTestId(TEST_IDS.COMMENT_READ_ONLY)
      expect(banner).toHaveTextContent(MD_SURFACE_COPY.paused('notes.md'))
      expect(screen.queryByTestId(TEST_IDS.COMMENT_NEW_ON_ELEMENT)).toBeNull()
    })

    it('024-AC-016 C-09: changed on disk too, the band warns and Go to editor opens this panel\'s editor view (F-03)', async () => {
      dock.unregister()
      dock = dockWith(true)
      const user = userEvent.setup()
      useProjectStore.setState({ dirtyPanelIds: new Set([PANEL_ID]) })
      const panel = renderPanel()
      const band = await screen.findByTestId(TEST_IDS.COMMENT_HOST_PAUSED)
      expect(band).toHaveAttribute('data-state', 'conflict')
      expect(band).toHaveTextContent(MD_SURFACE_COPY.pausedConflict('notes.md'))
      expect(within(band).queryByRole('button', { name: 'Save notes.md' })).toBeNull()
      await user.click(within(band).getByRole('button', { name: MD_SURFACE_COPY.goToEditor }))
      expect(panel.onViewMode).toHaveBeenCalledWith('editor')
    })

    it('024-AC-016: saving clears the pause and comment mode is offered again', async () => {
      useProjectStore.setState({ dirtyPanelIds: new Set([PANEL_ID]) })
      renderPanel()
      expect(await screen.findByTestId(TEST_IDS.COMMENT_HOST_PAUSED)).toBeVisible()
      act(() => useProjectStore.setState({ dirtyPanelIds: new Set() }))
      expect(screen.queryByTestId(TEST_IDS.COMMENT_HOST_PAUSED)).toBeNull()
      expect(modeTool()).not.toHaveAttribute('aria-disabled')
    })
  })

  describe('file states (F-04, F-06, F-07)', () => {
    it('F-04: a read-only file disables the toggle with the Markdown reason', async () => {
      api.list.mockResolvedValue({ ok: true, file: fileView([], { writable: false, readOnlyReason: 'too-many-blocks' }), placements: [] })
      renderPanel()
      await waitFor(() => expect(modeTool()).toHaveAttribute('aria-disabled', 'true'))
      expect(modeTool()).toHaveAttribute('title', MD_SURFACE_COPY.modeUnavailable(MARKDOWN_COPY.tooMany('notes.md')))
    })

    it('024-FR-022: a list refused because comments were turned off in Settings disables the toggle and lists nothing', async () => {
      api.list.mockResolvedValue({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'comments-off' })
      renderPanel()
      await waitFor(() => expect(modeTool()).toHaveAttribute('title', MD_SURFACE_COPY.modeUnavailable(MARKDOWN_COPY.off)))
      expect(screen.queryByTestId(TEST_IDS.COMMENT_DRAWER_ERROR)).toBeNull()
    })

    it('F-06 / F-07: the drawer reads, then offers Try again on a read error', async () => {
      const user = userEvent.setup()
      let answer: (value: unknown) => void = () => {}
      api.list.mockImplementation(() => new Promise(resolve => (answer = resolve)))
      renderPanel()
      await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
      expect(await screen.findByText('Reading comments…')).toBeVisible()
      await act(async () => answer({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'read-failed' }))
      expect(await screen.findByTestId(TEST_IDS.COMMENT_DRAWER_ERROR)).toBeVisible()
    })
  })

  describe('024-AC-023: one identity step for both previews', () => {
    it('024-AC-023: the first Markdown comment asks once, with the shared notice, and records it for both previews', async () => {
      setSettings({ identityNoticeSeen: false })
      const user = userEvent.setup()
      renderPanel()
      await turnModeOn(user)
      await user.click(paragraph())
      const dialog = await screen.findByRole('dialog', { name: IDENTITY_COPY.title })
      expect(dialog).toHaveTextContent(IDENTITY_COPY.notice)
      await user.type(screen.getByTestId('comment-identity-name'), 'Grace')
      await user.click(screen.getByTestId('comment-identity-continue'))
      expect(await screen.findByRole('dialog', { name: 'New comment on paragraph' })).toBeVisible()
      const { updateCommentIdentity } = (await import('../../../stores/useGlobalSettingsStore')).useGlobalSettingsStore.getState()
      expect(updateCommentIdentity).toHaveBeenCalledWith({ authorName: 'Grace', authorEmail: undefined, identityNoticeSeen: true })
    })

    it('024-AC-023: a step already taken in the HTML Preview is not asked again', async () => {
      const user = userEvent.setup()
      renderPanel()
      await turnModeOn(user)
      await user.click(paragraph())
      expect(await screen.findByRole('dialog', { name: 'New comment on paragraph' })).toBeVisible()
      expect(screen.queryByTestId('comment-identity-name')).toBeNull()
    })
  })

  describe('024-AC-034: renderer half', () => {
    it('024-AC-034: autosave is held while the write is in flight, and a refusal keeps the text in the window', async () => {
      const user = userEvent.setup()
      let settle: (value: unknown) => void = () => {}
      api.save.mockImplementation(() => new Promise(resolve => (settle = resolve)))
      renderPanel()
      await turnModeOn(user)
      await user.click(paragraph())
      const field = await screen.findByTestId('comment-new-field')
      await user.type(field, 'Keep me')
      await user.click(screen.getByTestId('comment-save'))
      await waitFor(() => expect(api.save).toHaveBeenCalled())
      expect(dock.holdAutosave).toHaveBeenCalledTimes(1)
      expect(dock.release).not.toHaveBeenCalled()

      await act(async () => settle({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED, reason: 'target-moved' }))
      await waitFor(() => expect(dock.release).toHaveBeenCalledTimes(1))
      expect(await screen.findByTestId(TEST_IDS.COMMENT_SAVE_ERROR)).toHaveTextContent(MARKDOWN_COPY.moved('paragraph'))
      expect(screen.getByTestId('comment-new-field')).toHaveValue('Keep me')
    })

    it('W-06: a write main could not confirm is not offered again – the list is read again first (C12)', async () => {
      const user = userEvent.setup()
      api.save.mockResolvedValue({ ok: false, code: ErrorCode.COMMENT_WRITE_FAILED, reason: 'changed-during-save' })
      renderPanel()
      await turnModeOn(user)
      await user.click(paragraph())
      await user.type(await screen.findByTestId('comment-new-field'), 'x')
      const listed = api.list.mock.calls.length
      await user.click(screen.getByTestId('comment-save'))
      expect(await screen.findByTestId(TEST_IDS.COMMENT_SAVE_ERROR)).toHaveTextContent(MARKDOWN_COPY.changedDuringSave('notes.md'))
      await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(listed))
      expect(screen.queryByTestId('comment-save')).toBeNull()
    })

    it('W-06: main\'s finer reason picks the Markdown sentence (generated region)', async () => {
      const user = userEvent.setup()
      api.save.mockResolvedValue({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED, reason: 'generated-region' })
      renderPanel()
      await turnModeOn(user)
      await user.click(paragraph())
      await user.type(await screen.findByTestId('comment-new-field'), 'x')
      await user.click(screen.getByTestId('comment-save'))
      expect(await screen.findByTestId(TEST_IDS.COMMENT_SAVE_ERROR)).toHaveTextContent(MARKDOWN_COPY.generated)
    })
  })

  describe('024-AC-032: marks never reach the content', () => {
    it('024-AC-032: outline, icons and the mode tab live outside the rendered content that export, copy and Find read', async () => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
      const user = userEvent.setup()
      renderPanel()
      const before = content().innerHTML
      await screen.findByTestId(TEST_IDS.COMMENT_HOST_ICON)
      await turnModeOn(user)
      fireEvent.mouseMove(paragraph())
      expect(await screen.findByTestId(TEST_IDS.COMMENT_HOST_OUTLINE)).toBeInTheDocument()
      // C-11: the host's marked aria-details and tabindex are the only change, and every export and copy strips them.
      expect(htmlWithoutCommentAttributes(content())).toBe(before)
      const scroller = document.querySelector('.markdown-preview')!
      expect(scroller.querySelector('[data-testid^="comment-"]')).toBeNull()
      expect(scroller.textContent).not.toMatch(/Comment mode|comment on/i)
      expect(usePreviewCommentStore.getState().panels.get(PANEL_ID)?.mode).toBe(true)
    })
  })
})
