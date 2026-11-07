// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The live pick highlight (spec 025, 025-FR-026; ADR 0007 decisions 6 and 7,
 * accepted 2026-11-03; owner decisions Q1 and Q2, spec change S-1).
 *
 * The outline is drawn outside the page's document, so the page sees no
 * mutation and no layout change, with **no fill and no engine label** (owner
 * decision Q2, ADR 0007 decision 6):
 *
 * - **Erfana's band** (amended 2026-11-05, `pickBand.ts`): ink, paper, ink
 *   around the element's top-level box, on a native surface over the page
 *   that takes no input and is never in the page's `capturePage`. While the
 *   page scrolls the band is hidden; once the wheel has been still for
 *   {@link SCROLL_SETTLE_MS} the box is read again and the band follows it.
 * - **The engine's outline**, where the band cannot be placed (Wayland) or
 *   failed: `Overlay.highlightQuad` on the session that owns the node, the
 *   element's border-box quad, in one colour.
 *
 * The exact
 * 025-FR-026 label (`elementLabel.ts`) is computed here and lives in the pick
 * row's status slot only (Q1, ADR 0007 decision 7); what was last asked for –
 * the node, its top-level box and its label – is kept for the test hook
 * (§ 12, T3) and the bench. An element without a box (`display: contents`)
 * gets no outline; its label still shows.
 *
 * The highlight is hidden before every `capturePage` (commit-8 probe: the
 * engine's overlay is in the image; the band never is, but the still image
 * replaces it) – {@link PickHighlight.hide}.
 */
import type { Clock, TimerHandle } from '../../../../shared/clock'
import { elementLabel } from '../../../../shared/browser/elementLabel'
import { pickOutlineParams } from '../cdp/cdpPinned'
import type { BandState, OutlineBand } from './pickBand'
import type { Box } from './pickGeometry'
import { hexOf, OUTLINE_PAIR, type OutlinePair } from './pickOutlineColours'
import type { PickNode, PickReader } from './pickCdp'
import { boxInView, describeForLabel } from './pickElement'
import type { PickFrames } from './pickFrames'
import type { FaultPair } from './pickSupport'

/** How long the wheel must be still before the band follows the scrolled element. */
export const SCROLL_SETTLE_MS = 150

export interface PickHighlightOptions {
  /**
   * The live outline's colours when a test hook set them
   * (`PickFaults.highlightColours`); `null` draws the product colours.
   */
  readonly testColours?: () => FaultPair | null
  /** Erfana's band; without one (or where it cannot be placed) the engine draws the outline. */
  readonly band?: OutlineBand | null
  /** For the scroll settle; required with a band. */
  readonly clock?: Pick<Clock, 'setTimeout' | 'clearTimeout'>
}

/** What the highlight shows now, for the status-slot echo and the test hook. */
export interface HighlightRecord {
  readonly node: PickNode
  /** The node's border box in the top-level viewport (CSS px), or null when it has none. */
  readonly box: Box | null
  readonly label: string
}

export class PickHighlight {
  private shownOn: string | null = null
  private current: HighlightRecord | null = null
  /** Generation of the latest request; an older one that finishes later is dropped. */
  private generation = 0
  private settle: TimerHandle | undefined

  constructor(
    private readonly reader: PickReader,
    private readonly frames: PickFrames,
    private readonly options: PickHighlightOptions = {}
  ) {}

  /** What the highlight shows now, or null. */
  get record(): HighlightRecord | null {
    return this.current
  }

  /** What Erfana's band draws now (the test hook), or null: nothing shows, or the engine draws the outline. */
  get band(): BandState | null {
    return this.options.band?.state ?? null
  }

