// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The set of live preview views, and the race guards over it (sd-074b §4.2).
 *
 * Extracted from `PreviewViewService` so the service stays an orchestrator: the
 * map, the two-part staleness guard and the least-recently-active ordering all
 * live here, and `PreviewLiveView.ts` (already at the file-size cap) grows
 * nothing.
 *
 * WHAT THIS REPLACES: a single `live: PreviewLiveView | null` field plus one
 * monotonic `openEpoch`. That epoch was global, so two legitimate concurrent
 * opens for different panels cancelled each other — the second bumped the
 * counter and the first aborted. The guard is therefore split in two:
 *
 *  - **`generation`** — bumped by whole-service events (project change,
 *    global off-switch, dispose). Every in-flight open aborts.
 *  - **`openSeq`, per panel** — bumped by that panel's own `open` and `close`.
 *    Only that panel's in-flight open aborts.
 *
 * An open captures both and re-checks after EVERY await.
 *
 * KEYING. Entries are keyed by `panelId`, with the owning window's id stored
 * alongside. Panel ids are derived from the file path, so two windows previewing
 * the same file mint the SAME id — keying on the id alone would let window B's
 * open take the replace branch and destroy window A's running view. Erfana ships
 * one window today, so this is latent, but the entry carries `windowId` and the
 * service refuses a cross-window collision rather than silently replacing.
 *
 * @see specs/designs/sd-074b-preview-navigation-and-multiview.md §4.2, §4.3
 */
import type { PreviewLiveView } from './PreviewLiveView'

/** One live view plus the bookkeeping the registry needs about it. */
export interface PreviewViewEntry {
  readonly view: PreviewLiveView
  /** `BrowserWindow.id` of the window whose content view hosts this preview. */
  readonly windowId: number
  /** Monotonic activation stamp; the lowest value is the eviction candidate. */
  lastActiveAt: number
}

/** The staleness token an in-flight `open` carries across its awaits. */
export interface PreviewOpenClaim {
  readonly panelId: string
  readonly generation: number
  readonly seq: number
}

export class PreviewViewRegistry {
  private readonly views = new Map<string, PreviewViewEntry>()
  private readonly openSeq = new Map<string, number>()
  private generation = 0
  /** Source of `lastActiveAt` stamps; monotonic, never wall-clock. */
  private activationCounter = 0

  /** Number of live views. */
  get size(): number {
    return this.views.size
  }

  /**
   * Invalidate every in-flight open. Called by project switch, the global
   * off-switch and dispose — all of which mean "nothing that was being built
   * for the old state may be installed".
   */
  bumpGeneration(): void {
    this.generation += 1
  }

  /** Claim an open for `panelId`, invalidating any earlier in-flight open of it. */
  claimOpen(panelId: string): PreviewOpenClaim {
    const seq = (this.openSeq.get(panelId) ?? 0) + 1
    this.openSeq.set(panelId, seq)
    return { panelId, generation: this.generation, seq }
  }

  /**
   * Invalidate an in-flight open for one panel without touching other panels.
   *
   * `close` MUST call this unconditionally — including when no view is
   * installed. A close arriving while the session is still building finds
   * nothing in the map, and if it returned early there the open would go on to
   * install a view for a panel whose renderer had already unmounted.
   */
  invalidateOpen(panelId: string): void {
    this.openSeq.set(panelId, (this.openSeq.get(panelId) ?? 0) + 1)
  }

  /** `true` when the claim has been superseded and its open must abandon. */
  isStale(claim: PreviewOpenClaim): boolean {
    return (
      claim.generation !== this.generation ||
      (this.openSeq.get(claim.panelId) ?? 0) !== claim.seq
    )
  }

  /** Install a freshly opened view as the most recently active one. */
  install(panelId: string, view: PreviewLiveView, windowId: number): void {
    this.activationCounter += 1
    this.views.set(panelId, { view, windowId, lastActiveAt: this.activationCounter })
  }

  /** The live view for `panelId`, or `null` when it is closed or suspended. */
  get(panelId: string): PreviewLiveView | null {
    return this.views.get(panelId)?.view ?? null
  }

  /** The full entry, for callers that need the owning window. */
  entry(panelId: string): PreviewViewEntry | null {
    return this.views.get(panelId) ?? null
  }

  /** Mark a view as most recently active, so it is last in line for eviction. */
  touch(panelId: string): void {
    const entry = this.views.get(panelId)
    if (entry !== undefined) {
      this.activationCounter += 1
      entry.lastActiveAt = this.activationCounter
    }
  }

  /**
   * Drop the entry and return the view it held.
   *
   * Callers remove BEFORE awaiting the teardown: a teardown that rejects must
   * never leave a half-destroyed view in the map, or that panel id is occupied
   * for the life of the process.
   */
  remove(panelId: string): PreviewLiveView | null {
    const entry = this.views.get(panelId)
    if (entry === undefined) {
      return null
    }
    this.views.delete(panelId)
    return entry.view
  }

  /** Every live view, in no particular order. */
  all(): readonly PreviewViewEntry[] {
    return [...this.views.values()]
  }

  /** Every live view of one project, for allowlist fan-out. */
  ofProject(projectPath: string): readonly PreviewViewEntry[] {
    return [...this.views.values()].filter((entry) => entry.view.projectPath === projectPath)
  }

  /** How many live views belong to `projectPath` (drives the notifier refcount). */
  countForProject(projectPath: string): number {
    return this.ofProject(projectPath).length
  }

  /** Remove and return every entry, leaving the registry empty. */
  drain(): readonly PreviewViewEntry[] {
    const entries = [...this.views.values()]
    this.views.clear()
    return entries
  }

  /**
   * Panel ids to suspend so that at most `limit` views stay live, least recently
   * active first. `keepPanelId` is never returned — the panel the user just
   * acted on must not evict itself.
   */
  evictionCandidates(limit: number, keepPanelId: string): readonly string[] {
    const excess = this.views.size - limit
    if (excess <= 0) {
      return []
    }
    return [...this.views.entries()]
      .filter(([panelId]) => panelId !== keepPanelId)
      .sort((a, b) => a[1].lastActiveAt - b[1].lastActiveAt)
      .slice(0, excess)
      .map(([panelId]) => panelId)
  }
}
