// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview main→renderer emitter bundle (Issue #74, work item 43; design §1.6, §4.3).
 *
 * The SINGLE main→renderer send chokepoint for the preview feature. Every push
 * is:
 *   - re-validated against its zod payload schema (the service composes the
 *     payload, but a malformed snapshot must never reach the renderer), and
 *   - guarded against a destroyed target (`isDestroyed()`), mirroring
 *     `claude-status-handlers.ts#emitToWebContents`.
 *
 * `failuresChanged` is additionally COALESCED (design §0: "every renderer-bound
 * emission on a page-drivable path is coalesced"). Rapid calls for a panel
 * collapse to a single trailing send carrying the latest snapshot, so a page
 * running a reload/failure loop cannot drive one IPC send per iteration.
 *
 * Trust model: payloads originate main-side from the sealed view's collaborators
 * and are never reflected back to the page; the schemas are the tripwire against
 * a wiring regression, not against the untrusted page (which has no path here).
 *
 * @see docs/designs/sd-074-html-preview.md §1.6, §4.3
 * @see src/main/ipc/claude-status-handlers.ts (the mirrored emit pattern)
 */
import {
  PreviewFailureListPayloadSchema,
  PreviewHostBlockedPayloadSchema,
  PreviewFindResultSchema,
  PreviewStillFrameSchema,
  PreviewBackdropPayloadSchema,
  PreviewBoundsAppliedPayloadSchema,
  PreviewLoadStatePayloadSchema,
  PreviewForwardedShortcutSchema,
  PreviewOpenFileRequestedSchema,
  type PreviewFailure
} from '../../../shared/ipc/preview-schema'
import { PreviewEvents } from '../../../shared/ipc/preview-channels'
import { PREVIEW_FORWARDED_SHORTCUTS } from '../../services/preview/previewInputForward'
import type {
  PreviewEmitters,
  PreviewFailureInput,
  PreviewFindResult,
  PreviewStillFrame
} from '../../../shared/ipc/preview-types'
import { logger } from '../../services/LoggingService'

/**
 * The slice of an Electron `WebContents` the emitter needs. Structural so tests
 * inject a fake without a real renderer.
 */
export interface PreviewEmitTarget {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
  /**
   * `BrowserWindow.id` of the window this target belongs to, when known.
   *
   * Most preview events carry a `panelId` and are harmless to broadcast, but
   * `openFileRequested` ACTS: broadcasting it would make every window open a
   * tab for one window's link click (sd-074b §4.9). Targets without an id are
   * always included, so test fakes and any future non-window target keep
   * receiving.
   */
  readonly windowId?: number
}

/** Injectable dependencies (all but `resolveTargets` defaulted). */
export interface PreviewEmittersDeps {
  /** The live renderer targets to send to (typically the app's main window). */
  readonly resolveTargets: () => readonly PreviewEmitTarget[]
  /** Clock for synthesised failure timestamps; defaults to `Date.now`. */
  readonly now?: () => number
  /**
   * Schedules the coalesced `failuresChanged` flush; defaults to
   * `queueMicrotask`. Injected so tests can flush deterministically.
   */
  readonly scheduleFlush?: (flush: () => void) => void
}

/**
 * The emitter bundle: the shared {@link PreviewEmitters} surface plus
 * `forwardedShortcut` (declared on its own event, not on `PreviewEmitters`) and
 * a `dispose` that cancels any pending coalesced flush.
 */
export interface PreviewEmitterBundle extends PreviewEmitters {
  /** Forward one of the four enumerated accelerators (§1.9) to the renderer. */
  forwardedShortcut(panelId: string, key: string): void
  /** Cancel a pending coalesced flush; drop buffered snapshots without sending. */
  dispose(): void
}

/** Accelerator lookup for the forwarded-shortcut payload (§1.9). */
const SHORTCUT_ACCEL = new Map<string, boolean>(
  PREVIEW_FORWARDED_SHORTCUTS.map((s) => [s.key, s.accel])
)

/**
 * Build the preview main→renderer emitter bundle.
 */
export function createPreviewEmitters(deps: PreviewEmittersDeps): PreviewEmitterBundle {
  const now = deps.now ?? Date.now
  const scheduleFlush = deps.scheduleFlush ?? queueMicrotask

  /** Latest coalesced failure snapshot per panel, drained on flush. */
  const pendingFailures = new Map<string, { failures: PreviewFailure[]; truncated: boolean }>()
  let flushScheduled = false
  let disposed = false

  /** Monotonic id source for synthesised failure entries (schema requires `id`). */
  let failureSeq = 0

  const send = (channel: string, payload: unknown, windowId?: number): void => {
    for (const target of deps.resolveTargets()) {
      if (target.isDestroyed()) continue
      // Scoped send: skip windows other than the requested one. A target that
      // reports no id is never skipped.
      if (windowId !== undefined && target.windowId !== undefined && target.windowId !== windowId) {
        continue
      }
      target.send(channel, payload)
    }
  }

  /** Validate then send a single payload; a validation failure drops it loudly. */
  const validateAndSend = (
    channel: string,
    schema: { safeParse: (v: unknown) => { success: boolean; error?: { message: string } } },
    payload: unknown,
    windowId?: number
  ): void => {
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      logger.warn(`Dropped preview emission on ${channel} with invalid payload`, {
        error: parsed.error?.message
      })
      return
    }
    send(channel, payload, windowId)
  }

  const toFailure = (input: PreviewFailureInput): PreviewFailure => ({
    id: `${++failureSeq}`,
    type: input.type,
    resourceUrlOrHost: input.resourceUrlOrHost,
    reasonCode: input.reasonCode,
    // The failure log hands entries that already carry a timestamp; the emit
    // type erases it, so read it defensively and fall back to the clock.
    timestamp: (input as { timestamp?: number }).timestamp ?? now()
  })

  const flushFailures = (): void => {
    flushScheduled = false
    if (disposed) {
      pendingFailures.clear()
      return
    }
    const snapshots = [...pendingFailures.entries()]
    pendingFailures.clear()
    for (const [panelId, snapshot] of snapshots) {
      validateAndSend(PreviewEvents.FAILURES_CHANGED, PreviewFailureListPayloadSchema, {
        panelId,
        failures: snapshot.failures,
        truncated: snapshot.truncated
      })
    }
  }

  return {
    failuresChanged(
      panelId: string,
      failures: readonly PreviewFailureInput[],
      truncated: boolean
    ): void {
      if (disposed) {
        return
      }
      // Coalesce: keep only the latest snapshot per panel; one trailing flush.
      pendingFailures.set(panelId, { failures: failures.map(toFailure), truncated })
      if (!flushScheduled) {
        flushScheduled = true
        scheduleFlush(flushFailures)
      }
    },

    hostBlocked(panelId: string, host: string, approvable: boolean): void {
      validateAndSend(PreviewEvents.HOST_BLOCKED, PreviewHostBlockedPayloadSchema, {
        panelId,
        host,
        approvable
      })
    },

    findResult(r: PreviewFindResult): void {
      validateAndSend(PreviewEvents.FIND_RESULT, PreviewFindResultSchema, {
        panelId: r.panelId,
        requestId: r.requestId,
        matches: r.matches,
        activeMatchOrdinal: r.activeMatchOrdinal
      })
    },

    stillFrameChanged(panelId: string, frame: PreviewStillFrame): void {
      validateAndSend(PreviewEvents.STILL_FRAME_CHANGED, PreviewStillFrameSchema, {
        panelId,
        dataUrl: frame.dataUrl,
        width: frame.width,
        height: frame.height,
        capturedAt: frame.capturedAt
      })
    },

    loadStateChanged(
      panelId: string,
      state: 'idle' | 'loading' | 'ready' | 'failed' | 'suspended',
      dropped: number
    ): void {
      validateAndSend(PreviewEvents.LOAD_STATE_CHANGED, PreviewLoadStatePayloadSchema, {
        panelId,
        state,
        dropped
      })
    },

    backdropChanged(panelId: string, color: string): void {
      validateAndSend(PreviewEvents.BACKDROP_CHANGED, PreviewBackdropPayloadSchema, {
        panelId,
        color
      })
    },

    boundsApplied(panelId: string, seq: number): void {
      // Deliberately NOT coalesced. It is sent only for a push that asked for
      // it, which is a user-initiated transition, not the per-frame pump; and a
      // renderer waiting on a specific `seq` must not have it collapsed away.
      validateAndSend(PreviewEvents.BOUNDS_APPLIED, PreviewBoundsAppliedPayloadSchema, {
        panelId,
        seq
      })
    },

    openFileRequested(
      sourcePanelId: string,
      filePath: string,
      anchor: string | null,
      windowId?: number
    ): void {
      validateAndSend(
        PreviewEvents.OPEN_FILE_REQUESTED,
        PreviewOpenFileRequestedSchema,
        { sourcePanelId, filePath, anchor },
        windowId
      )
    },

    forwardedShortcut(panelId: string, key: string): void {
      validateAndSend(PreviewEvents.FORWARDED_SHORTCUT, PreviewForwardedShortcutSchema, {
        panelId,
        key,
        accel: SHORTCUT_ACCEL.get(key) ?? false
      })
    },

    dispose(): void {
      disposed = true
      pendingFailures.clear()
    }
  }
}
