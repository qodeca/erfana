// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewFailureBadge (Issue #74, work item 71).
 *
 * A small count indicator that opens a popover listing the panel's failures
 * (AC20) — blocked hosts, script errors, missing assets and the rest. Renders
 * nothing when there are no failures.
 *
 * The indicator is mounted in the dockview tab (`HtmlPreviewTab`), which is
 * ordinary DOM the native preview `WebContentsView` never paints over — the
 * panel surface itself is occluded by that view, so a badge there would be
 * invisible while the page runs (design §1.8). The popover, however, drops down
 * OVER the preview region, so while it is open the component registers a `menu`
 * occluder via {@link useOccluder}: `OverlayGuardService` hides the native view
 * behind its still frame, making the list readable. This mirrors the shared
 * `ContextMenu`, which is the same class of transient DOM over the preview.
 *
 * The popover is portalled to `#portal-root` so the tab's `overflow: hidden`
 * cannot clip it. Grouping and the blocked-host extraction are pure
 * (`htmlPreview.logic.ts`); this component is presentation + open/close state.
 *
 * @module HtmlPreviewPanel/components/PreviewFailureBadge
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { useOccluder } from '../../../../hooks/useOccluder'
import type { FailureSummary } from '../htmlPreview.logic'

/** Gap in px between the trigger's bottom edge and the popover. */
const POPOVER_GAP = 4

/** Props for {@link PreviewFailureBadge}. */
export interface PreviewFailureBadgeProps {
  /** The pure summary derived from the panel's failures. */
  summary: FailureSummary
}

/** Fixed-position popover placement, in viewport coordinates. */
interface PopoverPosition {
  /** Distance from the viewport top to the popover's top edge. */
  top: number
  /** Distance from the viewport right edge to the popover's right edge. */
  right: number
}

/**
 * Renders the failure count indicator and its click-to-open list popover.
 *
 * Designed to be mounted in the preview tab (always-DOM chrome). While the
 * popover is open it hides the native preview view so the list is readable.
 *
 * @param props - The failure summary (count + grouped entries).
 * @returns The indicator, or `null` when there are no failures.
 *
 * @example
 * ```tsx
 * <PreviewFailureBadge summary={summarizeFailures(failures)} />
 * ```
 */
export function PreviewFailureBadge({ summary }: PreviewFailureBadgeProps): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  // A stable id so the trigger can point `aria-controls` at the portalled popover
  // — the two are far apart in the DOM (the popover renders under #portal-root),
  // so this link is what lets a screen reader reach the revealed issue list.
  const popoverId = useId()
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // While the popover is open it drops over the preview region; register a
  // `menu` occluder so the native view hides behind its still frame and the
  // list is readable (design §1.8). A no-op while closed.
  useOccluder('menu', open)

  // Anchor the fixed-position popover below the trigger, right edges aligned.
  // Recomputed each time it opens; the trigger lives in a tab that never moves
  // while open, so a one-shot measure is enough.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({ top: rect.bottom + POPOVER_GAP, right: window.innerWidth - rect.right })
  }, [open])

  // The popover is a non-modal DISCLOSURE, not a dialog (UX-005): no focus trap,
  // but it must dismiss on Escape (restoring focus to its trigger) and on a
  // click outside both the trigger and the (portalled) popover. Listeners live
  // only while open.
  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target as Node
      // The popover is portalled out of the anchor, so check both subtrees.
      if (anchorRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  // Force the popover closed the moment the badge empties (e.g. host approval
  // clears the failure log to zero). Without this, an open popover would hit the
  // `count === 0` early return below while `open` is still `true`: the component
  // renders `null` and never re-renders to release `useOccluder('menu', open)`,
  // so the native preview stays hidden behind its still frame — recoverable only
  // by closing the tab. Closing here lets the occluder cleanup fire and the
  // document listeners detach. Must run before the early return (hook ordering).
  useEffect(() => {
    if (summary.count === 0) setOpen(false)
  }, [summary.count])

  if (summary.count === 0) return null

  const portalRoot = typeof document !== 'undefined' ? document.getElementById('portal-root') : null

  const popover =
    open && position ? (
      <div
        ref={popoverRef}
        id={popoverId}
        className="html-preview-badge-popover"
        role="group"
        aria-label="Preview issues"
        style={{ position: 'fixed', top: `${position.top}px`, right: `${position.right}px` }}
      >
        {summary.groups.map((group) => (
          <div key={group.type} className="html-preview-badge-group">
            <div className="html-preview-badge-group-label">
              {group.label} ({group.entries.length})
            </div>
            <ul className="html-preview-badge-list">
              {group.entries.map((entry) => (
                <li key={entry.id} className="html-preview-badge-item">
                  {entry.resourceUrlOrHost}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    ) : null

  return (
    <div className="html-preview-badge-anchor" ref={anchorRef}>
      <button
        ref={triggerRef}
        type="button"
        className="html-preview-badge"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? popoverId : undefined}
        aria-label={`${summary.count} preview ${summary.count === 1 ? 'issue' : 'issues'}`}
        onClick={(e) => {
          // Toggle only — never bubble to the tab (tab activation / drag).
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <AlertTriangle size={14} aria-hidden="true" />
        <span className="html-preview-badge-count">{summary.count}</span>
      </button>

      {/* Portal so the tab's `overflow: hidden` cannot clip the drop-down. */}
      {popover && portalRoot ? createPortal(popover, portalRoot) : popover}
    </div>
  )
}
