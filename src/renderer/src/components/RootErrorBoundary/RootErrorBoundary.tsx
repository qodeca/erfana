// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Boundary of last resort for the renderer.
 *
 * Wraps only the `<App/>` branch in `main.tsx` (the overlay branch is
 * deliberately unwrapped — it has no recovery UI to show). Without it, a throw
 * anywhere under `<App/>` makes React 18 unmount the whole root and the window
 * goes black — the reported symptom of issue #60.
 *
 * TWO CLASSES, ON PURPOSE. React never routes an error thrown by a boundary's
 * own fallback back into that boundary, so the fallback-throw guard cannot live
 * in `RootErrorBoundary`. {@link FallbackGuard} is a distinct boundary class
 * (colocated here, never merged) whose own fallback is dependency-free static
 * JSX: no stylesheet, no `TEST_IDS`, no `window.api`, no detail extraction.
 * On catch it also appends an inline-styled sibling to `document.body` — a
 * SIBLING, never a write into `#root`, which would fight React's commit-phase
 * ownership of that subtree and be wiped (or throw `NotFoundError`).
 *
 * ONE ANNOUNCEMENT CHANNEL. Both of those land in the same tick, so only ONE of
 * them may speak: {@link GuardNotice} (the React fallback) is the single
 * `role="alert"` on this path, and it mounts empty and fills itself so the
 * region is registered before its content changes. A second alert would race
 * the first and the user would hear an interleaved or truncated instruction.
 * The body sibling therefore carries no role AND is not focused while that
 * alert is in the document — it is silent visual insurance, nothing more.
 * Focusing it as well would be the same double announcement by another route
 * (the alert reads the copy, the focus move reads the same copy again). It DOES
 * take focus when no guard alert reached the document at all, which is the case
 * where it is the only thing on screen and silence would strand the user.
 *
 * LOGGING IS LEVEL-INDEPENDENT. In production an error caught by
 * `componentDidCatch` does NOT reach `window.onerror`, so this `logger.fatal`
 * is the only record of the crash. `fatal` is the highest severity in
 * `LOG_LEVEL_PRIORITY`, so `shouldLog('fatal', …)` is true at every configured
 * level — there is no "off" level to suppress it.
 *
 * @see docs/design/design-issue-60.md §2.3, §5
 * @module components/RootErrorBoundary/RootErrorBoundary
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '../../utils/logger'
import { RootErrorFallback } from './RootErrorFallback'
import {
  APP_VERSION,
  buildErrorDetails,
  buildLogContext,
  emptyErrorDetails,
  toError,
  type ErrorDetails
} from './errorDetails'

/** Log message for a crash the root boundary caught. Greppable in log files. */
export const ROOT_CRASH_LOG_MESSAGE = '[RootErrorBoundary] renderer crash'

/** Log message for the (much worse) case of the fallback itself throwing. */
export const FALLBACK_GUARD_LOG_MESSAGE = '[RootErrorBoundary] fallback render failed'

/** Copy for the guard's dependency-free fallback and the emergency DOM sibling. */
const GUARD_HEADING = 'Erfana stopped unexpectedly.'
const GUARD_INSTRUCTION =
  'The recovery screen could not be drawn. Quit Erfana and open it again. Files you saved are not affected.'

/** Marks the emergency sibling so a repeat catch does not stack copies of it. */
const EMERGENCY_NODE_ATTRIBUTE = 'data-erfana-emergency'

/**
 * Marks {@link GuardNotice}'s alert region.
 *
 * Read by {@link appendEmergencyNotice} to decide whether anything else on this
 * path is already going to speak. A marker attribute rather than a bare
 * `[role="alert"]` query (the document may hold unrelated alerts) and rather
 * than a mounted-flag (the question is what is IN THE DOCUMENT, which is what
 * the screen reader sees). React commits DOM mutations before it runs
 * `componentDidCatch`, so the node is already queryable by then.
 */
const GUARD_ALERT_ATTRIBUTE = 'data-erfana-guard-alert'

