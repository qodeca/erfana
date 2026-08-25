// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the root crash recovery screen.
 *
 * Every timed row follows one recipe (design §5, "Fallback — timers"):
 * fake timers installed and torn down PER TEST,
 * `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` created AFTER the
 * switch, and the clock advanced inside `await act(...)`.
 *
 * ONE DEVIATION from the recipe as written, measured on this substrate
 * (vitest 3.2.6 / user-event 14.6 / React 18.3 / jsdom 25): plain
 * `vi.useFakeTimers()` DEADLOCKS `user.click()`. user-event awaits a real
 * `setTimeout(…, 0)` for its inter-event delay in parallel with
 * `advanceTimers(0)`, and with the clock fully frozen that promise never
 * settles — every such test hangs to the 5 s timeout, and because a timed-out
 * test never reaches its `finally`, the frozen clock then poisons every later
 * test in the file. `{ shouldAdvanceTime: true }` lets the fake clock track
 * real time between explicit `advanceTimersByTime` calls, which unblocks
 * user-event while keeping the 3 s advance deterministic (tests run in
 * milliseconds, so auto-advance never reaches the 3 s threshold on its own).
 * Verified alternatives that do NOT work: `delay: null`,
 * `advanceTimers: vi.advanceTimersByTimeAsync`, a wrapped arrow, and a reduced
 * `toFake` list. The `afterEach` below restores real timers unconditionally as
 * a second line of defence.
 *
 * `window.api` is extended with `(window as any).api = …`. Never
 * `vi.stubGlobal('window', …)` — that replaces the whole window object and
 * destroys React's DOM internals.
 *
 * @see docs/design/design-issue-60.md §2.3, §2.7, §5
 */

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CLOSE_PROJECT_TIMEOUT_MS, RootErrorFallback } from './RootErrorFallback'
import { buildErrorDetails, MAX_REPORT_CHARS, type ErrorDetails } from './errorDetails'
import { TEST_IDS } from '../../constants/testids'
import { textClipboard } from '../../services/textClipboard'

vi.mock('../../services/textClipboard', () => ({
  textClipboard: { writeText: vi.fn() }
}))

/** Milliseconds the Restart handler waits before offering manual-quit guidance. */
const RESTART_STALLED_MS = 3000

/** Bridge doubles installed on `window.api` for a test. */
interface BridgeDoubles {
  relaunchApp: ReturnType<typeof vi.fn>
  closeProject: ReturnType<typeof vi.fn>
  openLogsFolder: ReturnType<typeof vi.fn>
}

/**
 * Install a complete `window.api` bridge, extending the existing window.
 *
 * @param overrides - Per-method replacements
 * @returns The installed doubles, for assertions
 */
function installBridge(overrides: Partial<BridgeDoubles> = {}): BridgeDoubles {
  const doubles: BridgeDoubles = {
    relaunchApp: overrides.relaunchApp ?? vi.fn().mockResolvedValue(undefined),
    closeProject: overrides.closeProject ?? vi.fn().mockResolvedValue(true),
    openLogsFolder: overrides.openLogsFolder ?? vi.fn().mockResolvedValue('')
  }

  ;(window as unknown as { api: unknown }).api = {
    system: { relaunchApp: doubles.relaunchApp },
    file: { closeProject: doubles.closeProject },
    logging: { openLogsFolder: doubles.openLogsFolder },
    clipboard: { writeText: vi.fn().mockResolvedValue(true) }
  }

  return doubles
}

/** Build realistic details for the component under test. */
function makeDetails(overrides: Partial<ErrorDetails> = {}): ErrorDetails {
  const error = new RangeError('Maximum call stack size exceeded')
  error.stack = 'RangeError: Maximum call stack size exceeded\n    at flattenTree (x.ts:45:1)'
  return { ...buildErrorDetails(error, '\n    in ProjectTree\n    in App', '9.9.9'), ...overrides }
}

function renderFallback(details: ErrorDetails = makeDetails()) {
  return render(<RootErrorFallback details={details} />)
}

const statusRegion = (): HTMLElement => screen.getByTestId(TEST_IDS.ROOT_ERROR_STATUS)
const restartButton = (): HTMLElement => screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_RESTART)

