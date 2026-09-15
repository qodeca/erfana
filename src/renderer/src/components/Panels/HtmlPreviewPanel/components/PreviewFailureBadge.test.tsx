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
 * Also covers the refused-frame entries of issue #124 (P2-AC3): each frame
 * type is listed under its own label, and the entry text – an address, or a
 * finished sentence from `previewFrameBadgeText.ts` – is shown exactly as main
 * wrote it. The summaries are built with the real `summarizeFailures`, so the
 * labels and the grouping are the ones the tab passes in.
 *
 * @see PreviewFailureBadge.tsx
 * @see docs/design/design-issue-124-part2.md §2.12
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { PreviewFailureBadge } from './PreviewFailureBadge'
import { FAILURE_TYPE_LABELS, summarizeFailures, type FailureSummary } from '../htmlPreview.logic'
import { useOverlayOccluderStore } from '../../../../stores/useOverlayOccluderStore'
import { ErrorCode } from '../../../../../../shared/errors'
import type { PreviewFailure } from '../../../../../../shared/ipc/preview-schema'
import type { PreviewFailureType } from '../../../../../../shared/ipc/preview-types'
import {
  SRCDOC_TOO_DEEP_ENTRY,
  describeFramesOverLimit
} from '../../../../../../shared/previewFrameBadgeText'

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

  it('links the trigger to the portalled popover so AT can reach it (#7)', () => {
    render(<PreviewFailureBadge summary={SUMMARY} />)
    const trigger = screen.getByRole('button', { name: '1 preview issue' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'true')
    // Closed: no dangling aria-controls to a non-existent element.
    expect(trigger).not.toHaveAttribute('aria-controls')

    fireEvent.click(trigger)
    const popover = screen.getByRole('group', { name: 'Preview issues' })
    // The trigger's aria-controls points at the popover's id.
    expect(trigger.getAttribute('aria-controls')).toBe(popover.getAttribute('id'))
    expect(popover.getAttribute('id')).toBeTruthy()
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
    // Host approval → reload commits a fresh page scope → an empty snapshot can arrive while the
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

// ============================================================================
// Refused frames (issue #124, part 2 §2.12, P2-AC3)
// ============================================================================

let nextFailureId = 0

/** One failure entry as main emits it; ids and timestamps are unique per call. */
function failure(
  type: PreviewFailureType,
  resourceUrlOrHost: string,
  reasonCode: ErrorCode = ErrorCode.PREVIEW_LINK_BLOCKED
): PreviewFailure {
  nextFailureId += 1
  return { id: `f${nextFailureId}`, type, resourceUrlOrHost, reasonCode, timestamp: nextFailureId }
}

/** A popover group as the user reads it: its heading and its entries. */
interface ListedGroup {
  heading: string
  entries: string[]
}

/**
 * Renders the badge for `failures`, opens it, and returns the popover.
 *
 * @param failures - Entries as main emits them.
 * @returns The open popover element.
 */
function openBadgeFor(failures: PreviewFailure[]): HTMLElement {
  render(<PreviewFailureBadge summary={summarizeFailures(failures)} />)
  fireEvent.click(screen.getByRole('button', { name: /preview issues?$/ }))
  return screen.getByRole('group', { name: 'Preview issues' })
}

/**
 * Reads the open popover back as headings and entry texts, in display order.
 *
 * @param popover - The element returned by {@link openBadgeFor}.
 * @returns One {@link ListedGroup} per rendered group.
 */
function listedGroups(popover: HTMLElement): ListedGroup[] {
  return Array.from(popover.querySelectorAll('.html-preview-badge-group')).map((group) => ({
    heading: group.querySelector('.html-preview-badge-group-label')?.textContent ?? '',
    entries: Array.from(group.querySelectorAll('li')).map((li) => li.textContent ?? '')
  }))
}

describe('PreviewFailureBadge – refused frames (issue #124, P2-AC3)', () => {
  it.each<[string, PreviewFailureType, string]>([
    ['a remote frame, by its address', 'frame-remote', 'https://cdn.example/widget.html'],
    ['a data: frame, by its scheme only', 'frame-remote', 'data:'],
    ['a blob: frame, by its scheme only', 'frame-remote', 'blob:'],
    ['a frame outside the project, by its src', 'frame-escape', '../outside/secret.html'],
    ['a frame in an excluded folder, by its src', 'frame-excluded', 'node_modules/pkg/index.html'],
    ['a src frame nested too deep, by its src', 'frame-too-deep', 'level-4.html'],
    ['a blocked link in a frame, by scheme and host', 'frame-link-blocked', 'https://tracker.example']
  ])('lists %s under its own label', (_case, type, entry) => {
    const popover = openBadgeFor([failure(type, entry)])

    expect(listedGroups(popover)).toEqual([
      { heading: `${FAILURE_TYPE_LABELS[type]} (1)`, entries: [entry] }
    ])
  })

  it('shows the srcdoc and "too many frames" sentences exactly as main wrote them', () => {
    const popover = openBadgeFor([
      failure('frame-too-deep', 'level-4.html'),
      failure('frame-too-deep', SRCDOC_TOO_DEEP_ENTRY),
      failure('frame-over-limit', describeFramesOverLimit(12, 'src')),
      failure('frame-over-limit', describeFramesOverLimit(10, 'srcdoc'))
    ])

    expect(screen.getByRole('button', { name: '4 preview issues' })).toBeInTheDocument()
    expect(listedGroups(popover)).toEqual([
      { heading: 'Frame nested too deep (2)', entries: ['level-4.html', SRCDOC_TOO_DEEP_ENTRY] },
      {
        heading: 'Too many frames (2)',
        entries: [describeFramesOverLimit(12, 'src'), describeFramesOverLimit(10, 'srcdoc')]
      }
    ])
  })

  it('shows the singular "too many frames" sentences as they are', () => {
    const popover = openBadgeFor([
      failure('frame-over-limit', describeFramesOverLimit(1, 'src')),
      failure('frame-over-limit', describeFramesOverLimit(1, 'srcdoc'))
    ])

    expect(listedGroups(popover)).toEqual([
      {
        heading: 'Too many frames (2)',
        entries: [describeFramesOverLimit(1, 'src'), describeFramesOverLimit(1, 'srcdoc')]
      }
    ])
  })

  it('lists a missing frame document under the existing "Missing local file" label', () => {
    const popover = openBadgeFor([
      failure('missing-local-file', 'frames/missing.html', ErrorCode.PREVIEW_LOCAL_FILE_MISSING)
    ])

    expect(listedGroups(popover)).toEqual([
      { heading: 'Missing local file (1)', entries: ['frames/missing.html'] }
    ])
  })

  it('keeps frame groups beside the existing ones, in first-seen order, and out of the host list', () => {
    const failures = [
      failure('blocked-host', 'cdn.example', ErrorCode.PREVIEW_HOST_NOT_APPROVABLE),
      failure('frame-remote', 'https://other.example/page.html'),
      failure('frame-remote', 'data:')
    ]
    // A remote page used as a frame is a badge entry, never a host to approve.
    expect(summarizeFailures(failures).blockedHosts).toEqual(['cdn.example'])

    const popover = openBadgeFor(failures)
    expect(listedGroups(popover)).toEqual([
      { heading: 'Blocked host (1)', entries: ['cdn.example'] },
      {
        heading: 'Blocked remote frame (2)',
        entries: ['https://other.example/page.html', 'data:']
      }
    ])
  })

  it('renders a page-influenced frame src as text, never as markup', () => {
    const src = 'frames/<img src=x onerror=alert(1)>.html'
    const popover = openBadgeFor([failure('frame-escape', src)])

    expect(popover.querySelector('img')).toBeNull()
    expect(listedGroups(popover)[0].entries).toEqual([src])
  })

  it('shows the longest address the schema allows in full', () => {
    // The schema caps an entry at 2048 characters; main cuts, the badge does not.
    const prefix = 'https://cdn.example/'
    const address = prefix + 'a'.repeat(2048 - prefix.length)
    const popover = openBadgeFor([failure('frame-remote', address)])

    expect(listedGroups(popover)[0].entries[0]).toHaveLength(2048)
    expect(listedGroups(popover)[0].entries[0]).toBe(address)
  })
})
