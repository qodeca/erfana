// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Main's bounds drop log (issue #124, WI-5, P1-AC1; part 1 §1.2).
 *
 * Every place main throws a bounds update away reports it through a rate-capped
 * drop reporter, in the renderer's line shape: the fixed message, the fields as
 * structured context, `source: 'main'`. This module holds the reason ids of
 * every main drop point, the reporter factory that writes to the main logger,
 * and the service's per-panel memory for M4. It owns no scope itself: the
 * setBounds handler builds one reporter per channel registration (M1–M3), the
 * service one per panel (M4), each live view one of its own (M5–M8, M10), and
 * the window-edge resize hold one per held view (M9, `previewResizeHold.ts`).
 *
 * Main-only, because it writes to the main logger; the pure reporter both
 * processes share is `src/shared/dropReporter.ts`.
 */

import { performance } from 'node:perf_hooks'

import { logger } from '../LoggingService'
import {
  createDropReporter,
  type DropLogEntry,
  type DropReporter
} from '../../../shared/dropReporter'
import type { PreviewBounds } from '../../../shared/ipc/preview-types'

/**
 * The setBounds channel's drop points (M-numbers are the design's). Like every
 * reason here: a fixed id, never page-derived, so one search finds them beside
 * the renderer's `PREVIEW_BOUNDS_DROP_REASON` lines.
 */
export const SET_BOUNDS_DROP_REASON = {
  /** M1 – the sender is not Erfana's own window. No URL: drop lines carry fixed fields. */
  untrustedSender: 'untrusted-sender',
  /** M2 – the payload failed its schema. */
  invalidPayload: 'invalid-payload',
  /** M3 – the handler threw; the error rides on the line. */
  handlerThrew: 'handler-threw'
} as const

/**
 * Drop point M4, a push for a panel with no live view. Two ids, because the
 * reporter caps per id and the warn must never wait behind the info.
 */
export const NO_VIEW_DROP_REASON = {
  /** The push raced the panel's open: expected, the view is on its way (info). */
  beforeInstall: 'no-view-before-install',
  /** The panel's view was installed and is gone: the renderer is sizing nothing (warn). */
  afterInstall: 'no-view-after-install'
} as const

/** A live view's drop points (`previewLiveBounds.ts`). */
export const LIVE_BOUNDS_DROP_REASON = {
  /** M5 – the view is torn down, closing, or its page is gone. */
  viewDefunct: 'view-defunct',
  /** M6 – a push no newer than the last one accepted (`seq <= lastSeq`). */
  staleSeq: 'stale-seq',
  /** M7 – the rect clamped to nothing against the window's content area. */
  clampedEmpty: 'clamped-empty',
  /** M8 – a newer push overtook this repaint confirmation; that push owns it. */
  ackSuperseded: 'ack-superseded',
  /**
   * M10 – the zoom the view is sized with is not its host window's (the C3
   * diagnostic). Nothing is dropped: the rect still applies, and the line says
   * it may be the wrong size.
   */
  zoomMismatch: 'zoom-mismatch'
} as const

/** The window-edge resize hold's drop point (`previewResizeHold.ts`, issue #124, WI-10). */
export const RESIZE_HOLD_DROP_REASON = {
  /**
   * M9 – a held view's settled push did not arrive within
   * `RESIZE_HOLD_SETTLE_TIMEOUT_MS`, so the view stays hidden and is asked
   * again. Logged at every such timeout, rate-capped per held view.
   */
  noSettledPush: 'no-settled-push'
} as const

/** Options of {@link createMainDropReporter}. */
export interface MainDropReporterOptions {
  /** Milliseconds; defaults to a monotonic clock. */
  readonly now?: () => number
  /**
   * The error behind an `error` line, if any. The reporter writes inside
   * `report`, synchronously, so this reads the drop being reported (M3).
   */
  readonly errorOf?: () => Error | undefined
}

/**
 * A drop reporter for one main-process scope – the setBounds channel, one
 * panel in the service, one live view – writing to the main logger with
 * `source: 'main'`: the fixed message, the fields as structured context.
 */
export function createMainDropReporter(options: MainDropReporterOptions = {}): DropReporter {
  const { now = () => performance.now(), errorOf } = options
  return createDropReporter({
    source: 'main',
    now,
    emit: (entry) => writeDropLine(entry, errorOf?.())
  })
}

/** Hands one reporter line to the main logger. */
function writeDropLine({ level, message, context }: DropLogEntry, error: Error | undefined): void {
  // Spread: the logger takes a plain record, and the context stays structured.
  const fields = { ...context }
  if (level === 'error') logger.error(message, error, fields)
  else logger[level](message, fields)
}

/** The service's side of M4. */
export interface PreviewNoViewDropLog {
  /** The panel's open installed its view: from now on a push with no view is a warn. */
  installed(panelId: string): void
  /** A push for `panelId` found no live view. */
  report(panelId: string, rect: PreviewBounds, seq: number): void
  /** A new open began, or the panel closed: its next trail starts fresh, at info. */
  forget(panelId: string): void
}

/**
 * Drop point M4 for the service: one scope per panel, and whether that panel's
 * current open has installed its view.
 *
 * A push that races the open is expected – the renderer sizes its placeholder
 * before main has built the view – so it logs at info. A push after the view
 * was installed means the renderer is sizing a view main no longer has
 * (suspended or torn down), so it logs at warn.
 */
export function createNoViewDropLog(now: () => number): PreviewNoViewDropLog {
  const panels = new Map<string, { installed: boolean; drops: DropReporter }>()
  const panel = (panelId: string): { installed: boolean; drops: DropReporter } => {
    let state = panels.get(panelId)
    if (state === undefined) {
      state = { installed: false, drops: createMainDropReporter({ now }) }
      panels.set(panelId, state)
    }
    return state
  }
  return {
    installed: (panelId) => {
      panel(panelId).installed = true
    },
    report: (panelId, rect, seq) => {
      const { installed, drops } = panel(panelId)
      drops.report(
        installed
          ? { reason: NO_VIEW_DROP_REASON.afterInstall, level: 'warn', panelId, seq, rect }
          : { reason: NO_VIEW_DROP_REASON.beforeInstall, level: 'info', panelId, seq, rect }
      )
    },
    forget: (panelId) => {
      panels.delete(panelId)
    }
  }
}
