// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML Preview against the shared "leaving comment mode" suite (plan step
 * 4; I-1, K-19, I-8): the real panel with the fake bridges. The mode is
 * turned on with a click on the toggle, so focus stays in the chrome and the
 * page's own Esc is out of reach: that is the case the suite exists for.
 */
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import type { ModeLeavePlace, PanelKeyDriver } from '../../../../../shared/comments/__conformance__/overlayDriver'
import { runModeLeaveSuite } from '../../../../../shared/comments/__conformance__/overlay.suite'
import { runPanelKeySuite } from '../../../../../shared/comments/__conformance__/pickerKeys.suite'
import { TEST_IDS } from '../../../constants/testids'
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { usePreviewCommentStore } from '../../../stores/usePreviewCommentStore'
import { useSearchStore } from '../../../stores/useSearchStore'
import { HtmlPreviewPanel } from './HtmlPreviewPanel'
import { installHtmlPreviewPanelHarness } from './__test__/panelHarness'
import { fileView, installCommentsBridge, thread } from './comments/__test-helpers__/commentTestKit'

const mockLogger = vi.hoisted(() => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }))
vi.mock('../../../utils/logger', async importOriginal => ({ ...(await importOriginal<Record<string, unknown>>()), logger: mockLogger }))

const { listeners, makeProps } = installHtmlPreviewPanelHarness()

async function createDriver(): Promise<PanelKeyDriver> {
  const fake = installCommentsBridge()
  ;(window.api as unknown as { utils: unknown }).utils = { getPlatform: () => 'win32' }
  useGlobalSettingsStore.setState({
    settings: { comments: { authorName: 'Ada', identityNoticeSeen: true }, htmlPreview: { comments: { enabled: true } } } as never
  })
  const props = makeProps('/proj/page.html')
  const group = document.createElement('div')
  group.className = 'dv-groupview'
  group.tabIndex = -1
  document.body.appendChild(group)
  const elsewhere = document.createElement('button')
  document.body.appendChild(elsewhere)
  Object.assign(props.api, { group: { element: group }, onDidGroupChange: vi.fn(() => ({ dispose: vi.fn() })) })
  const element = document.createElement('div')
  document.body.appendChild(element)
  const portal = document.createElement('div')
  portal.id = 'portal-root' // the modal window's home
  document.body.appendChild(portal)
  ;(props.containerApi as unknown as { getPanel: (id: string) => unknown }).getPanel = id =>
    id === 'preview-1' ? { id, params: props.params, view: { contentComponent: 'htmlPreview', content: { element } } } : undefined
  render(<HtmlPreviewPanel {...props} />, { container: element })
  act(() => listeners.loadState?.({ panelId: 'preview-1', state: 'ready', dropped: 0 }))
  const toggle = await within(element).findByTestId('preview-band-comment-mode')

  const isModeOn = (): boolean => toggle.getAttribute('aria-pressed') === 'true'
  const placeOf = async (place: ModeLeavePlace): Promise<HTMLElement> => {
    if (place === 'toggle') return toggle
    if (place === 'group') return group
    if (place === 'find') {
      act(() => useSearchStore.getState().openSearch())
      return within(element).findByTestId(TEST_IDS.SEARCH_BAR_INPUT)
    }
    act(() => usePreviewCommentStore.getState().patch('preview-1', { drawerOpen: true }))
    return within(element).findByTestId(TEST_IDS.COMMENT_DRAWER_CLOSE)
  }

  return {
    async modeOn() {
      fireEvent.click(toggle)
      toggle.focus()
      await waitFor(() => expect(isModeOn()).toBe(true))
    },
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
      fake.bridge.list.mockResolvedValue({ ok: true, files: [fileView({ threads: [thread(1)] })] })
      await act(async () => fake.emitChanged({ panelId: 'preview-1', counts: { open: 1, resolved: 0, attention: 0 } } as never))
    },
    async pressStep(place) {
      fireEvent.keyDown(await placeOf(place), { key: 'F9', code: 'F9', altKey: true })
      await act(async () => {})
      await act(async () => {})
    },
    async pressModeKey(place) {
      fireEvent.keyDown(await placeOf(place), { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true })
      await act(async () => {})
    },
    // The page's Esc: its preload leaves the mode, main says so.
    async pressEscapeInPreview() {
      await act(async () => {
        fake.emitMode({ panelId: 'preview-1', on: false, reason: 'escape' })
      })
    },
    keysInPreview: () => (window.api as unknown as { preview: { focusPage: { mock: { calls: unknown[] } } } }).preview.focusPage.mock.calls.length > 0,
    windowOpen: () => document.querySelector(`[data-testid="${TEST_IDS.COMMENT_WINDOW}"]`) !== null,
    said: () => within(element).getByTestId('comment-announce').textContent ?? '',
    findOpen: () => useSearchStore.getState().isOpen,
    focused() {
      const active = document.activeElement
      if (active === toggle) return 'toggle'
      if (active === group) return 'group'
      return null
    },
    async setTabShown(shown) {
      await act(async () => {
        ;(props.api as unknown as { isVisible: boolean }).isVisible = shown
      })
    },
    dispose() {
      cleanup()
      fake.uninstall()
      usePreviewCommentStore.getState().reset()
      useGlobalSettingsStore.setState({ settings: null })
      useSearchStore.getState().closeSearch()
      group.remove()
      elsewhere.remove()
      element.remove()
      portal.remove()
    }
  }
}

runModeLeaveSuite('HTML', createDriver)
runPanelKeySuite('HTML', createDriver)
