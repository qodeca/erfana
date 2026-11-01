// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown Preview against the shared "leaving comment mode" suite (plan
 * step 4; I-1, K-19, I-8), plus what only this preview has: a view switch
 * (024-FR-005) and a window that stays open beside the toolbar (D-01).
 *
 * The panel harness with the real `useMarkdownComments`, the real Find bar on a
 * stand-in provider, and a dockview group element.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runModeLeaveSuite } from '../../../../../shared/comments/__conformance__/overlay.suite'
import { runPanelKeySuite } from '../../../../../shared/comments/__conformance__/pickerKeys.suite'
import type { ModeLeavePlace, PanelKeyDriver } from '../../../../../shared/comments/__conformance__/overlayDriver'
import { TEST_IDS } from '../../../constants/testids'
import { usePreviewCommentStore } from '../../../stores/usePreviewCommentStore'
import { useSearchStore } from '../../../stores/useSearchStore'
import { Harness, PANEL_ID, fileView, installApi, resetStores, setSettings, thread, type FileCommentsMock } from './__test-utils__/harness'
import type { UseMarkdownCommentsOptions } from './useMarkdownComments'

const DOC = ['# Plan', '', 'Ship the first slice.', ''].join('\n')

/** Everything the panel needs around {@link Harness} for one test. */
function mountPanel(): { group: HTMLElement; elsewhere: HTMLElement; api: FileCommentsMock; rerender: (shown: boolean, viewMode?: 'preview' | 'editor') => void } {
  Element.prototype.scrollIntoView ??= vi.fn()
  resetStores()
  const comments = installApi(fileView())
  setSettings()
  const group = document.createElement('div')
  group.tabIndex = -1
  const elsewhere = document.createElement('button')
  document.body.append(group, elsewhere)
  const api = { isActive: true, group: { element: group }, onDidGroupChange: vi.fn(() => ({ dispose: vi.fn() })) } as unknown as UseMarkdownCommentsOptions['panelApi']
  const element = (shown: boolean, viewMode: 'preview' | 'editor'): React.JSX.Element => (
    <Harness content={DOC} isVisible={shown} viewMode={viewMode} panelApi={api} withFind />
  )
  const view = render(element(true, 'preview'))
  return { group, elsewhere, api: comments, rerender: (shown, viewMode = 'preview') => view.rerender(element(shown, viewMode)) }
}

const scroller = (): HTMLElement | null => document.querySelector<HTMLElement>('.preview-pane > .markdown-preview')
const toggle = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE)
const isModeOn = (): boolean => toggle().getAttribute('aria-pressed') === 'true'
const storedMode = (): boolean => usePreviewCommentStore.getState().panels.get(PANEL_ID)?.mode === true

async function modeOn(): Promise<void> {
  await waitFor(() => expect(toggle()).not.toHaveProperty('disabled', true))
  fireEvent.click(toggle())
  toggle().focus()
  await waitFor(() => expect(isModeOn()).toBe(true))
}

async function createDriver(): Promise<PanelKeyDriver> {
  const { group, elsewhere, api, rerender } = mountPanel()
  await screen.findByTestId(TEST_IDS.COMMENT_TOOL_MODE)
  const placeOf = async (place: ModeLeavePlace): Promise<HTMLElement> => {
    if (place === 'toggle') return toggle()
    if (place === 'group') return group
    if (place === 'find') {
      act(() => useSearchStore.getState().openSearch())
      return screen.findByTestId(TEST_IDS.SEARCH_BAR_INPUT)
    }
    act(() => usePreviewCommentStore.getState().patch(PANEL_ID, { drawerOpen: true }))
    return screen.findByTestId(TEST_IDS.COMMENT_DRAWER_CLOSE)
  }
  return {
    modeOn,
    isModeOn,
    async focusOn(place) {
      const el = await placeOf(place)
      act(() => el.focus())
    },
    async pressEscape(place, modifiers = {}) {
      const el = await placeOf(place)
      const unclaimed = fireEvent.keyDown(el, { key: 'Escape', code: 'Escape', shiftKey: modifiers.shift === true })
      await act(async () => {})
      return unclaimed
    },
    async pressEscapeOutside() {
      act(() => elsewhere.focus())
      fireEvent.keyDown(elsewhere, { key: 'Escape', code: 'Escape' })
      await act(async () => {})
    },
    async withComment() {
      api.list.mockResolvedValue({ ok: true, file: fileView([thread('t1', 3, 'p')]), placements: [] })
      await act(async () => api.emitChanged())
    },
    async pressStep(place) {
      fireEvent.keyDown(await placeOf(place), { key: 'F9', code: 'F9', altKey: true })
      await act(async () => {})
    },
    async pressModeKey(place) {
      fireEvent.keyDown(await placeOf(place), { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true })
      await waitFor(() => expect(scroller()?.contains(document.activeElement)).toBe(true))
    },
    async pressEscapeInPreview() {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })
      await act(async () => {})
    },
    keysInPreview: () => scroller()?.contains(document.activeElement) === true,
    windowOpen: () => screen.queryByTestId(TEST_IDS.COMMENT_WINDOW) !== null,
    said: () => screen.getByTestId(TEST_IDS.COMMENT_STEP_LIVE).textContent ?? '',
    findOpen: () => useSearchStore.getState().isOpen,
    focused() {
      const active = document.activeElement
      if (active === toggle()) return 'toggle'
      return active === group ? 'group' : null
    },
    async setTabShown(shown) {
      rerender(shown)
      await act(async () => {})
    },
    dispose() {
      cleanup()
      useSearchStore.getState().closeSearch()
      group.remove()
      elsewhere.remove()
      resetStores()
    }
  }
}

