// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { IDockviewPanelProps } from 'dockview'

const gateway = vi.hoisted(() => ({
  navigate: vi.fn(),
  history: vi.fn(async () => undefined),
  devTools: vi.fn(async () => undefined),
  suggest: vi.fn(async (): Promise<{ rows: Array<{ url: string }> }> => ({ rows: [] })),
  toolbarFocus: vi.fn(),
  onForwardedKey: vi.fn(() => () => undefined),
  onFocus: vi.fn(() => () => undefined),
  pickMode: vi.fn(async () => undefined),
  closePick: vi.fn(async () => undefined),
  pickSurface: vi.fn(async () => undefined),
  targetStatus: vi.fn(async () => ({ kind: 'agent', process: 'claude', fresh: true }))
}))
const lifecycle = vi.hoisted(() => ({ ensureBrowserTab: vi.fn() }))
const focusPage = vi.hoisted(() => vi.fn())
const pageFocusOptions = vi.hoisted(() => ({ onFocused: undefined as undefined | (() => void) }))
const toast = vi.hoisted(() => vi.fn())

vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../services/browser/browserTabLifecycle', () => lifecycle)
vi.mock('./useBrowserBounds', () => ({ useBrowserBounds: () => ({ pushBounds: () => true }) }))
vi.mock('./useBrowserPageFocus', () => ({
  useBrowserPageFocus: (options: { onFocused?: () => void }) => {
    pageFocusOptions.onFocused = options.onFocused
    return focusPage
  }
}))
vi.mock('../../../utils/toastHelpers', () => ({ showErrorToast: toast, showInfoToast: vi.fn() }))
vi.mock('../../../utils/platform', () => ({ isMacOS: () => true, isWindows: () => false }))
vi.mock('../../../utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

import { BrowserPanel } from './BrowserPanel'
import { useBrowserTabStore } from '../../../stores/useBrowserTabStore'
import { useBrowserPickStore, type PickSummary } from '../../../stores/useBrowserPickStore'
import { useBrowserStillStore } from '../../../stores/useBrowserStillStore'
import type { BrowserPanelParams } from '../../../utils/openBrowserTab'
import { browserState } from './__test__/browserState'
import { BROWSER_TEST_IDS } from './browserTestIds'
import { TOOLTIP_HOVER_DELAY_MS } from './ToolbarTooltip'

const PANEL = 'browser-panel-1'
const TAB = 'browser-tab-1'

function renderPanel(params: Partial<BrowserPanelParams> = {}): {
  close: ReturnType<typeof vi.fn>
  setVisible: (isVisible: boolean) => void
} {
  const close = vi.fn()
  const visibility = new Set<(event: { isVisible: boolean }) => void>()
  const api = {
    id: PANEL,
    close,
    isVisible: true,
    onDidVisibilityChange: (listener: (event: { isVisible: boolean }) => void) => {
      visibility.add(listener)
      return { dispose: () => visibility.delete(listener) }
    },
    group: { panels: [], activePanel: undefined }
  }
  const props = {
    params: { panelId: PANEL, ...params },
    api,
    containerApi: {}
  } as unknown as IDockviewPanelProps<BrowserPanelParams>
  render(<BrowserPanel {...props} />)
  const setVisible = (isVisible: boolean): void => {
    api.isVisible = isVisible
    act(() => visibility.forEach(listener => listener({ isVisible })))
  }
  return { close, setVisible }
}

function host(patch: Parameters<typeof browserState>[0] = {}): void {
  act(() => {
    useBrowserTabStore.getState().attach(PANEL, TAB)
    useBrowserTabStore.getState().applyState(browserState(patch))
  })
}

beforeEach(() => {
  lifecycle.ensureBrowserTab.mockResolvedValue({ tabId: TAB })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  // jsdom draws no canvas: the still image's picture is not under test here.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  useBrowserTabStore.setState({
    byTab: new Map(),
    tabByPanel: new Map(),
    unhosted: new Map(),
    closing: new Set(),
    localAddresses: []
  })
})

