// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link HtmlPreviewTab} (Issue #74, work item 72).
 *
 * @see HtmlPreviewTab.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { DockviewReact, type DockviewApi, type IDockviewPanelHeaderProps } from 'dockview'

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

  it('offers no export in its context menu — that lives on the preview toolbar', () => {
    // It used to be prepended here, because the panel surface is painted over by
    // the native view and the tab was the only chrome that survived (UX-003).
    // The preview has its own toolbar above the view now, which is where the
    // markdown editor has always kept its export button. An export hidden behind
    // a right-click on a tab handle is an export nobody finds.
    render(<HtmlPreviewTab {...props} />)
    fireEvent.contextMenu(screen.getByText('index.html').closest('.html-preview-tab')!)

    expect(screen.queryByText('Export as PDF')).toBeNull()
    expect(screen.queryByText('Export to PDF')).toBeNull()
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

  describe('after a same-tab move (issue #124, part 3 §3.4)', () => {
    it('follows params.filePath: label, tooltip and close label name the new page', () => {
      const { rerender } = render(<HtmlPreviewTab {...props} />)

      rerender(
        <HtmlPreviewTab
          {...props}
          params={{ ...props.params, filePath: '/proj/pages/pricing.html' }}
        />
      )

      const tab = screen.getByText('pricing.html').closest('.html-preview-tab')
      expect(tab).toHaveAttribute('title', 'pricing.html\npages/pricing.html')
      expect(screen.getByRole('button', { name: 'Close pricing.html' })).toBeInTheDocument()
      expect(screen.queryByText('index.html')).toBeNull()
    })

    it('is re-rendered by dockview itself when the panel calls updateParameters', async () => {
      // Pins the dockview contract the design leans on: `updateParameters`
      // reaches the TAB component too (panelApi → DockviewPanel.update →
      // DockviewPanelModel.update → the React header part). Were it ever to stop,
      // the tab would keep naming the old page after a move, and HtmlPreviewTab
      // would have to subscribe to `api.onDidParametersChange` itself.
      let dockApi: DockviewApi | undefined
      render(
        <DockviewReact
          components={{ htmlPreview: () => null }}
          tabComponents={{ htmlPreviewTab: HtmlPreviewTab }}
          onReady={(event) => {
            dockApi = event.api
          }}
        />
      )
      act(() => {
        dockApi?.addPanel({
          id: 'preview-a',
          component: 'htmlPreview',
          tabComponent: 'htmlPreviewTab',
          title: 'a.html',
          params: { filePath: '/proj/a.html', panelId: 'preview-a' }
        })
      })
      expect(await screen.findByRole('button', { name: 'Close a.html' })).toBeInTheDocument()

      act(() => {
        dockApi?.getPanel('preview-a')?.api.updateParameters({ filePath: '/proj/b.html' })
      })

      expect(await screen.findByRole('button', { name: 'Close b.html' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Close a.html' })).toBeNull()
    })
  })
})
