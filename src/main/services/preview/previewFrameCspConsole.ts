// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Blocked hosts inside frames reach the permission band (issue #124, WI-14;
 * design part 2 §2.8, spike S9).
 *
 * Frames get no preload – `nodeIntegrationInSubFrames` stays false – so a
 * frame's CSP refusal never reaches the preload's `securitypolicyviolation`
 * report. Chromium does print it as a `console-message` credited to the real
 * subframe (S9), and this module turns that line back into the report the
 * preload would have sent, `{ blockedURI, effectiveDirective }`. The page
 * scope's CSP-violation bridge then applies the same dedupe, caps and budgets
 * as for the page itself, and the band row appears as it does for the page.
 *
 * The text is page-influenced, so it is handled as data and bounded before any
 * matching:
 *
 *  - only `error` lines, only from a frame that is not the main frame and whose
 *    parent walk reaches this view's main frame within `MAX_FRAME_DEPTH + 1`
 *    steps. A frame's own `console.log` is credited to the MAIN frame (S9), so
 *    a look-alike line the page prints lands on the ignored path; the page's
 *    own refusals come from the preload, never twice;
 *  - `Framing '…'` lines are ignored, before the cap: a refused frame is a
 *    failure-badge entry (the failed-load writer), never a band row whose
 *    Allow could not work (RX2-7);
 *  - an arrival cap of `FRAME_CONSOLE_MAX_PER_SECOND` lines per view, before
 *    the text is cut or matched; the rest are dropped and counted, and the
 *    count is logged at most once per window (RX2);
 *  - the text is cut to `FRAME_CSP_CONSOLE_MAX_CHARS` and matched by anchored
 *    patterns with no nested quantifiers. An unknown format is ignored: no row.
 *
 * The patterns are pinned by lines captured from Electron 39.8.10 (spike S17,
 * for WI-14; S9 and S10 before it). A later Chromium that rewords them turns
 * frame hosts into no row at all, which the WI-24 e2e catches on an upgrade.
 */
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import { frameDepth, type PreviewFrameLike } from './previewFrameGuard'

/** The report the page's preload would have sent for the same refusal. */
export interface PreviewFrameCspViolation {
  readonly blockedURI: string
  readonly effectiveDirective: string
}

/** The slice of Electron 39's `console-message` details this module reads. */
export interface PreviewFrameConsoleDetails {
  readonly level?: unknown
  readonly message?: unknown
  readonly frame?: PreviewFrameLike | null
}

/** What the console bridge needs from its view. */
export interface PreviewFrameCspConsoleDeps {
  readonly panelId: string
  /** The view's main frame now; its object changes when a page commits. */
  readonly mainFrame: () => PreviewFrameLike | null | undefined
  /** Into the page on screen's CSP-violation bridge, looked up per write. */
  readonly report: (violation: PreviewFrameCspViolation) => void
  /** Clock for the arrival cap. */
  readonly now?: () => number
}

/** One view's frame console bridge. */
export interface PreviewFrameCspConsole {
  /** One `console-message` of the view. */
  handle(details: PreviewFrameConsoleDetails): void
  /** Stop; any drops not yet logged are logged. */
  dispose(): void
}

/** How a refused frame reads; such a line is never a band row. */
const FRAMING_PREFIX = 'Framing '
const ARRIVAL_WINDOW_MS = 1_000

/** The quoted URL, bounded like the bridge's payload (2048). */
const QUOTED_URL = "'([^']{1,2048})'"
/** The refused directive's name, the first word after the opening quote. */
const DIRECTIVE_TAIL = 'violates the following Content Security Policy directive: "([a-z-]{1,64})[ "]'

/**
 * Captured Electron 39 formats, then the older wording the design names:
 *
 *  - `Loading the <kind> '<url>' violates …` – script, stylesheet, image, font;
 *  - `Loading media from  '<url>' violates …` – audio and video, with the two
 *    spaces Chromium prints;
 *  - `Connecting to '<url>' violates …` – fetch and XMLHttpRequest (the
 *    directive-less `Fetch API cannot load …` line that follows is ignored);
 *  - `Refused to load the <kind> '<url>' because it violates …` – older.
 */