describe('BrowserPanel', () => {
  it('opens its tab and, as a new tab, shows the empty page with the address bar focused', async () => {
    renderPanel({ focusAddress: true })
    expect(lifecycle.ensureBrowserTab).toHaveBeenCalledWith(PANEL, undefined)
    host({ erfanaPage: 'empty', committedUrl: null, origin: null, title: '' })
    await act(async () => undefined)
    expect(screen.getByRole('combobox', { name: 'Address and search' })).toHaveFocus()
    expect(screen.getByText(/Load your app, then click/)).toBeInTheDocument()
    expect(screen.getByTestId(BROWSER_TEST_IDS.PANEL)).toHaveAttribute('data-browser-tab-id', TAB)
  })

  it('lets go of the address field once the page has focus, so its formatted display shows', async () => {
    renderPanel()
    host()
    await act(async () => undefined)
    const field = screen.getByRole('combobox', { name: 'Address and search' })
    act(() => field.focus())
    expect(field).toHaveFocus()
    act(() => useBrowserTabStore.getState().setPageFocused(TAB, true))
    expect(field).not.toHaveFocus()
    expect(document.querySelector('.erf-brw-address__display')).not.toBeNull()

    // Main reporting the focus it was asked for (after Enter or Esc) releases the field too.
    act(() => useBrowserTabStore.getState().setPageFocused(TAB, false))
    act(() => field.focus())
    act(() => pageFocusOptions.onFocused?.())
    expect(field).not.toHaveFocus()
  })

  it('keeps focus on a toolbar control other than the address field when the page is focused', async () => {
    renderPanel()
    host()
    await act(async () => undefined)
    const more = screen.getByRole('button', { name: 'More' })
    act(() => more.focus())
    act(() => useBrowserTabStore.getState().setPageFocused(TAB, true))
    expect(more).toHaveFocus()
  })

  it('adopts a page-opened tab', () => {
    renderPanel({ tabId: 'browser-tab-5' })
    expect(lifecycle.ensureBrowserTab).toHaveBeenCalledWith(PANEL, 'browser-tab-5')
  })

  it('closes itself with a toast when main refuses the tab', async () => {
    lifecycle.ensureBrowserTab.mockResolvedValue({ error: 'No project is open' })
    const { close } = renderPanel()
    await act(async () => undefined)
    expect(toast).toHaveBeenCalledWith("Browser tab couldn't open", 'No project is open')
    expect(close).toHaveBeenCalled()
  })

  it('loads typed text and moves focus to the page once it shows', async () => {
    gateway.navigate.mockResolvedValue({ ok: true })
    renderPanel()
    host({ erfanaPage: 'empty', committedUrl: null })
    const field = screen.getByRole('combobox', { name: 'Address and search' })
    fireEvent.change(field, { target: { value: 'localhost:5173' } })
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }))
    expect(gateway.navigate).toHaveBeenCalledWith({
      tabId: TAB,
      input: 'localhost:5173',
      source: 'address'
    })
    expect(focusPage).toHaveBeenCalledWith(true)
  })

  it('shows a refusal under the row, linked to the field, until the next edit', async () => {
    gateway.navigate.mockResolvedValue({ refused: 'scheme' })
    renderPanel()
    host()
    const field = screen.getByRole('combobox', { name: 'Address and search' })
    fireEvent.change(field, { target: { value: 'javascript:alert(1)' } })
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("Error: Browser tabs can't open javascript: addresses.")
    expect(field).toHaveAccessibleDescription(/can't open javascript:/)
    fireEvent.change(field, { target: { value: 'javascript:alert(2)' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    [{ error: 'The address could not be opened' }, 'The address could not be opened'],
    ['reject', 'The browser tab did not answer.']
  ] as const)('toasts a navigation that failed (%#)', async (answer, message) => {
    if (answer === 'reject') gateway.navigate.mockRejectedValue(new Error('gone'))
    else gateway.navigate.mockResolvedValue(answer)
    renderPanel()
    host()
    const field = screen.getByRole('combobox', { name: 'Address and search' })
    fireEvent.change(field, { target: { value: 'example.test' } })
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }))
    expect(toast).toHaveBeenCalledWith("Couldn't open the address", message)
  })

  it('runs the toolbar buttons against its tab', () => {
    renderPanel()
    host({ canGoBack: true, canGoForward: true })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    fireEvent.click(screen.getByRole('button', { name: 'DevTools' }))
    expect(gateway.history.mock.calls).toEqual([
      [TAB, 'back'],
      [TAB, 'forward'],
      [TAB, 'reload']
    ])
    expect(gateway.devTools).toHaveBeenCalledWith(TAB)
    host({ loading: true })
    fireEvent.click(screen.getByRole('button', { name: 'Stop loading' }))
    expect(gateway.history).toHaveBeenLastCalledWith(TAB, 'stop')
  })

  it('returns focus to a live page on Esc in the field, and on F6 through the pick row', () => {
    renderPanel()
    host()
    const field = screen.getByRole('combobox', { name: 'Address and search' })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(focusPage).toHaveBeenCalledTimes(1)
    // The pick row is always reserved, so it is the next F6 zone (025-FR-047, ADR 0011 decision 5).
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'F6' })
    const pickButton = screen.getByRole('button', { name: 'Pick element' })
    expect(pickButton).toHaveFocus()
    fireEvent.keyDown(pickButton, { key: 'F6' })
    expect(focusPage).toHaveBeenCalledTimes(2)
  })

  it('moves F6 into an Erfana page instead of the native page', async () => {
    renderPanel()
    host({ erfanaPage: 'crashed' })
    act(() => screen.getByRole('combobox', { name: 'Address and search' }).focus())
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Address and search' }), { key: 'F6' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Pick element' }), { key: 'F6' })
    // The crash page's own Reload, not the navigation row's (whose tooltip text is its description).
    const erfanaPage = document.querySelector<HTMLElement>('.erf-brw-frame__erfana')
    expect(erfanaPage).not.toBeNull()
    const pageReload = within(erfanaPage as HTMLElement).getByRole('button', { name: 'Reload' })
    expect(pageReload).not.toHaveAttribute('data-tip')
    expect(document.activeElement).toBe(pageReload)
    expect(focusPage).not.toHaveBeenCalled()
  })

  it('wraps F6 to the address bar from the last zone on a first-run empty tab, where the page has nothing to focus', async () => {
    gateway.suggest.mockResolvedValue({ rows: [] })
    renderPanel()
    host({ erfanaPage: 'empty', committedUrl: null })
    await act(async () => undefined)
    const address = screen.getByRole('combobox', { name: 'Address and search' })
    act(() => address.focus())
    fireEvent.keyDown(address, { key: 'F6' })
    const pickButton = screen.getByRole('button', { name: 'Pick element' })
    expect(pickButton).toHaveFocus()
    fireEvent.keyDown(pickButton, { key: 'F6' })
    expect(address).toHaveFocus()
    expect(focusPage).not.toHaveBeenCalled()
  })

  it('025-AC-065 the first Esc on a focused toolbar control only hides its tooltip; the second returns focus to the page', () => {
    renderPanel()
    host()
    const reload = screen.getByRole('button', { name: 'Reload' })
    act(() => reload.focus())
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Reload (⌘R)')
    // Drawn inside the pick row's band (design R2-H5).
    expect(screen.getByTestId(BROWSER_TEST_IDS.PICK_ROW)).toContainElement(tooltip)
    fireEvent.keyDown(reload, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(reload).toHaveFocus()
    expect(focusPage).not.toHaveBeenCalled()
    fireEvent.keyDown(reload, { key: 'Escape' })
    expect(focusPage).toHaveBeenCalled()
  })

  it('025-AC-065 a hover-only tooltip on Pick element hides when the page\'s Esc ends pick mode', async () => {
    renderPanel()
    host()
    act(() => useBrowserPickStore.getState().apply({ tabId: TAB, kind: 'mode', on: true }))
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Pick element' }))
    await act(async () => new Promise(resolve => setTimeout(resolve, TOOLTIP_HOVER_DELAY_MS + 20)))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Stop picking')
    act(() => useBrowserPickStore.getState().apply({ tabId: TAB, kind: 'mode', on: false }))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => useBrowserPickStore.getState().forget(TAB))
  })

  it('has one hidden polite region for pick and send, and the visible status slot is not live (M-45)', () => {
    renderPanel()
    host()
    expect(screen.getByTestId(BROWSER_TEST_IDS.PICK_ANNOUNCER)).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByTestId(BROWSER_TEST_IDS.PICK_STATUS)).not.toHaveAttribute('aria-live')
    act(() => useBrowserPickStore.getState().apply({ tabId: TAB, kind: 'mode', on: true }))
    expect(screen.getByTestId(BROWSER_TEST_IDS.PICK_ANNOUNCER)).toHaveTextContent('Picking. Esc to stop.')
    act(() => useBrowserPickStore.getState().forget(TAB))
  })

  it('loads an empty-tab row as a history navigation', async () => {
    gateway.navigate.mockResolvedValue({ ok: true })
    gateway.suggest.mockResolvedValue({ rows: [{ url: 'https://recent.test/' }] })
    renderPanel()
    host({ erfanaPage: 'empty', committedUrl: null })
    fireEvent.click(await screen.findByRole('button', { name: 'recent.test' }))
    await act(async () => undefined)
    expect(gateway.navigate).toHaveBeenCalledWith({
      tabId: TAB,
      input: 'https://recent.test/',
      source: 'history'
    })
  })

  it('draws the page-focus ring only around a live page', () => {
    renderPanel()
    host()
    act(() => useBrowserTabStore.getState().setPageFocused(TAB, true))
    expect(
      screen.getByTestId(BROWSER_TEST_IDS.PAGE_PLACEHOLDER).parentElement?.className
    ).toContain('erf-brw-frame--focused')
  })

  it('reserves the pick row under the navigation row and toggles pick mode from it (025-FR-025)', () => {
    renderPanel()
    host()
    const row = screen.getByTestId(BROWSER_TEST_IDS.PICK_ROW)
    expect(row).toHaveAttribute('data-brw-zone', 'pick')
    fireEvent.click(screen.getByRole('button', { name: 'Pick element' }))
    expect(gateway.pickMode).toHaveBeenCalledWith(TAB, true)
  })

  it('draws the prompt-actions panel over the still image on a capture, and closes it on Esc', () => {
    const summary: PickSummary = {
      name: 'button.cta',
      size: '176 × 32',
      ancestors: ['html', 'button.cta'],
      box: { x: 10, y: 20, width: 176, height: 32 },
      atTop: false,
      atStart: true,
      gone: false,
      changedAfterPick: false
    }
    renderPanel()
    host()
    act(() => {
      useBrowserStillStore.getState().set(TAB, { image: { data: new Uint8Array(4), width: 1, height: 1 }, source: 'pick' })
      useBrowserPickStore.getState().apply({ tabId: TAB, kind: 'mode', on: true })
      useBrowserPickStore
        .getState()
        .apply({ tabId: TAB, kind: 'captured', captureId: 'a'.repeat(32), still: new Uint8Array(4), stillWidth: 1, stillHeight: 1, summary })
    })
    expect(screen.getByTestId(BROWSER_TEST_IDS.STILL)).toBeInTheDocument()
    const panel = screen.getByTestId(BROWSER_TEST_IDS.PROMPT_ACTIONS)
    const explain = screen.getByRole('button', { name: 'Explain' })
    expect(explain).toHaveFocus()
    // Focus into a menu in the portal (the panel's target menu) has not left the tab.
    const portal = document.createElement('div')
    portal.id = 'portal-root'
    const item = document.createElement('button')
    portal.appendChild(item)
    document.body.appendChild(portal)
    fireEvent.blur(explain, { relatedTarget: item })
    expect(screen.getByTestId(BROWSER_TEST_IDS.PROMPT_ACTIONS)).toBeInTheDocument()
    portal.remove()
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(gateway.closePick).toHaveBeenCalledWith({ tabId: TAB, captureId: 'a'.repeat(32), reason: 'esc' })
    expect(screen.queryByTestId(BROWSER_TEST_IDS.PROMPT_ACTIONS)).toBeNull()
    act(() => {
      useBrowserPickStore.getState().forget(TAB)
      useBrowserStillStore.getState().clear(TAB)
    })
  })

  it('keeps the panel open when the address field lets go because the page took focus', () => {
    const summary: PickSummary = {
      name: 'a',
      size: '1 × 1',
      ancestors: ['html', 'a'],
      box: { x: 0, y: 0, width: 1, height: 1 },
      atTop: false,
      atStart: true,
      gone: false,
      changedAfterPick: false
    }
    renderPanel()
    host()
    act(() => {
      useBrowserStillStore.getState().set(TAB, { image: { data: new Uint8Array(4), width: 1, height: 1 }, source: 'pick' })
      useBrowserPickStore
        .getState()
        .apply({ tabId: TAB, kind: 'captured', captureId: 'd'.repeat(32), still: new Uint8Array(4), stillWidth: 1, stillHeight: 1, summary })
    })
    const field = screen.getByRole('combobox', { name: 'Address and search' })
    act(() => field.focus())
    act(() => pageFocusOptions.onFocused?.())
    expect(field).not.toHaveFocus()
    expect(gateway.closePick).not.toHaveBeenCalled()
    expect(screen.getByTestId(BROWSER_TEST_IDS.PROMPT_ACTIONS)).toBeInTheDocument()
    act(() => {
      useBrowserPickStore.getState().forget(TAB)
      useBrowserStillStore.getState().clear(TAB)
    })
  })

  it('closes the panel when focus leaves the tab', () => {
    const summary: PickSummary = {
      name: 'a',
      size: '1 × 1',
      ancestors: ['html', 'a'],
      box: { x: 0, y: 0, width: 1, height: 1 },
      atTop: false,
      atStart: true,
      gone: false,
      changedAfterPick: false
    }
    renderPanel()
    host()
    act(() => {
      useBrowserStillStore.getState().set(TAB, { image: { data: new Uint8Array(4), width: 1, height: 1 }, source: 'pick' })
      useBrowserPickStore
        .getState()
        .apply({ tabId: TAB, kind: 'captured', captureId: 'b'.repeat(32), still: new Uint8Array(4), stillWidth: 1, stillHeight: 1, summary })
    })
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    fireEvent.blur(screen.getByRole('button', { name: 'Explain' }), { relatedTarget: outside })
    expect(gateway.closePick).toHaveBeenCalledWith({ tabId: TAB, captureId: 'b'.repeat(32), reason: 'focusLeft' })
    outside.remove()
    act(() => {
      useBrowserPickStore.getState().forget(TAB)
      useBrowserStillStore.getState().clear(TAB)
    })
  })
  it('closes an open dialog without sending when another editor tab hides this one (025-FR-052)', () => {
    const summary: PickSummary = {
      name: 'a',
      size: '1 × 1',
      ancestors: ['html', 'a'],
      box: { x: 0, y: 0, width: 1, height: 1 },
      atTop: false,
      atStart: true,
      gone: false,
      changedAfterPick: false
    }
    const { setVisible } = renderPanel()
    host()
    act(() => {
      useBrowserStillStore.getState().set(TAB, { image: { data: new Uint8Array(4), width: 1, height: 1 }, source: 'pick' })
      useBrowserPickStore
        .getState()
        .apply({ tabId: TAB, kind: 'captured', captureId: 'c'.repeat(32), still: new Uint8Array(4), stillWidth: 1, stillHeight: 1, summary })
    })
    const change = screen.getByRole('button', { name: 'Change' })
    // A fresh Enter on the action, then its keyboard click (025-FR-030).
    fireEvent.keyDown(change, { key: 'Enter' })
    fireEvent.click(change)
    expect(screen.getByTestId(BROWSER_TEST_IDS.INSTRUCTION_DIALOG)).toBeInTheDocument()
    setVisible(false)
    expect(gateway.closePick).toHaveBeenCalledWith({ tabId: TAB, captureId: 'c'.repeat(32), reason: 'tabHidden' })
    expect(screen.queryByTestId(BROWSER_TEST_IDS.INSTRUCTION_DIALOG)).toBeNull()
    act(() => {
      useBrowserPickStore.getState().forget(TAB)
      useBrowserStillStore.getState().clear(TAB)
    })
  })
})