/**
 * Install fake timers in the only configuration user-event survives here.
 *
 * @returns A user-event instance wired to the fake clock
 */
function setupFakeTimers(): ReturnType<typeof userEvent.setup> {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

describe('RootErrorFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installBridge()
    vi.mocked(textClipboard.writeText).mockResolvedValue(true)
  })

  afterEach(() => {
    // Unconditional: a fake clock left installed by a failing test would hang
    // every later user-event interaction in this file.
    vi.useRealTimers()
    delete (window as unknown as { api?: unknown }).api
  })

  describe('accessibility contract', () => {
    it('exposes an alertdialog with a real accessible name and holds focus on mount', () => {
      renderFallback()

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAccessibleName('Erfana stopped unexpectedly.')
      expect(dialog).toHaveAccessibleDescription(
        'Files you saved are not affected. Restarting opens Erfana on the welcome screen.'
      )
      expect(dialog).toHaveAttribute('tabindex', '-1')
      expect(dialog).toHaveFocus()
    })

    it('drops the restart promise and describes the manual quit when Restart is gone', () => {
      // Partial bridge: Copy and Open logs survive, Restart does not. Promising
      // a restart here would point at a button that is not on screen.
      ;(window as unknown as { api: unknown }).api = {
        system: {},
        file: { closeProject: vi.fn() },
        logging: { openLogsFolder: vi.fn() },
        clipboard: { writeText: vi.fn() }
      }

      renderFallback()

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toHaveAccessibleDescription(
        'Files you saved are not affected. Quit Erfana and open it again.'
      )
      expect(screen.queryByText(/Restarting opens Erfana/)).not.toBeInTheDocument()
    })

    it('describes the degraded screen with its own instruction, not the generic message', () => {
      delete (window as unknown as { api?: unknown }).api

      renderFallback()

      const dialog = screen.getByRole('alertdialog')
      const instruction = screen.getByText(/recovery tools are unavailable/)
      const logPath = screen.getByText('.erfana/logs in your home folder')

      // The instruction ends on "Log files are in:", so the location has to be
      // part of the description or the sentence is left hanging with the one
      // fact the user still needs unspoken.
      expect(dialog).toHaveAccessibleDescription(
        "Files you saved are not affected. Erfana's recovery tools are unavailable, so quit " +
          'Erfana and open it again. Log files are in: .erfana/logs in your home folder'
      )
      // Bound by id, in that order, and the generic message paragraph is gone
      // entirely — the reassurance must not be announced twice.
      expect(dialog.getAttribute('aria-describedby')).toBe(
        `${instruction.getAttribute('id')} ${logPath.getAttribute('id')}`
      )
      expect(screen.queryByText(/Restarting opens Erfana/)).not.toBeInTheDocument()
      expect(
        screen.queryByText('Files you saved are not affected. Quit Erfana and open it again.')
      ).not.toBeInTheDocument()
    })

    it('does NOT put focus on Restart', () => {
      // A buffered Enter must not relaunch the app the instant the screen appears.
      renderFallback()
      expect(restartButton()).not.toHaveFocus()
    })

    it('renders exactly one live region, present from the first render', () => {
      renderFallback()

      const liveRegions = screen.getAllByRole('status')
      expect(liveRegions).toHaveLength(1)
      expect(liveRegions[0]).toHaveAttribute('aria-live', 'polite')
      expect(liveRegions[0]).toBeEmptyDOMElement()
    })

    it('keeps the raw error message out of the heading', () => {
      renderFallback()

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Erfana stopped unexpectedly.'
      )
      expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('RangeError')
    })
  })

  describe('details disclosure', () => {
    it('starts collapsed with aria-expanded="false" and the region out of the a11y tree', () => {
      renderFallback()

      const toggle = screen.getByTestId(TEST_IDS.ROOT_ERROR_DETAILS_TOGGLE)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(toggle).toHaveTextContent('Show error details')
      expect(screen.queryByRole('region', { name: 'Error details' })).not.toBeInTheDocument()
    })

    it('expands to a focusable, named region that aria-controls resolves to', async () => {
      const user = userEvent.setup()
      renderFallback()

      const toggle = screen.getByTestId(TEST_IDS.ROOT_ERROR_DETAILS_TOGGLE)
      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(toggle).toHaveTextContent('Hide error details')

      const region = screen.getByRole('region', { name: 'Error details' })
      expect(region).toHaveAttribute('tabindex', '0')
      expect(toggle.getAttribute('aria-controls')).toBe(region.getAttribute('id'))
    })

    it('shows the raw error message and stack only inside the details region', async () => {
      const user = userEvent.setup()
      renderFallback()

      // Collapsed: `hidden` keeps the untrusted message out of the
      // accessibility tree, and nothing above the disclosure repeats it.
      expect(screen.getByTestId(TEST_IDS.ROOT_ERROR_DETAILS)).toHaveAttribute('hidden')
      expect(screen.queryByRole('region', { name: 'Error details' })).not.toBeInTheDocument()

      await user.click(screen.getByTestId(TEST_IDS.ROOT_ERROR_DETAILS_TOGGLE))

      const region = screen.getByRole('region', { name: 'Error details' })
      expect(region).toHaveTextContent('RangeError: Maximum call stack size exceeded')
      expect(region).toHaveTextContent('flattenTree')
      expect(region).toHaveTextContent('in ProjectTree')
      expect(region).toHaveTextContent('Erfana 9.9.9')
    })

    it('collapses again on a second activation', async () => {
      const user = userEvent.setup()
      renderFallback()

      const toggle = screen.getByTestId(TEST_IDS.ROOT_ERROR_DETAILS_TOGGLE)
      await user.click(toggle)
      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('region', { name: 'Error details' })).not.toBeInTheDocument()
    })
  })

  describe('Copy error details', () => {
    it('writes the capped report through the clipboard service and announces success', async () => {
      const user = userEvent.setup()
      renderFallback()

      await user.click(screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_COPY))

      expect(textClipboard.writeText).toHaveBeenCalledTimes(1)
      const report = vi.mocked(textClipboard.writeText).mock.calls[0][0]
      expect(report.length).toBeLessThanOrEqual(MAX_REPORT_CHARS)
      expect(report).toContain('version: 9.9.9')
      expect(report).toContain('Maximum call stack size exceeded')

      await waitFor(() => {
        expect(statusRegion()).toHaveTextContent('Error details copied to clipboard.')
      })
    })

    it('re-announces on a repeat copy by clearing the region first', async () => {
      const user = userEvent.setup()
      renderFallback()

      await user.click(screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_COPY))
      await waitFor(() => {
        expect(statusRegion()).toHaveTextContent('Error details copied to clipboard.')
      })

      // A live region only speaks when its content MUTATES, so writing the same
      // string twice must go through an empty state in between. Observing the
      // DOM directly is the only way to prove that happened.
      const seen: string[] = []
      const observer = new MutationObserver(() => {
        seen.push(statusRegion().textContent ?? '')
      })
      observer.observe(statusRegion(), { childList: true, characterData: true, subtree: true })

      await user.click(screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_COPY))
      await waitFor(() => {
        expect(statusRegion()).toHaveTextContent('Error details copied to clipboard.')
      })
      observer.disconnect()

      expect(textClipboard.writeText).toHaveBeenCalledTimes(2)
      expect(seen).toContain('')
      expect(seen[seen.length - 1]).toBe('Error details copied to clipboard.')
    })

    it('announces failure when the clipboard write is refused', async () => {
      vi.mocked(textClipboard.writeText).mockResolvedValue(false)
      const user = userEvent.setup()
      renderFallback()

      await user.click(screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_COPY))

      await waitFor(() => {
        expect(statusRegion()).toHaveTextContent('Could not copy the error details')
      })
    })

    it('announces failure when the clipboard write rejects', async () => {
      vi.mocked(textClipboard.writeText).mockRejectedValue(new Error('IPC gone'))
      const user = userEvent.setup()
      renderFallback()

      await user.click(screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_COPY))

      await waitFor(() => {
        expect(statusRegion()).toHaveTextContent('Could not copy the error details')
      })
    })

    it('keeps the copy status until the next action (no timed revert)', async () => {
      const user = setupFakeTimers()
      try {
        renderFallback()
        await user.click(screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_COPY))
        await act(async () => {
          await Promise.resolve()
        })
        expect(statusRegion()).toHaveTextContent('Error details copied to clipboard.')

        await act(async () => {
          vi.advanceTimersByTime(30_000)
        })

        expect(statusRegion()).toHaveTextContent('Error details copied to clipboard.')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('Restart', () => {
    it('closes the project before relaunching', async () => {
      const user = userEvent.setup()
      const bridge = installBridge()
      renderFallback()

      await user.click(restartButton())

      await waitFor(() => {
        expect(bridge.relaunchApp).toHaveBeenCalledTimes(1)
      })
      expect(bridge.closeProject).toHaveBeenCalledTimes(1)
      expect(vi.mocked(bridge.closeProject).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(bridge.relaunchApp).mock.invocationCallOrder[0]
      )
    })

    it('relaunches even when closeProject rejects', async () => {
      const user = userEvent.setup()
      const bridge = installBridge({ closeProject: vi.fn().mockRejectedValue(new Error('no IPC')) })
      renderFallback()

      await user.click(restartButton())

      await waitFor(() => {
        expect(bridge.relaunchApp).toHaveBeenCalledTimes(1)
      })
    })

    it('relaunches even when closeProject never settles', async () => {
      // The realistic failure after a crash is not a rejection but silence: the
      // main process never answers, and an unbounded `await` would leave the
      // user on a recovery screen whose only working control does nothing.
      const user = setupFakeTimers()
      try {
        const bridge = installBridge({
          closeProject: vi.fn().mockReturnValue(new Promise(() => {}))
        })
        renderFallback()

        await user.click(restartButton())
        await act(async () => {
          await Promise.resolve()
        })
        expect(bridge.relaunchApp).not.toHaveBeenCalled()

        await act(async () => {
          vi.advanceTimersByTime(CLOSE_PROJECT_TIMEOUT_MS)
        })

        expect(bridge.closeProject).toHaveBeenCalledTimes(1)
        expect(bridge.relaunchApp).toHaveBeenCalledTimes(1)
        // Still well short of the 3 s stall guidance, so the screen has not
        // contradicted itself in the meantime.
        expect(statusRegion()).toHaveTextContent('Restarting Erfana…')
      } finally {
        vi.useRealTimers()
      }
    })

    it('marks the button aria-disabled (never disabled) and keeps focus on it', async () => {
      const user = userEvent.setup()
      renderFallback()

      const button = restartButton()
      await user.click(button)

      // These three attribute assertions ARE the invariant: `aria-disabled` is
      // set and the `disabled` attribute is not. The focus check below is a
      // weaker companion — jsdom does not emulate Chromium's blur-on-disable,
      // so it cannot demonstrate the failure being avoided; it only pins that
      // nothing on the pending path moves focus off the button.
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).not.toBeDisabled()
      expect(button).not.toHaveAttribute('disabled')
      expect(button).toHaveFocus()
    })

    it('announces that a restart is under way', async () => {
      const user = userEvent.setup()
      renderFallback()

      await user.click(restartButton())

      await waitFor(() => {
        expect(statusRegion()).toHaveTextContent('Restarting Erfana…')
      })
    })

    it('ignores a second activation while a restart is pending', async () => {
      const user = userEvent.setup()
      const bridge = installBridge()
      renderFallback()

      await user.click(restartButton())
      await user.click(restartButton())

      await waitFor(() => {
        expect(bridge.relaunchApp).toHaveBeenCalledTimes(1)
      })
    })

    it('offers manual-quit guidance and re-enables the button after 3 s', async () => {
      const user = setupFakeTimers()
      try {
        // Relaunch that never settles: the app should have quit by now, so a
        // still-live window means the relaunch did not take.
        installBridge({ relaunchApp: vi.fn().mockReturnValue(new Promise(() => {})) })
        renderFallback()

        await user.click(restartButton())
        await act(async () => {
          await Promise.resolve()
        })
        expect(restartButton()).toHaveAttribute('aria-disabled', 'true')

        await act(async () => {
          vi.advanceTimersByTime(RESTART_STALLED_MS)
        })

        expect(statusRegion()).toHaveTextContent(
          "Restart didn't start – quit and reopen Erfana manually."
        )
        expect(restartButton()).toHaveAttribute('aria-disabled', 'false')
      } finally {
        vi.useRealTimers()
      }
    })

    it('re-enables and announces failure when relaunchApp rejects', async () => {
      const user = userEvent.setup()
      installBridge({ relaunchApp: vi.fn().mockRejectedValue(new Error('relaunch refused')) })
      renderFallback()

      await user.click(restartButton())

      await waitFor(() => {
        expect(statusRegion()).toHaveTextContent(
          'Restart failed – quit and reopen Erfana manually.'
        )
      })
      expect(restartButton()).toHaveAttribute('aria-disabled', 'false')
    })

    it('does not fire the 3 s guidance after unmount', async () => {
      const user = setupFakeTimers()
      try {
        installBridge({ relaunchApp: vi.fn().mockReturnValue(new Promise(() => {})) })
        const { unmount } = renderFallback()

        await user.click(restartButton())
        await act(async () => {
          await Promise.resolve()
        })

        unmount()

        // A surviving timer would call setState on an unmounted component.
        expect(() => vi.advanceTimersByTime(RESTART_STALLED_MS * 2)).not.toThrow()
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('Open logs folder', () => {
    it('calls the bridge and announces success', async () => {
      const user = userEvent.setup()
      const bridge = installBridge()
      renderFallback()

      await user.click(screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_LOGS))

      expect(bridge.openLogsFolder).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(statusRegion()).toHaveTextContent('Opened the logs folder.')
      })
    })

    it('announces failure when the bridge reports one', async () => {
      const user = userEvent.setup()
      installBridge({ openLogsFolder: vi.fn().mockResolvedValue('ENOENT') })
      renderFallback()

      await user.click(screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_LOGS))

      await waitFor(() => {
        expect(statusRegion()).toHaveTextContent('Could not open the logs folder.')
      })
    })

    it('announces failure when the bridge rejects', async () => {
      const user = userEvent.setup()
      installBridge({ openLogsFolder: vi.fn().mockRejectedValue(new Error('no handler')) })
      renderFallback()

      await user.click(screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_LOGS))

      await waitFor(() => {
        expect(statusRegion()).toHaveTextContent('Could not open the logs folder.')
      })
    })
  })

  describe('capability gating', () => {
    it('hides only the affected action when the bridge is partial', () => {
      ;(window as unknown as { api: unknown }).api = {
        system: {},
        file: { closeProject: vi.fn() },
        logging: { openLogsFolder: vi.fn() },
        clipboard: { writeText: vi.fn() }
      }

      renderFallback()

      expect(screen.queryByTestId(TEST_IDS.ROOT_ERROR_BTN_RESTART)).not.toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_COPY)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.ROOT_ERROR_BTN_LOGS)).toBeInTheDocument()
    })

    it('renders no dead buttons and at least one operable instruction with no bridge', () => {
      delete (window as unknown as { api?: unknown }).api

      renderFallback()

      expect(screen.queryByTestId(TEST_IDS.ROOT_ERROR_BTN_RESTART)).not.toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.ROOT_ERROR_BTN_COPY)).not.toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.ROOT_ERROR_BTN_LOGS)).not.toBeInTheDocument()

      expect(
        screen.getByText(/quit Erfana and open it again\. Log files are in:/)
      ).toBeInTheDocument()
      // Platform-neutral prose, not a `~/…` path: degraded mode cannot read the
      // platform, and `~/` is wrong on Windows.
      expect(screen.getByText('.erfana/logs in your home folder')).toBeInTheDocument()
    })

    it('still offers the details disclosure in degraded mode', async () => {
      delete (window as unknown as { api?: unknown }).api
      const user = userEvent.setup()

      renderFallback()
      await user.click(screen.getByTestId(TEST_IDS.ROOT_ERROR_DETAILS_TOGGLE))

      expect(screen.getByRole('region', { name: 'Error details' })).toHaveTextContent('RangeError')
    })
  })

  describe('empty details', () => {
    it('renders without a stack or component stack', () => {
      const details = makeDetails({
        stack: '',
        displayStack: '',
        componentStack: '',
        timestamp: ''
      })

      expect(() => renderFallback(details)).not.toThrow()
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })
})
