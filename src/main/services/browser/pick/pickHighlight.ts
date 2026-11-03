// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The live pick highlight (spec 025, 025-FR-026; ADR 0007 decisions 6 and 7,
 * accepted 2026-11-03; owner decisions Q1 and Q2, spec change S-1).
 *
 * The outline is drawn by the engine outside the page's document, so the page
 * sees no mutation and no layout change: `Overlay.highlightQuad` on the
 * session that owns the node, the element's border-box quad, **no fill and no
 * engine label** (owner decision Q2, ADR 0007 decision 6). The exact
 * 025-FR-026 label (`elementLabel.ts`) is computed here and lives in the pick
 * row's status slot only (Q1, ADR 0007 decision 7); what was last asked for –
 * the node, its top-level box and its label – is kept for the test hook
 * (§ 12, T3) and the bench. An element without a box (`display: contents`)
 * gets no outline; its label still shows.
 *
 * The highlight must be hidden before every `capturePage` (commit-8 probe:
 * the overlay is in the image) – {@link PickHighlight.hide}.
 */
import { elementLabel } from '../../../../shared/browser/elementLabel'
import { pickOutlineParams } from '../cdp/cdpPinned'
import type { Box } from './pickGeometry'
import type { PickNode, PickReader } from './pickCdp'
import { boxInView, describeForLabel } from './pickElement'
import type { PickFrames } from './pickFrames'

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

  constructor(
    private readonly reader: PickReader,
    private readonly frames: PickFrames
  ) {}

  /** What the highlight shows now, or null. */
  get record(): HighlightRecord | null {
    return this.current
  }

  /**
   * Outline `node` and resolve its record; null when a newer request
   * replaced this one or the node went before it could be read.
   */
  async show(node: PickNode): Promise<HighlightRecord | null> {
    const generation = ++this.generation
    const label = await describeForLabel(this.reader, node)
    if (generation !== this.generation) return null
    if (label === null) return null
    if (this.shownOn !== null && this.shownOn !== node.sessionKey) this.hideOn(this.shownOn)
    this.shownOn = node.sessionKey
    if (label.border !== null) {
      await this.reader.call('Overlay.highlightQuad', pickOutlineParams(label.border), node.sessionKey).catch(() => undefined)
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
    this.current = null
    const on = this.shownOn
    this.shownOn = null
    if (on !== null) await this.reader.call('Overlay.hideHighlight', undefined, on).catch(() => undefined)
  }

  /** Forget what is shown without a command (the session's pick domains are already off). */
  forget(): void {
    this.generation++
    this.current = null
    this.shownOn = null
  }

  private hideOn(sessionKey: string): void {
    this.reader.call('Overlay.hideHighlight', undefined, sessionKey).catch(() => undefined)
  }
}
