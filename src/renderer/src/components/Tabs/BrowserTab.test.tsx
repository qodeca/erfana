// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview'

vi.mock('./useTabContextMenu', () => ({ useTabContextMenu: () => [] }))
vi.mock('../ContextMenu/ContextMenu', () => ({ ContextMenu: () => <div data-testid="context-menu" /> }))
vi.mock('../../utils/platform', () => ({ isMacOS: () => true, isWindows: () => false }))
const lifecycle = vi.hoisted(() => ({
  requestBrowserPanelClose: vi.fn((_panelId: string, removePanel: () => void) => removePanel())
}))
vi.mock('../../services/browser/browserTabLifecycle', () => lifecycle)

import { BrowserTab } from './BrowserTab'
import { NewBrowserTabButton } from './NewBrowserTabButton'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'
import type { BrowserPanelParams } from '../../utils/openBrowserTab'
import { browserState } from '../Panels/BrowserPanel/__test__/browserState'

const project = vi.hoisted(() => ({ path: '/proj' as string | null }))
vi.mock('../../context/ProjectManagementContext', () => ({
  useProjectManagementContext: () => ({ projectPath: project.path })
}))
const openBrowserTab = vi.hoisted(() => vi.fn())
vi.mock('../../utils/openBrowserTab', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/openBrowserTab')>()),
  openBrowserTab
}))

const PANEL = 'browser-panel-1'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function renderTab(): { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn()
  const props = { params: { panelId: PANEL }, api: { id: PANEL, close } } as unknown as IDockviewPanelHeaderProps<BrowserPanelParams>
  render(<BrowserTab {...props} />)
  return { close }
}

function host(patch: Parameters<typeof browserState>[0] = {}, icon?: Uint8Array): void {
  act(() => {
    useBrowserTabStore.getState().attach(PANEL, 'browser-tab-1')
    useBrowserTabStore.getState().applyState({ ...browserState(patch), ...(icon ? { icon } : {}) })
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  project.path = '/proj'
  useBrowserTabStore.setState({ byTab: new Map(), tabByPanel: new Map(), unhosted: new Map() })
})

describe('BrowserTab', () => {
  it('reads "New browser tab" before anything loads, with the fixed kind mark only', () => {
    renderTab()
    expect(screen.getByText('New browser tab')).toBeInTheDocument()
    expect(document.querySelector('.erf-brw-tab__kind svg')).not.toBeNull()
    expect(document.querySelector('img')).toBeNull()
  })

  it('shows the title in a bdi, the site icon after the kind mark, and the address in the tooltip', () => {
    renderTab()
    host({ title: 'Docs' }, PNG)
    const label = screen.getByText('Docs')
    expect(label.tagName).toBe('BDI')
    expect(label).toHaveAttribute('dir', 'auto')
    expect(document.querySelector('img.erf-brw-tab__icon')?.getAttribute('src')).toMatch(/^data:image\/png/)
    expect(document.querySelector('.erf-brw-tab')).toHaveAttribute('title', 'www.example.test/docs\nTitle: Docs')
    expect(screen.getByRole('button', { name: 'Close Docs' })).toHaveAttribute('title', 'Close (⌘W)')
  })

  it('shows the host while loading with no title, and says it is loading', () => {
    renderTab()
    host({ title: '', loading: true })
    expect(screen.getByText('www.example.test')).toBeInTheDocument()
    expect(screen.getByText(', loading')).toBeInTheDocument()
  })

  it('closes on the close button and on a middle click, and opens the tab menu on right click', () => {
    const { close } = renderTab()
    host()
    fireEvent.click(screen.getByRole('button', { name: 'Close Docs' }))
    const tab = document.querySelector('.erf-brw-tab') as HTMLElement
    fireEvent(tab, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    fireEvent(tab, new MouseEvent('auxclick', { bubbles: true, button: 2 }))
    expect(close).toHaveBeenCalledTimes(2)
    // Each close asked main first (025-FR-058).
    expect(lifecycle.requestBrowserPanelClose).toHaveBeenCalledTimes(2)
    expect(lifecycle.requestBrowserPanelClose).toHaveBeenCalledWith(PANEL, expect.any(Function))
    fireEvent.contextMenu(tab)
    expect(screen.getByTestId('context-menu')).toBeInTheDocument()
    fireEvent.dragStart(tab)
  })
})

describe('NewBrowserTabButton', () => {
  it('opens a browser tab in its dockview', () => {
    const containerApi = {}
    render(<NewBrowserTabButton {...({ containerApi } as unknown as IDockviewHeaderActionsProps)} />)
    fireEvent.click(screen.getByRole('button', { name: 'New browser tab' }))
    expect(openBrowserTab).toHaveBeenCalledWith(containerApi)
  })

  it('is not shown without a project', () => {
    project.path = null
    render(<NewBrowserTabButton {...({ containerApi: {} } as unknown as IDockviewHeaderActionsProps)} />)
    expect(screen.queryByRole('button', { name: 'New browser tab' })).not.toBeInTheDocument()
  })
})
