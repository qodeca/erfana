// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link PreviewFailureBadge} (Issue #74, UX-005, AC20).
 *
 * Covers the disclosure dismissal behaviour (Escape closes + restores focus,
 * outside-click closes) and the occluder wiring: while the popover is open the
 * component registers a `menu` occluder so the native preview view hides and
 * the list is readable (design §1.8). The popover is portalled to
 * `#portal-root`.
 *
 * @see PreviewFailureBadge.tsx
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { PreviewFailureBadge } from './PreviewFailureBadge'
import type { FailureSummary } from '../htmlPreview.logic'
import { useOverlayOccluderStore } from '../../../../stores/useOverlayOccluderStore'
import { ErrorCode } from '../../../../../../shared/errors'

/** A one-entry blocked-host summary. */
const SUMMARY: FailureSummary = {
  count: 1,
  groups: [
    {
      type: 'blocked-host',
      label: 'Blocked host',
      entries: [
        {
          id: '1',
          type: 'blocked-host',
          resourceUrlOrHost: 'cdn.example',
          reasonCode: ErrorCode.PREVIEW_HOST_NOT_APPROVABLE,
          timestamp: 1
        }
      ]
    }
  ],
  blockedHosts: ['cdn.example']
}

let portalRoot: HTMLDivElement

beforeEach(() => {
  useOverlayOccluderStore.getState().reset()
  portalRoot = document.createElement('div')
  portalRoot.id = 'portal-root'
  document.body.appendChild(portalRoot)
})

afterEach(() => {
  cleanup()
  document.body.removeChild(portalRoot)
})

describe('PreviewFailureBadge', () => {
  it('renders nothing when there are no failures', () => {
    const { container } = render(
      <PreviewFailureBadge summary={{ count: 0, groups: [], blockedHosts: [] }} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('opens the disclosure on click and lists entries', () => {
    render(<PreviewFailureBadge summary={SUMMARY} />)
    const trigger = screen.getByRole('button', { name: '1 preview issue' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('cdn.example')).toBeInTheDocument()
    // It is a disclosure, not a modal dialog.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('registers a menu occluder while the popover is open and releases it on close', () => {
    render(<PreviewFailureBadge summary={SUMMARY} />)
    const trigger = screen.getByRole('button', { name: '1 preview issue' })
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)

    fireEvent.click(trigger)
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

    fireEvent.click(trigger)
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('releases the occluder when the summary drops to zero while open (M1)', () => {
    // Host approval → failureLog.clear() → an empty snapshot can arrive while the
    // popover is still open. The badge must force itself closed so the `menu`
    // occluder releases; otherwise it early-returns null with `open` still true
    // and the native preview stays hidden behind its still frame.
    const { rerender } = render(<PreviewFailureBadge summary={SUMMARY} />)
    fireEvent.click(screen.getByRole('button', { name: '1 preview issue' }))
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

    rerender(<PreviewFailureBadge summary={{ count: 0, groups: [], blockedHosts: [] }} />)
    // The badge is gone (early return) and the occluder registration is released.
    expect(screen.queryByRole('button', { name: /preview issue/ })).toBeNull()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('releases the occluder on unmount while still open', () => {
    const { unmount } = render(<PreviewFailureBadge summary={SUMMARY} />)
    fireEvent.click(screen.getByRole('button', { name: '1 preview issue' }))
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

    unmount()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('closes on Escape and restores focus to the trigger (UX-005)', () => {
    render(<PreviewFailureBadge summary={SUMMARY} />)
    const trigger = screen.getByRole('button', { name: '1 preview issue' })
    fireEvent.click(trigger)
    expect(screen.getByText('cdn.example')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('cdn.example')).toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(trigger)
    // The occluder is released once the popover closes.
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('closes on an outside click (UX-005)', () => {
    render(<PreviewFailureBadge summary={SUMMARY} />)
    const trigger = screen.getByRole('button', { name: '1 preview issue' })
    fireEvent.click(trigger)
    expect(screen.getByText('cdn.example')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('cdn.example')).toBeNull()
  })
})
