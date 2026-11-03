// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import type { DockviewApi } from 'dockview'

const forwarded = vi.hoisted(() => ({
  listener: null as null | ((event: { tabId: string; action: string }) => void)
}))
const gateway = vi.hoisted(() => ({
  history: vi.fn(async () => undefined),
  devTools: vi.fn(async () => undefined),
  toolbarFocus: vi.fn(),
  onForwardedKey: vi.fn((listener: (event: { tabId: string; action: string }) => void) => {
    forwarded.listener = listener
    return () => (forwarded.listener = null)
  })
}))
const openBrowserTab = vi.hoisted(() => vi.fn())

vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../utils/openBrowserTab', () => ({ openBrowserTab }))
vi.mock('../../../utils/logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }))
const lifecycle = vi.hoisted(() => ({
  requestBrowserPanelClose: vi.fn((_panelId: string, removePanel: () => void) => removePanel())
}))
vi.mock('../../../services/browser/browserTabLifecycle', () => lifecycle)
const openFind = vi.hoisted(() => vi.fn())

import { useBrowserKeys, type UseBrowserKeysOptions } from './useBrowserKeys'
import { logger } from '../../../utils/logger'

type Overrides = Partial<
  Pick<UseBrowserKeysOptions, 'tabId' | 'focusAddress' | 'focusLastTool' | 'focusPageArea'>
>

function makeGroup(): {
  api: UseBrowserKeysOptions['api']
  panels: Array<{ id: string; api: { setActive: ReturnType<typeof vi.fn> } }>
} {
  const panels = ['a', 'b', 'c'].map(id => ({ id, api: { setActive: vi.fn() } }))
  const api = {
    close: vi.fn(),
    group: { panels, activePanel: panels[0] }
  } as unknown as UseBrowserKeysOptions['api']
  return { api, panels }
}

/** A panel with every F6 zone: the navigation row, the pick row, the strip, a page-area control and the panel. */
function ZonesHarness(
  props: Overrides &
    Pick<UseBrowserKeysOptions, 'pickSurface' | 'closePanel'> & { readonly pick?: boolean; readonly strip?: 'buttons' | 'empty' | 'none' }
): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const keys = useBrowserKeys({
    tabId: props.tabId === undefined ? 'browser-tab-1' : props.tabId,
    panelId: 'browser-panel-1',
    openFind,
    api: makeGroup().api,
    containerApi: {} as DockviewApi,
    rootRef,
    navRef,
    focusAddress: props.focusAddress ?? vi.fn(),
    focusLastTool: props.focusLastTool ?? vi.fn(),
    focusPageArea: props.focusPageArea ?? vi.fn(),
    pickSurface: props.pickSurface,
    closePanel: props.closePanel
  })
  const strip = props.strip ?? 'buttons'
  return (
    <div ref={rootRef} onKeyDown={keys.onKeyDown}>
      <div ref={navRef}>
        <button type="button">Reload</button>
      </div>
      {props.pick !== false && (
        <div data-brw-zone="pick">
          <button type="button">Pick element</button>
          <button type="button">Target</button>
        </div>
      )}
      {strip !== 'none' && (
        <div data-testid="browser-strip">
          {strip === 'buttons' && (
            <>
              <button type="button">Allow</button>
              <button type="button">Block</button>
            </>
          )}
        </div>
      )}
      <button type="button">In page</button>
      <div className="erf-brw-actions">
        <button type="button">Explain</button>
      </div>
    </div>
  )
}

function Harness(props: Overrides & { api: UseBrowserKeysOptions['api'] }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const keys = useBrowserKeys({
    tabId: props.tabId === undefined ? 'browser-tab-1' : props.tabId,
    panelId: 'browser-panel-1',
    openFind,
    api: props.api,
    containerApi: {} as DockviewApi,
    rootRef,
    navRef,
    focusAddress: props.focusAddress ?? vi.fn(),
    focusLastTool: props.focusLastTool ?? vi.fn(),
    focusPageArea: props.focusPageArea ?? vi.fn()
  })
  return (
    <div>
      <div ref={rootRef} onKeyDown={keys.onKeyDown} onFocus={keys.onFocus} onBlur={keys.onBlur}>
        <div ref={navRef}>
          <button type="button">Reload</button>
          <input aria-label="field" />
        </div>
        <button type="button">In page</button>
      </div>
      <button type="button">Outside</button>
    </div>
  )
}

