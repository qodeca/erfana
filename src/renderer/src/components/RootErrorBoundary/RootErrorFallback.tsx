// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Full-window recovery screen shown when `RootErrorBoundary` catches a throw.
 *
 * Plain language first: the headline never carries the raw error. `error.message`
 * is untrusted text and appears as TEXT ONLY, inside the collapsed details
 * disclosure — never as HTML, never in the heading.
 *
 * RESTART SAFETY INVARIANT. Relaunching after a crash is only safe because
 * Erfana does NOT auto-restore the last project on start-up — see the
 * "Load last project on mount - DISABLED" effect in
 * `src/renderer/src/hooks/useProjectManagement.ts:75`. Were that ever re-enabled,
 * restarting after a crash *caused by* a project would reopen that project and
 * crash again, in a loop. Rather than depend on the coupling, Restart calls
 * `window.api.file.closeProject()` best-effort (clearing `lastProjectPath`) before
 * `relaunchApp()`. That call is BOUNDED, not merely wrapped: after a crash the
 * main process may never answer, and a rejection, a hang, and a success all have
 * to end at the relaunch — so it races a
 * {@link CLOSE_PROJECT_TIMEOUT_MS} timer and the relaunch runs unconditionally.
 * Both halves are load bearing: if you re-enable auto-restore, this component is
 * the second line of defence, not the first.
 *
 * Accessibility contract (design §2.3):
 * - The container is the single announcement: `role="alertdialog"`,
 *   `aria-modal`, a real accessible name via `aria-labelledby`, and focus on
 *   mount. Focus deliberately lands on the CONTAINER, not on Restart — a
 *   buffered Enter keystroke must not relaunch the app the instant the fallback
 *   appears.
 * - One `role="status"` region carries every transient message (copy result,
 *   restart pending, the 3 s manual-quit guidance). It exists from the first
 *   render so the live region is registered before anything is written to it,
 *   and it is written clear-then-set so a repeated message re-announces.
 * - Restart pending uses `aria-disabled` + an early-return handler, NEVER the
 *   `disabled` attribute (Chromium blurs a control the moment it is disabled).
 *
 * @see docs/design/design-issue-60.md §2.3, §2.7
 * @module components/RootErrorBoundary/RootErrorFallback
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { LOGS_DIR_RELATIVE } from '../../../../shared/constants'
import { TEST_IDS } from '../../constants/testids'
import { textClipboard } from '../../services/textClipboard'
import { formatErrorReport, type ErrorDetails } from './errorDetails'
import './RootErrorBoundary.css'

/** Copy deck (design §2.3). */
const HEADING = 'Erfana stopped unexpectedly.'

/**
 * Description shown when Restart is available.
 *
 * The second sentence is a PROMISE about a button, so it may only be shown
 * when that button exists — see {@link MESSAGE_MANUAL_QUIT}.
 */
const MESSAGE_RESTARTABLE =
  'Files you saved are not affected. Restarting opens Erfana on the welcome screen.'

/**
 * Description shown when the Restart bridge is missing but others survive.
 *
 * Without this branch the screen would promise a restart while rendering no
 * Restart button, sending the user hunting for a control that is not there.
 */
const MESSAGE_MANUAL_QUIT = 'Files you saved are not affected. Quit Erfana and open it again.'

const DETAILS_SHOW = 'Show error details'
const DETAILS_HIDE = 'Hide error details'
const DETAILS_REGION_LABEL = 'Error details'
const LABEL_RESTART = 'Restart Erfana'
const LABEL_COPY = 'Copy error details'
const LABEL_LOGS = 'Open logs folder'

/**
 * Status-region copy. Persistent until the next action — no timed revert.
 *
 * En dashes, per the project style rule; em dashes are not used in UI copy.
 */
const STATUS_COPIED = 'Error details copied to clipboard.'
const STATUS_COPY_FAILED = 'Could not copy the error details – the clipboard is unavailable.'
const STATUS_RESTARTING = 'Restarting Erfana…'
const STATUS_RESTART_STALLED = "Restart didn't start – quit and reopen Erfana manually."
const STATUS_RESTART_FAILED = 'Restart failed – quit and reopen Erfana manually.'
const STATUS_LOGS_OPENED = 'Opened the logs folder.'
const STATUS_LOGS_FAILED = 'Could not open the logs folder.'

/**
 * Degraded mode: no bridge at all, so instructions replace the dead buttons.
 *
 * Leads with the reassurance rather than restating the heading — this string
 * IS the accessible description in degraded mode, and a screen-reader user has
 * just heard the heading read out.
 */
const DEGRADED_INSTRUCTION =
  "Files you saved are not affected. Erfana's recovery tools are unavailable, so quit Erfana " +
  'and open it again. Log files are in:'

/**
 * Where `LoggingService` writes, spelled as platform-neutral prose.
 *
 * Degraded mode is exactly the case where `window.api.logging.getLogsDir()`
 * cannot be called, so neither the real path nor the platform can be read from
 * the bridge. `~/…` would be wrong on Windows and `process.platform` is
 * `undefined` under the sandbox, so the folder is described instead of spelled
 * as a path. The relative part comes from the SHARED constant
 * `LoggingService.getLogsDir()` also uses (`join(homedir(), LOGS_DIR_RELATIVE)`),
 * so the two can no longer drift apart.
 */
