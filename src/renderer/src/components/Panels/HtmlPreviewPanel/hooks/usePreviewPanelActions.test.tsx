// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewPanelActions – the PDF export's in-flight guard (issue #124, QG-8 C4).
 *
 * The export used to start inside a `useState` updater. StrictMode runs an
 * updater twice to expose exactly that impurity, so one press opened two save
 * dialogs. These cases render under `<StrictMode>` so a regression shows here
 * rather than only in a dev build.
 */
import { StrictMode, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import type { DockviewApi } from 'dockview'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePreviewPanelActions } from './usePreviewPanelActions'

const mockExportPreviewPdf = vi.hoisted(() => vi.fn<(panelId: string) => Promise<void>>())
vi.mock('../previewPdfExport', () => ({ exportPreviewPdf: mockExportPreviewPdf }))
vi.mock('../previewOpenInBrowser', () => ({ openInDefaultBrowser: vi.fn(async () => {}) }))
const mockOpenFileInPanel = vi.hoisted(() => vi.fn())
vi.mock('../../../../utils/openFileInPanel', () => ({ openFileInPanel: mockOpenFileInPanel }))

const strict = ({ children }: { children: ReactNode }): React.JSX.Element => (
  <StrictMode>{children}</StrictMode>
)

function renderActions(): ReturnType<typeof renderHook<ReturnType<typeof usePreviewPanelActions>, unknown>> {
  return renderHook(
    () =>
      usePreviewPanelActions({
        panelId: 'preview-1',
        filePath: '/proj/page.html',
        api: { close: vi.fn() },
        containerApi: {} as DockviewApi,
        searchProvider: { clearHighlights: vi.fn() },
        chipRef: { current: null }
      }),
    { wrapper: strict }
  )
}

/** An export whose save dialog stays open until the test settles it. */
function pendingExport(): () => void {
  let settle: () => void = () => {}
  mockExportPreviewPdf.mockReturnValue(
    new Promise<void>((resolve) => {
      settle = resolve
    })
  )
  return () => settle()
}

/**
 * Runs one export to completion, then forgets the call.
 *
 * A hook that has never updated takes React's eager path, which runs a state
 * updater once, outside render. A live panel has always updated, so its
 * updater runs during render – twice under StrictMode. Without this the old
 * impure updater passed the one-press case.
 */
async function primeWithOneExport(exportPdf: () => void): Promise<void> {
  const settle = pendingExport()
  act(() => exportPdf())
  await act(async () => settle())
  mockExportPreviewPdf.mockClear()
}

describe('usePreviewPanelActions – exportPdf under StrictMode', () => {
  beforeEach(() => {
    mockExportPreviewPdf.mockReset()
    // The forwarded-shortcut subscription is the only bridge the hook touches.
    ;(window as unknown as { api: unknown }).api = {
      preview: { onForwardedShortcut: vi.fn(() => () => {}) }
    }
  })

  it('calls the export once for one press', async () => {
    const { result } = renderActions()
    await primeWithOneExport(result.current.exportPdf)
    const settle = pendingExport()

    act(() => result.current.exportPdf())

    expect(mockExportPreviewPdf).toHaveBeenCalledTimes(1)
    expect(mockExportPreviewPdf).toHaveBeenCalledWith('preview-1')
    await act(async () => settle())
  })

  it('calls the export once for two presses in one act', async () => {
    const { result } = renderActions()
    await primeWithOneExport(result.current.exportPdf)
    const settle = pendingExport()

    act(() => {
      result.current.exportPdf()
      result.current.exportPdf()
    })

    expect(mockExportPreviewPdf).toHaveBeenCalledTimes(1)
    expect(result.current.exportingPdf).toBe(true)
    await act(async () => settle())
  })

  it('clears the flag when the export settles, and lets the next press through', async () => {
    const settle = pendingExport()
    const { result } = renderActions()

    act(() => result.current.exportPdf())
    expect(result.current.exportingPdf).toBe(true)

    await act(async () => settle())
    expect(result.current.exportingPdf).toBe(false)

    mockExportPreviewPdf.mockResolvedValue(undefined)
    act(() => result.current.exportPdf())
    expect(mockExportPreviewPdf).toHaveBeenCalledTimes(2)
    await act(async () => {})
  })
})

describe('usePreviewPanelActions – open as source after a same-tab move', () => {
  beforeEach(() => {
    mockOpenFileInPanel.mockReset()
    ;(window as unknown as { api: unknown }).api = {
      preview: { onForwardedShortcut: vi.fn(() => () => {}) }
    }
  })

  it('opens the page the tab moved to, not the page it first showed', () => {
    const containerApi = {} as DockviewApi
    const base = {
      panelId: 'preview-1',
      api: { close: vi.fn() },
      containerApi,
      searchProvider: { clearHighlights: vi.fn() },
      chipRef: { current: null }
    }
    const { result, rerender } = renderHook(
      ({ filePath }: { filePath: string }) => usePreviewPanelActions({ ...base, filePath }),
      { wrapper: strict, initialProps: { filePath: '/proj/a.html' } }
    )

    // A same-tab move keeps the panel mounted and changes only `params.filePath`.
    rerender({ filePath: '/proj/sub/b.html' })
    act(() => result.current.limitReachedBanner.onAction())

    expect(mockOpenFileInPanel).toHaveBeenCalledTimes(1)
    expect(mockOpenFileInPanel).toHaveBeenCalledWith(containerApi, '/proj/sub/b.html', {
      kind: 'editor'
    })
  })
})