function send(action: string, tabId = 'browser-tab-1'): void {
  act(() => forwarded.listener?.({ tabId, action }))
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useBrowserKeys – forwarded keys', () => {
  it('acts on this tab’s actions only', () => {
    const focusAddress = vi.fn()
    const focusLastTool = vi.fn()
    const { api, panels } = makeGroup()
    render(<Harness api={api} focusAddress={focusAddress} focusLastTool={focusLastTool} />)
    send('focusAddress')
    send('focusNextZone')
    send('focusAddress', 'browser-tab-2')
    expect(focusAddress).toHaveBeenCalledTimes(2)
    send('focusPreviousZone')
    expect(focusLastTool).toHaveBeenCalledOnce()
    send('reload')
    send('back')
    send('forward')
    expect(gateway.history.mock.calls).toEqual([
      ['browser-tab-1', 'reload'],
      ['browser-tab-1', 'back'],
      ['browser-tab-1', 'forward']
    ])
    send('devTools')
    expect(gateway.devTools).toHaveBeenCalledWith('browser-tab-1')
    send('closeTab')
    // The user's close asks main first (025-FR-058); the lifecycle removes the editor tab.
    expect(lifecycle.requestBrowserPanelClose).toHaveBeenCalledWith('browser-panel-1', expect.any(Function))
    expect(api.close).toHaveBeenCalledOnce()
    send('newTab')
    expect(openBrowserTab).toHaveBeenCalledOnce()
    send('nextEditorTab')
    expect(panels[1].api.setActive).toHaveBeenCalled()
    send('previousEditorTab')
    expect(panels[2].api.setActive).toHaveBeenCalled()
    send('find')
    expect(openFind).toHaveBeenCalledOnce()
    send('focusPanel')
    expect(logger.debug).toHaveBeenCalledTimes(1)
  })

  it('closes the open panel before Ctrl/Cmd+L moves to the address bar (025-FR-049)', () => {
    const closePanel = vi.fn()
    const focusAddress = vi.fn()
    render(<ZonesHarness pickSurface="panel" closePanel={closePanel} focusAddress={focusAddress} />)
    send('focusAddress')
    expect(closePanel).toHaveBeenCalledOnce()
    expect(focusAddress).toHaveBeenCalledOnce()
  })

  it('switches editor tabs on Ctrl+Tab and Ctrl+Shift+Tab from the tab’s own controls', () => {
    const { api, panels } = makeGroup()
    render(<Harness api={api} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'Tab', ctrlKey: true })
    expect(panels[1].api.setActive).toHaveBeenCalledOnce()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'Tab', ctrlKey: true, shiftKey: true })
    expect(panels[2].api.setActive).toHaveBeenCalledOnce()
  })

  it('logs a failed action, and does not switch tabs in a group of one', async () => {
    gateway.history.mockRejectedValueOnce(new Error('gone'))
    const panel = { id: 'a', api: { setActive: vi.fn() } }
    const api = {
      close: vi.fn(),
      group: { panels: [panel], activePanel: panel }
    } as unknown as UseBrowserKeysOptions['api']
    render(<Harness api={api} />)
    send('reload')
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled())
    send('nextEditorTab')
    expect(panel.api.setActive).not.toHaveBeenCalled()
  })

  it('does not listen without a tab', () => {
    render(<Harness api={makeGroup().api} tabId={null} />)
    expect(gateway.onForwardedKey).not.toHaveBeenCalled()
  })
})

