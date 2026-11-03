// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { IDockviewPanelProps } from 'dockview'

const gateway = vi.hoisted(() => ({
  navigate: vi.fn(),
  history: vi.fn(async () => undefined),
  devTools: vi.fn(async () => undefined),
  suggest: vi.fn(async (): Promise<{ rows: Array<{ url: string }> }> => ({ rows: [] })),
  toolbarFocus: vi.fn(),
  onForwardedKey: vi.fn(() => () => undefined)
}))
const lifecycle = vi.hoisted(() => ({ ensureBrowserTab: vi.fn() }))
const focusPage = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => vi.fn())

vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../services/browser/browserTabLifecycle', () => lifecycle)
vi.mock('./useBrowserBounds', () => ({ useBrowserBounds: () => ({ pushBounds: () => true }) }))
vi.mock('./useBrowserPageFocus', () => ({ useBrowserPageFocus: () => focusPage }))
vi.mock('../../../utils/toastHelpers', () => ({ showErrorToast: toast }))
vi.mock('../../../utils/platform', () => ({ isMacOS: () => true, isWindows: () => false }))
vi.mock('../../../utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

import { BrowserPanel } from './BrowserPanel'
import { useBrowserTabStore } from '../../../stores/useBrowserTabStore'
import type { BrowserPanelParams } from '../../../utils/openBrowserTab'
import { browserState } from './__test__/browserState'
import { BROWSER_TEST_IDS } from './browserTestIds'

const PANEL = 'browser-panel-1'
const TAB = 'browser-tab-1'

function renderPanel(params: Partial<BrowserPanelParams> = {}): {
  close: ReturnType<typeof vi.fn>
} {
  const close = vi.fn()
  const api = {
    id: PANEL,
    close,
    isVisible: true,
    onDidVisibilityChange: () => ({ dispose: () => undefined }),
    group: { panels: [], activePanel: undefined }
  }
  const props = {
    params: { panelId: PANEL, ...params },
    api,
    containerApi: {}
  } as unknown as IDockviewPanelProps<BrowserPanelParams>
  render(<BrowserPanel {...props} />)
  return { close }
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
    expect(screen.getByRole('textbox', { name: 'Address and search' })).toHaveFocus()
    expect(screen.getByText(/Load your app, then click/)).toBeInTheDocument()
    expect(screen.getByTestId(BROWSER_TEST_IDS.PANEL)).toHaveAttribute('data-browser-tab-id', TAB)
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
    const field = screen.getByRole('textbox', { name: 'Address and search' })
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
    const field = screen.getByRole('textbox', { name: 'Address and search' })
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
    const field = screen.getByRole('textbox', { name: 'Address and search' })
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

  it('returns focus to a live page on Esc in the field, and on F6 from the row', () => {
    renderPanel()
    host()
    const field = screen.getByRole('textbox', { name: 'Address and search' })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(focusPage).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'F6' })
    expect(focusPage).toHaveBeenCalledTimes(2)
  })

  it('moves F6 into an Erfana page instead of the native page', async () => {
    renderPanel()
    host({ erfanaPage: 'crashed' })
    act(() => screen.getByRole('textbox', { name: 'Address and search' }).focus())
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Address and search' }), { key: 'F6' })
    expect(screen.getByRole('button', { name: 'Reload', description: '' })).toBeDefined()
    expect(document.activeElement).toHaveTextContent('Reload')
    expect(focusPage).not.toHaveBeenCalled()
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
})
