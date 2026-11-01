// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown host's thread window (plan step 5): a drawer row lands on its
 * target (I-2), "New comment" opens a draft on demand from the target (I-4,
 * P-F05), and text carried by Pick again stays in view (I-23) – the real
 * preview, host and window, with only the bridge mocked.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import { editorSaveRegistry } from '../../../services/editorSaveRegistry'
import { commentDrafts } from '../../../stores/usePreviewCommentStore'
import { useProjectStore } from '../../../stores/useProjectStore'
import { TEST_IDS } from '../../../constants/testids'
import { carriedDrafts } from '../../Comments/commentCarriedDrafts'
import { FILE_PATH, Harness, PANEL_ID, fileView, installApi, resetStores, setSettings, thread, type FileCommentsMock } from './__test-utils__/harness'

const DOC = ['# Plan', '', 'We ship the beta.', '', '- Run the load test.', '- two', '', 'Closing words.', ''].join('\n')
const ON_ITEM: ThreadPlacement = { threadKey: 't1', line: 6, tag: 'li' }

const content = (): HTMLElement => document.querySelector<HTMLElement>('.markdown-preview-content')!
const listItem = (line: number): HTMLElement => content().querySelector<HTMLElement>(`li[data-line-start="${line}"]`)!
const closing = (): HTMLElement => content().querySelector<HTMLElement>('p[data-line-start="8"]')!
const modeTool = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE)
const icon = (): Promise<HTMLElement> => screen.findByTestId(TEST_IDS.COMMENT_HOST_ICON)
const newOnTarget = (): HTMLElement | null => screen.queryByTestId(TEST_IDS.COMMENT_NEW_ON_ELEMENT)

/** Every box is the pane's (600 × 400), except `target` while it is scrolled below it; `scrollIntoView` brings it in. */
function scrolledAway(target: () => Element | null): void {
  let away = true
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => [new DOMRect(0, 0, 1, 1)] as unknown as DOMRectList)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return away && this === target() ? new DOMRect(0, 900, 600, 20) : new DOMRect(0, 0, 600, 400)
  })
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    if (this === target()) away = false
  })
}