const LOGS_FOLDER_LOCATION = `${LOGS_DIR_RELATIVE} in your home folder`

/** How long Restart waits before telling the user to quit manually. */
const RESTART_STALLED_MS = 3000

/**
 * How long Restart waits for `closeProject` before relaunching anyway.
 *
 * Well inside {@link RESTART_STALLED_MS}, so a hung close still leaves the
 * relaunch time to happen before the screen offers manual-quit guidance.
 */
export const CLOSE_PROJECT_TIMEOUT_MS = 1500

/** Props for {@link RootErrorFallback}. */
export interface RootErrorFallbackProps {
  /** Extracted crash details; the raw message is rendered inside details only */
  details: ErrorDetails
}

/**
 * Is a bridge method callable right now?
 *
 * Per-action rather than one "is the bridge present" flag: a partially exposed
 * `window.api` must disable only the affected action, not the whole screen.
 *
 * @param method - The candidate bridge method, read through optional chaining
 * @returns `true` when it can be invoked
 */
function isCallable(method: unknown): boolean {
  return typeof method === 'function'
}

/**
 * Clear `lastProjectPath` before a relaunch, without ever blocking it.
 *
 * Three outcomes, one behaviour. A resolution is the happy path; a rejection is
 * ignored (the restart-safety invariant in the module docblock explains why the
 * relaunch is still the right move); and a call that NEVER SETTLES — the
 * realistic case when the main process is the thing that is unwell — is
 * abandoned after {@link CLOSE_PROJECT_TIMEOUT_MS} rather than stranding the
 * user on a screen whose only working control has quietly stopped working.
 *
 * @returns A promise that always resolves, within {@link CLOSE_PROJECT_TIMEOUT_MS}
 */
