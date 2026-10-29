// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview still-frame cache (Issue #74, work item 34).
 *
 * When a preview tab goes inactive its `WebContentsView` is hidden, and the
 * dockview tab would otherwise show a blank rectangle. This cache captures a
 * downscaled snapshot of the LIVE page so the inactive tab can paint the last
 * frame instead — with a **defined fallback**: if a frame cannot be produced
 * within budget, NO frame is emitted and the panel falls back to the
 * placeholder's current backdrop — brand black before the page has painted, the
 * page's own paper colour afterwards (`previewBackdrop.ts`). It never emits a
 * blank frame (design §1.4).
 *
 * `captureIfStale` must be called BEFORE the view is hidden, or with a capture
 * that passes `stayHidden: true`, so `capturePage` has live pixels to read.
 * Invalidation is driven by FILE CHANGE, not DOM observation — the caller
 * invalidates on a watched-file change (design §1.4).
 *
 * The budgets below are all about SIZE. There is deliberately no time budget,
 * and nothing on an interactive path may await this — `PreviewLiveView` starts a
 * capture and hides the view in the same tick, precisely because a slow capture
 * in front of `setVisible(false)` leaves the native view eating clicks meant for
 * the overlay that just opened. The one caller that waits is eviction, which is
 * about to destroy the page anyway.
 *
 * Budget enforcement, in order:
 *   - a capture of this panel that THIS cache started is still in flight, and no
 *     `invalidate` has overtaken it ⇒ skip. Not Electron's `isBeingCaptured()`:
 *     that is Chromium's capturer count, which other things raise — on Windows
 *     it read true from a fresh preview's first frame, so no frame was ever
 *     taken (2026-09-03).
 *   - either edge under `MIN_STILL_FRAME_PX` ⇒ skip (the 1×1 seed rect)
 *   - the caller's `shouldKeep` says its subject left mid-capture ⇒ keep the
 *     frame this panel already had. An EMPTY slot is exempt: a picture taken as
 *     the tab went away beats the no picture at all that the veto would leave.
 *   - an `invalidate` overtook the capture ⇒ NO frame: it shows a page, or a
 *     version of it, that is gone – a same-tab move's old page (RS2-8).
 *   - `capturePage` past `CAPTURE_TIMEOUT_MS` ⇒ NO frame, previous kept
 *   - `capturePage` throws      ⇒ NO frame (swallowed, never rethrown)
 *   - downscale to `MAX_FRAME_EDGE_PX` longest edge via `NativeImage.resize`
 *   - `toDataURL` over `MAX_FRAME_DATAURL_CHARS` ⇒ NO frame
 *
 * Two facts ride with a stored frame (issue #124, part 1 §1.5): the view's CSS
 * size at capture (`cssWidth`, `cssHeight`), which the renderer draws the still
 * at, and `stale` once real input reached the page after the capture
 * (`markStale`; omitted while false). Input that arrives while a capture runs
 * may be missing from it, so that frame is stored stale.
 *
 * @see docs/designs/html-preview/sd-074-html-preview.md §1.4
 */
import { PREVIEW } from '../../../shared/constants'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import { TimeoutError, withTimeout } from '../../utils/withTimeout'
import type { PreviewBounds, PreviewStillFrame } from '../../../shared/ipc/preview-types'
import { StillFrameOrder, type PreviewInvalidateOptions } from './previewStillFrameOrder'

/**
 * An error as a log line carries it: its name, plus `code` when it has one.
 * Never the message, which can quote a path or a preview URL (QG-7 S3).
 */
function errorFieldsOf(error: unknown): { error: string; code?: string } {
  if (!(error instanceof Error)) {
    return { error: typeof error }
  }
  const { code } = error as NodeJS.ErrnoException
  return typeof code === 'string' ? { error: error.name, code } : { error: error.name }
}

/**
 * The `NativeImage` surface this cache uses. Structural so tests inject a fake
 * without constructing a real Electron image. `resize` preserves aspect ratio
 * when only one edge is supplied.
 */
export interface PreviewNativeImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width?: number; height?: number; quality?: 'good' | 'better' | 'best' }): PreviewNativeImage
  toDataURL(): string
  /** Optional so older fakes stay valid; the fresh capture's pixel check reads through them. */
  crop?(rect: { x: number; y: number; width: number; height: number }): PreviewNativeImage
  toBitmap?(): Buffer
}

