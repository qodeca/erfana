// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for `RootErrorBoundary` and its colocated `FallbackGuard`.
 *
 * The interesting cases are all failure-of-the-failure-path cases: the logger
 * throwing, the fallback itself throwing, and `document.body.appendChild`
 * throwing. Each one is a route by which a crash-containment layer turns into
 * the crash.
 *
 * `console.error` is suppressed per the `EditorErrorBoundary.test.tsx` pattern —
 * React logs every boundary-caught error, and these tests throw on purpose.
 *
 * @see docs/design/design-issue-60.md §5 (`RootErrorBoundary` row)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { logger } from '../../utils/logger'
import { TEST_IDS } from '../../constants/testids'

vi.mock('../../utils/logger', () => ({
  logger: {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn()
  }
}))

// Hoisted so the RootErrorFallback mock factory can reach it.
const fallbackControl = vi.hoisted(() => ({ shouldThrow: false }))

vi.mock('./RootErrorFallback', async () => {
  const actual = await vi.importActual<typeof import('./RootErrorFallback')>('./RootErrorFallback')
  return {
    RootErrorFallback: (props: { details: import('./errorDetails').ErrorDetails }) => {
      if (fallbackControl.shouldThrow) {
        throw new Error('fallback exploded')
      }
      return actual.RootErrorFallback(props)
    }
  }
})

import { FALLBACK_GUARD_LOG_MESSAGE, RootErrorBoundary, ROOT_CRASH_LOG_MESSAGE } from './RootErrorBoundary'

/** Text rendered by FallbackGuard's dependency-free fallback. */
const GUARD_TEXT = 'The recovery screen could not be drawn.'

/** Selector for the emergency sibling appended straight to `document.body`. */
const EMERGENCY_SELECTOR = '[data-erfana-emergency]'

/** Selector for the guard's React alert region — what gates the sibling's focus. */
const GUARD_ALERT_SELECTOR = '[role="alert"][data-erfana-guard-alert]'

function Boom(): never {
  throw new Error('child exploded')
}

function Healthy(): JSX.Element {
  return <div data-testid="healthy-child">healthy</div>
}

/** Install a minimally complete bridge so the real fallback can render. */
function installBridge(): void {
  ;(window as unknown as { api: unknown }).api = {
    system: { relaunchApp: vi.fn().mockResolvedValue(undefined) },
    file: { closeProject: vi.fn().mockResolvedValue(true) },
    logging: { openLogsFolder: vi.fn().mockResolvedValue('') },
    clipboard: { writeText: vi.fn().mockResolvedValue(true) }
  }
}