describe('useBrowserKeys – toolbar focus and keys', () => {
  it('reports toolbar focus once on entering and once on leaving the panel', () => {
    render(<Harness api={makeGroup().api} />)
    act(() => screen.getByRole('button', { name: 'Reload' }).focus())
    act(() => screen.getByRole('textbox', { name: 'field' }).focus())
    expect(gateway.toolbarFocus.mock.calls).toEqual([['browser-tab-1', true]])
    act(() => screen.getByRole('button', { name: 'Outside' }).focus())
    expect(gateway.toolbarFocus.mock.calls).toEqual([
      ['browser-tab-1', true],
      ['browser-tab-1', false]
    ])
  })

  it('keeps toolbar focus while focus is in a menu the tab drew in the portal root (025-FR-030)', () => {
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    const item = document.createElement('div')
    item.tabIndex = -1
    item.setAttribute('role', 'menuitem')
    portalRoot.appendChild(item)
    document.body.appendChild(portalRoot)
    render(<Harness api={makeGroup().api} />)
    act(() => screen.getByRole('button', { name: 'Reload' }).focus())
    act(() => item.focus())
    expect(gateway.toolbarFocus.mock.calls).toEqual([['browser-tab-1', true]])
    portalRoot.remove()
  })

  it('ends a reported toolbar focus on unmount', () => {
    const { unmount } = render(<Harness api={makeGroup().api} />)
    act(() => screen.getByRole('button', { name: 'Reload' }).focus())
    unmount()
    expect(gateway.toolbarFocus).toHaveBeenLastCalledWith('browser-tab-1', false)
  })

  it('moves F6 between the navigation row and the page area, and Esc on a row button to the page', () => {
    const focusAddress = vi.fn()
    const focusPageArea = vi.fn()
    const focusLastTool = vi.fn()
    render(
      <Harness api={makeGroup().api} focusAddress={focusAddress} focusPageArea={focusPageArea} focusLastTool={focusLastTool} />
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'F6' })
    expect(focusPageArea).toHaveBeenCalledOnce()
    fireEvent.keyDown(screen.getByRole('button', { name: 'In page' }), { key: 'F6' })
    expect(focusAddress).toHaveBeenCalledOnce()
    // Shift+F6 from the page area: the last zone's last control – here the navigation row's, More (025-FR-047).
    fireEvent.keyDown(screen.getByRole('button', { name: 'In page' }), {
      key: 'F6',
      shiftKey: true
    })
    expect(focusLastTool).toHaveBeenCalledOnce()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'F6', shiftKey: true })
    expect(focusPageArea).toHaveBeenCalledTimes(2)
    focusPageArea.mockClear()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'Escape' })
    expect(focusPageArea).toHaveBeenCalledTimes(1)
    // Esc in the field is the address bar's own; Ctrl+F6 is not F6.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'field' }), { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'F6', ctrlKey: true })
    expect(focusPageArea).toHaveBeenCalledTimes(1)
  })

  it('cycles F6 through the navigation row, the pick row and the strip, and Shift+F6 back (025-FR-047)', () => {
    const focusAddress = vi.fn()
    const focusPageArea = vi.fn()
    render(<ZonesHarness focusAddress={focusAddress} focusPageArea={focusPageArea} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'F6' })
    expect(screen.getByRole('button', { name: 'Pick element' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Pick element' }), { key: 'F6' })
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Allow' }), { key: 'F6' })
    expect(focusPageArea).toHaveBeenCalledOnce()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Allow' }), { key: 'F6', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Target' })).toHaveFocus()
    // From the page: Shift+F6 lands on the strip's last control; Esc on a pick-row button returns to the page.
    fireEvent.keyDown(screen.getByRole('button', { name: 'In page' }), { key: 'F6', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Block' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Target' }), { key: 'Escape' })
    expect(focusPageArea).toHaveBeenCalledTimes(2)
  })

  it('takes main\'s forwarded Shift+F6 to the last zone\'s last control', () => {
    render(<ZonesHarness />)
    act(() => forwarded.listener?.({ tabId: 'browser-tab-1', action: 'focusPreviousZone' }))
    expect(screen.getByRole('button', { name: 'Block' })).toHaveFocus()
  })

  it('with the panel open and no strip controls, Shift+F6 lands on More; without a pick row F6 only closes', () => {
    const closePanel = vi.fn()
    const focusLastTool = vi.fn()
    const { rerender } = render(<ZonesHarness pickSurface="panel" closePanel={closePanel} focusLastTool={focusLastTool} strip="empty" />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Explain' }), { key: 'F6', shiftKey: true })
    expect(focusLastTool).toHaveBeenCalledOnce()
    rerender(<ZonesHarness pickSurface="panel" closePanel={closePanel} focusLastTool={focusLastTool} strip="none" pick={false} />)
    screen.getByRole('button', { name: 'Explain' }).focus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Explain' }), { key: 'F6' })
    expect(closePanel).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Explain' })).toHaveFocus()
  })

  it('moves nothing on Shift+F6 from the page area before the tab exists', () => {
    const focusLastTool = vi.fn()
    render(<ZonesHarness tabId={null} focusLastTool={focusLastTool} />)
    screen.getByRole('button', { name: 'In page' }).focus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'In page' }), { key: 'F6', shiftKey: true })
    expect(focusLastTool).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'In page' })).toHaveFocus()
  })

  it('with the panel open F6 closes it and lands on Pick element; with the dialog open it moves nothing', () => {
    const closePanel = vi.fn()
    const { rerender } = render(<ZonesHarness pickSurface="panel" closePanel={closePanel} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Explain' }), { key: 'F6' })
    expect(closePanel).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Pick element' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Explain' }), { key: 'F6', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Block' })).toHaveFocus()
    rerender(<ZonesHarness pickSurface="dialog" closePanel={closePanel} />)
    screen.getByRole('button', { name: 'Explain' }).focus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Explain' }), { key: 'F6' })
    expect(closePanel).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Explain' })).toHaveFocus()
  })
})
