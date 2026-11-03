// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What a confirmed pick reads from the page, for one tab (spec 025,
 * 025-FR-033, 025-FR-037, 025-FR-053; ADR 0008 decision 2). Kept out of
 * `BrowserTabPick.ts`, which decides *when* these run.
 *
 * - **Screenshot**: `capturePage`, retried once when the first image comes
 *   back empty (macOS gives an empty first capture); a second empty image or
 *   a refusal fails the capture with a reason the user sees.
 * - **Facts** of one chain entry (`capture/captureFacts.ts`); while the page
 *   is frozen, or for an element with no node, only what the chain snapshot
 *   already holds ({@link fallbackFacts}) – a page function on a paused page
 *   hangs (ADR 0008 probe).
 * - **Hints** (`capture/sourceHints.ts`): the source attributes, and the
 *   React lookup in the page's main world unless the page is frozen.
 * - The style-sheet headers announced by `CSS.styleSheetAdded` (matched-rule
 *   lines need their start line), and a per-session queue so node-id reads
 *   (`DOM.getDocument` resets them) never interleave.
 */
import type { Clock } from '../../../../shared/clock'
import { logger } from '../../LoggingService'
import { readElementFacts, type ElementFacts, type StyleSheetHeader } from '../capture/captureFacts'
import { isEmptyBitmap, type Bitmap } from '../capture/captureImage'
import { collectSourceHints, type SourceHints } from '../capture/sourceHints'
import { REACT_LOOKUP } from '../cdp/cdpPickFunctions'
import { isRecord } from '../cdp/cdpTypes'
import { TOP_SESSION, type PickReader } from './pickCdp'
import type { ChainEntry, ElementChain } from './pickElement'
import type { PickFrames } from './pickFrames'
import type { PickFaults } from './pickSupport'

/** A capture failure whose message the user sees (`captureFailed`). */
export class CaptureFailure extends Error {}

/** What `capturePage` gives back, as far as the bitmap needs. */
export interface CapturedImage {
  toBitmap(): Buffer
  getSize(): { width: number; height: number }
}

export interface PickCaptureReadsDeps {
  readonly reader: PickReader
  readonly frames: PickFrames
  readonly capturePage: () => Promise<CapturedImage>
  readonly isFrozen: () => boolean
  readonly projectRoot: () => string | null
  readonly clock: Clock
  readonly faults?: PickFaults
}

/** Screenshot attempts before the capture fails (one retry). */
const SCREENSHOT_ATTEMPTS = 2

export class PickCaptureReads {
  private readonly styleSheets = new Map<string, StyleSheetHeader>()
  private readonly sessionQueues = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: PickCaptureReadsDeps) {}

  /** Forget the style sheets (pick mode starts over on a fresh set). */
  clearStyleSheets(): void {
    this.styleSheets.clear()
  }

  /** Record a `CSS.styleSheetAdded` header. */
  recordStyleSheet(params: unknown): void {
    const header = isRecord(params) && isRecord(params.header) ? params.header : null
    if (header === null || typeof header.styleSheetId !== 'string') return
    this.styleSheets.set(header.styleSheetId, {
      sourceURL: typeof header.sourceURL === 'string' ? header.sourceURL : '',
      startLine: typeof header.startLine === 'number' ? header.startLine : 0
    })
  }

  /** The visible page as a BGRA bitmap. Throws {@link CaptureFailure}. */
  async screenshot(): Promise<Bitmap> {
    const faults = this.deps.faults
    for (let attempt = 0; attempt < SCREENSHOT_ATTEMPTS; attempt++) {
      if (faults?.takeCaptureFailure()) throw new CaptureFailure('The screenshot could not be taken')
      const forcedEmpty = faults?.takeEmptyCapture() ?? false
      const bitmap = toBitmap(await this.deps.capturePage())
      if (!forcedEmpty && !isEmptyBitmap(bitmap)) return bitmap
      logger.info('Browser pick: the screenshot came back empty', { attempt })
    }
    throw new CaptureFailure('The screenshot came back empty')
  }

  /** The top document's layout viewport in CSS px. Throws {@link CaptureFailure}. */
  async viewport(): Promise<{ width: number; height: number }> {
    const size = await this.deps.frames.viewportSize(TOP_SESSION)
    if (size.width > 0 && size.height > 0) return size
    throw new CaptureFailure('The page size could not be read')
  }

  /** The facts of entry `index` of `chain`; never rejects. */
  facts(chain: ElementChain, entry: ChainEntry, index: number): Promise<ElementFacts> {
    if (entry.node === null || this.deps.isFrozen()) return Promise.resolve(fallbackFacts(chain, entry))
    const own = index === chain.entries.length - 1 ? chain : undefined
    const ctx = { reader: this.deps.reader, frames: this.deps.frames, styleSheets: this.styleSheets, serialise: this.serialise }
    return readElementFacts(ctx, entry.node, own).catch(() => fallbackFacts(chain, entry))
  }

  /** The source hints of entry `index` of `chain`; never rejects. */
  hints(chain: ElementChain, index: number): Promise<SourceHints> {
    const node = chain.entries[index].node
    const { reader, faults } = this.deps
    const lookup =
      node === null || this.deps.isFrozen()
        ? undefined
        : async (): Promise<unknown> => {
            await faults?.hintsHook()
            return reader.callValue(node.sessionKey, await reader.resolve(node, 'main'), REACT_LOOKUP)
          }
    return collectSourceHints({
      attributesNearestFirst: chain.entries.slice(0, index + 1).reverse().map((e) => e.attrs),
      reactLookup: lookup,
      projectRoot: this.deps.projectRoot(),
      clock: this.deps.clock
    })
  }

  /** Runs `task` after every earlier node-id read of `sessionKey`. */
  readonly serialise = <T>(sessionKey: string, task: () => Promise<T>): Promise<T> => {
    const before = this.sessionQueues.get(sessionKey) ?? Promise.resolve()
    const run = before.then(task, task)
    this.sessionQueues.set(sessionKey, run.catch(() => undefined))
    return run
  }
}

/** A captured image as a raw BGRA bitmap at its largest scale factor. */
export function toBitmap(image: CapturedImage): Bitmap {
  const data = image.toBitmap()
  const size = image.getSize()
  const factor = size.width > 0 && size.height > 0 ? Math.sqrt(data.length / 4 / (size.width * size.height)) : 1
  const width = Math.round(size.width * factor)
  const height = width > 0 ? Math.floor(data.length / 4 / width) : 0
  return { data: new Uint8Array(data.buffer, data.byteOffset, width * height * 4), width, height }
}

/** What can be said of an entry without reading the page (frozen, or the element went). */
export function fallbackFacts(chain: ElementChain, entry: ChainEntry): ElementFacts {
  return {
    selectors: chain.selectors,
    closedShadow: chain.closedShadow,
    frameOrigins: chain.frameOrigins,
    outerHtml: '',
    styles: [],
    layout: [],
    matchedRules: null,
    coveredBy: null,
    boxInView: entry.boxInView,
    boxInFrame: entry.boxInFrame,
    connected: false
  }
}
