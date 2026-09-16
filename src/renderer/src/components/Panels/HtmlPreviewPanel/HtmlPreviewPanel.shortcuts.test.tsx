// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Forwarded-shortcut tests for {@link HtmlPreviewPanel}: Cmd/Ctrl+S, +W, +F
 * and Escape arrive from main because the native view swallows renderer keys.
 *
 * Split out of `HtmlPreviewPanel.test.tsx` by concern (issue #124, 500-line
 * cap); the shared fake bridge is `__test__/panelHarness.ts`.
 *
 * @see HtmlPreviewPanel.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'

import { HtmlPreviewPanel } from './HtmlPreviewPanel'
import { useSearchStore } from '../../../stores/useSearchStore'
import { installHtmlPreviewPanelHarness } from './__test__/panelHarness'

// The bounds hook logs its drop lines through the renderer logger, which has no
// bridge here; mocked, as in the other renderer suites, so a run stays quiet.
// Declared per file: `vi.mock` is hoisted per test file, so the shared harness
// cannot carry it.
const mockLogger = vi.hoisted(() => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}))
vi.mock('../../../utils/logger', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logger: mockLogger
}))

const { listeners, preview, makeProps } = installHtmlPreviewPanelHarness()

describe('HtmlPreviewPanel – forwarded shortcuts', () => {
  it('exports to PDF on a forwarded Cmd/Ctrl+S (UX-003)', async () => {
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    await waitFor(() => expect(listeners.forwardedShortcut).not.toBeNull())
    listeners.forwardedShortcut?.({ panelId: 'preview-1', key: 's', accel: true })

    await waitFor(() => expect(preview.exportPdf).toHaveBeenCalledWith('preview-1'))
  })

  it('closes the panel on a forwarded Cmd/Ctrl+W (UX-006)', async () => {
    const props = makeProps('/proj/page.html')
    render(<HtmlPreviewPanel {...props} />)

    await waitFor(() => expect(listeners.forwardedShortcut).not.toBeNull())
    act(() => listeners.forwardedShortcut?.({ panelId: 'preview-1', key: 'w', accel: true }))

    expect(props.api.close).toHaveBeenCalledTimes(1)
  })

  it('opens find on a forwarded Cmd/Ctrl+F and closes it on Escape (UX-007)', async () => {
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    await waitFor(() => expect(listeners.forwardedShortcut).not.toBeNull())

    act(() => listeners.forwardedShortcut?.({ panelId: 'preview-1', key: 'f', accel: true }))
    await waitFor(() => expect(useSearchStore.getState().isOpen).toBe(true))

    act(() => listeners.forwardedShortcut?.({ panelId: 'preview-1', key: 'Escape', accel: false }))
    await waitFor(() => expect(useSearchStore.getState().isOpen).toBe(false))
  })
})
