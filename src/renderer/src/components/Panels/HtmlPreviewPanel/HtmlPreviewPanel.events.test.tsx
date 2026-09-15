// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Event-feed tests for {@link HtmlPreviewPanel}: failure lists and blocked
 * hosts, driven through the captured bridge listeners into the preview store.
 *
 * Split out of `HtmlPreviewPanel.test.tsx` by concern (issue #124, 500-line
 * cap); the shared fake bridge is `__test__/panelHarness.ts`.
 *
 * @see HtmlPreviewPanel.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

import { HtmlPreviewPanel } from './HtmlPreviewPanel'
import { usePreviewStore } from '../../../stores/usePreviewStore'
import { ErrorCode } from '../../../../../shared/errors'
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

const { listeners, makeProps } = installHtmlPreviewPanelHarness()

describe('HtmlPreviewPanel – event feed', () => {
  it('routes failures into the store and renders no in-panel badge (AC20, §1.8)', async () => {
    // The badge lives in the tab now — the native view paints over this panel,
    // so a badge here would be invisible. The panel only feeds the store the
    // tab reads from; see HtmlPreviewTab.test.tsx for the indicator itself.
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    await waitFor(() => expect(listeners.failures).not.toBeNull())
    listeners.failures?.({
      panelId: 'preview-1',
      truncated: false,
      failures: [
        {
          id: '1',
          type: 'blocked-host',
          resourceUrlOrHost: 'cdn.example',
          reasonCode: ErrorCode.PREVIEW_HOST_NOT_APPROVABLE,
          timestamp: 1
        }
      ]
    })

    await waitFor(() =>
      expect(usePreviewStore.getState().getFailureCount('preview-1')).toBe(1)
    )
    // No badge is rendered inside the panel itself.
    expect(screen.queryByRole('button', { name: '1 preview issue' })).toBeNull()
  })

  it('records a blocked host the toast budget suppressed', async () => {
    // THE DEFECT, from the renderer's side. Host four raises no toast by design,
    // and used not to arrive at all — so it could not be listed and could not be
    // approved. It must now be recorded whatever `notify` says.
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    await waitFor(() => expect(listeners.hostBlocked).not.toBeNull())

    listeners.hostBlocked?.({
      panelId: 'preview-1',
      host: 'fourth.example',
      approvable: true,
      kinds: ['image'],
      notify: false
    })

    await waitFor(() =>
      expect(usePreviewStore.getState().panels.get('preview-1')?.blockedHosts).toEqual([
        { host: 'fourth.example', kinds: ['image'], approvable: true }
      ])
    )
  })

  it('keeps the blocked-host list when the failure log is cleared', async () => {
    // Approving runs `applyApprovedHosts`, which clears the failure log and
    // reloads. A list derived from failures would empty under the reader's hands
    // precisely mid-cascade — as they are about to approve the next host.
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    await waitFor(() => expect(listeners.hostBlocked).not.toBeNull())

    listeners.hostBlocked?.({
      panelId: 'preview-1',
      host: 'cdn.example',
      approvable: true,
      kinds: ['script'],
      notify: true
    })
    await waitFor(() =>
      expect(usePreviewStore.getState().panels.get('preview-1')?.blockedHosts).toHaveLength(1)
    )

    act(() => {
      usePreviewStore.getState().clearFailures('preview-1')
    })

    expect(usePreviewStore.getState().panels.get('preview-1')?.blockedHosts).toHaveLength(1)
  })

  it('merges a repeat sighting instead of listing the host twice', async () => {
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    await waitFor(() => expect(listeners.hostBlocked).not.toBeNull())

    listeners.hostBlocked?.({
      panelId: 'preview-1',
      host: 'cdn.example',
      approvable: true,
      kinds: ['style'],
      notify: true
    })
    listeners.hostBlocked?.({
      panelId: 'preview-1',
      host: 'cdn.example',
      approvable: true,
      kinds: ['style', 'script'],
      notify: false
    })

    await waitFor(() => {
      const rows = usePreviewStore.getState().panels.get('preview-1')?.blockedHosts ?? []
      expect(rows).toHaveLength(1)
      expect(rows[0].kinds).toEqual(['style', 'script'])
    })
  })

  it('ignores a blocked-host event for another panel (UX-001)', async () => {
    const toastEvents: CustomEvent[] = []
    const capture = (e: Event): void => {
      toastEvents.push(e as CustomEvent)
    }
    window.addEventListener('app:toast', capture)

    try {
      render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
      await waitFor(() => expect(listeners.hostBlocked).not.toBeNull())
      listeners.hostBlocked?.({
        panelId: 'preview-other',
        host: 'cdn.example',
        approvable: true,
        kinds: ['script'],
        notify: true
      })
      // A microtask settle is enough; no toast must be dispatched.
      await Promise.resolve()
      expect(toastEvents.length).toBe(0)
    } finally {
      window.removeEventListener('app:toast', capture)
    }
  })
})
