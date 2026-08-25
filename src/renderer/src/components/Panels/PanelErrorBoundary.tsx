// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Panel-scoped error boundary.
 *
 * The upper tier of the two-tier containment set added by issue #60. A
 * root-only boundary turns a project-tree defect into "workspace gone",
 * discarding unsaved Monaco buffers and a live terminal; this boundary keeps
 * the blast radius inside one sidebar panel and offers a Reload that clears the
 * error state without remounting the app.
 *
 * Logs at `error`, NOT `fatal`: the window is still usable, so this is not the
 * crash-of-last-resort that `RootErrorBoundary` records. Shape follows
 * `EditorErrorBoundary` (children / fallback / componentName / TEST_ID), plus
 * the Reload action.
 *
 * MOUNT-SITE CONTRACT. The error state survives every re-render and is cleared
 * only by Reload or by a remount, so a caller whose content is scoped to
 * something the user can switch must KEY the boundary by it — see
 * `<PanelErrorBoundary key={projectPath ?? 'none'} …>` in `ProjectPanel.tsx`.
 * Without that key a tree that crashed on project A still reads "unavailable"
 * after the user opens project B, and only Reload would clear it.
 *
 * FOCUS CONTRACT. Swapping the subtree drops focus to `<body>`, so the boundary
 * moves it deliberately — but only when the user was standing in this panel:
 * to the Reload button when the panel dies with focus inside it (a failed
 * retry, or an async re-throw after a reload succeeded), and to the recovered
 * content wrapper when a Reload works. A panel that throws on its own while
 * the user is in the editor never steals focus.
 *
 * ONE ANNOUNCEMENT CHANNEL, and it is that focus move. The fallback container
 * carries NO `role="alert"`: the alert and the focus land in the same tick, and
 * both say the same sentence — the alert reads the container text while the
 * focused Reload button reads its name plus the `aria-describedby` message, so
 * a live region here buys a duplicate (or an interleaved, truncated) reading of
 * the copy the button already carries. Same reasoning as the root guard notice
 * (`RootErrorBoundary.tsx`, ONE ANNOUNCEMENT CHANNEL). The trade-off is
 * deliberate: when the panel dies while the user is elsewhere, nothing is
 * announced — which is the correct outcome for a failure in a surface the user
 * is not looking at, and the copy is waiting when they navigate to it.
 *
 * @see docs/design/design-issue-60.md §2.3 (two-tier contract)
 * @module components/Panels/PanelErrorBoundary
 */

import { Component, createRef, type ErrorInfo, type ReactNode } from 'react'
import { TEST_IDS } from '../../constants/testids'
import { logger } from '../../utils/logger'
import './PanelErrorBoundary.css'

/** Props for {@link PanelErrorBoundary}. */
interface PanelErrorBoundaryProps {
  /** Panel content to protect */
  children: ReactNode
  /** Optional replacement for the default fallback */
  fallback?: ReactNode
  /** Human-readable panel name, used in the fallback copy and the log line */
  componentName?: string
}

/** State for {@link PanelErrorBoundary}. */
interface PanelErrorBoundaryState {
  /** Whether the wrapped panel threw */
  hasError: boolean
  /** The caught error, if any */
  error: Error | null
  /** How many times the user has pressed Reload on this mount */
  reloadAttempts: number
}

/** What the commit phase knew about focus before the DOM was mutated. */
interface PanelFocusSnapshot {
  /** Whether focus was inside this boundary's content when the update committed */
  focusWasInside: boolean
}

/** Fallback copy when no `componentName` is supplied. */
const DEFAULT_COMPONENT_NAME = 'Panel'

/**
 * Makes each boundary's `aria-describedby` target unique.
 *
 * A class component has no `useId`, and two panels can be mounted at once, so
 * a fixed id would make both Reload buttons point at the first message.
 */
let boundaryInstanceCount = 0

/**
 * Error boundary for a single sidebar / dock panel.
 *
 * @example
 * ```tsx
 * <PanelErrorBoundary componentName="Project tree">
 *   <ProjectTree {...props} />
 * </PanelErrorBoundary>
 * ```
 */