/**
 * The `WebContents` surface this cache uses. Structural so tests need no real
 * `WebContentsView`.
 */
export interface PreviewCaptureContents {
  capturePage(rect?: PreviewBounds, opts?: { stayHidden?: boolean }): Promise<PreviewNativeImage>
}

export interface PreviewStillFrameCacheDeps {
  /** Clock for `capturedAt` (defaults to `Date.now`). */
  now?: () => number
  /** Longest-edge cap in px before `toDataURL` (defaults to the constant). */
  maxEdgePx?: number
  /** Data-URL char cap; over budget ⇒ no frame (defaults to the constant). */
  maxDataUrlChars?: number
}

export interface IPreviewStillFrameCache {
  /**
   * Capture `wc` into `panelId`'s slot if no in-flight capture is running.
   * Never throws and never stores a blank frame: an over-budget, skipped or
   * throwing capture leaves the previous frame (if any) untouched.
   *
   * TAKES A SIZE, NOT A RECT, AND THAT IS THE WHOLE POINT. `capturePage`'s rect
   * is **page-relative** — `(0,0)` is the page's own top-left — while the only
   * rect a caller has to hand is `lastRect()` from `previewLiveBounds.ts`, which
   * is **window-relative** DIPs for `View.setBounds`. Passing that through asked
   * for a box starting hundreds of pixels INTO the page; Chromium clipped it at
   * the page edge and returned a narrow off-centre sliver, which
   * `.html-preview-still-frame`'s `object-fit: cover` then blew up to fill the
   * height and letterboxed in black. Accepting a size makes the mistake
   * unspellable: the rect is built here, at the origin, every time.
   *
   * `shouldKeep` VETOES A REPLACEMENT, NOT A FIRST WRITE. It is the caller's
   * answer to "was my subject on screen the whole time", and a `false` from it
   * protects a frame this panel already holds from being overwritten by one
   * captured as the page went away. On an EMPTY slot it is not consulted: there
   * is nothing to protect, and honouring it there parks the tab on a bare
   * backdrop for good.
   *
   * `cssSize` is the view's size in CSS px at the start of the capture; the
   * stored frame carries it as `cssWidth` × `cssHeight` (issue #124).
   */
  captureIfStale(
    wc: PreviewCaptureContents,
    panelId: string,
    size: { width: number; height: number },
    opts?: PreviewCaptureOptions
  ): Promise<void>
  /** The cached frame for `panelId`, or `undefined` (⇒ placeholder colour). */
  get(panelId: string): PreviewStillFrame | undefined
  /**
   * Drop `panelId`'s frame, and the result of any capture of it still running
   * (called on file change, a new page, panel close). With `keepSinceLoad`,
   * only what was captured before the last {@link markLoaded} goes.
   */
  invalidate(panelId: string, opts?: PreviewInvalidateOptions): void
  /** A load of `panelId`'s page finished (`did-finish-load`). Optional like `markStale`. */
  markLoaded?(panelId: string): void
  /**
   * Real input reached `panelId`'s page (issue #124, RU3): its cached frame no
   * longer shows what the page does, and a capture running now may miss it.
   *
   * Optional HERE only so test doubles typed against this interface stay
   * valid; {@link PreviewStillFrameCache} always has it.
   */
  markStale?(panelId: string): void
  /**
   * Capture NOW for a popup about to cover the view (HTML Preview comments,
   * html-preview-comments.md §3, §19 R3-6). Optional like `markStale`.
   */
  captureFresh?(
    wc: PreviewCaptureContents,
    panelId: string,
    size: { width: number; height: number },
    opts?: PreviewFreshCaptureOptions
  ): Promise<boolean>
}

export type { PreviewInvalidateOptions } from './previewStillFrameOrder'

/** Options of {@link PreviewStillFrameCache.captureFresh}. */
export interface PreviewFreshCaptureOptions {
  /** The view's CSS size when the capture started; stored as `cssWidth` / `cssHeight`. */
  cssSize?: { width: number; height: number }
  /** Whether a capture shows what it must; a refused one is retried once, and the retry kept. */
  accept?: (image: PreviewNativeImage) => boolean
  /** Runs before that retry – wait for another paint. */
  beforeRetry?: () => Promise<void>
}