async function closeProjectBestEffort(): Promise<void> {
  // The invocation itself is inside the async body, so a synchronous throw from
  // a broken bridge is caught here too.
  const closed = (async () => {
    try {
      await window.api?.file?.closeProject?.()
    } catch {
      /* intentionally ignored — see the restart-safety invariant above */
    }
  })()

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      closed,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, CLOSE_PROJECT_TIMEOUT_MS)
      })
    ])
  } finally {
    // Cleared on both branches: a timer left running would outlive the screen.
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

/**
 * The crash recovery screen.
 *
 * @param props - See {@link RootErrorFallbackProps}
 */
export function RootErrorFallback({ details }: RootErrorFallbackProps) {
  const idPrefix = useId()
  const headingId = `root-error-heading-${idPrefix}`
  const messageId = `root-error-message-${idPrefix}`
  const degradedId = `root-error-degraded-${idPrefix}`
  const logPathId = `root-error-log-path-${idPrefix}`
  const detailsId = `root-error-details-${idPrefix}`

  const containerRef = useRef<HTMLDivElement>(null)
  const stalledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [status, setStatus] = useState('')
  const [announcement, setAnnouncement] = useState<{ text: string; seq: number }>({
    text: '',
    seq: 0
  })
  const seqRef = useRef(0)

  // Capability probes. Read per render rather than memoised: the bridge is
  // injected before first paint and never changes, and a stale memo here would
  // be a dead button on the one screen that must not have any.
  const canRestart = isCallable(window.api?.system?.relaunchApp)
  const canCopy = isCallable(window.api?.clipboard?.writeText)
  const canOpenLogs = isCallable(window.api?.logging?.openLogsFolder)
  const isDegraded = !canRestart && !canCopy && !canOpenLogs

  // The description branches on CAPABILITY, never on taste: promising that
  // "restarting opens Erfana on the welcome screen" while rendering no Restart
  // button sends the user looking for a control that is not on screen. Degraded
  // mode drops the message paragraph entirely — its instruction already opens
  // with the same reassurance, and duplicating it would make the accessible
  // description read the sentence twice.
  // Degraded mode names BOTH paragraphs: the instruction ends on "Log files are
  // in:", so a description that stopped there would leave the sentence hanging
  // and the one piece of information the user still needs unspoken.
  const message = canRestart ? MESSAGE_RESTARTABLE : MESSAGE_MANUAL_QUIT
  const describedById = isDegraded ? `${degradedId} ${logPathId}` : messageId

  /**
   * Queue a status message.
   *
   * Clear-then-set across TWO commits: a live region only speaks when its
   * content mutates, so writing the same string twice in one commit would be
   * silent. The first commit empties the region, the effect below fills it.
   */
  const announce = useCallback((text: string) => {
    seqRef.current += 1
    setStatus('')
    setAnnouncement({ text, seq: seqRef.current })
  }, [])

  useEffect(() => {
    if (announcement.seq === 0) return
    setStatus(announcement.text)
  }, [announcement])

  // Focus the labelled container, never the Restart button (design §2.3).
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  const clearStalledTimer = useCallback(() => {
    if (stalledTimerRef.current !== null) {
      clearTimeout(stalledTimerRef.current)
      stalledTimerRef.current = null
    }
  }, [])

  useEffect(() => clearStalledTimer, [clearStalledTimer])

  const handleRestart = useCallback(async () => {
    // Early return instead of the `disabled` attribute — see the module docblock.
    if (isRestarting || !canRestart) return

    setIsRestarting(true)
    announce(STATUS_RESTARTING)

    clearStalledTimer()
    stalledTimerRef.current = setTimeout(() => {
      stalledTimerRef.current = null
      setIsRestarting(false)
      announce(STATUS_RESTART_STALLED)
    }, RESTART_STALLED_MS)

    await closeProjectBestEffort()

    try {
      await window.api.system.relaunchApp()
    } catch {
      clearStalledTimer()
      setIsRestarting(false)
      announce(STATUS_RESTART_FAILED)
    }
  }, [announce, canRestart, clearStalledTimer, isRestarting])

  const handleCopy = useCallback(async () => {
    let copied = false
    try {
      copied = await textClipboard.writeText(formatErrorReport(details))
    } catch {
      copied = false
    }
    announce(copied ? STATUS_COPIED : STATUS_COPY_FAILED)
  }, [announce, details])

  const handleOpenLogs = useCallback(async () => {
    try {
      // Resolves to '' on success, or an error string on failure.
      const failure = await window.api.logging.openLogsFolder()
      announce(failure ? STATUS_LOGS_FAILED : STATUS_LOGS_OPENED)
    } catch {
      announce(STATUS_LOGS_FAILED)
    }
  }, [announce])

  const toggleDetails = useCallback(() => {
    setDetailsOpen((open) => !open)
  }, [])

  return (
    <div
      ref={containerRef}
      className="root-error"
      role="alertdialog"
      // No focus trap, deliberately: `RootErrorBoundary` renders this screen
      // INSTEAD of `<App/>`, so nothing else focusable is left in the document
      // and Tab cannot escape the dialog. If this fallback is ever rendered
      // beside live app content, `aria-modal` stops being honest and a trap
      // becomes mandatory.
      aria-modal="true"
      aria-labelledby={headingId}
      aria-describedby={describedById}
      tabIndex={-1}
      data-testid={TEST_IDS.ROOT_ERROR_BOUNDARY}
    >
      <div className="root-error-panel">
        <h1 className="root-error-heading" id={headingId}>
          {HEADING}
        </h1>
        {!isDegraded && (
          <p className="root-error-message" id={messageId}>
            {message}
          </p>
        )}

        <div
          className="root-error-status"
          role="status"
          aria-live="polite"
          data-testid={TEST_IDS.ROOT_ERROR_STATUS}
        >
          {status}
        </div>

        {isDegraded && (
          <>
            <p className="root-error-message" id={degradedId}>
              {DEGRADED_INSTRUCTION}
            </p>
            <p className="root-error-log-path" id={logPathId}>
              {LOGS_FOLDER_LOCATION}
            </p>
          </>
        )}

        {!isDegraded && (
          <div className="root-error-actions">
            {canRestart && (
              <button
                type="button"
                className="dialog-btn dialog-btn-primary"
                aria-disabled={isRestarting}
                onClick={handleRestart}
                data-testid={TEST_IDS.ROOT_ERROR_BTN_RESTART}
              >
                {LABEL_RESTART}
              </button>
            )}
            {canCopy && (
              <button
                type="button"
                className="dialog-btn dialog-btn-secondary"
                onClick={handleCopy}
                data-testid={TEST_IDS.ROOT_ERROR_BTN_COPY}
              >
                {LABEL_COPY}
              </button>
            )}
            {canOpenLogs && (
              <button
                type="button"
                className="dialog-btn dialog-btn-secondary"
                onClick={handleOpenLogs}
                data-testid={TEST_IDS.ROOT_ERROR_BTN_LOGS}
              >
                {LABEL_LOGS}
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          className="dialog-btn dialog-btn-secondary root-error-details-toggle"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={toggleDetails}
          data-testid={TEST_IDS.ROOT_ERROR_DETAILS_TOGGLE}
        >
          {detailsOpen ? DETAILS_HIDE : DETAILS_SHOW}
        </button>

        {/* Always in the DOM so `aria-controls` always resolves; `hidden` keeps
            it out of the accessibility tree while collapsed. */}
        <div
          id={detailsId}
          className="root-error-details"
          role="region"
          aria-label={DETAILS_REGION_LABEL}
          tabIndex={0}
          hidden={!detailsOpen}
          data-testid={TEST_IDS.ROOT_ERROR_DETAILS}
        >
          <p className="root-error-meta">
            {`Erfana ${details.version}`}
            {details.timestamp ? ` · ${details.timestamp}` : ''}
          </p>
          {/* Untrusted error text, rendered as a text child — never as HTML. */}
          <pre className="root-error-stack">{`${details.name}: ${details.message}`}</pre>
          {details.displayStack.length > 0 && (
            <pre className="root-error-stack">{details.displayStack}</pre>
          )}
          {details.componentStack.length > 0 && (
            <pre className="root-error-stack">{details.componentStack}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