const CONSOLE_PATTERNS: readonly RegExp[] = [
  new RegExp(`^Loading the [a-z]{1,32} ${QUOTED_URL} ${DIRECTIVE_TAIL}`),
  new RegExp(`^Loading media from {1,2}${QUOTED_URL} ${DIRECTIVE_TAIL}`),
  new RegExp(`^Connecting to ${QUOTED_URL} ${DIRECTIVE_TAIL}`),
  new RegExp(`^Refused to load the [a-z]{1,32} ${QUOTED_URL} because it ${DIRECTIVE_TAIL}`)
]

/**
 * Cut one subframe console line and match it.
 *
 * @returns the refusal it reports, or `null` for anything that is not a CSP
 *   refusal of a load – a framing line and an unknown format included.
 */
export function parseFrameCspConsoleMessage(message: string): PreviewFrameCspViolation | null {
  const text =
    message.length > PREVIEW_LIMITS.FRAME_CSP_CONSOLE_MAX_CHARS
      ? message.slice(0, PREVIEW_LIMITS.FRAME_CSP_CONSOLE_MAX_CHARS)
      : message
  if (text.startsWith(FRAMING_PREFIX)) {
    return null
  }
  for (const pattern of CONSOLE_PATTERNS) {
    const match = pattern.exec(text)
    if (match !== null) {
      return { blockedURI: match[1], effectiveDirective: match[2] }
    }
  }
  return null
}

/** Build one view's frame console bridge. */
export function createPreviewFrameCspConsole(
  deps: PreviewFrameCspConsoleDeps
): PreviewFrameCspConsole {
  const now = deps.now ?? Date.now
  // The panel id is the page's readable path: log lines carry its digest.
  const loggedPanelId = stablePathDigest(deps.panelId)
  let windowStartedAt = now()
  let admitted = 0
  let dropped = 0
  let readFailureLogged = false
  let disposed = false

  const logDropped = (): void => {
    if (dropped > 0) {
      logger.info('Preview frame console lines past the per-second cap were dropped', {
        panelId: loggedPanelId,
        count: dropped,
        cap: PREVIEW_LIMITS.FRAME_CONSOLE_MAX_PER_SECOND
      })
      dropped = 0
    }
  }

  /** The arrival cap: a fixed one-second window per view. */
  const admit = (): boolean => {
    const timestamp = now()
    if (timestamp - windowStartedAt >= ARRIVAL_WINDOW_MS) {
      logDropped()
      windowStartedAt = timestamp
      admitted = 0
    }
    if (admitted >= PREVIEW_LIMITS.FRAME_CONSOLE_MAX_PER_SECOND) {
      dropped += 1
      return false
    }
    admitted += 1
    return true
  }

  const handleFrameLine = (frame: PreviewFrameLike, message: string): void => {
    const main = deps.mainFrame()
    // The page's own lines – and every line a frame prints itself (S9) – are
    // the main frame's; the preload already reports the page's refusals.
    if (!main || frame.frameTreeNodeId === main.frameTreeNodeId) {
      return
    }
    if (!admit()) {
      return
    }
    // This view's frames only, and no deeper than the walk goes.
    if (frameDepth(frame, main.frameTreeNodeId) === null) {
      return
    }
    const violation = parseFrameCspConsoleMessage(message)
    if (violation !== null) {
      deps.report(violation)
    }
  }

  return {
    handle(details) {
      const { frame, message } = details
      if (disposed || details.level !== 'error' || typeof message !== 'string' || !frame) {
        return
      }
      if (message.startsWith(FRAMING_PREFIX)) {
        return
      }
      try {
        handleFrameLine(frame, message)
      } catch (error) {
        // A frame torn down while it is read throws. The line is dropped, never
        // guessed at; logged once per view, as a flood would repeat it. By name
        // only: the message is not ours to vet, and may quote the frame's URL.
        if (!readFailureLogged) {
          readFailureLogged = true
          logger.warn('Preview frame console line could not be read; dropped', {
            panelId: loggedPanelId,
            error: error instanceof Error ? error.name : typeof error
          })
        }
      }
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      logDropped()
    }
  }
}
