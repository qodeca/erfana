// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for BaseDialog focus behaviour.
 *
 * Covers the two opt-in capabilities added for #42 — `initialFocusRef` and
 * `trapFocus` — plus the focusable-selector change that makes both of them
 * correct in the presence of disabled controls.
 */
import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { BaseDialog } from './BaseDialog'
import { TEST_IDS } from '../../constants/testids'

/** Matches FOCUS_DELAY_MS in BaseDialog, with headroom. */
const FOCUS_TICK_MS = 20

/** Advance past the auto-focus timeout inside act(). */
function flushFocus(): void {
  act(() => {
    vi.advanceTimersByTime(FOCUS_TICK_MS)
  })
}

describe('BaseDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    if (!document.getElementById('portal-root')) {
      const portalRoot = document.createElement('div')
      portalRoot.id = 'portal-root'
      document.body.appendChild(portalRoot)
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial focus', () => {
    it('focuses the first focusable element by default', () => {
      render(
        <BaseDialog isOpen onClose={vi.fn()} zIndex={1000}>
          <button data-testid="first">First</button>
          <button data-testid="second">Second</button>
        </BaseDialog>
      )

      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('first'))
    })

    it('skips a disabled control when choosing the initial focus target', () => {
      // Regression guard for the `:not(:disabled)` selector: a disabled control
      // cannot take focus, so focusing it left focus on <body>.
      render(
        <BaseDialog isOpen onClose={vi.fn()} zIndex={1000}>
          <button data-testid="first" disabled>
            Disabled
          </button>
          <button data-testid="second">Second</button>
        </BaseDialog>
      )

      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('second'))
    })

    it('prefers initialFocusRef over DOM order', () => {
      function Harness(): JSX.Element {
        const preferredRef = useRef<HTMLButtonElement>(null)
        return (
          <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} initialFocusRef={preferredRef}>
            <button data-testid="first">First</button>
            <button data-testid="second" ref={preferredRef}>
              Second
            </button>
          </BaseDialog>
        )
      }

      render(<Harness />)
      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('second'))
    })

    it('falls back to the first focusable when initialFocusRef is empty', () => {
      function Harness(): JSX.Element {
        // Never attached to any element — the documented fallback path.
        const preferredRef = useRef<HTMLButtonElement>(null)
        return (
          <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} initialFocusRef={preferredRef}>
            <button data-testid="first">First</button>
            <button data-testid="second">Second</button>
          </BaseDialog>
        )
      }

      render(<Harness />)
      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('first'))
    })

    it('falls back to the first focusable when the preferred target is disabled', () => {
      function Harness(): JSX.Element {
        const preferredRef = useRef<HTMLButtonElement>(null)
        return (
          <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} initialFocusRef={preferredRef}>
            <button data-testid="first">First</button>
            <button data-testid="preferred" ref={preferredRef} disabled>
              Preferred but disabled
            </button>
          </BaseDialog>
        )
      }

      render(<Harness />)
      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('first'))
    })

    it('falls back when the preferred target is disabled by an ancestor fieldset', () => {
      // `hasAttribute('disabled')` would call this control enabled and focus a
      // dead target; `matches(':disabled')` — the same predicate the focusable
      // selector uses — agrees with the browser.
      function Harness(): JSX.Element {
        const preferredRef = useRef<HTMLButtonElement>(null)
        return (
          <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} initialFocusRef={preferredRef}>
            <button data-testid="first">First</button>
            <fieldset disabled>
              <button data-testid="preferred" ref={preferredRef}>
                Preferred but inside a disabled fieldset
              </button>
            </fieldset>
          </BaseDialog>
        )
      }

      render(<Harness />)
      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('first'))
    })

    it('leaves focus alone when the dialog has no focusable control', () => {
      // Boundary: `querySelectorAll(...)[0]` is undefined. Nothing must throw
      // and nothing must be focused.
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      outside.focus()

      try {
        render(
          <BaseDialog isOpen onClose={vi.fn()} zIndex={1000}>
            <p>Nothing focusable here</p>
          </BaseDialog>
        )

        expect(() => flushFocus()).not.toThrow()
        expect(document.activeElement).toBe(outside)
      } finally {
        outside.remove()
      }
    })

    it('focuses the only control when the dialog has exactly one', () => {
      // Boundary: first === last, so the Tab trap below also degenerates.
      render(
        <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} trapFocus>
          <button data-testid="only">Only</button>
        </BaseDialog>
      )

      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('only'))

      // Tab and Shift+Tab both wrap onto the same control rather than escaping.
      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getByTestId('only'))
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(screen.getByTestId('only'))
    })
  })

  describe('initialFocusKey', () => {
    /**
     * Dialog whose preferred target starts disabled and is enabled by a prop,
     * mirroring CameraDialog's Capture button waiting on `startPreview()`.
     */
    function AsyncHarness({
      ready,
      withKey = true
    }: {
      ready: boolean
      withKey?: boolean
    }): JSX.Element {
      const preferredRef = useRef<HTMLButtonElement>(null)
      return (
        <BaseDialog
          isOpen
          onClose={vi.fn()}
          zIndex={1000}
          initialFocusRef={preferredRef}
          initialFocusKey={withKey ? ready : undefined}
          // The shipped configuration. Without it these tests exercised the
          // promotion in isolation, while CameraDialog runs it alongside the
          // focusout rescue — and the two interact (see the promotion-after-
          // rescue test below).
          trapFocus
        >
          <button data-testid="fallback">Cancel</button>
          <button data-testid="preferred" ref={preferredRef} disabled={!ready}>
            Capture
          </button>
        </BaseDialog>
      )
    }

    it('promotes focus to the preferred target when it becomes enabled', () => {
      const { rerender } = render(<AsyncHarness ready={false} />)
      flushFocus()

      // Preferred is still disabled at the focus tick: fallback wins.
      expect(document.activeElement).toBe(screen.getByTestId('fallback'))

      rerender(<AsyncHarness ready />)
      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('preferred'))
    })

    it('never promotes without the key (the regression this prop fixes)', () => {
      const { rerender } = render(<AsyncHarness ready={false} withKey={false} />)
      flushFocus()
      expect(document.activeElement).toBe(screen.getByTestId('fallback'))

      rerender(<AsyncHarness ready withKey={false} />)
      flushFocus()

      // Documents the pre-#42 behaviour: the focus effect never re-runs, so
      // `initialFocusRef` is inert for asynchronously-enabled controls.
      expect(document.activeElement).toBe(screen.getByTestId('fallback'))
    })

    it('does not steal focus the user moved to another control', () => {
      const { rerender } = render(<AsyncHarness ready={false} />)
      flushFocus()

      const outside = document.createElement('button')
      document.body.appendChild(outside)
      outside.focus()

      try {
        rerender(<AsyncHarness ready />)
        flushFocus()

        expect(document.activeElement).toBe(outside)
      } finally {
        outside.remove()
      }
    })

    it('re-focuses from <body>, where a disabled-on-focus control leaves it', () => {
      const { rerender } = render(<AsyncHarness ready={false} />)
      flushFocus()

      // Chromium's blur-on-disable drops focus to <body>; that is not a
      // deliberate user move, so the promotion must still happen.
      ;(document.activeElement as HTMLElement).blur()
      expect(document.activeElement).toBe(document.body)

      rerender(<AsyncHarness ready />)
      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('preferred'))
    })

    it('promotes inside the 1.5s window after open', () => {
      const { rerender } = render(<AsyncHarness ready={false} />)
      flushFocus()
      expect(document.activeElement).toBe(screen.getByTestId('fallback'))

      // Well inside FOCUS_PROMOTION_WINDOW_MS (1500ms): a fast camera start.
      act(() => {
        vi.advanceTimersByTime(500)
      })
      rerender(<AsyncHarness ready />)
      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('preferred'))
    })

    it('does NOT promote once the 1.5s window has elapsed', () => {
      // The UX this protects: a slow camera that finally starts seconds after
      // the dialog opened must not move the focus ring off Cancel, because by
      // then the user has settled and may be about to press Enter on it.
      const { rerender } = render(<AsyncHarness ready={false} />)
      flushFocus()
      expect(document.activeElement).toBe(screen.getByTestId('fallback'))

      // Past FOCUS_PROMOTION_WINDOW_MS. `vi.useFakeTimers()` fakes Date as well
      // as the timer queue, so this really does move the clock BaseDialog reads.
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      rerender(<AsyncHarness ready />)
      flushFocus()

      // Everything else about the promotion is satisfied — the preferred target
      // is enabled and focus is still exactly where BaseDialog parked it — so
      // deleting the elapsed-time check makes this assertion fail.
      expect(screen.getByTestId('preferred')).toBeEnabled()
      expect(document.activeElement).toBe(screen.getByTestId('fallback'))
    })

    it('still refuses to steal focus inside the window (no-steal guard holds)', () => {
      // The time box is ADDITIVE, not a replacement: within the window, a user
      // who has already moved focus still keeps it.
      const { rerender } = render(<AsyncHarness ready={false} />)
      flushFocus()

      const outside = document.createElement('button')
      document.body.appendChild(outside)

      try {
        outside.focus()
        act(() => {
          vi.advanceTimersByTime(100) // still well inside the window
        })

        rerender(<AsyncHarness ready />)
        flushFocus()

        expect(screen.getByTestId('preferred')).toBeEnabled()
        expect(document.activeElement).toBe(outside)
      } finally {
        outside.remove()
      }
    })

    it('re-opens the window on a fresh open cycle', () => {
      // The clock is stamped per OPEN, not per mount, so a dialog reopened
      // after a long session still gets its promotion.
      function ReopenAsyncHarness({
        isOpen,
        ready
      }: {
        isOpen: boolean
        ready: boolean
      }): JSX.Element {
        const preferredRef = useRef<HTMLButtonElement>(null)
        return (
          <BaseDialog
            isOpen={isOpen}
            onClose={vi.fn()}
            zIndex={1000}
            initialFocusRef={preferredRef}
            initialFocusKey={ready}
          >
            <button data-testid="fallback">Cancel</button>
            <button data-testid="preferred" ref={preferredRef} disabled={!ready}>
              Capture
            </button>
          </BaseDialog>
        )
      }

      const { rerender } = render(<ReopenAsyncHarness isOpen ready={false} />)
      flushFocus()
      act(() => {
        vi.advanceTimersByTime(5000) // window long gone
      })

      rerender(<ReopenAsyncHarness isOpen={false} ready={false} />)
      rerender(<ReopenAsyncHarness isOpen ready={false} />)
      flushFocus()
      expect(document.activeElement).toBe(screen.getByTestId('fallback'))

      rerender(<ReopenAsyncHarness isOpen ready />)
      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('preferred'))
    })

    it('promotes again after its OWN rescue moved focus', () => {
      // Two focus authorities, one fact. The promotion guard asks "is focus
      // still where BaseDialog parked it?"; if the focusout rescue moves focus
      // without recording where it put it, the next promotion reads
      // `active !== placed`, misclassifies BaseDialog's own rescue as a
      // deliberate user move, and suppresses the promotion the prop exists to
      // deliver. The shipping sequence is a camera hiccup: Capture enables,
      // drops out, comes back, all inside the promotion window.
      const { rerender } = render(<AsyncHarness ready={false} />)
      flushFocus()
      expect(document.activeElement).toBe(screen.getByTestId('fallback'))

      // Camera up: promotion parks focus on Capture.
      rerender(<AsyncHarness ready />)
      flushFocus()
      const preferred = screen.getByTestId('preferred')
      expect(document.activeElement).toBe(preferred)

      // Transient disable. Chromium blurs Capture to nowhere; the rescue moves
      // focus to the only live control.
      rerender(<AsyncHarness ready={false} />)
      fireEvent.focusOut(preferred, { relatedTarget: null })
      expect(document.activeElement).toBe(screen.getByTestId('fallback'))

      // Stream recovers, still inside FOCUS_PROMOTION_WINDOW_MS.
      rerender(<AsyncHarness ready />)
      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('preferred'))
    })

    it('resolves focus unconditionally again after a close/reopen cycle', () => {
      function ReopenHarness({ isOpen }: { isOpen: boolean }): JSX.Element {
        const preferredRef = useRef<HTMLButtonElement>(null)
        return (
          <BaseDialog isOpen={isOpen} onClose={vi.fn()} zIndex={1000} initialFocusRef={preferredRef}>
            <button data-testid="fallback">Cancel</button>
            <button data-testid="preferred" ref={preferredRef}>
              Capture
            </button>
          </BaseDialog>
        )
      }

      const { rerender } = render(<ReopenHarness isOpen />)
      flushFocus()
      expect(document.activeElement).toBe(screen.getByTestId('preferred'))

      rerender(<ReopenHarness isOpen={false} />)
      rerender(<ReopenHarness isOpen />)
      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('preferred'))
    })
  })

  describe('trapFocus', () => {
    it('cycles Tab from the last control back to the first', () => {
      render(
        <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} trapFocus>
          <button data-testid="first">First</button>
          <button data-testid="last">Last</button>
        </BaseDialog>
      )
      flushFocus()

      screen.getByTestId('last').focus()
      const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })

      expect(notPrevented).toBe(false)
      expect(document.activeElement).toBe(screen.getByTestId('first'))
    })

    it('cycles Shift+Tab from the first control back to the last', () => {
      render(
        <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} trapFocus>
          <button data-testid="first">First</button>
          <button data-testid="last">Last</button>
        </BaseDialog>
      )
      flushFocus()

      screen.getByTestId('first').focus()
      const notPrevented = fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

      expect(notPrevented).toBe(false)
      expect(document.activeElement).toBe(screen.getByTestId('last'))
    })

    it('treats the last ENABLED control as the trap boundary', () => {
      render(
        <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} trapFocus>
          <button data-testid="first">First</button>
          <button data-testid="middle">Middle</button>
          <button data-testid="disabled-last" disabled>
            Disabled
          </button>
        </BaseDialog>
      )
      flushFocus()

      screen.getByTestId('middle').focus()
      fireEvent.keyDown(document, { key: 'Tab' })

      expect(document.activeElement).toBe(screen.getByTestId('first'))
    })

    it('leaves Tab alone when trapFocus is not set', () => {
      render(
        <BaseDialog isOpen onClose={vi.fn()} zIndex={1000}>
          <button data-testid="first">First</button>
          <button data-testid="last">Last</button>
        </BaseDialog>
      )
      flushFocus()

      screen.getByTestId('last').focus()
      // jsdom performs no native tabbing, so the load-bearing assertion is that
      // BaseDialog did not call preventDefault: the browser keeps its default.
      const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })

      expect(notPrevented).toBe(true)
      expect(document.activeElement).toBe(screen.getByTestId('last'))
    })

    it('ignores non-Tab keys', () => {
      render(
        <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} trapFocus closeOnEscape={false}>
          <button data-testid="first">First</button>
          <button data-testid="last">Last</button>
        </BaseDialog>
      )
      flushFocus()

      screen.getByTestId('last').focus()
      const notPrevented = fireEvent.keyDown(document, { key: 'Enter' })

      expect(notPrevented).toBe(true)
      expect(document.activeElement).toBe(screen.getByTestId('last'))
    })
  })

  describe('trapFocus recovery of escaped focus', () => {
    it('pulls focus back in when it sits on <body>', () => {
      // `<body>` is where focus lands after a backdrop mousedown and after
      // Chromium blurs a control at the instant it becomes disabled. It equals
      // neither the first nor the last control, so the plain boundary trap let
      // Tab walk into the page behind an `aria-modal` dialog.
      render(
        <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} trapFocus>
          <button data-testid="first">First</button>
          <button data-testid="last">Last</button>
        </BaseDialog>
      )
      flushFocus()
      ;(document.activeElement as HTMLElement).blur()
      expect(document.activeElement).toBe(document.body)

      const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })

      expect(notPrevented).toBe(false)
      expect(document.activeElement).toBe(screen.getByTestId('first'))
    })

    it('pulls focus back in from an element outside the dialog', () => {
      const outside = document.createElement('button')
      document.body.appendChild(outside)

      try {
        render(
          <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} trapFocus>
            <button data-testid="first">First</button>
            <button data-testid="last">Last</button>
          </BaseDialog>
        )
        flushFocus()
        outside.focus()
        expect(document.activeElement).toBe(outside)

        const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })

        expect(notPrevented).toBe(false)
        expect(document.activeElement).toBe(screen.getByTestId('first'))
      } finally {
        outside.remove()
      }
    })

    it('re-enters on the first control for Shift+Tab too', () => {
      // Outside the dialog there is no "previous element inside it" to step
      // back to, so both directions land on the first focusable.
      render(
        <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} trapFocus>
          <button data-testid="first">First</button>
          <button data-testid="last">Last</button>
        </BaseDialog>
      )
      flushFocus()
      ;(document.activeElement as HTMLElement).blur()

      const notPrevented = fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

      expect(notPrevented).toBe(false)
      expect(document.activeElement).toBe(screen.getByTestId('first'))
    })

    it('does not throw when the dialog has no focusable control', () => {
      // Boundary: `focusable[0]` is undefined, so the recovery branch has no
      // target. Tab must fall through to the browser, not throw.
      const outside = document.createElement('button')
      document.body.appendChild(outside)

      try {
        render(
          <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} trapFocus>
            <p>Nothing focusable here</p>
          </BaseDialog>
        )
        flushFocus()
        outside.focus()

        let notPrevented = true
        expect(() => {
          notPrevented = fireEvent.keyDown(document, { key: 'Tab' })
        }).not.toThrow()

        expect(notPrevented).toBe(true)
        expect(document.activeElement).toBe(outside)
      } finally {
        outside.remove()
      }
    })

    it('leaves escaped focus alone when trapFocus is not set (Tab)', () => {
      // The recovery branch is part of the opt-in, not a global behaviour
      // change for the dialogs that never asked for a trap.
      const outside = document.createElement('button')
      document.body.appendChild(outside)

      try {
        render(
          <BaseDialog isOpen onClose={vi.fn()} zIndex={1000}>
            <button data-testid="first">First</button>
            <button data-testid="last">Last</button>
          </BaseDialog>
        )
        flushFocus()
        outside.focus()

        const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })

        expect(notPrevented).toBe(true)
        expect(document.activeElement).toBe(outside)
      } finally {
        outside.remove()
      }
    })
  })

  describe('trapFocus focusout rescue', () => {
    /**
     * Dialog with three controls, the last of which can be disabled by a prop.
     * Mirrors CameraDialog's Capture button and mirror checkbox going
     * `disabled` on a camera disconnect — the only shape the rescue acts on.
     * (CameraDialog's Refresh button does NOT belong here: `handleRefresh`
     * clears the error that renders it, so activating Refresh UNMOUNTS it. See
     * the unmount test below for why that case is deliberately not rescued.)
     */
    function DisablingHarness({
      isOpen = true,
      thirdDisabled = false,
      trapFocus = true
    }: {
      isOpen?: boolean
      thirdDisabled?: boolean
      trapFocus?: boolean
    }): JSX.Element {
      return (
        <BaseDialog isOpen={isOpen} onClose={vi.fn()} zIndex={1000} trapFocus={trapFocus}>
          <button data-testid="first">First</button>
          <button data-testid="second">Second</button>
          <button data-testid="third" disabled={thirdDisabled}>
            Third
          </button>
        </BaseDialog>
      )
    }

    /**
     * jsdom does not emulate Chromium's "disabling a focused control blurs it",
     * so the focusout is dispatched by hand. `relatedTarget: null` and a
     * bubbling event are exactly what Chromium delivers in that situation.
     */
    function simulateBlurOnDisable(element: HTMLElement): void {
      fireEvent.focusOut(element, { relatedTarget: null })
    }

    it('returns focus into the dialog when the focused control becomes disabled', () => {
      const { rerender } = render(<DisablingHarness />)
      flushFocus()

      const third = screen.getByTestId('third')
      third.focus()
      expect(document.activeElement).toBe(third)

      rerender(<DisablingHarness thirdDisabled />)
      simulateBlurOnDisable(third)

      const container = screen.getByTestId(TEST_IDS.DIALOG_CONTAINER)
      expect(container.contains(document.activeElement)).toBe(true)
      expect(document.activeElement).toBe(screen.getByTestId('first'))
    })

    it('does not fire on a normal Tab between two enabled controls', () => {
      // `relatedTarget` is the next control and it is inside the container.
      // Without the rescue's guards this would yank focus back to `first` on
      // every Tab and the dialog would be unnavigable.
      render(<DisablingHarness />)
      flushFocus()

      const first = screen.getByTestId('first')
      const second = screen.getByTestId('second')
      first.focus()

      // The real focus move (which itself dispatches the focusout jsdom models,
      // relatedTarget = second), plus an explicit dispatch so the assertion does
      // not depend on jsdom's internal ordering.
      second.focus()
      fireEvent.focusOut(first, { relatedTarget: second })

      expect(document.activeElement).toBe(second)
    })

    it('does not fire when a DEAD control hands focus to another control inside', () => {
      // Isolates the relatedTarget-inside guard from the liveness guard: the
      // control that lost focus really is disabled, so only the relatedTarget
      // check can stop the rescue. Focus must stay on `second`, not snap to
      // `first`.
      const { rerender } = render(<DisablingHarness />)
      flushFocus()

      const second = screen.getByTestId('second')
      const third = screen.getByTestId('third')
      third.focus()

      rerender(<DisablingHarness thirdDisabled />)
      second.focus()
      fireEvent.focusOut(third, { relatedTarget: second })

      expect(document.activeElement).toBe(second)
    })

    it('does not fire when the focused control is still enabled and connected', () => {
      // Isolates the liveness guard: focus left a LIVE control to nowhere (a
      // click on a non-focusable area, the window deactivating). BaseDialog
      // must not override that; the Tab trap already recovers on the next
      // keystroke.
      render(<DisablingHarness />)
      flushFocus()

      const first = screen.getByTestId('first')
      const focusSpy = vi.spyOn(first, 'focus')
      const third = screen.getByTestId('third')
      third.focus()

      simulateBlurOnDisable(third)

      expect(focusSpy).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(third)
    })

    it('does not grab focus once the dialog subtree is detached (closing)', () => {
      // React removes the portal subtree in the mutation phase and only detaches
      // this listener when the passive effect cleanup runs, so a focusout can
      // legitimately arrive against a detached container. Detaching by hand
      // reproduces exactly that window.
      //
      // The spy is the load-bearing assertion: focusing a detached element is a
      // no-op in jsdom, so asserting on `document.activeElement` alone would
      // pass even for an implementation with no teardown guard at all.
      const { rerender } = render(<DisablingHarness />)
      flushFocus()

      const container = screen.getByTestId(TEST_IDS.DIALOG_CONTAINER)
      const first = screen.getByTestId('first')
      const third = screen.getByTestId('third')
      const focusSpy = vi.spyOn(first, 'focus')

      // A DISABLED control losing focus to nowhere, so the only guard that can
      // stop the rescue here is the detachment check.
      rerender(<DisablingHarness thirdDisabled />)
      container.remove()
      expect(container.isConnected).toBe(false)

      simulateBlurOnDisable(third)

      expect(focusSpy).not.toHaveBeenCalled()
    })

    it('closing the dialog restores focus to the opener rather than grabbing it', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)

      try {
        opener.focus()

        const { rerender } = render(<DisablingHarness />)
        flushFocus()
        expect(document.activeElement).toBe(screen.getByTestId('first'))

        rerender(<DisablingHarness isOpen={false} />)

        expect(document.activeElement).toBe(opener)
      } finally {
        opener.remove()
      }
    })

    it('is part of the trapFocus opt-in', () => {
      // Dialogs that never asked for a trap keep their previous behaviour.
      const { rerender } = render(<DisablingHarness trapFocus={false} />)
      flushFocus()

      const third = screen.getByTestId('third')
      third.focus()
      rerender(<DisablingHarness trapFocus={false} thirdDisabled />)
      simulateBlurOnDisable(third)

      expect(document.activeElement).toBe(third)
    })

    it('does not throw when the dialog has no other focusable control', () => {
      // Boundary: the disabled control was the only one, so there is nothing to
      // rescue focus to.
      function OnlyControlHarness({ disabled }: { disabled: boolean }): JSX.Element {
        return (
          <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} trapFocus>
            <button data-testid="only" disabled={disabled}>
              Only
            </button>
          </BaseDialog>
        )
      }

      const { rerender } = render(<OnlyControlHarness disabled={false} />)
      flushFocus()

      const only = screen.getByTestId('only')
      rerender(<OnlyControlHarness disabled />)

      expect(() => simulateBlurOnDisable(only)).not.toThrow()
    })

    it('does not rescue a control that was UNMOUNTED while focused', () => {
      // Measured in this app's runtime (Electron 39.8.9 / Chromium 142, macOS):
      // removing a focused element DOES fire `blur` and a bubbling `focusout`
      // with `relatedTarget: null` — but Blink clears focus BEFORE detaching
      // the node, so at dispatch the target still reports `isConnected: true`
      // and `matches(':disabled') === false`. That ordering is reproduced here.
      //
      // Declining is the behaviour we want, not an accident of the ordering:
      // DocumentImportDialog and TranscriptionDialog swap their whole footer on
      // every state transition, so a rescue here would fire on the ordinary
      // "user pressed Enter on Import" path and park focus on the
      // `.dialog-btn-danger` Cancel button that replaced it — where a second
      // reflexive Enter aborts the operation just started.
      function UnmountHarness({ showExtra }: { showExtra: boolean }): JSX.Element {
        return (
          <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} trapFocus>
            <button data-testid="first">First</button>
            {showExtra && <button data-testid="extra">Extra</button>}
          </BaseDialog>
        )
      }

      const { rerender } = render(<UnmountHarness showExtra />)
      flushFocus()

      const first = screen.getByTestId('first')
      const extra = screen.getByTestId('extra')
      extra.focus()
      const focusSpy = vi.spyOn(first, 'focus')

      // Chromium's order: focusout while still attached and still enabled...
      fireEvent.focusOut(extra, { relatedTarget: null })
      // ...then the detach.
      rerender(<UnmountHarness showExtra={false} />)

      expect(focusSpy).not.toHaveBeenCalled()
      expect(screen.queryByTestId('extra')).not.toBeInTheDocument()
    })
  })

  describe('focusRescueRef', () => {
    /**
     * Dialog shaped like CameraDialog in its error state: the first focusable
     * in DOM order is the device `<select>` at the top, while the control the
     * situation calls for (Refresh) sits at the end.
     */
    function RescueHarness({
      targetDisabled = false,
      withRescueButton = true,
      rescueDisabled = false,
      withRescueRef = true
    }: {
      targetDisabled?: boolean
      withRescueButton?: boolean
      rescueDisabled?: boolean
      withRescueRef?: boolean
    }): JSX.Element {
      const rescueRef = useRef<HTMLButtonElement>(null)
      return (
        <BaseDialog
          isOpen
          onClose={vi.fn()}
          zIndex={1000}
          trapFocus
          focusRescueRef={withRescueRef ? rescueRef : undefined}
        >
          <select data-testid="select">
            <option>Camera 1</option>
          </select>
          <button data-testid="target" disabled={targetDisabled}>
            Target
          </button>
          {withRescueButton && (
            <button data-testid="rescue" ref={rescueRef} disabled={rescueDisabled}>
              Refresh
            </button>
          )}
        </BaseDialog>
      )
    }

    it('rescues to the nominated control instead of the first focusable', () => {
      const { rerender } = render(<RescueHarness />)
      flushFocus()

      const target = screen.getByTestId('target')
      target.focus()
      rerender(<RescueHarness targetDisabled />)
      fireEvent.focusOut(target, { relatedTarget: null })

      // Not the `<select>`, where the next arrow key would silently switch
      // camera and restart the stream.
      expect(document.activeElement).toBe(screen.getByTestId('rescue'))
    })

    it('falls back to the first focusable when the nominated control is not rendered', () => {
      const { rerender } = render(<RescueHarness withRescueButton={false} />)
      flushFocus()

      const target = screen.getByTestId('target')
      target.focus()
      rerender(<RescueHarness withRescueButton={false} targetDisabled />)
      fireEvent.focusOut(target, { relatedTarget: null })

      expect(document.activeElement).toBe(screen.getByTestId('select'))
    })

    it('falls back to the first focusable when the nominated control is disabled', () => {
      const { rerender } = render(<RescueHarness rescueDisabled />)
      flushFocus()

      const target = screen.getByTestId('target')
      target.focus()
      rerender(<RescueHarness rescueDisabled targetDisabled />)
      fireEvent.focusOut(target, { relatedTarget: null })

      expect(document.activeElement).toBe(screen.getByTestId('select'))
    })

    it('rescues to the first focusable when no rescue ref is given (unchanged default)', () => {
      const { rerender } = render(<RescueHarness withRescueRef={false} />)
      flushFocus()

      const target = screen.getByTestId('target')
      target.focus()
      rerender(<RescueHarness withRescueRef={false} targetDisabled />)
      fireEvent.focusOut(target, { relatedTarget: null })

      expect(document.activeElement).toBe(screen.getByTestId('select'))
    })
  })

  describe('initialFocusRef containment', () => {
    it('ignores a preferred target outside the dialog subtree', () => {
      // Focusing outside an `aria-modal` dialog defeats the modality, and with
      // `trapFocus` on the next Tab yanks it straight back — visible ping-pong.
      function OutsideHarness(): JSX.Element {
        const outsideRef = useRef<HTMLButtonElement>(null)
        return (
          <>
            <button data-testid="outside" ref={outsideRef}>
              Outside the dialog
            </button>
            <BaseDialog isOpen onClose={vi.fn()} zIndex={1000} initialFocusRef={outsideRef} trapFocus>
              <button data-testid="inside">Inside</button>
            </BaseDialog>
          </>
        )
      }

      render(<OutsideHarness />)
      flushFocus()

      expect(document.activeElement).toBe(screen.getByTestId('inside'))
    })
  })

  describe('stacked dialogs', () => {
    /**
     * The shipping shape: DocumentImportDialog and TranscriptionDialog are
     * mounted at app root with `trapFocus`, and DialogManager stacks its own
     * dialogs (the Cmd+Q quit ConfirmDialog, which does NOT trap) on top.
     */
    function StackHarness({
      topOpen,
      topTraps = true
    }: {
      topOpen: boolean
      topTraps?: boolean
    }): JSX.Element {
      return (
        <>
          <BaseDialog isOpen onClose={vi.fn()} zIndex={10000} trapFocus>
            <button data-testid="bg-first">Background first</button>
            <button data-testid="bg-last">Background last</button>
          </BaseDialog>
          <BaseDialog isOpen={topOpen} onClose={vi.fn()} zIndex={10001} trapFocus={topTraps}>
            <button data-testid="top-first">Top first</button>
            <button data-testid="top-last">Top last</button>
          </BaseDialog>
        </>
      )
    }

    /** Open the background dialog, then stack the top one on it. */
    function renderStacked(topTraps = true): ReturnType<typeof render> {
      const result = render(<StackHarness topOpen={false} topTraps={topTraps} />)
      flushFocus()
      result.rerender(<StackHarness topOpen topTraps={topTraps} />)
      flushFocus()
      return result
    }

    it('lets Tab through to the browser inside the top dialog', () => {
      // The keyboard trap this fixes: the background dialog's document listener
      // is registered FIRST, so it ran first, saw focus "outside itself" (it was
      // in the top dialog), preventDefault()ed and dragged focus down. The top
      // dialog's own trap then pulled it back to ITS first control — so Tab
      // could never advance and Quit/Cancel were keyboard-unreachable.
      renderStacked()
      expect(document.activeElement).toBe(screen.getByTestId('top-first'))

      const bgFocusSpy = vi.spyOn(screen.getByTestId('bg-first'), 'focus')
      const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })

      expect(bgFocusSpy).not.toHaveBeenCalled()
      expect(notPrevented).toBe(true)
      expect(document.activeElement).toBe(screen.getByTestId('top-first'))
    })

    it('cycles Tab within the TOP dialog only', () => {
      renderStacked()

      screen.getByTestId('top-last').focus()
      const bgFocusSpy = vi.spyOn(screen.getByTestId('bg-first'), 'focus')
      const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })

      expect(bgFocusSpy).not.toHaveBeenCalled()
      expect(notPrevented).toBe(false)
      expect(document.activeElement).toBe(screen.getByTestId('top-first'))
    })

    it('is suppressed by a NON-trapping dialog stacked on top', () => {
      // The concrete case: the quit ConfirmDialog never opted into `trapFocus`,
      // so a stack of only trapping dialogs would leave this unfixed.
      renderStacked(false)

      screen.getByTestId('top-last').focus()
      const bgFocusSpy = vi.spyOn(screen.getByTestId('bg-first'), 'focus')
      const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })

      expect(bgFocusSpy).not.toHaveBeenCalled()
      expect(notPrevented).toBe(true)
      expect(document.activeElement).toBe(screen.getByTestId('top-last'))
    })

    it('does not rescue focus out of the dialog stacked on top of it', () => {
      function DisablingStack({
        topOpen,
        bgDisabled = false
      }: {
        topOpen: boolean
        bgDisabled?: boolean
      }): JSX.Element {
        return (
          <>
            <BaseDialog isOpen onClose={vi.fn()} zIndex={10000} trapFocus>
              <button data-testid="bg-first">Background first</button>
              <button data-testid="bg-busy" disabled={bgDisabled}>
                Background busy
              </button>
            </BaseDialog>
            <BaseDialog isOpen={topOpen} onClose={vi.fn()} zIndex={10001} trapFocus>
              <button data-testid="top-first">Top first</button>
            </BaseDialog>
          </>
        )
      }

      const { rerender } = render(<DisablingStack topOpen={false} />)
      flushFocus()
      const bgBusy = screen.getByTestId('bg-busy')
      rerender(<DisablingStack topOpen />)
      flushFocus()
      expect(document.activeElement).toBe(screen.getByTestId('top-first'))

      // Background work finishes and disables its control while the top dialog
      // holds focus. Rescuing here would yank focus out of the modal on top.
      const bgFocusSpy = vi.spyOn(screen.getByTestId('bg-first'), 'focus')
      rerender(<DisablingStack topOpen bgDisabled />)
      fireEvent.focusOut(bgBusy, { relatedTarget: null })

      expect(bgFocusSpy).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(screen.getByTestId('top-first'))
    })

    it('ranks by zIndex, not by registration order, when a lower dialog re-opens', () => {
      // The ordering contract, stated as a test. A permanently-mounted app-root
      // dialog (TranscriptionDialog, DocumentImportDialog — zIndex 10000) whose
      // `isOpen` cycles false → true WHILE a DialogManager dialog at 10001 is
      // already up registers LAST. Under registration order it would claim
      // topmost and reinstate the app-wide keyboard trap the stack exists to
      // prevent; under z-index it stays behind, where it is painted.
      // The top dialog stays mounted and open THROUGHOUT — only `bgOpen`
      // cycles. Re-rendering a different root element type instead would
      // remount both dialogs and re-register them in DOM order, which is the
      // ordering this test exists to disprove reliance on.
      function ReopenHarness({ bgOpen }: { bgOpen: boolean }): JSX.Element {
        return (
          <>
            <BaseDialog isOpen={bgOpen} onClose={vi.fn()} zIndex={10000} trapFocus>
              <button data-testid="bg-first">Background first</button>
              <button data-testid="bg-last">Background last</button>
            </BaseDialog>
            <BaseDialog isOpen onClose={vi.fn()} zIndex={10001} trapFocus>
              <button data-testid="top-first">Top first</button>
              <button data-testid="top-last">Top last</button>
            </BaseDialog>
          </>
        )
      }

      const { rerender } = render(<ReopenHarness bgOpen />)
      flushFocus()
      rerender(<ReopenHarness bgOpen={false} />)
      flushFocus()
      // Re-opened underneath the top dialog: registers LAST, paints BEHIND.
      rerender(<ReopenHarness bgOpen />)
      flushFocus()

      screen.getByTestId('top-last').focus()
      const bgFocusSpy = vi.spyOn(screen.getByTestId('bg-first'), 'focus')
      fireEvent.keyDown(document, { key: 'Tab' })

      expect(bgFocusSpy).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(screen.getByTestId('top-first'))
    })

    it('breaks a zIndex tie by registration order', () => {
      // The other half of the contract: equal z-index is the case registration
      // order still decides, and the LAST registration is frontmost — the
      // behaviour equal-z-index stacks had before z-index was compared at all.
      function TieHarness({ secondOpen }: { secondOpen: boolean }): JSX.Element {
        return (
          <>
            <BaseDialog isOpen onClose={vi.fn()} zIndex={10000} trapFocus>
              <button data-testid="bg-first">Background first</button>
              <button data-testid="bg-last">Background last</button>
            </BaseDialog>
            <BaseDialog isOpen={secondOpen} onClose={vi.fn()} zIndex={10000} trapFocus>
              <button data-testid="top-first">Top first</button>
              <button data-testid="top-last">Top last</button>
            </BaseDialog>
          </>
        )
      }

      const { rerender } = render(<TieHarness secondOpen={false} />)
      flushFocus()
      rerender(<TieHarness secondOpen />)
      flushFocus()

      screen.getByTestId('top-last').focus()
      const bgFocusSpy = vi.spyOn(screen.getByTestId('bg-first'), 'focus')
      fireEvent.keyDown(document, { key: 'Tab' })

      expect(bgFocusSpy).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(screen.getByTestId('top-first'))
    })

    it('restores trapping to the dialog beneath once the top one closes', () => {
      const { rerender } = renderStacked()

      rerender(<StackHarness topOpen={false} />)
      flushFocus()

      screen.getByTestId('bg-last').focus()
      const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })

      expect(notPrevented).toBe(false)
      expect(document.activeElement).toBe(screen.getByTestId('bg-first'))
    })
  })
})
