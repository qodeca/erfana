// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Rate-capped reporter for dropped preview bounds updates (issue #124, P1-AC1).
 *
 * Every place that can throw a bounds update away – the renderer's bounds hook,
 * main's `setBounds` handler, the service and the live view – reports through
 * one of these, so a page that ends up over Erfana's own chrome leaves a trail
 * naming the step that dropped the update. Pure: the clock and the sink are
 * injected and nothing here imports a logger, so the same module runs in both
 * processes.
 *
 * - The first drop of each reason is always emitted.
 * - Later drops of that reason are emitted at most once per window, and the
 *   line carries `suppressed`: how many were swallowed since the previous one.
 * - At most `PREVIEW_LIMITS.BOUNDS_DROP_MAX_REASONS` reasons get a slot of
 *   their own. Reasons are code constants, so the cap only matters for a caller
 *   bug; every further reason shares one overflow slot under the same rule, so
 *   neither the map nor the log can grow without bound.
 *
 * One reporter is one scope: a bounds-hook mount, a live view, or a channel.
 * Fields travel as structured context and are never put into the message.
 * There is no path field – a line carries the panel id's digest (never the id,
 * which spells the file path; QG-7 S3), sequence numbers and a rect rounded to
 * whole pixels.
 *
 * @see docs/design/design-issue-124-part1.md §1.2
 */
import { PREVIEW_LIMITS } from './preview-limits'
import { stablePathDigest } from './stablePathDigest'

/** Which process wrote the line. */
export type DropSource = 'renderer' | 'main'

/** The level a drop point logs at (part 1 §1.2). */
export type DropLevel = 'info' | 'warn' | 'error'

/** A rectangle as the drop point saw it. Rounded before it is logged. */
export interface DropRect {
  x: number
  y: number
  width: number
  height: number
}

/** One dropped bounds update, as a drop point reports it. */
export interface BoundsDrop {
  /** Fixed id of the drop point, for example `'stale-seq'`. Never page-derived. */
  reason: string
  level: DropLevel
  panelId?: string
  /** The sequence number of the dropped push. */
  seq?: number
  /** The last sequence number that was applied. */
  lastSeq?: number
  rect?: DropRect
}

/** The structured context of one emitted line. */
export interface DropLogContext {
  source: DropSource
  reason: string
  /** `stablePathDigest` of the drop's panel id, never the id itself. */
  panelId?: string
  seq?: number
  lastSeq?: number
  /** Whole pixels. */
  rect?: { x: number; y: number; w: number; h: number }
  /** Drops of this reason swallowed since its previous line; absent when none. */
  suppressed?: number
}

/** What the reporter hands its sink; the caller maps it onto its own logger. */
export interface DropLogEntry {
  level: DropLevel
  message: string
  context: DropLogContext
}

/** Injected collaborators of {@link createDropReporter}. */
export interface DropReporterDeps {
  /** Written into every line. */
  source: DropSource
  /** Milliseconds; a monotonic clock is best. */
  now: () => number
  /** Defaults to `PREVIEW_LIMITS.BOUNDS_DROP_LOG_WINDOW_MS`. */
  windowMs?: number
  emit: (entry: DropLogEntry) => void
}

/** A rate-capped drop reporter for one scope. */
export interface DropReporter {
  report(drop: BoundsDrop): void
}

/** The message of every line. The reason travels in the context. */
export const BOUNDS_DROP_MESSAGE = 'Preview bounds update dropped'

/** When a slot last emitted, and how many drops it swallowed since. */
interface ReasonSlot {
  lastEmitAt: number
  suppressed: number
}

/**
 * Creates a drop reporter for one scope.
 *
 * @example
 * ```ts
 * const drops = createDropReporter({
 *   source: 'renderer',
 *   now: () => performance.now(),
 *   emit: ({ level, message, context }) => writeLog(level, message, context)
 * })
 * drops.report({ reason: 'no-placeholder', level: 'info', panelId })
 * ```
 */
export function createDropReporter(deps: DropReporterDeps): DropReporter {
  const windowMs = deps.windowMs ?? PREVIEW_LIMITS.BOUNDS_DROP_LOG_WINDOW_MS
  const slots = new Map<string, ReasonSlot>()
  let overflow: ReasonSlot | undefined

  return {
    report(drop: BoundsDrop): void {
      const at = deps.now()
      const own = slots.get(drop.reason)
      const shared = own === undefined && slots.size >= PREVIEW_LIMITS.BOUNDS_DROP_MAX_REASONS
      const slot = shared ? overflow : own

      if (slot !== undefined && at - slot.lastEmitAt < windowMs) {
        slot.suppressed += 1
        return
      }

      const suppressed = slot?.suppressed ?? 0
      const fresh: ReasonSlot = { lastEmitAt: at, suppressed: 0 }
      if (shared) {
        overflow = fresh
      } else {
        slots.set(drop.reason, fresh)
      }

      deps.emit({
        level: drop.level,
        message: BOUNDS_DROP_MESSAGE,
        context: buildContext(deps.source, drop, suppressed)
      })
    }
  }
}

/** Copies only the fields the drop point gave, with the rect rounded. */
function buildContext(source: DropSource, drop: BoundsDrop, suppressed: number): DropLogContext {
  const context: DropLogContext = { source, reason: drop.reason }
  if (drop.panelId !== undefined) context.panelId = stablePathDigest(drop.panelId)
  if (drop.seq !== undefined) context.seq = drop.seq
  if (drop.lastSeq !== undefined) context.lastSeq = drop.lastSeq
  if (drop.rect !== undefined) {
    context.rect = {
      x: Math.round(drop.rect.x),
      y: Math.round(drop.rect.y),
      w: Math.round(drop.rect.width),
      h: Math.round(drop.rect.height)
    }
  }
  if (suppressed > 0) context.suppressed = suppressed
  return context
}
