// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the actionable-toast path (Issue #74, items 64 + 65).
 *
 * Item 64 (ToastContext): a toast carrying an `action` is forced to
 * `duration: 0` (manual dismiss), and a `'toast'` occluder is pushed while any
 * toast is shown. Item 65 (ToastNotification): the action button renders, runs
 * its `onClick`, and dismisses the toast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ToastProvider, useToast, type Toast } from './ToastContext'
import { ToastNotification } from './ToastNotification'
import { TEST_IDS } from '../../constants/testids'
import { usePreviewViewportStore } from '../../stores/usePreviewViewportStore'
import { useOverlayOccluderStore } from '../../stores/useOverlayOccluderStore'

/** Renders a button that shows `toast` via the context on click. */
function Trigger({ toast }: { toast: Omit<Toast, 'id'> }): JSX.Element {
  const { showToast } = useToast()
  return (
    <button data-testid="trigger" onClick={() => showToast(toast)}>
      show
    </button>
  )
}

/** Mounts a provider + notifications and returns the trigger click helper. */
function setup(toast: Omit<Toast, 'id'>): void {
  render(
    <ToastProvider>
      <Trigger toast={toast} />
      <ToastNotification />
    </ToastProvider>
  )
  fireEvent.click(screen.getByTestId('trigger'))
}

/**
 * jsdom performs no layout, so `.toast-container` measures {0,0,0,0} and covers
 * nothing. A test about coverage has to supply the rect by hand.
 */
function stubToastContainerRect(rect: {
  left: number
  top: number
  width: number
  height: number
}): void {
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function boundingRect(this: HTMLElement): DOMRect {
    if (this.classList.contains('toast-container')) {
      return { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) } as DOMRect
    }
    return original.call(this)
  }
  restoreRect = () => {
    HTMLElement.prototype.getBoundingClientRect = original
  }
}

let restoreRect: (() => void) | null = null

afterEach(() => {
  restoreRect?.()
  restoreRect = null
  usePreviewViewportStore.setState({ rects: new Map() })
})

describe('Actionable toast (items 64/65)', () => {
  beforeEach(() => {
    useOverlayOccluderStore.getState().reset()
  })

  describe('with fake timers', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('forces duration 0 for an actionable toast (no auto-dismiss)', () => {
      setup({
        title: 'Host blocked',
        message: 'cdn.example.com',
        type: 'warning',
        action: { label: 'Approve', onClick: () => {} }
      })

      expect(screen.getByText('Host blocked')).toBeInTheDocument()

      // Far past the 3s default: an actionable toast must remain because its
      // duration was forced to 0.
      act(() => {
        vi.advanceTimersByTime(60000)
      })
      expect(screen.getByText('Host blocked')).toBeInTheDocument()
    })

    it('still auto-dismisses a non-actionable toast after its duration', () => {
      setup({ title: 'Saved', message: 'ok', type: 'success', duration: 3000 })
      expect(screen.getByText('Saved')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    })
  })

  it('does NOT occlude a preview it does not cover', () => {
    // The rule changed with the toast-placement work (issue #74 follow-up): a
    // toast used to hide EVERY live preview simply by existing, including ones
    // it never overlapped, and an actionable toast never auto-dismisses — so the
    // "Approve this host?" prompt the preview itself raises hid every preview
    // indefinitely. The occluder is now registered only when the stack cannot be
    // placed clear of a live view.
    setup({
      title: 'Host blocked',
      message: 'cdn.example.com',
      type: 'warning',
      action: { label: 'Approve', onClick: () => {} }
    })

    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('occludes when a live preview leaves the stack nowhere to go', () => {
    // The fail-safe branch. When no clear position exists the old
    // hide-everything behaviour is restored, so the outcome is never worse than
    // before — the security prompt must never end up under an untrusted page.
    usePreviewViewportStore
      .getState()
      .setRect('preview-1', { left: 0, top: 0, width: 10_000, height: 10_000 })
    stubToastContainerRect({ left: 16, top: 760, width: 400, height: 110 })

    setup({
      title: 'Host blocked',
      message: 'cdn.example.com',
      type: 'warning',
      action: { label: 'Approve', onClick: () => {} }
    })

    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

    fireEvent.click(screen.getByTestId(TEST_IDS.TOAST_BTN_DISMISS))
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('renders the action button, runs onClick, then dismisses', () => {
    const onClick = vi.fn()
    setup({
      title: 'Host blocked',
      message: 'cdn.example.com',
      type: 'warning',
      action: { label: 'Approve', onClick }
    })

    const actionButton = screen.getByTestId(TEST_IDS.TOAST_BTN_ACTION)
    expect(actionButton).toHaveTextContent('Approve')

    fireEvent.click(actionButton)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Host blocked')).not.toBeInTheDocument()
  })

  it('renders no action button for a plain toast', () => {
    setup({ title: 'Saved', message: 'ok', type: 'success', duration: 60000 })
    expect(screen.queryByTestId(TEST_IDS.TOAST_BTN_ACTION)).not.toBeInTheDocument()
  })
})