export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  /** The Reload button, so focus can be put back after a failed retry. */
  private readonly reloadButtonRef = createRef<HTMLButtonElement>()

  /** The healthy-content wrapper: focus target after a successful Reload. */
  private readonly contentRef = createRef<HTMLDivElement>()

  /** Id of the fallback message, referenced by the Reload button. */
  private readonly messageId: string

  constructor(props: PanelErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, reloadAttempts: 0 }
    boundaryInstanceCount += 1
    this.messageId = `panel-error-message-${boundaryInstanceCount}`
  }

  static getDerivedStateFromError(error: Error): Pick<
    PanelErrorBoundaryState,
    'hasError' | 'error'
  > {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { componentName = DEFAULT_COMPONENT_NAME } = this.props
    logger.error(`[PanelErrorBoundary] ${componentName} error`, error, {
      componentStack: errorInfo?.componentStack ?? ''
    })
  }

  /**
   * Read where focus was while the old DOM is still standing.
   *
   * The only place this is knowable: `componentDidCatch` and
   * `componentDidUpdate` both run after the mutation phase, by which point the
   * browser has already reset `document.activeElement` to `<body>`.
   *
   * @returns Whether focus was inside this boundary's content
   */
  getSnapshotBeforeUpdate(): PanelFocusSnapshot {
    const content = this.contentRef.current
    return {
      focusWasInside: content !== null && content.contains(document.activeElement)
    }
  }

  componentDidUpdate(
    _prevProps: PanelErrorBoundaryProps,
    prevState: PanelErrorBoundaryState,
    // Optional, matching React's own typing: a missing snapshot must degrade to
    // "focus was elsewhere", never throw out of a boundary's own lifecycle.
    snapshot?: PanelFocusSnapshot
  ): void {
    const { hasError, reloadAttempts } = this.state

    // Reload worked. The fallback the user was standing on is gone, so park
    // focus on the recovered content instead of dropping it to <body>.
    if (prevState.hasError && !hasError && reloadAttempts > 0) {
      this.contentRef.current?.focus()
      return
    }

    if (!hasError) return

    // Two ways focus can end up on <body> with the fallback on screen:
    // a failed retry (the fallback subtree is torn down and rebuilt), and a
    // panel that dies while the user is working inside it — including an async
    // re-throw after a reload succeeded, where no attempt counter changes.
    // Focus is NOT taken when it was somewhere else entirely: a tree that
    // throws on its own must not yank the user out of the editor.
    const failedRetry = reloadAttempts > prevState.reloadAttempts
    if (failedRetry || snapshot?.focusWasInside === true) {
      this.reloadButtonRef.current?.focus()
    }
  }

  /** Clear the error so the panel gets one more chance to render. */
  private handleReload = (): void => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      reloadAttempts: prev.reloadAttempts + 1
    }))
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      // Wrapped, not bare: the wrapper is where focus goes after a successful
      // Reload, and where `getSnapshotBeforeUpdate` asks whether focus was
      // inside the panel when it died. `.panel-error-content` is a flex
      // passthrough, so the panel below it lays out exactly as before.
      return (
        <div ref={this.contentRef} className="panel-error-content" tabIndex={-1}>
          {this.props.children}
        </div>
      )
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback
    }

    const { componentName = DEFAULT_COMPONENT_NAME } = this.props
    // First failure explains the blast radius ("the rest still works"); a
    // failed retry must not repeat that reassurance as if nothing was tried.
    const message =
      this.state.reloadAttempts > 0
        ? `${componentName} is still unavailable.`
        : `${componentName} unavailable. The rest of Erfana still works.`

    // No `role="alert"` on the container — see ONE ANNOUNCEMENT CHANNEL in the
    // module docblock: the focused Reload button already carries this copy.
    return (
      <div className="panel-error" data-testid={TEST_IDS.PANEL_ERROR_BOUNDARY}>
        <span className="panel-error-message" id={this.messageId}>
          {message}
        </span>
        {/* Visible label stays "Reload"; the accessible name names the target,
            so a screen-reader user landing on it out of context knows what
            reloads. Prefix matches the visible text (WCAG 2.5.3).
            `aria-describedby` is the announcement: it rides the focus move, so
            after a failed retry the user hears "Reload project tree" AND the
            outcome, instead of an unchanged button label. */}
        <button
          ref={this.reloadButtonRef}
          type="button"
          className="dialog-btn dialog-btn-secondary"
          aria-label={`Reload ${componentName.toLowerCase()}`}
          aria-describedby={this.messageId}
          onClick={this.handleReload}
        >
          Reload
        </button>
      </div>
    )
  }
}