describe('RootErrorBoundary', () => {
  const originalConsoleError = console.error

  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: one test installs a THROWING
    // `logger.fatal` implementation, and `mockClear` would leave it in place
    // for every later test in the file.
    vi.resetAllMocks()
    console.error = vi.fn()
    fallbackControl.shouldThrow = false
    installBridge()
  })

  afterEach(() => {
    // Restores `spyOn`-installed doubles (notably the appendChild failure).
    vi.restoreAllMocks()
    console.error = originalConsoleError
    delete (window as unknown as { api?: unknown }).api
    // The emergency notice is appended OUTSIDE the RTL container, so RTL's
    // cleanup does not remove it.
    document.querySelectorAll(EMERGENCY_SELECTOR).forEach((node) => node.remove())
  })

  describe('healthy path', () => {
    it('renders its children', () => {
      render(
        <RootErrorBoundary>
          <Healthy />
        </RootErrorBoundary>
      )

      expect(screen.getByTestId('healthy-child')).toBeInTheDocument()
    })

    it('does not log', () => {
      render(
        <RootErrorBoundary>
          <Healthy />
        </RootErrorBoundary>
      )

      expect(logger.fatal).not.toHaveBeenCalled()
    })
  })

  describe('caught crash', () => {
    it('renders the crash fallback instead of an empty root', () => {
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>
      )

      expect(screen.getByTestId(TEST_IDS.ROOT_ERROR_BOUNDARY)).toBeInTheDocument()
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    it('logs one fatal record carrying the component stack and app version', () => {
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>
      )

      expect(logger.fatal).toHaveBeenCalledTimes(1)
      expect(logger.fatal).toHaveBeenCalledWith(
        ROOT_CRASH_LOG_MESSAGE,
        expect.any(Error),
        expect.objectContaining({
          componentStack: expect.stringContaining('Boom'),
          appVersion: '0.0.0-test',
          errorName: 'Error'
        })
      )
    })

    it('passes the caught error through to the log', () => {
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>
      )

      const [, error] = vi.mocked(logger.fatal).mock.calls[0]
      expect((error as Error).message).toBe('child exploded')
    })

    it('survives a hostile non-Error thrown value', () => {
      /*
       * A hostile value with a THROWING `stack` getter is deliberately NOT the
       * fixture here: React itself reads `stack` while building the component
       * stack, so the getter fires inside `react-dom` and React substitutes its
       * own error before the boundary ever sees the original. That case is
       * covered where it can actually be observed — `errorDetails.test.ts`,
       * against the pure extractor. What this pins is the boundary's own
       * tolerance of a value that is not an `Error` at all.
       */
      function HostileThrow(): never {
        throw { code: 'E_NOT_AN_ERROR', detail: 'thrown object' }
      }

      expect(() =>
        render(
          <RootErrorBoundary>
            <HostileThrow />
          </RootErrorBoundary>
        )
      ).not.toThrow()

      expect(screen.getByTestId(TEST_IDS.ROOT_ERROR_BOUNDARY)).toBeInTheDocument()
      expect(logger.fatal).toHaveBeenCalledWith(
        ROOT_CRASH_LOG_MESSAGE,
        expect.any(Error),
        expect.objectContaining({ errorName: 'Error' })
      )
      // The wrapper carries the coerced value, not `undefined`.
      const [, error] = vi.mocked(logger.fatal).mock.calls[0]
      expect((error as Error).name).toBe('NonError')
    })

    it('survives a thrown string', () => {
      function StringThrow(): never {
        throw 'plain string throw'
      }

      expect(() =>
        render(
          <RootErrorBoundary>
            <StringThrow />
          </RootErrorBoundary>
        )
      ).not.toThrow()

      expect(screen.getByTestId(TEST_IDS.ROOT_ERROR_BOUNDARY)).toBeInTheDocument()
    })

    it('still renders the fallback when logger.fatal itself throws', () => {
      vi.mocked(logger.fatal).mockImplementation(() => {
        throw new Error('logger exploded')
      })

      expect(() =>
        render(
          <RootErrorBoundary>
            <Boom />
          </RootErrorBoundary>
        )
      ).not.toThrow()

      expect(screen.getByTestId(TEST_IDS.ROOT_ERROR_BOUNDARY)).toBeInTheDocument()
      // The guard was NOT reached: the failure was contained inside
      // componentDidCatch, not routed through a second boundary.
      expect(screen.queryByText(GUARD_TEXT, { exact: false })).not.toBeInTheDocument()
    })
  })

  describe('FallbackGuard', () => {
    it('renders dependency-free static text when the fallback itself throws', () => {
      fallbackControl.shouldThrow = true

      let container: HTMLElement | undefined
      expect(() => {
        container = render(
          <RootErrorBoundary>
            <Boom />
          </RootErrorBoundary>
        ).container
      }).not.toThrow()

      // Scoped to the React container: the emergency `document.body` sibling
      // carries the same copy and would otherwise make this ambiguous.
      expect(
        within(container as HTMLElement).getByText(GUARD_TEXT, { exact: false })
      ).toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.ROOT_ERROR_BOUNDARY)).not.toBeInTheDocument()
    })

    it('appends an inline-styled sibling to document.body, never into #root', () => {
      // Seed a #root with a child, mirroring the real DOM: the emergency write
      // must not touch it (React owns that subtree).
      const root = document.createElement('div')
      root.id = 'root'
      root.appendChild(document.createElement('span'))
      document.body.appendChild(root)

      fallbackControl.shouldThrow = true
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>
      )

      const notice = document.body.querySelector(EMERGENCY_SELECTOR)
      expect(notice).not.toBeNull()
      expect(notice?.parentElement).toBe(document.body)
      expect(notice?.getAttribute('style')).toContain('position:fixed')
      expect(notice?.getAttribute('class')).toBeNull()
      expect(notice?.textContent).toContain('Erfana stopped unexpectedly.')
      // #root untouched.
      expect(root.childElementCount).toBe(1)
      expect(root.querySelector(EMERGENCY_SELECTOR)).toBeNull()

      root.remove()
    })

    it('keeps the sibling silent while the guard alert is in the document', () => {
      // Two live regions inserted in the same tick race each other: the reader
      // interleaves them or drops one. The React fallback keeps the alert role,
      // and this node neither gets a role NOR takes focus — focusing it would
      // read the same copy a second time. It stays as visual insurance.
      fallbackControl.shouldThrow = true
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>
      )

      const notice = document.body.querySelector(EMERGENCY_SELECTOR)
      expect(notice?.getAttribute('role')).toBeNull()
      // Still focusABLE: the other path below moves focus here.
      expect(notice?.getAttribute('tabindex')).toBe('-1')
      expect(notice).not.toHaveFocus()
      expect(document.querySelector(GUARD_ALERT_SELECTOR)).not.toBeNull()
    })

    it('focuses the sibling when no guard alert reached the document', () => {
      // The failure below the failure: React's alert never lands in the
      // document, so the sibling is the only thing the user has — and silence
      // would leave a screen-reader user with an unannounced screen. Rendering
      // into a DETACHED container reproduces exactly that condition (RTL uses a
      // supplied container as-is, without appending it to the body).
      const detached = document.createElement('div')

      fallbackControl.shouldThrow = true
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>,
        { container: detached }
      )

      expect(document.querySelector(GUARD_ALERT_SELECTOR)).toBeNull()
      const notice = document.body.querySelector(EMERGENCY_SELECTOR)
      expect(notice).not.toBeNull()
      expect(notice).toHaveFocus()
    })

    it('leaves exactly one alert in the document on the guard path', () => {
      fallbackControl.shouldThrow = true
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>
      )

      // Both the React fallback and the body sibling are on screen; only one of
      // them may speak.
      expect(document.body.querySelector(EMERGENCY_SELECTOR)).not.toBeNull()
      expect(screen.getAllByRole('alert')).toHaveLength(1)
    })

    it('mounts the alert region empty and fills it on the next commit', () => {
      // An alert inserted with its text already in place is a single event, and
      // a reader that was mid-announcement when the app came down can miss it.
      // Registering the region first and CHANGING its content is the reliable
      // shape — which is only observable as two separate mutations.
      const container = document.createElement('div')
      document.body.appendChild(container)

      const observer = new MutationObserver(() => {})
      observer.observe(container, { childList: true, characterData: true, subtree: true })

      fallbackControl.shouldThrow = true
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>,
        { container }
      )

      // Synchronous drain: both commits have already happened, and the records
      // are queued in order regardless of when the callback would have run.
      const records = observer.takeRecords()
      observer.disconnect()

      const isAlert = (node: Node): boolean =>
        node instanceof HTMLElement && node.getAttribute('role') === 'alert'
      const inserted = records.findIndex((record) => [...record.addedNodes].some(isAlert))
      const filled = records.findIndex(
        (record) => isAlert(record.target) && record.addedNodes.length > 0
      )

      expect(inserted, 'the guard never inserted a role="alert" region').toBeGreaterThanOrEqual(0)
      expect(
        filled,
        'the alert region arrived with its text already in it — it must mount ' +
          'empty and be filled by a later commit'
      ).toBeGreaterThan(inserted)
      expect(within(container).getByText(GUARD_TEXT, { exact: false })).toBeInTheDocument()

      container.remove()
    })

    it('logs the guard path at fatal level', () => {
      fallbackControl.shouldThrow = true
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>
      )

      expect(logger.fatal).toHaveBeenCalledWith(
        FALLBACK_GUARD_LOG_MESSAGE,
        expect.any(Error),
        expect.objectContaining({ appVersion: '0.0.0-test' })
      )
    })

    it('does not throw when document.body.appendChild fails', () => {
      // Render into a pre-created container so RTL never calls the spied
      // appendChild itself.
      const container = document.createElement('div')
      document.body.appendChild(container)

      const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => {
        throw new Error('appendChild exploded')
      })

      fallbackControl.shouldThrow = true
      expect(() =>
        render(
          <RootErrorBoundary>
            <Boom />
          </RootErrorBoundary>,
          { container }
        )
      ).not.toThrow()

      expect(appendSpy).toHaveBeenCalled()
      // The React-level guard fallback still rendered.
      expect(within(container).getByText(GUARD_TEXT, { exact: false })).toBeInTheDocument()

      appendSpy.mockRestore()
      container.remove()
    })

    it('does not stack duplicate emergency notices', () => {
      fallbackControl.shouldThrow = true
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>
      )
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>
      )

      expect(document.body.querySelectorAll(EMERGENCY_SELECTOR)).toHaveLength(1)
    })
  })
})

describe('logger.fatal is level-independent', () => {
  /*
   * The boundary's fatal line is the ONLY record of a production crash
   * (`componentDidCatch` errors never reach `window.onerror` in a production
   * build), so it must survive whatever level the user configured. The suite
   * above mocks the logger, which cannot prove that; this one drives the REAL
   * `RendererLogger` at the least verbose level there is and asserts the entry
   * still reaches the IPC bridge.
   */
  it('sends a fatal entry with the strictest level configured', async () => {
    const actual =
      await vi.importActual<typeof import('../../utils/logger')>('../../utils/logger')
    const realLogger = new actual.RendererLogger()
    realLogger.setLevel('fatal')

    const log = vi.fn()
    ;(window as unknown as { api: unknown }).api = { logging: { log } }

    realLogger.fatal(ROOT_CRASH_LOG_MESSAGE, new Error('boom'), { appVersion: '0.0.0-test' })

    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'fatal',
        message: ROOT_CRASH_LOG_MESSAGE,
        source: 'renderer',
        context: expect.objectContaining({ appVersion: '0.0.0-test' })
      })
    )

    delete (window as unknown as { api?: unknown }).api
  })
})
