// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Toast placement WIRING, as opposed to the placement arithmetic.
 *
 * `toastPlacement.test.ts` covers the pure function and covers it well. What
 * had no cover at all was the loop around it: measure → decide → apply a
 * `transform` → measure again. That loop had a defect the pure function cannot
 * express.
 *
 * THE DEFECT. `getBoundingClientRect()` returns the box AFTER the element's own
 * transform. `placeToastContainer` computes its offsets relative to the box it
 * is handed, and the result is applied as an ABSOLUTE translate from the
 * untransformed CSS anchor. So the second recompute measured the box the first
 * one had already moved, found it clear of every preview, and returned
 * `AT_REST` — dropping the transform and landing the stack back on top of the
 * native view. Nothing recomputed afterwards.
 *
 * Worse than a cosmetic snap-back: the verdict was `clear`, so the `toast`
 * occluder stayed unregistered and the preview was NOT hidden. The path fails
 * OPEN, and the toast it fails open for is the "Approve this host?" consent
 * prompt — invisible, and click-through to the untrusted page beneath it.
 *
 * The existing harness in `ToastAction.test.tsx` cannot see this: its
 * `getBoundingClientRect` stub returns a fixed rect however the element is
 * transformed, so the feedback loop it needs to model is stubbed away. The stub
 * here adds the applied translate, the way a browser does.
 *
 * @see ToastNotification.tsx - the `recompute` this exercises
 * @see toastPlacement.ts - the arithmetic it wraps
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

import { ToastProvider, useToast, type Toast } from './ToastContext'
import { ToastNotification } from './ToastNotification'
import { usePreviewViewportStore } from '../../stores/usePreviewViewportStore'
import { TEST_IDS } from '../../constants/testids'

/** Where the toast stack sits with no transform applied: bottom-left. */
const ANCHOR = { left: 16, top: 660, width: 300, height: 100 }

/** A preview covering the whole bottom-left quadrant, so the anchor is buried. */
const COVERING_PREVIEW = { left: 0, top: 600, width: 520, height: 200 }

let restoreRect: (() => void) | null = null

/**
 * Measure `.toast-container` as a browser would: the CSS anchor PLUS whatever
 * translate is currently on the element.
 *
 * This is the whole point of the file. A stub that ignores the transform makes
 * the defect unobservable.
 */
function stubMeasuring(): void {
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function measured(this: HTMLElement): DOMRect {
    if (!this.classList.contains('toast-container')) {
      return original.call(this)
    }
    // An empty stack really is zero-sized, and `placeToastContainer` treats a
    // degenerate box as covering nothing. Reporting a full-size rect with no
    // toasts would make the container "overlap" a preview before any toast
    // existed, which is not a state the real component can be in.
    const empty = this.childElementCount === 0
    const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(this.style.transform)
    const dx = match === null ? 0 : Number.parseFloat(match[1])
    const dy = match === null ? 0 : Number.parseFloat(match[2])
    const left = ANCHOR.left + dx
    const top = ANCHOR.top + dy
    const width = empty ? 0 : ANCHOR.width
    const height = empty ? 0 : ANCHOR.height
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({})
    } as DOMRect
  }
  restoreRect = () => {
    HTMLElement.prototype.getBoundingClientRect = original
  }
}

/** Renders a button that raises `toast` on click. */
function Trigger({ toast }: { toast: Omit<Toast, 'id'> }): JSX.Element {
  const { showToast } = useToast()
  return (
    <button data-testid="trigger" onClick={() => showToast(toast)}>
      show
    </button>
  )
}

const CONSENT: Omit<Toast, 'id'> = {
  type: 'warning',
  title: 'Approve a remote host?',
  message: 'The preview blocked cdn.example.com.',
  action: { label: 'Approve', onClick: () => undefined }
}

/** The translate currently on the container, or null when there is none. */
function appliedTransform(): string | undefined {
  const el = screen.getByTestId(TEST_IDS.TOAST_CONTAINER)
  return el.style.transform === '' ? undefined : el.style.transform
}

beforeEach(() => {
  window.innerWidth = 1000
  window.innerHeight = 800
  stubMeasuring()
  // Seeded BEFORE the render, so the component never sees a frame without it.
  usePreviewViewportStore.setState({ rects: new Map([['panel-A', COVERING_PREVIEW]]) })
  render(
    <ToastProvider>
      <Trigger toast={CONSENT} />
      <ToastNotification />
    </ToastProvider>
  )
})

afterEach(() => {
  restoreRect?.()
  restoreRect = null
  usePreviewViewportStore.setState({ rects: new Map() })
  vi.restoreAllMocks()
})

describe('ToastNotification placement', () => {
  it('moves the stack clear of a preview it would otherwise sit under', () => {
    // The control for everything below. If this ever stops holding, the two
    // cases after it would pass for the wrong reason — an unmoved stack is
    // trivially "still where it was".
    fireEvent.click(screen.getByTestId('trigger'))

    expect(appliedTransform()).toBeDefined()
  })

  it('keeps the stack clear when a second toast arrives', () => {
    // THE REGRESSION. The second toast re-runs the layout effect while the
    // first one's transform is still applied. Measuring the displaced box finds
    // no overlap, so the placement collapses to AT_REST and the stack drops
    // back over the native view.
    fireEvent.click(screen.getByTestId('trigger'))
    const first = appliedTransform()

    fireEvent.click(screen.getByTestId('trigger'))

    expect(appliedTransform()).toBe(first)
  })

  it('keeps the stack clear when the preview rect changes', () => {
    // Same loop, reached the other way: opening the find bar re-pushes the
    // preview's rectangle, which recomputes placement through the store
    // subscription rather than through the toast list.
    fireEvent.click(screen.getByTestId('trigger'))
    const first = appliedTransform()

    // Wrapped in `act`: the store notifies outside React, and without a flush
    // the DOM would still show the previous transform — the assertion would
    // then pass by reading a stale frame rather than by the fix working.
    act(() => {
      usePreviewViewportStore.setState({
        rects: new Map([['panel-A', { ...COVERING_PREVIEW, top: COVERING_PREVIEW.top + 4 }]])
      })
    })

    expect(appliedTransform()).toBeDefined()
    expect(appliedTransform()).toBe(first)
  })

  it('returns to the anchor once the preview goes away', () => {
    // The mirror: the correction must not pin a transform in place forever.
    fireEvent.click(screen.getByTestId('trigger'))
    expect(appliedTransform()).toBeDefined()

    act(() => {
      usePreviewViewportStore.setState({ rects: new Map() })
    })

    expect(appliedTransform()).toBeUndefined()
  })
})
