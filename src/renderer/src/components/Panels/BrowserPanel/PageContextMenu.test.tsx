// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const { gateway, warn } = vi.hoisted(() => ({
  gateway: { contextAction: vi.fn(async () => ({ ok: true })) },
  warn: vi.fn()
}))
vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../utils/logger', () => ({ logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('../../../utils/platform', () => ({ isMacOS: () => false, isWindows: () => true }))
const still = vi.hoisted(() => ({ release: vi.fn() }))
vi.mock('../../../services/browser/browserStill', () => ({ browserStill: still, CONTEXT_MENU_STILL_HOLDER: 'contextMenu' }))

import { PageContextMenu } from './PageContextMenu'
import { useBrowserChromeStore } from '../../../stores/useBrowserChromeStore'

const TAB = 'browser-tab-1'
let portalRoot: HTMLDivElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'portal-root'
  document.body.appendChild(portalRoot)
})

afterEach(() => {
  cleanup()
  portalRoot.remove()
  useBrowserChromeStore.setState({ menu: null })
  vi.clearAllMocks()
})

function open(): void {
  act(() => {
    useBrowserChromeStore.getState().openMenu({
      tabId: TAB,
      menuId: 'm1',
      items: ['back', 'reload', 'openLinkInNewTab'],
      linkOrigin: { kind: 'nonWeb', scheme: 'mailto' },
      at: { x: 40, y: 30 }
    })
  })
}

describe('PageContextMenu', () => {
  it('draws nothing without a menu for this tab', () => {
    const { container } = render(<PageContextMenu tabId={TAB} pageOrigin={() => null} onClosed={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    open()
    const other = render(<PageContextMenu tabId="browser-tab-2" pageOrigin={() => null} onClosed={vi.fn()} />)
    expect(other.container).toBeEmptyDOMElement()
  })

  it('shows "Page actions" with the link header and the keys, and sends the chosen action', () => {
    const onClosed = vi.fn()
    render(<PageContextMenu tabId={TAB} pageOrigin={() => ({ left: 100, top: 50 })} onClosed={onClosed} />)
    open()
    const menu = screen.getByRole('menu', { name: 'Page actions' })
    expect(menu).toHaveAccessibleDescription('mailto: link – opens your email app')
    expect(screen.getByText('Alt+←')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Reload/ }))
    expect(gateway.contextAction).toHaveBeenCalledWith({ tabId: TAB, menuId: 'm1', action: 'reload' })
    expect(useBrowserChromeStore.getState().menu).toBeNull()
    expect(onClosed).toHaveBeenCalled()
  })

  it('logs a refused action', async () => {
    gateway.contextAction.mockRejectedValueOnce(new Error('stale'))
    render(<PageContextMenu tabId={TAB} pageOrigin={() => null} onClosed={vi.fn()} />)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /Back/ }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(warn).toHaveBeenCalledWith('Browser page menu action failed', { error: 'stale' })
  })

  it('lets the still image go as it closes (ADR 0011)', () => {
    const onClosed = vi.fn()
    render(<PageContextMenu tabId={TAB} pageOrigin={() => null} onClosed={onClosed} />)
    open()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(still.release).toHaveBeenCalledWith(TAB, 'contextMenu')
    expect(onClosed).toHaveBeenCalledOnce()
  })
})
