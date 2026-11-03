// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * EditorAreaSplitPanel's built-in browser wiring (spec 025, commit 17): a
 * removed browser editor tab closes main's tab; a page-opened tab gets an
 * editor tab.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { DockviewReadyEvent, ISplitviewPanelProps } from 'dockview'

const captured = vi.hoisted(() => ({ onReady: undefined as undefined | ((event: DockviewReadyEvent) => void) }))
vi.mock('dockview', () => ({
  DockviewReact: (props: { onReady: (event: DockviewReadyEvent) => void }) => {
    captured.onReady = props.onReady
    return null
  }
}))
vi.mock('../../Panels/MarkdownEditorPanel', () => ({ MarkdownEditorPanel: () => null }))
vi.mock('../../../utils/logger', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))
vi.mock('../../../services/preview/PreviewLinkRouter', () => ({
  mountPreviewLinkRouter: () => ({ move: vi.fn(), dispose: vi.fn() })
}))
const events = vi.hoisted(() => ({ openPageTab: undefined as undefined | ((event: unknown) => void) }))
vi.mock('../../../services/browser/browserTabEvents', () => ({
  mountBrowserTabEvents: (deps: { openPageTab: (event: unknown) => void }) => {
    events.openPageTab = deps.openPageTab
    return () => undefined
  }
}))
const closeBrowserTab = vi.hoisted(() => vi.fn())
vi.mock('../../../services/browser/browserTabLifecycle', () => ({ closeBrowserTab }))
const openBrowserTab = vi.hoisted(() => vi.fn())
vi.mock('../../../utils/openBrowserTab', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/openBrowserTab')>()),
  openBrowserTab
}))

import { EditorAreaSplitPanel } from './EditorAreaSplitPanel'
import { useProjectStore } from '../../../stores/useProjectStore'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useProjectStore.setState({ dockviewApi: null })
})

describe('EditorAreaSplitPanel – built-in browser', () => {
  it('closes main’s tab when dockview removes a browser panel, and only then', () => {
    render(<EditorAreaSplitPanel {...({ params: {} } as unknown as ISplitviewPanelProps)} />)
    let removed: ((panel: { id: string }) => void) | undefined
    const dispose = { dispose: vi.fn() }
    captured.onReady?.({
      api: {
        addPanel: vi.fn(() => ({ group: {} })),
        onDidActivePanelChange: vi.fn(() => dispose),
        onDidRemovePanel: vi.fn((listener: (panel: { id: string }) => void) => {
          removed = listener
          return dispose
        })
      }
    } as unknown as DockviewReadyEvent)
    removed?.({ id: 'editor-a.md' })
    expect(closeBrowserTab).not.toHaveBeenCalled()
    removed?.({ id: 'browser-panel-2' })
    expect(closeBrowserTab).toHaveBeenCalledExactlyOnceWith('browser-panel-2')
  })

  it('opens an editor tab for a tab the page opened, in the background when asked', () => {
    const api = { marker: true }
    useProjectStore.setState({ dockviewApi: api as never })
    render(<EditorAreaSplitPanel {...({ params: {} } as unknown as ISplitviewPanelProps)} />)
    events.openPageTab?.({ tabId: 'browser-tab-4', openerTabId: 'browser-tab-1', background: true })
    expect(openBrowserTab).toHaveBeenCalledWith(api, { tabId: 'browser-tab-4', background: true })
  })
})