describe('Markdown Preview comments – the thread window', () => {
  let api: FileCommentsMock
  let portalRoot: HTMLDivElement
  let unregister: () => void

  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    Element.prototype.scrollIntoView ??= vi.fn()
    Range.prototype.getBoundingClientRect ??= () => new DOMRect()
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
    resetStores()
    commentDrafts.reset()
    api = installApi(fileView([thread('t1', 6, 'li')]), [ON_ITEM])
    setSettings()
    const panel = { id: PANEL_ID, params: { filePath: FILE_PATH }, view: { contentComponent: 'editor' }, api: { setActive: vi.fn() } }
    unregister = editorSaveRegistry.register(PANEL_ID, { save: vi.fn(async () => true), hasConflict: () => false, holdAutosave: vi.fn(() => () => {}) })
    useProjectStore.setState({
      dockviewApi: { panels: [panel], getPanel: (id: string) => (id === PANEL_ID ? panel : undefined) } as unknown as DockviewApi,
      dirtyPanelIds: new Set()
    })
  })
  afterEach(() => {
    portalRoot.remove()
    unregister()
    commentDrafts.reset()
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
    vi.restoreAllMocks()
  })

  async function ready(): Promise<void> {
    render(<Harness content={DOC} />)
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST)).toHaveAccessibleName(/^1 comment/))
  }

  async function openDrawerRow(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
    await user.click(await screen.findByTestId(TEST_IDS.COMMENT_DRAWER_ROW_OPEN))
  }

  describe('I-2 a drawer row always lands on its window', () => {
    it('I-2 a row whose target is off screen scrolls it in first: the window shows, not the edge tab', async () => {
      const user = userEvent.setup()
      await ready()
      scrolledAway(() => listItem(6))
      await openDrawerRow(user)
      const win = await screen.findByTestId(TEST_IDS.COMMENT_WINDOW)
      await waitFor(() => expect(win.dataset.placement).toBeDefined())
      expect(win.dataset.placement).not.toBe('edge')
      expect(screen.queryByTestId(TEST_IDS.COMMENT_EDGE_TAB)).toBeNull()
    })

    it('I-2 a row with its target gone still opens, beside nothing: there is nothing to scroll to', async () => {
      const user = userEvent.setup()
      api = installApi(fileView([thread('t1', 6, 'li', { attached: false })]), [])
      await ready()
      await openDrawerRow(user)
      expect(await screen.findByTestId(TEST_IDS.COMMENT_WINDOW)).toBeInTheDocument()
    })
  })

  describe('I-4, P-F05 New comment in the thread window', () => {
    it('I-4 a thread opened from its icon offers New comment, which opens a draft on the target only when pressed', async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(await icon())
      await screen.findByTestId(TEST_IDS.COMMENT_WINDOW)
      const button = await screen.findByTestId(TEST_IDS.COMMENT_NEW_ON_ELEMENT)
      expect(api.openDraft).not.toHaveBeenCalled()
      await user.click(button)
      expect(await screen.findByRole('dialog', { name: 'New comment on list item' })).toBeVisible()
      expect(api.openDraft).toHaveBeenCalledTimes(1)
      expect(api.openDraft.mock.calls[0][0]).toMatchObject({ target: { lineStart: 6, tag: 'li' } })
    })

    it('I-4 a pick on a commented block offers it too, with no mouse', async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(modeTool())
      await user.click(listItem(6))
      const button = await screen.findByTestId(TEST_IDS.COMMENT_NEW_ON_ELEMENT)
      button.focus()
      await user.keyboard('{Enter}')
      expect(await screen.findByRole('dialog', { name: 'New comment on list item' })).toBeVisible()
    })

    it('I-4 a thread opened from a drawer row offers none, as in the HTML Preview: it names no picked target', async () => {
      const user = userEvent.setup()
      await ready()
      await openDrawerRow(user)
      await screen.findByTestId(TEST_IDS.COMMENT_WINDOW)
      expect(newOnTarget()).toBeNull()
    })

    it('I-4 a thread reached by the step key offers none, as in the HTML Preview', async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
      await screen.findByTestId(TEST_IDS.COMMENT_DRAWER)
      fireEvent.keyDown(document.querySelector<HTMLElement>('.markdown-preview')!, { key: 'F9', code: 'F9', altKey: true })
      await screen.findByTestId(TEST_IDS.COMMENT_WINDOW)
      expect(newOnTarget()).toBeNull()
    })

    it('I-4 a ghost icon offers none: its target is gone', async () => {
      const user = userEvent.setup()
      api = installApi(fileView([thread('t1', 6, 'li', { attached: false })]), [ON_ITEM])
      await ready()
      await user.click(await screen.findByTestId(TEST_IDS.COMMENT_HOST_GHOST))
      await screen.findByTestId(TEST_IDS.COMMENT_WINDOW)
      expect(newOnTarget()).toBeNull()
    })
  })

  describe('I-23 text carried by Pick again stays in view until it is kept', () => {
    it('I-23 in comment mode, a pick on a commented block opens a new comment with the text', async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(modeTool())
      carriedDrafts.put(PANEL_ID, 'Make it bigger')
      await user.click(listItem(6))
      expect(await screen.findByTestId(TEST_IDS.COMMENT_CARRIED)).toBeVisible()
      expect(screen.getByTestId<HTMLTextAreaElement>('comment-new-field').value).toBe('Make it bigger')
    })

    it('I-23 in comment mode, its icon does the same: every way onto the target keeps the promise', async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(modeTool())
      carriedDrafts.put(PANEL_ID, 'Make it bigger')
      await user.click(await icon())
      expect(await screen.findByTestId(TEST_IDS.COMMENT_CARRIED)).toBeVisible()
    })

    it('I-23 with the mode off, the icon opens its thread: the text waits, and is not spent', async () => {
      const user = userEvent.setup()
      await ready()
      carriedDrafts.put(PANEL_ID, 'Make it bigger')
      await user.click(await icon())
      const win = await screen.findByTestId(TEST_IDS.COMMENT_WINDOW)
      expect(win.dataset.view).toBe('threads')
      expect(carriedDrafts.peek(PANEL_ID)).toBe('Make it bigger')
    })

    it('I-23 New comment in the thread window takes the waiting text', async () => {
      const user = userEvent.setup()
      await ready()
      carriedDrafts.put(PANEL_ID, 'Make it bigger')
      await user.click(await icon())
      await user.click(await screen.findByTestId(TEST_IDS.COMMENT_NEW_ON_ELEMENT))
      expect(await screen.findByTestId(TEST_IDS.COMMENT_CARRIED)).toBeVisible()
    })

    it('I-23 a pick on a block with no comment is unchanged: it opens a new comment with the text', async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(modeTool())
      carriedDrafts.put(PANEL_ID, 'Make it bigger')
      await user.click(closing())
      expect(await screen.findByTestId(TEST_IDS.COMMENT_CARRIED)).toBeVisible()
    })
  })
})
