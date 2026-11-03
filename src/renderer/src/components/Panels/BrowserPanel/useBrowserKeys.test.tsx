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

function Harness(props: Overrides & { api: UseBrowserKeysOptions['api'] }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const keys = useBrowserKeys({
    tabId: props.tabId === undefined ? 'browser-tab-1' : props.tabId,
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
    expect(api.close).toHaveBeenCalledOnce()
    send('newTab')
    expect(openBrowserTab).toHaveBeenCalledOnce()
    send('nextEditorTab')
    expect(panels[1].api.setActive).toHaveBeenCalled()
    send('previousEditorTab')
    expect(panels[2].api.setActive).toHaveBeenCalled()
    send('find')
    send('focusPanel')
    expect(logger.debug).toHaveBeenCalledTimes(2)
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

  it('ends a reported toolbar focus on unmount', () => {
    const { unmount } = render(<Harness api={makeGroup().api} />)
    act(() => screen.getByRole('button', { name: 'Reload' }).focus())
    unmount()
    expect(gateway.toolbarFocus).toHaveBeenLastCalledWith('browser-tab-1', false)
  })

  it('moves F6 between the navigation row and the page area, and Esc on a row button to the page', () => {
    const focusAddress = vi.fn()
    const focusPageArea = vi.fn()
    render(
      <Harness api={makeGroup().api} focusAddress={focusAddress} focusPageArea={focusPageArea} />
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'F6' })
    expect(focusPageArea).toHaveBeenCalledOnce()
    fireEvent.keyDown(screen.getByRole('button', { name: 'In page' }), {
      key: 'F6',
      shiftKey: true
    })
    expect(focusAddress).toHaveBeenCalledOnce()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'Escape' })
    expect(focusPageArea).toHaveBeenCalledTimes(2)
    // Esc in the field is the address bar's own; Ctrl+F6 is not F6.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'field' }), { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reload' }), { key: 'F6', ctrlKey: true })
    expect(focusPageArea).toHaveBeenCalledTimes(2)
  })
})