/** Options of {@link IPreviewStillFrameCache.captureIfStale}. */
export interface PreviewCaptureOptions {
  /** The caller's "was my subject on screen the whole time" (see `captureIfStale`). */
  shouldKeep?: () => boolean
  /** The view's CSS size when the capture started; stored as `cssWidth` / `cssHeight`. */
  cssSize?: { width: number; height: number }
}

/** One capture this cache started and has not yet settled. */
interface PreviewCaptureRun {
  /** An `invalidate` ran meanwhile: the picture shows what was declared gone. */
  superseded: boolean
  /** Real input reached the page meanwhile: the picture may miss it. */
  inputDuring: boolean
  /** When it started, in this cache's capture order. */
  readonly order: number
}

export class PreviewStillFrameCache implements IPreviewStillFrameCache {
  private readonly frames = new Map<string, PreviewStillFrame>()
  /** Each panel's capture THIS cache started, not yet settled and not overtaken. */
  private readonly inFlight = new Map<string, PreviewCaptureRun>()
  /** Capture starts and load marks in one order (E-011). */
  private readonly order = new StillFrameOrder()
  private readonly now: () => number
  private readonly maxEdgePx: number
  private readonly maxDataUrlChars: number

  constructor(deps: PreviewStillFrameCacheDeps = {}) {
    this.now = deps.now ?? Date.now
    this.maxEdgePx = deps.maxEdgePx ?? PREVIEW.MAX_FRAME_EDGE_PX
    this.maxDataUrlChars = deps.maxDataUrlChars ?? PREVIEW.MAX_FRAME_DATAURL_CHARS
  }

  async captureIfStale(
    wc: PreviewCaptureContents,
    panelId: string,
    size: { width: number; height: number },
    opts: PreviewCaptureOptions = {}
  ): Promise<void> {
    // A capture of this panel is already in flight — skip rather than stack.
    // Our own ledger, not `wc.isBeingCaptured()`: see the header.
    if (this.inFlight.has(panelId)) {
      return
    }

    // No rectangle, no picture — and no picture worth having below the
    // minimum either. A view that has never been laid out reports the 1×1 seed
    // rect `preview:open` was called with, and a one-pixel frame stretched over
    // the panel is the flat colour block a suspended tab used to show.
    if (size.width < PREVIEW.MIN_STILL_FRAME_PX || size.height < PREVIEW.MIN_STILL_FRAME_PX) {
      return
    }

    let image: PreviewNativeImage | null
    const run: PreviewCaptureRun = { superseded: false, inputDuring: false, order: this.order.next() }
    this.inFlight.set(panelId, run)
    try {
      image = await this.firstCapture(wc, size)
      // An EMPTY image is Chromium saying the surface has not produced a frame
      // yet — measured on Windows: the capture at `'ready'` came back empty for
      // a page that had just finished loading, and a parked tab then showed a
      // flat colour block. One retry after a short pause is enough; a second
      // empty answer means the page is genuinely not painting. Electron 44
      // REJECTS that same not-yet-painted capture instead of returning an
      // empty image (`firstCapture` maps it to `null`), so both get the retry.
      if (image === null || image.isEmpty()) {
        await new Promise<void>((resolve) => setTimeout(resolve, PREVIEW.CAPTURE_RETRY_DELAY_MS))
        // `shouldKeep` protects a frame this panel ALREADY has; with an empty
        // slot it has nothing to protect and abandoning the retry costs the tab
        // its only picture. That is not hypothetical: the first capture at
        // `'ready'` comes back empty on macOS every time, so a tab switched away
        // inside `CAPTURE_RETRY_DELAY_MS` — opening four `.html` files in a
        // burst does it — reached this line with `wantedVisible` already false
        // and parked as a flat colour block for the rest of the session.
        // `captureOnce` passes `stayHidden: true`, which reads a hidden-but-live
        // page (verified on macOS 2026-09-04), so the retry is worth running.
        if (run.superseded || (this.frames.has(panelId) && !this.keep(opts))) {
          return
        }
        image = await this.captureOnce(wc, size)
      }
    } catch (error) {
      // Capture failed or timed out ⇒ NO frame. The panel keeps what it had.
      // Said out loud: a tab that wakes without a picture is otherwise silent.
      logger.warn('Preview still frame: capture failed', {
        panelId: stablePathDigest(panelId),
        ...errorFieldsOf(error)
      })
      return
    } finally {
      // An overtaken run has already handed the panel to its next capture.
      if (this.inFlight.get(panelId) === run) {
        this.inFlight.delete(panelId)
      }
    }

    // A page that is gone must never fill the slot its going emptied: a move's
    // commit invalidates while page A may still be being captured (RS2-8).
    if (run.superseded) {
      logger.debug('Preview still frame: dropped a capture an invalidate overtook', {
        panelId: stablePathDigest(panelId)
      })
      return
    }

    if (image.isEmpty()) {
      logger.debug('Preview still frame: empty capture, no frame stored', {
        panelId: stablePathDigest(panelId)
      })
      return
    }

    /*
     * LAST CHANCE TO THROW THE RESULT AWAY, and it is the only defence against
     * poisoning a good frame with a bad one.
     *
     * `isEmpty()` above catches a ZERO-DIMENSION image and nothing else — an
     * all-black picture at the right size sails through and overwrites whatever
     * was cached. So a capture that started while the page was on screen and
     * finished after it had gone could replace a perfectly good frame with a
     * black rectangle, and nothing invalidates it afterwards: the only callers
     * of `invalidate` are a file change, a completed load, and teardown.
     *
     * The caller knows whether its subject was still there the whole time. This
     * asks, at the last possible moment, rather than guessing from the pixels.
     *
     * IT GUARDS A REPLACEMENT, NOT A FIRST WRITE. Every word above is about
     * overwriting a frame that is already good, and with an empty slot there is
     * no such frame — refusing the write there does not avoid a black rectangle,
     * it guarantees no rectangle at all. The tab then parks on its backdrop
     * colour, which is the documented fallback for a capture that could not be
     * produced, not for one that was produced and thrown away.
     */
    if (this.frames.has(panelId) && !this.keep(opts)) {
      logger.debug('Preview still frame: kept the existing frame, view went away mid-capture', {
        panelId: stablePathDigest(panelId)
      })
      return
    }

    // Input the page got while this capture ran may be missing from it.
    this.store(panelId, image, { cssSize: opts.cssSize, stale: run.inputDuring, order: run.order })
  }