runModeLeaveSuite('Markdown', createDriver)
runPanelKeySuite('Markdown', createDriver)

describe('leaving comment mode – what only the Markdown Preview has', () => {
  afterEach(() => {
    cleanup()
    useSearchStore.getState().closeSearch()
    resetStores()
    document.body.replaceChildren()
  })

  it('024-FR-005 a switch to the editor view leaves comment mode; a hidden tab does not', async () => {
    const { rerender } = mountPanel()
    await screen.findByTestId(TEST_IDS.COMMENT_TOOL_MODE)
    await modeOn()
    rerender(false)
    await act(async () => {})
    expect(storedMode()).toBe(true)
    rerender(true, 'editor')
    await act(async () => {})
    expect(storedMode()).toBe(false)
  })

  it('024-FR-005 a view switch while the tab is hidden leaves comment mode too', async () => {
    const { rerender } = mountPanel()
    await screen.findByTestId(TEST_IDS.COMMENT_TOOL_MODE)
    await modeOn()
    rerender(false)
    rerender(false, 'editor')
    await act(async () => {})
    expect(storedMode()).toBe(false)
  })

  it('D-01 the Esc order holds from the toolbar: an open window closes first, then the mode goes', async () => {
    mountPanel()
    await screen.findByTestId(TEST_IDS.COMMENT_TOOL_MODE)
    await modeOn()
    const block = document.querySelector<HTMLElement>('.markdown-preview-content p')
    if (block === null) throw new Error('no paragraph')
    fireEvent.click(block)
    await screen.findByTestId('comment-window')
    act(() => toggle().focus())
    fireEvent.keyDown(toggle(), { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('comment-window')).toBeNull())
    expect(isModeOn()).toBe(true)
    fireEvent.keyDown(toggle(), { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(isModeOn()).toBe(false))
  })

  describe('K-9 one Esc path: the window’s dismiss, wherever focus is', () => {
    /** The window on one comment, with its Edit step open, by keys. */
    async function openEditStep(): Promise<FileCommentsMock> {
      const portal = document.createElement('div')
      portal.id = 'portal-root' // the message's menu
      document.body.append(portal)
      const { api } = mountPanel()
      await screen.findByTestId(TEST_IDS.COMMENT_TOOL_MODE)
      api.list.mockResolvedValue({ ok: true, file: fileView([thread('t1', 3, 'p')]), placements: [] })
      await act(async () => api.emitChanged())
      act(() => toggle().focus())
      fireEvent.keyDown(toggle(), { key: 'F9', code: 'F9', altKey: true })
      await screen.findByTestId('comment-window')
      fireEvent.click(await screen.findByTestId(TEST_IDS.COMMENT_MESSAGE_ACTIONS))
      fireEvent.click(await screen.findByRole('menuitem', { name: /^Edit/ }))
      await screen.findByTestId(TEST_IDS.COMMENT_EDIT_FIELD)
      return api
    }
    const preview = (): HTMLElement => {
      const el = scroller()
      if (el === null) throw new Error('no preview')
      return el
    }

    it.each([
      ['the preview', preview],
      ['the toggle', toggle]
    ])('K-9 Esc with focus on %s backs out of the edit first, and the window stays', async (_place, place) => {
      await openEditStep()
      act(() => place().focus())
      if (place === toggle) await act(async () => usePreviewCommentStore.getState().patch(PANEL_ID, { mode: true }))
      fireEvent.keyDown(place(), { key: 'Escape', code: 'Escape' })
      await waitFor(() => expect(screen.queryByTestId(TEST_IDS.COMMENT_EDIT_FIELD)).toBeNull())
      expect(screen.getByTestId('comment-window')).toBeInTheDocument()
      fireEvent.keyDown(place(), { key: 'Escape', code: 'Escape' })
      await waitFor(() => expect(screen.queryByTestId('comment-window')).toBeNull())
    })
  })
})
