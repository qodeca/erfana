// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Overlay occluder store (Issue #74, work item 61).
 *
 * Tracks how many overlays of each {@link OccluderKind} are currently on screen
 * and exposes a single boolean — {@link OverlayOccluderState.isOccluded} — that
 * the preview `OverlayGuardService` (item 69) consumes to decide whether the
 * live `WebContentsView` must hide behind a still frame (design §1.8, §5(d)).
 *
 * Two views of the same counts exist on purpose:
 *
 * 1. **Live counts** — a module-private object mutated *synchronously* by
 *    {@link OverlayOccluderState.register}/{@link OverlayOccluderState.unregister}.
 *    `isOccluded()` reads these, so a caller that just registered sees the truth
 *    immediately (needed by the dev assertion).
 * 2. **Published snapshot** — the `counts`/`version` fields on the store, written
 *    only inside a `queueMicrotask` flush. Subscribers are notified from here.
 *
 * The split is what delivers the **microtask coalescing** the design requires
 * (§1.8 NEW-10): `BaseDialog.registerOpenDialog` calls `unregisterOpenDialog`
 * first as a dedupe, and a `zIndex`-change effect runs cleanup (unregister → 0)
 * then body (register → 1) inside one React commit. Publishing on every
 * synchronous mutation would emit a spurious `0` between the two — a hide/show
 * flap, a wasted `capturePage` and a visible flash. By deferring the publish to
 * a single microtask that reads the *final* live counts, a synchronous
 * unregister→register pair collapses to exactly one notification carrying the
 * settled value, and the intermediate `0` is never observed.
 */

import { create } from 'zustand'

/**
 * The closed set of overlay classes that can occlude the preview view.
 *
 * `reason` on `preview:setVisibility` is a bounded free string, NOT this enum,
 * on purpose (design §3.1 X14): a closed enum on the IPC boundary fails *open* —
 * adding a kind while forgetting the enum would drop the visibility message and
 * silently leave the preview painted over a new overlay. This union is the
 * renderer-internal producer key only.
 *
 * - `dialog`   — any `BaseDialog` (item 63)
 * - `settings` — the settings overlay
 * - `toast`    — an actionable toast (item 64)
 * - `menu`     — the shared context menu (item 66)
 * - `overlay`  — the image-viewer full-screen overlay (item 67)
 * - `drag`     — an in-flight drag-and-drop overlay
 */
export type OccluderKind = 'dialog' | 'settings' | 'toast' | 'menu' | 'overlay' | 'drag'

/**
 * Z-index at or above which an element is assumed to occlude the preview.
 *
 * Mirrors `--z-modal` (1000) from `styles/design-tokens.css`; kept as a numeric
 * literal because design tokens are CSS custom properties not readable from TS.
 * Used only by the dev-mode assertion below — never for styling — so a small
 * drift from the token is a diagnostics-only concern, not a visual one.
 */
export const OVERLAY_BASE_ZINDEX = 1000

/**
 * Live per-kind counts, mutated synchronously by register/unregister.
 *
 * Module-private (not stored on the zustand state) precisely so that mutating
 * it does NOT notify subscribers — notification is deferred to the microtask
 * flush that reads this object's settled value.
 */
const liveCounts: Partial<Record<OccluderKind, number>> = {}

/** Guards against scheduling more than one microtask flush per tick. */
let flushScheduled = false

/**
 * Reactive slice + imperative API of the occluder store.
 *
 * `counts`/`version` are the *published* snapshot; treat them as read-only and
 * prefer the {@link OverlayOccluderState.isOccluded} getter over inspecting
 * `counts` directly.
 */
export interface OverlayOccluderState {
  /** Published copy of the live counts, replaced on each microtask flush. */
  counts: Readonly<Partial<Record<OccluderKind, number>>>
  /** Bumped on every flush so store-level subscribers fire exactly once per tick. */
  version: number
  /**
   * Increments the live count for `kind` and schedules a coalesced publish.
   * @param kind - The overlay class being shown.
   */
  register: (kind: OccluderKind) => void
  /**
   * Decrements the live count for `kind` (clamped at 0) and schedules a
   * coalesced publish. Safe to call when the count is already 0.
   * @param kind - The overlay class being hidden.
   */
  unregister: (kind: OccluderKind) => void
  /**
   * @returns `true` while any kind has a live count greater than 0.
   * Reads the *live* counts, so it reflects synchronous register/unregister
   * calls made in the same tick before the microtask flush.
   */
  isOccluded: () => boolean
  /**
   * Resets live and published counts to empty. Intended for tests and hard
   * teardown; production code manages counts via register/unregister only.
   */
  reset: () => void
}

/**
 * Recomputes whether any live count is positive.
 * @returns `true` if at least one kind is currently registered.
 */
function computeOccluded(): boolean {
  for (const kind in liveCounts) {
    if ((liveCounts[kind as OccluderKind] ?? 0) > 0) return true
  }
  return false
}

export const useOverlayOccluderStore = create<OverlayOccluderState>((set) => {
  /**
   * Publishes the settled live counts to subscribers, at most once per tick.
   * Reads `liveCounts` at flush time, so any number of synchronous mutations in
   * the same tick collapse to a single notification with the final value.
   */
  const scheduleFlush = (): void => {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(() => {
      flushScheduled = false
      set((state) => ({ counts: { ...liveCounts }, version: state.version + 1 }))
    })
  }

  return {
    counts: {},
    version: 0,

    register: (kind) => {
      liveCounts[kind] = (liveCounts[kind] ?? 0) + 1
      scheduleFlush()
    },

    unregister: (kind) => {
      const next = (liveCounts[kind] ?? 0) - 1
      if (next <= 0) {
        delete liveCounts[kind]
      } else {
        liveCounts[kind] = next
      }
      scheduleFlush()
    },

    isOccluded: () => computeOccluded(),

    reset: () => {
      for (const kind in liveCounts) {
        delete liveCounts[kind as OccluderKind]
      }
      flushScheduled = false
      set({ counts: {}, version: 0 })
    }
  }
})

/**
 * Dev-mode hook point for the design's high-z-index assertion (§1.8).
 *
 * An element painted at or above {@link OVERLAY_BASE_ZINDEX} that does NOT
 * register an occluder would sit over the preview view invisibly to the guard —
 * the preview would keep repainting behind it. Call this when such an element
 * mounts to surface the wiring gap during development.
 *
 * In production this is a no-op (tree-shaken by the `import.meta.env.DEV`
 * guard), so it is safe to leave in hot paths. It reads the *live* occluder
 * state so a same-tick `register` counts.
 *
 * @param zIndex - The mounting element's effective z-index.
 * @param label - Optional element description used in the warning message.
 *
 * @example
 * ```ts
 * useEffect(() => {
 *   devAssertOccluderForZIndex(10000, 'MyCustomOverlay')
 * }, [])
 * ```
 */
export function devAssertOccluderForZIndex(zIndex: number, label = 'element'): void {
  if (!import.meta.env.DEV) return
  if (zIndex >= OVERLAY_BASE_ZINDEX && !computeOccluded()) {
    console.warn(
      `[overlay-occluder] ${label} mounted at z-index ${zIndex} (>= ${OVERLAY_BASE_ZINDEX}) ` +
        'while no occluder is registered. The preview view will not hide behind it. ' +
        'Wire a useOccluder(kind, active) for this overlay.'
    )
  }
}
