// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview IPC channel names (Issue #74, work item 40; design §4.1).
 *
 * Type-safe channel name constants for the `WebContentsView`-backed HTML
 * preview. Using constants eliminates typos and enables refactoring across the
 * main/preload/renderer boundary.
 *
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 * @see docs/designs/sd-074-html-preview.md §4.1 - Channels
 */

/**
 * Preview control channels (renderer → main).
 *
 * `setBounds` and `setVisibility` use send/on (not invoke) — they are
 * high-frequency, fire-and-forget updates. The rest use invoke/handle.
 */
export const PreviewChannels = {
  /** Check whether a path is eligible to open as a running preview */
  CHECK_ELIGIBILITY: 'preview:checkEligibility',
  /** Open a preview for a panel (mints the view; may refuse if one is live) */
  OPEN: 'preview:open',
  /** Close and destroy the preview for a panel (bounded destroy) */
  CLOSE: 'preview:close',
  /** Update the native view bounds (send/on; stale seqs dropped) */
  SET_BOUNDS: 'preview:setBounds',
  /** Update view visibility with a diagnostic reason (send/on) */
  SET_VISIBILITY: 'preview:setVisibility',
  /** Reload the previewed page */
  RELOAD: 'preview:reload',
  /** Approve a remote host, writing back to the project allowlist */
  APPROVE_HOST: 'preview:approveHost',
  /** Start / advance an in-page find */
  FIND: 'preview:find',
  /** Stop the active in-page find */
  STOP_FIND: 'preview:stopFind',
  /** Export the live previewed page to PDF */
  EXPORT_PDF: 'preview:exportPdf'
} as const

/**
 * Preview event channels (main → renderer push, send/on pattern).
 */
export const PreviewEvents = {
  /** The failure log for a panel changed (coalesced) */
  FAILURES_CHANGED: 'preview:failuresChanged',
  /** A remote host was blocked; drives the approve toast (budgeted) */
  HOST_BLOCKED: 'preview:hostBlocked',
  /** An in-page find produced a final result */
  FIND_RESULT: 'preview:findResult',
  /** The still-frame captured on hide changed */
  STILL_FRAME_CHANGED: 'preview:stillFrameChanged',
  /** The load state for a panel changed */
  LOAD_STATE_CHANGED: 'preview:loadStateChanged',
  /** The colour painted behind the page changed (chrome vs the page's own paper) */
  BACKDROP_CHANGED: 'preview:backdropChanged',
  /** An enumerated keyboard accelerator was forwarded from the sealed page */
  FORWARDED_SHORTCUT: 'preview:forwardedShortcut',
  /** A link in the page resolved to a project file the renderer should open */
  OPEN_FILE_REQUESTED: 'preview:openFileRequested'
} as const

/**
 * Union types for channel-name validation.
 */
export type PreviewChannel = (typeof PreviewChannels)[keyof typeof PreviewChannels]
export type PreviewEvent = (typeof PreviewEvents)[keyof typeof PreviewEvents]
