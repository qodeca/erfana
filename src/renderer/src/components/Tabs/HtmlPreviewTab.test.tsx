// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link HtmlPreviewTab} (Issue #74, work item 72).
 *
 * @see HtmlPreviewTab.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { IDockviewPanelHeaderProps } from 'dockview'

import { HtmlPreviewTab } from './HtmlPreviewTab'
import { usePreviewStore } from '../../stores/usePreviewStore'
import { useOverlayOccluderStore } from '../../stores/useOverlayOccluderStore'
import type { PreviewFailure } from '../../../../shared/ipc/preview-schema'
import { ErrorCode } from '../../../../shared/errors'

vi.mock('./useTabContextMenu', () => ({
  useTabContextMenu: () => [{ label: 'Close', icon: null, action: vi.fn() }]
}))

vi.mock('../../context/ProjectManagementContext', () => ({
  useProjectManagementContext: () => ({ projectPath: '/proj' })
}))

vi.mock('../ContextMenu/ContextMenu', () => ({
  ContextMenu: () => <div data-testid="context-menu" />
}))

type TabProps = IDockviewPanelHeaderProps<{ filePath?: string; panelId?: string }>

function makeProps(filePath: string): TabProps {
  const api = {
    id: `preview-${filePath}`,
    title: undefined as string | undefined,
    close: vi.fn(),
    onDidTitleChange: vi.fn(() => ({ dispose: vi.fn() }))
  }
  return { params: { filePath, panelId: api.id }, api } as unknown as TabProps
}

/** Build a single blocked-host failure entry for a panel. */
function blockedHost(host: string, id = '1'): PreviewFailure {
  return {
    id,
    type: 'blocked-host',
    resourceUrlOrHost: host,
    reasonCode: ErrorCode.PREVIEW_HOST_NOT_APPROVABLE,
    timestamp: 1
  }
}

let portalRoot: HTMLDivElement

beforeEach(() => {
  usePreviewStore.getState().reset()
  useOverlayOccluderStore.getState().reset()
  portalRoot = document.createElement('div')
  portalRoot.id = 'portal-root'
  document.body.appendChild(portalRoot)
})

afterEach(() => {
  cleanup()
  document.body.removeChild(portalRoot)
})

describe('HtmlPreviewTab', () => {
  let props: TabProps

  beforeEach(() => {
    props = makeProps('/proj/pages/index.html')
  })

  it('renders the basename as the label', () => {
    render(<HtmlPreviewTab {...props} />)
    expect(screen.getByText('index.html')).toBeInTheDocument()
  })

  it('closes the panel from the close button', () => {
    render(<HtmlPreviewTab {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close index.html' }))
    expect(props.api.close).toHaveBeenCalledTimes(1)
  })

  it('closes on middle-click', () => {
    render(<HtmlPreviewTab {...props} />)
    const tab = screen.getByText('index.html').closest('.html-preview-tab')!
    fireEvent(tab, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))
    expect(props.api.close).toHaveBeenCalledTimes(1)
  })

  it('shows the failure indicator reflecting the store count for its panelId (AC20)', () => {
    const panelId = props.params!.panelId!
    usePreviewStore.getState().pushFailures(panelId, [blockedHost('cdn.example')])
    render(<HtmlPreviewTab {...props} />)
    expect(screen.getByRole('button', { name: '1 preview issue' })).toBeInTheDocument()
  })

  it('hides the indicator when the panel has no failures', () => {
    render(<HtmlPreviewTab {...props} />)
    expect(screen.queryByRole('button', { name: /preview issue/ })).toBeNull()
  })

  it('reads the count for its own panelId only', () => {
    // Failures for a different panel must not surface on this tab.
    usePreviewStore.getState().pushFailures('other-panel', [blockedHost('elsewhere.example')])
    render(<HtmlPreviewTab {...props} />)
    expect(screen.queryByRole('button', { name: /preview issue/ })).toBeNull()
  })

  it('opens the popover from the tab and hides the native view while open (§1.8)', () => {
    const panelId = props.params!.panelId!
    usePreviewStore.getState().pushFailures(panelId, [blockedHost('cdn.example')])
    render(<HtmlPreviewTab {...props} />)

    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '1 preview issue' }))
    expect(screen.getByText('cdn.example')).toBeInTheDocument()
    // Popover open → a `menu` occluder is registered so the native view hides.
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

    // Escape closes the disclosure and releases the occluder (a11y preserved).
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('cdn.example')).toBeNull()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })
})
