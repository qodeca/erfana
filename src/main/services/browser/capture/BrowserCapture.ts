// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One held capture (spec 025, 025-FR-027, 025-FR-046, 025-FR-053; solution
 * design § 3.1 "held capture", § 4 "refinement on the still image", § 6;
 * spec change S-34).
 *
 * Created when a pick is confirmed and kept in memory only while the menu or
 * dialog is open; written at send, and released on every other exit. What
 * was taken at the pick ({@link CaptureMoment}: the image, the logs, the
 * page address and title, the chain with every entry's box) never changes.
 *
 * Refinement moves {@link BrowserCapture.index} along the chain – Up toward
 * the root, Down back toward the element first picked – and the outline is
 * redrawn from the snapshot boxes; the moved-to element's facts are read
 * when it is reached (live while the page runs; read before the freeze for
 * a frozen page). Several quick moves: the last wins, earlier reads are
 * dropped (025-FR-053).
 */
import { ancestorPathNames, elementName, elementSize } from '../../../../shared/browser/elementLabel'
import type { PickEvent } from '../../../../shared/ipc/browser-tab-schema'
import type { ChainEntry, ElementChain } from '../pick/pickElement'
import type { Box } from '../pick/pickGeometry'
import type { CaptureElement, CaptureMoment } from './captureRender'
import type { ElementFacts } from './captureFacts'
import type { SourceHints } from './sourceHints'

export type PickSummary = Extract<PickEvent, { kind: 'captured' }>['summary']

export type RefineMove = 'parent' | 'child' | { readonly ancestor: number }

/** Why a move did nothing, as the status-slot note names it (025-FR-027). */
export type RefineRefusal = 'topOfPage' | 'backAtStart' | 'elementGone'

/** Reads the facts and hints of one chain entry; supplied by the tab's pick controller. */
export interface EntryReader {
  facts(entry: ChainEntry, index: number): Promise<ElementFacts>
  hints(index: number): Promise<SourceHints>
}

const ZERO: Box = { x: 0, y: 0, width: 0, height: 0 }

export class BrowserCapture {
  /** The chain entry picked now; starts at the element first picked (the last entry). */
  private current: number
  readonly firstIndex: number
  private readonly factsByIndex = new Map<number, Promise<ElementFacts>>()
  private readonly hintsByIndex = new Map<number, Promise<SourceHints>>()
  private moveGeneration = 0
  private goneFlag = false
  /** The page froze after the hints (a second-Ctrl/Cmd+E pick). */
  frozen = false
  /** The page navigated while the menu or dialog was open; only the dialog may still send it (025-FR-053). */
  afterNavigation = false
  /** Names of the files the last send wrote, for `discardCaptureFiles`. */
  written: readonly string[] = []
  /** A write in flight: a second submit joins it, so each confirmation writes once (025-FR-031). */
  writing: Promise<unknown> | null = null

  constructor(
    readonly id: string,
    readonly moment: CaptureMoment,
    readonly chain: ElementChain,
    private readonly reader: EntryReader
  ) {
    this.firstIndex = chain.entries.length - 1
    this.current = this.firstIndex
  }

  get index(): number {
    return this.current
  }

  get entry(): ChainEntry {
    return this.chain.entries[this.current]
  }

  get gone(): boolean {
    return this.goneFlag
  }

  /** The menu header's summary of the element picked now (025-FR-026, 025-FR-027). */
  summary(changedAfterPick = false): PickSummary {
    const entry = this.entry
    const box = entry.boxInView ?? ZERO
    return {
      name: elementName(entry.name),
      size: elementSize(box.width, box.height),
      ancestors: ancestorPathNames(this.chain.entries.slice(0, this.current + 1).map((e) => e.name)),
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      atTop: this.goneFlag || this.current === 0,
      atStart: this.goneFlag || this.current === this.firstIndex,
      gone: this.goneFlag,
      changedAfterPick
    }
  }

  /** The page removed the picked element: no move works any more; the capture stays (025-FR-027). */
  markGone(): void {
    this.goneFlag = true
  }

  /**
   * Move the pick. Returns the refusal when nothing moved, or the move's
   * generation – {@link isLatest} tells whether a later move replaced it.
   */
  move(move: RefineMove): { refused: RefineRefusal } | { generation: number } {
    if (this.goneFlag) return { refused: 'elementGone' }
    let next = this.current
    if (move === 'parent') {
      if (this.current === 0) return { refused: 'topOfPage' }
      next = this.current - 1
    } else if (move === 'child') {
      if (this.current === this.firstIndex) return { refused: 'backAtStart' }
      next = this.current + 1
    } else {
      if (!Number.isInteger(move.ancestor) || move.ancestor < 0 || move.ancestor > this.current) return { refused: 'topOfPage' }
      next = move.ancestor
    }
    this.current = next
    return { generation: ++this.moveGeneration }
  }

  isLatest(generation: number): boolean {
    return generation === this.moveGeneration
  }

  /** The facts of entry `index`, read once. */
  facts(index = this.current): Promise<ElementFacts> {
    let facts = this.factsByIndex.get(index)
    if (facts === undefined) {
      facts = this.reader.facts(this.chain.entries[index], index)
      // A failed read is retried at the next ask, not cached.
      facts.catch(() => this.factsByIndex.delete(index))
      this.factsByIndex.set(index, facts)
    }
    return facts
  }

  /** The hints of entry `index`, read once (never rejects). */
  hints(index = this.current): Promise<SourceHints> {
    let hints = this.hintsByIndex.get(index)
    if (hints === undefined) {
      hints = this.reader.hints(index)
      this.hintsByIndex.set(index, hints)
    }
    return hints
  }

  /** Read every entry's facts now – before a freeze, so refinement needs no page function while frozen. */
  async prefetchAll(): Promise<void> {
    await Promise.all(this.chain.entries.map((_e, i) => this.facts(i).catch(() => undefined)))
  }

  /** What the send renders for the element picked now. */
  async element(): Promise<CaptureElement> {
    const index = this.current
    const [facts, hints] = await Promise.all([this.facts(index), this.hints(index)])
    const entry = this.chain.entries[index]
    return { tag: entry.name.tagName, facts, hints, snapshotBox: entry.boxInView }
  }
}
