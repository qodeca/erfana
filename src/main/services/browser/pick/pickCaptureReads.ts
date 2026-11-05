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
 *   React lookup in the page's main world unless the page is frozen; for
 *   React 19, the element's `_debugStack` read by handle and mapped through
 *   the page's source map, read through the tab session
 *   (`capture/sourceMapLocation.ts`), when a page fetch is given.
 * - The style-sheet headers announced by `CSS.styleSheetAdded` (matched-rule
 *   lines need their start line), and a per-session queue so node-id reads
 *   (`DOM.getDocument` resets them) never interleave.
 */
import type { Clock } from '../../../../shared/clock'
import { logger } from '../../LoggingService'
import { readElementFacts, type ElementFacts, type StyleSheetHeader } from '../capture/captureFacts'
import { isEmptyBitmap, type Bitmap } from '../capture/captureImage'
import type { PageFetch } from '../capture/pageResourceFetch'
import { collectSourceHints, type ReportedLocation, type SourceHints } from '../capture/sourceHints'
import { locateInSourceMap } from '../capture/sourceMapLocation'
import { REACT_DEBUG_STACK, REACT_LOOKUP } from '../cdp/cdpPickFunctions'
import { isRecord } from '../cdp/cdpTypes'
import { TOP_SESSION, type PickNode, type PickReader } from './pickCdp'
import type { ChainEntry, ElementChain } from './pickElement'
import type { PickFrames } from './pickFrames'
import type { PickFaults } from './pickSupport'

/** A capture failure whose message the user sees (`captureFailed`). */
export class CaptureFailure extends Error {}

/** What `capturePage` gives back, as far as the bitmap needs. */
export interface CapturedImage {
  toBitmap(): Buffer
  getSize(): { width: number; height: number }
  /** Electron's `NativeImage.getScaleFactors()`: the scales its representations are kept at. */
  getScaleFactors?(): number[]
}

export interface PickCaptureReadsDeps {
  readonly reader: PickReader
  readonly frames: PickFrames
  readonly capturePage: () => Promise<CapturedImage>
  readonly isFrozen: () => boolean
  readonly projectRoot: () => string | null
  readonly clock: Clock
  readonly faults?: PickFaults
  /** The tab session's `fetch`, for the React 19 source map; without it React 19 names no source. */
  readonly fetchFromPage?: PageFetch
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

  /**
   * The top-level viewport in CSS px: the whole page view the screenshot
   * shows – `view` (window DIP) at page zoom `zoom` – a classic scrollbar
   * included (025-FR-034). The layout viewport leaves the scrollbar out, so
   * the image divided by it gave a device pixel ratio of 2.08 at 2× on Linux
   * and shifted the drawn outline and the crop. Without a placed view, the
   * layout viewport. Throws {@link CaptureFailure} when the page reports no
   * size.
   */
  async viewport(view: { readonly width: number; readonly height: number } | null, zoom: number): Promise<{ width: number; height: number }> {
    const size = await this.deps.frames.viewportSize(TOP_SESSION)
    if (!(size.width > 0 && size.height > 0)) throw new CaptureFailure('The page size could not be read')
    const z = zoom > 0 ? zoom : 1
    return view !== null && view.width > 0 && view.height > 0 ? { width: view.width / z, height: view.height / z } : size
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
    const fetchFromPage = this.deps.fetchFromPage
    const sourceLookup =
      lookup === undefined || node === null || fetchFromPage === undefined
        ? undefined
        : (signal: AbortSignal): Promise<readonly ReportedLocation[]> => this.reactSource(node, chain.frameOrigins.at(-1) ?? null, fetchFromPage, signal)
    return collectSourceHints({
      attributesNearestFirst: chain.entries.slice(0, index + 1).reverse().map((e) => e.attrs),
      reactLookup: lookup,
      reactSourceLookup: sourceLookup,
      projectRoot: this.deps.projectRoot(),
      clock: this.deps.clock
    })
  }

  /** React 19: where the element's JSX ran, through the page's source map; none on any failure. */
  private async reactSource(node: PickNode, frameOrigin: string | null, fetchFromPage: PageFetch, signal: AbortSignal): Promise<readonly ReportedLocation[]> {
    const { reader } = this.deps
    const stack = await reader.callErrorDescription(node.sessionKey, await reader.resolve(node, 'main'), REACT_DEBUG_STACK)
    if (stack === null) return []
    const result = await locateInSourceMap(stack, { frameOrigin, fetch: fetchFromPage, signal })
    if ('miss' in result) {
      // A fixed reason only: the page's URLs and paths stay out of the log.
      logger.debug('Browser pick: no React source from the source map', { reason: result.miss })
      return []
    }
    return result.locations
  }

  /** Runs `task` after every earlier node-id read of `sessionKey`. */
  readonly serialise = <T>(sessionKey: string, task: () => Promise<T>): Promise<T> => {
    const before = this.sessionQueues.get(sessionKey) ?? Promise.resolve()
    const run = before.then(task, task)
    this.sessionQueues.set(sessionKey, run.catch(() => undefined))
    return run
  }
}

/**
 * The pixel width of a bitmap of `pixels` pixels whose size in DIPs is
 * `width` × `height`, at about `scale` device pixels per DIP. At a fractional
 * scale (Windows 125 %, 150 %) the pixel size is the DIP size times the scale
 * rounded either way, so the width is the one near `width × scale` that
 * divides the pixel count, with the height nearest `height × scale`; a width
 * off by one would shear every row (025-AC-034).
 */
export function bitmapWidth(pixels: number, width: number, height: number, scale: number): number {
  let best: number | null = null
  let bestError = Number.POSITIVE_INFINITY
  // `width` may be the pixel width divided by the scale and cut down, so the pixel width can reach (width + 1) × scale.
  for (let w = Math.max(1, Math.floor(width * scale) - 1); w <= Math.ceil((width + 1) * scale) + 1; w++) {
    if (pixels % w !== 0) continue
    const error = Math.abs(w - width * scale) + Math.abs(pixels / w - height * scale)
    if (error < bestError) {
      best = w
      bestError = error
    }
  }
  return best ?? Math.round(width * scale)
}

/** A captured image as a raw BGRA bitmap at its largest scale factor. */
export function toBitmap(image: CapturedImage): Bitmap {
  const data = image.toBitmap()
  const size = image.getSize()
  const pixels = Math.floor(data.length / 4)
  if (!(size.width > 0 && size.height > 0) || pixels === 0) return { data: new Uint8Array(data.buffer, data.byteOffset, 0), width: 0, height: 0 }
  const known = Math.max(0, ...(image.getScaleFactors?.() ?? []).filter((f) => Number.isFinite(f) && f > 0))
  // Without a known scale (or with a representation the size is not of), the bitmap's own size says it.
  const measured = Math.sqrt(pixels / (size.width * size.height))
  const scale = known > 0 && Math.abs(known - measured) < 0.5 ? known : measured
  const width = bitmapWidth(pixels, size.width, size.height, scale)
  const height = Math.floor(pixels / width)
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