/**
 * Inline style for the emergency sibling.
 *
 * A `style` ATTRIBUTE, never a class: the guard path must not depend on any
 * stylesheet having loaded, and `RootErrorBoundary.css`'s allowlist forbids a
 * rule for it anyway. Colours are literals for the same reason (they match
 * `--color-brand-black` / `--color-gray-300`).
 */
const EMERGENCY_NODE_STYLE = [
  'position:fixed',
  'inset:0',
  'z-index:2147483647',
  'display:flex',
  'flex-direction:column',
  'gap:12px',
  'justify-content:center',
  'padding:24px',
  'background:#161312',
  'color:#cccccc',
  'font:14px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
].join(';')

/**
 * Append a static, inline-styled notice directly to `document.body`.
 *
 * Reached only from the guard path, i.e. after the React fallback has already
 * failed. Every step is guarded: this function must never throw, because there
 * is nothing left to catch it.
 *
 * ONE ANNOUNCEMENT PER PATH. This notice carries NO `role="alert"`, and when
 * the guard's React alert did reach the document it is not focused either: two
 * live regions inserted in the same tick make the screen reader interleave both
 * strings or drop one, and focusing a container that repeats the alert's copy
 * is the same duplicate by another route. In that case the notice is silent
 * visual insurance — it only has to be VISIBLE if React's paint is broken.
 *
 * When no guard alert is in the document the notice is the only thing left, so
 * it takes focus: moving focus to a container announces its text once, in
 * order, and parks the user on it.
 */
function appendEmergencyNotice(): void {
  try {
    const body = typeof document === 'undefined' ? null : document.body
    if (body === null) return
    if (body.querySelector(`[${EMERGENCY_NODE_ATTRIBUTE}]`) !== null) return

    const notice = document.createElement('div')
    notice.setAttribute(EMERGENCY_NODE_ATTRIBUTE, 'true')
    notice.setAttribute('tabindex', '-1')
    notice.setAttribute('style', EMERGENCY_NODE_STYLE)
    notice.textContent = `${GUARD_HEADING} ${GUARD_INSTRUCTION}`
    body.appendChild(notice)

    const guardAlert = document.querySelector(`[role="alert"][${GUARD_ALERT_ATTRIBUTE}]`)
    if (guardAlert === null) notice.focus()
  } catch {
    /* last resort — swallowing is the whole point */
  }
}

/** State for {@link GuardNotice}. */
interface GuardNoticeState {
  /** Whether the static copy has been written into the mounted alert region */
  filled: boolean
}

/**
 * The guard's alert region: mounts EMPTY, then writes its own copy.
 *
 * A live region that is inserted with its text already in it is one event —
 * and an assistive technology that was mid-announcement when the app came down
 * can drop it. A region that is already registered when its CONTENT changes is
 * the reliable shape, so the copy lands on the next commit instead. One extra
 * render, no dependencies: static strings, no stylesheet, no bridge, nothing
 * that can throw on the one path where nothing is left to catch it.
 */
class GuardNotice extends Component<Record<string, never>, GuardNoticeState> {
  constructor(props: Record<string, never>) {
    super(props)
    this.state = { filled: false }
  }

  componentDidMount(): void {
    this.setState({ filled: true })
  }

  render(): ReactNode {
    return (
      <div
        role="alert"
        // Spread from the constant, not spelled out: the emergency sibling
        // queries for this attribute to decide whether to stay silent, and a
        // typo here would quietly restore the double announcement.
        {...{ [GUARD_ALERT_ATTRIBUTE]: 'true' }}
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          justifyContent: 'center',
          padding: 24,
          background: '#161312',
          color: '#cccccc',
          font: '14px/1.6 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
        }}
      >
        {this.state.filled && (
          <>
            <strong>{GUARD_HEADING}</strong>
            <span>{GUARD_INSTRUCTION}</span>
          </>
        )}
      </div>
    )
  }
}

/** Props for {@link FallbackGuard}. */
interface FallbackGuardProps {
  /** The crash fallback whose own render failure must be contained */
  children: ReactNode
}

/** State for {@link FallbackGuard}. */
interface FallbackGuardState {
  /** Whether the wrapped fallback threw */
  hasError: boolean
}