  /**
   * Capture `wc` into `panelId`'s slot NOW: a popup is about to cover the view
   * and must sit over a picture of what the reader just picked, its outline
   * painted (HTML Preview comments, §3 "Stale still image under popups",
   * R3-6). Unlike {@link captureIfStale} it supersedes a capture in flight,
   * whose idle picture would miss the outline, and what it stores is not
   * stale: the input that asked for it came before it. `accept` checks a
   * capture; a refused or empty one is retried once after `beforeRetry`, and
   * the retry is kept when it has pixels. Never throws; resolves whether a
   * frame was stored.
   */
  async captureFresh(
    wc: PreviewCaptureContents,
    panelId: string,
    size: { width: number; height: number },
    opts: PreviewFreshCaptureOptions = {}
  ): Promise<boolean> {
    if (size.width < PREVIEW.MIN_STILL_FRAME_PX || size.height < PREVIEW.MIN_STILL_FRAME_PX) {
      return false
    }
    const overtaken = this.inFlight.get(panelId)
    if (overtaken !== undefined) overtaken.superseded = true
    const run: PreviewCaptureRun = { superseded: false, inputDuring: false, order: this.order.next() }
    this.inFlight.set(panelId, run)
    let image: PreviewNativeImage | null = null
    try {
      image = await this.firstCapture(wc, size)
      if (image === null || image.isEmpty() || (opts.accept !== undefined && !opts.accept(image))) {
        await opts.beforeRetry?.()
        const retry = run.superseded ? null : await this.captureOnce(wc, size).catch(() => null)
        if (retry !== null && !retry.isEmpty()) image = retry
      }
    } catch (error) {
      logger.warn('Preview still frame: fresh capture failed', {
        panelId: stablePathDigest(panelId),
        ...errorFieldsOf(error)
      })
      return false
    } finally {
      if (this.inFlight.get(panelId) === run) {
        this.inFlight.delete(panelId)
      }
    }
    if (run.superseded || image === null || image.isEmpty()) {
      return false
    }
    return this.store(panelId, image, { cssSize: opts.cssSize, stale: false, order: run.order })
  }