  /**
   * Outline `node` and resolve its record; null when a newer request
   * replaced this one or the node went before it could be read.
   */
  async show(node: PickNode): Promise<HighlightRecord | null> {
    const generation = ++this.generation
    this.cancelSettle()
    const label = await describeForLabel(this.reader, node)
    if (generation !== this.generation) return null
    if (label === null) return null
    const band = this.usableBand()
    if (band !== null) return this.showOnBand(band, node, label, generation)
    if (this.shownOn !== null && this.shownOn !== node.sessionKey) this.hideOn(this.shownOn)
    this.shownOn = node.sessionKey
    if (label.border !== null) {
      const params = pickOutlineParams(label.border, this.options.testColours?.()?.ink ?? undefined)
      await this.reader.call('Overlay.highlightQuad', params, node.sessionKey).catch(() => undefined)
    } else {
      // No box to outline: what was outlined before must not stay up beside the new label.
      await this.reader.call('Overlay.hideHighlight', undefined, node.sessionKey).catch(() => undefined)
    }
    const box = await boxInView(this.reader, this.frames, node)
    if (generation !== this.generation) return null
    this.current = { node, box, label: elementLabel({ ...label.name, width: label.width, height: label.height }) }
    return this.current
  }

  /** Hide the outline (before a capture, at pick end, when the node went). Never rejects. */
  async hide(): Promise<void> {
    this.generation++
    this.cancelSettle()
    this.current = null
    this.options.band?.hide()
    const on = this.shownOn
    this.shownOn = null
    if (on !== null) await this.reader.call('Overlay.hideHighlight', undefined, on).catch(() => undefined)
  }

  /** Forget what is shown without a command (the session's pick domains are already off); the band goes too. */
  forget(): void {
    this.generation++
    this.cancelSettle()
    this.current = null
    this.shownOn = null
    this.options.band?.hide()
  }

  /**
   * The page scrolls under the band (a wheel event): hide the band at once,
   * and once the wheel has been still for {@link SCROLL_SETTLE_MS}, read the
   * element's box again and outline it where it is now. The engine's outline
   * is left as it is.
   */
  scrolled(): void {
    const band = this.options.band
    const clock = this.options.clock
    if (band === undefined || band === null || clock === undefined || this.current === null || this.shownOn !== null) return
    band.suspend()
    this.cancelSettle()
    const generation = this.generation
    this.settle = clock.setTimeout(() => {
      this.settle = undefined
      void this.follow(band, generation)
    }, SCROLL_SETTLE_MS)
  }

  /** Close the band's surface (the tab is closing). */
  dispose(): void {
    this.forget()
    this.options.band?.dispose()
  }

  private usableBand(): OutlineBand | null {
    const band = this.options.band
    return band !== undefined && band !== null && band.available ? band : null
  }

  private colours(): OutlinePair {
    const test = this.options.testColours?.() ?? null
    return test === null ? OUTLINE_PAIR : { ink: hexOf(test.ink), paper: hexOf(test.paper) }
  }

  private async showOnBand(
    band: OutlineBand,
    node: PickNode,
    label: NonNullable<Awaited<ReturnType<typeof describeForLabel>>>,
    generation: number
  ): Promise<HighlightRecord | null> {
    // The engine's outline of an earlier fallback must not stay beside the band.
    if (this.shownOn !== null) this.hideOn(this.shownOn)
    this.shownOn = null
    const box = label.border === null ? null : await boxInView(this.reader, this.frames, node)
    if (generation !== this.generation) return null
    if (box === null) band.hide()
    else band.show(box, this.colours())
    this.current = { node, box, label: elementLabel({ ...label.name, width: label.width, height: label.height }) }
    return this.current
  }

  private async follow(band: OutlineBand, generation: number): Promise<void> {
    const current = this.current
    if (current === null || generation !== this.generation) return
    const box = await boxInView(this.reader, this.frames, current.node)
    if (generation !== this.generation || this.current !== current) return
    if (box === null) return band.hide()
    band.show(box, this.colours())
    this.current = { ...current, box }
  }

  private cancelSettle(): void {
    if (this.settle === undefined) return
    this.options.clock?.clearTimeout(this.settle)
    this.settle = undefined
  }

  private hideOn(sessionKey: string): void {
    this.reader.call('Overlay.hideHighlight', undefined, sessionKey).catch(() => undefined)
  }
}