/**
 * Minimal boundary that contains a throw from the crash fallback itself.
 *
 * Deliberately separate from {@link RootErrorBoundary}: React cannot route a
 * fallback's error back into the boundary that rendered it, so merging the two
 * would leave the fallback unprotected (design §9, condition 4).
 */
export class FallbackGuard extends Component<FallbackGuardProps, FallbackGuardState> {
  constructor(props: FallbackGuardProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): FallbackGuardState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    // Best effort. No detail extraction, no bridge access — the fewer moving
    // parts on this path, the better.
    try {
      logger.fatal(FALLBACK_GUARD_LOG_MESSAGE, error instanceof Error ? error : undefined, {
        componentStack: errorInfo?.componentStack ?? '',
        appVersion: APP_VERSION
      })
    } catch {
      /* the log is best effort; never let it escape */
    }

    appendEmergencyNotice()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Dependency-free static JSX: no CSS import, no TEST_IDS, no window.api.
      return <GuardNotice />
    }

    return this.props.children
  }
}

/** Props for {@link RootErrorBoundary}. */
interface RootErrorBoundaryProps {
  /** The application subtree to protect */
  children: ReactNode
}

/** State for {@link RootErrorBoundary}. */
interface RootErrorBoundaryState {
  /** Whether a descendant threw during render or a lifecycle method */
  hasError: boolean
  /** Extracted crash details; `null` only while healthy */
  details: ErrorDetails | null
}

/**
 * Extract crash details without ever throwing.
 *
 * `buildErrorDetails` is defensive by contract, but this runs inside
 * `getDerivedStateFromError` — a render-phase static where a throw would escape
 * past the boundary and blank the window, which is precisely the failure this
 * class exists to prevent.
 *
 * @param error - The thrown value
 * @param componentStack - Component stack, when one is available yet
 * @returns Populated details, or a minimal placeholder
 */
function safeBuildDetails(error: unknown, componentStack: string | null): ErrorDetails {
  try {
    return buildErrorDetails(error, componentStack, APP_VERSION)
  } catch {
    return emptyErrorDetails(APP_VERSION)
  }
}

/**
 * Root-level error boundary with a full-window recovery screen.
 *
 * @example
 * ```tsx
 * <React.StrictMode>
 *   <RootErrorBoundary>
 *     <App />
 *   </RootErrorBoundary>
 * </React.StrictMode>
 * ```
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  constructor(props: RootErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, details: null }
  }

  /**
   * Runs in the render phase, BEFORE `componentDidCatch`, so the details built
   * here are what the first fallback render sees. The component stack is not
   * available yet; `componentDidCatch` fills it in on the next commit.
   */
  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return { hasError: true, details: safeBuildDetails(error, null) }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    // The component stack is the ONLY thing this callback knows that the
    // render-phase extraction did not, so it is the only thing merged in.
    // Rebuilding the whole details object here would re-read the thrown value's
    // (possibly hostile) getters a second time and re-stamp `timestamp`, moving
    // the capture time the fallback has already rendered — and the report the
    // user may be copying — a few milliseconds into the future.
    const componentStack = errorInfo?.componentStack ?? ''
    // Unwrapped, unlike the logging call below: the updater is a spread of the
    // details object THIS class built (no foreign getters are read), so the only
    // remaining throw route is React's own scheduler — which a `catch` here
    // could not repair, only hide from the log line that follows.
    this.setState((prev) => ({
      details: prev.details === null ? null : { ...prev.details, componentStack }
    }))

    try {
      const details = this.state.details ?? emptyErrorDetails(APP_VERSION)
      logger.fatal(
        ROOT_CRASH_LOG_MESSAGE,
        toError(error),
        buildLogContext({ ...details, componentStack })
      )
    } catch {
      /* a logger failure must not take the fallback down with it */
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <FallbackGuard>
          <RootErrorFallback details={this.state.details ?? emptyErrorDetails(APP_VERSION)} />
        </FallbackGuard>
      )
    }

    return this.props.children
  }
}