  /** Downscale, encode and keep `image` as `panelId`'s frame; `false` when it is over budget. */
  private store(
    panelId: string,
    image: PreviewNativeImage,
    { cssSize, stale, order }: { cssSize?: { width: number; height: number }; stale: boolean; order: number }
  ): boolean {
    const downscaled = this.downscale(image)
    const dataUrl = downscaled.toDataURL()
    // Over the data-URL budget ⇒ NO frame (never a partial/blank one).
    if (dataUrl.length > this.maxDataUrlChars) {
      return false
    }
    const { width, height } = downscaled.getSize()
    // The #124 fields are added only when there is something to say, so a frame
    // without them is exactly the frame it always was.
    this.frames.set(panelId, {
      dataUrl,
      width,
      height,
      capturedAt: this.now(),
      ...(cssSize !== undefined ? { cssWidth: cssSize.width, cssHeight: cssSize.height } : {}),
      ...(stale ? { stale: true } : {})
    })
    this.order.stored(panelId, order)
    return true
  }

  markLoaded(panelId: string): void {
    this.order.loaded(panelId)
  }

  markStale(panelId: string): void {
    const frame = this.frames.get(panelId)
    if (frame !== undefined && frame.stale !== true) {
      this.frames.set(panelId, { ...frame, stale: true })
    }
    const run = this.inFlight.get(panelId)
    if (run !== undefined) {
      run.inputDuring = true
    }
  }

  get(panelId: string): PreviewStillFrame | undefined {
    return this.frames.get(panelId)
  }

  /** The caller's verdict, defaulting to "keep" when it did not supply one. */
  private keep(opts: PreviewCaptureOptions): boolean {
    return opts.shouldKeep === undefined || opts.shouldKeep()
  }

  invalidate(panelId: string, opts: PreviewInvalidateOptions = {}): void {
    // `keepSinceLoad`: what started after the load shows the loaded document (E-011).
    const gone = this.order.invalidate(panelId, opts.keepSinceLoad === true)
    if (gone.frame) this.frames.delete(panelId)
    // A capture still running shows what was just declared gone: it stores
    // nothing, and the next capture need not wait for it.
    const run = this.inFlight.get(panelId)
    if (run !== undefined && gone.run(run.order)) {
      run.superseded = true
      this.inFlight.delete(panelId)
    }
  }

  /**
   * The first {@link captureOnce} of a run. A rejection other than the timeout
   * comes back as `null` – "no frame yet", retried like an empty image – and
   * a timeout still ends the run, because a capture that never answered is not
   * worth a second wait. Measured on Windows with Electron 44: every capture
   * at `'ready'` rejected, where Electron 39 returned an empty image.
   */
  private async firstCapture(
    wc: PreviewCaptureContents,
    size: { width: number; height: number }
  ): Promise<PreviewNativeImage | null> {
    try {
      return await this.captureOnce(wc, size)
    } catch (error) {
      if (error instanceof TimeoutError) throw error
      logger.debug('Preview still frame: first capture rejected, retrying once', {
        ...errorFieldsOf(error)
      })
      return null
    }
  }

  /**
   * One `capturePage`, page-relative at the origin, `stayHidden` so it also
   * works for a view that is hiding, and bounded — a capture that never comes
   * back must not hold this panel's slot (or eviction's settle wait) hostage.
   */
  private captureOnce(
    wc: PreviewCaptureContents,
    size: { width: number; height: number }
  ): Promise<PreviewNativeImage> {
    return withTimeout(
      wc.capturePage({ x: 0, y: 0, width: size.width, height: size.height }, { stayHidden: true }),
      PREVIEW.CAPTURE_TIMEOUT_MS,
      'Preview still-frame capture'
    )
  }

  /**
   * Downscale so the longest edge is at most `maxEdgePx`, preserving aspect
   * ratio. Images already within budget are returned untouched.
   */
  private downscale(image: PreviewNativeImage): PreviewNativeImage {
    const { width, height } = image.getSize()
    const longestEdge = Math.max(width, height)
    if (longestEdge <= this.maxEdgePx || longestEdge === 0) {
      return image
    }

    const scale = this.maxEdgePx / longestEdge
    return image.resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: 'good'
    })
  }
}

/** Factory mirroring the codebase interface + class + factory convention. */
export function createPreviewStillFrameCache(
  deps: PreviewStillFrameCacheDeps = {}
): IPreviewStillFrameCache {
  return new PreviewStillFrameCache(deps)
}
