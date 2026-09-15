// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The post-load pipeline and live reload of one preview view (Issue #124, WI-1;
 * design §3). Moved out of `PreviewLiveView.ts` in WI-1; frames joined in WI-15.
 *
 * Owns the rate limit (the last run and the one trailing timer), the swap
 * counter and the watched files the page's frames use. A run reads the page,
 * derives the watch set from its static links and then its frames'
 * (`previewFrameSources.ts`) and reports `ready`; a classified change swaps one
 * stylesheet in place – unless a frame uses it – or reloads. The watch
 * coordinator, the reload policy and the reload itself are reached through
 * injected functions, so the view that owns them keeps their lifecycles.
 *
 * While a navigation main started is pending – a same-tab move or a history
 * step (issue #124, WI-17b; part 3 §3.4) – the pipeline is paused: it starts
 * no run and no reload, so a watcher reload cannot supersede the move. What
 * arrives meanwhile is about the page on screen and waits. When another
 * document commits, that work is dropped; when the page stays, it runs. A
 * navigation that commits with an error status gets no `ready` until the next
 * commit: the load state is `failed` then (part 3 §3.5).
 *
 * The rate limit paces the runs of ONE page – a save burst reloading it. A new
 * page's first run waits for no window: it is that page's only still capture,
 * so holding it back left a tab hidden straight after a move with no picture
 * (RS2-8).
 */

import { open } from 'node:fs/promises'

import { PREVIEW } from '../../../shared/constants'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import type { PreviewEmitters } from '../../../shared/ipc/preview-types'
import type { IPreviewStillFrameCache } from './PreviewStillFrameCache'
import type { WatchSetResult } from './PreviewWatchCoordinator'
import { classifyReload, type ReloadDecision } from './PreviewReloadPolicy'
import type { PreviewWebContentsHandle } from './PreviewSessionFactory'
import { collectPreviewFrameSources, watchedFrameAssets } from './previewFrameSources'
import { buildCacheBustHref, buildCssSwapScript } from './previewCssSwap'

/** A non-main isolated world for the CSS-swap script (§1.4: page cannot shadow it). */
const SWAP_WORLD_ID = 999

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

/** What the pipeline needs from the view that owns it. */
export interface PreviewLivePipelineDeps {
  readonly panelId: string
  /** The page, for the CSS-swap script. */
  readonly contents: Pick<PreviewWebContentsHandle, 'executeJavaScriptInIsolatedWorld'>
  readonly emit: Pick<PreviewEmitters, 'loadStateChanged'>
  readonly stillFrameCache: Pick<IPreviewStillFrameCache, 'invalidate'>
  readonly now: () => number
  /** Reads the page and each frame document; the bounded reader below when absent. */
  readonly readEntryHtml?: (filePath: string) => Promise<string>
  /** The page on screen, asked afresh at every read. */
  readonly currentPage: () => string
  /** The `erfana-preview://` URL a local file is served at. */
  readonly urlFor: (absPath: string) => string
  /**
   * The project's real root. A frame document is read only when it confines
   * inside it; absent, no frame document is read (fail closed, WI-15).
   */
  readonly realRoot?: string
  /** Replace the view's watch set (its watch coordinator). */
  readonly setWatchSet: (candidates: readonly string[]) => Promise<WatchSetResult>
  /** Feed one changed path to the view's reload policy. */
  readonly recordChange: (path: string) => void
  /** Reload the page. The view decides how a load starts; this module decides when. */
  readonly reloadPage: (ignoreCache: boolean) => void
  /** Whether the view is meant to be drawn (the visibility module). */
  readonly isWanted: () => boolean
  /** Photograph the page now that it is ready (the visibility module). */
  readonly captureWhileVisible: () => void
  /**
   * The view's teardown latch. Every guard here has always read this alone,
   * never the wider `isDefunct`, so a webContents that dies outside a teardown
   * still reaches the reload calls exactly as it did before the split.
   */
  readonly isTornDown: () => boolean
}

/** How a pending load ended, for {@link PreviewLivePipeline.resume}. */
export interface PreviewPipelineResume {
  /** Another document is on screen: the waiting work, about the old one, is dropped. */
  readonly replaced: boolean
  /** A navigation committed at status 400 or above: no `ready` until the next commit. */
  readonly failed?: boolean
}

/** The post-load pipeline of one live view. */
export interface PreviewLivePipeline {
  /** A `did-finish-load`: run now, or once at the end of the rate-limit window. */
  schedule(): void
  /** Drop the pending trailing run, if there is one. */
  cancel(): void
  /** A watched subresource changed — feed each path to the reload policy. */
  onWatchChanged(paths: readonly string[]): void
  /** The reload policy classified a burst: swap one stylesheet or full reload. */
  handleReloadDecision(decision: ReloadDecision): void
  /** Reload the page, unless the view is torn down. */
  reload(ignoreCache: boolean): void
  /** Hot-swap one stylesheet; `false` means it fell back to a full reload. */
  swap(absPath: string): Promise<boolean>
  /** A navigation main started is pending: start no run and no reload until it ends. */
  pause(): void
  /**
   * A pending load ended, or a load committed. Called on every commit, so a
   * failed navigation's silence ends at the next one; harmless when not paused.
   */
  resume(outcome: PreviewPipelineResume): void
}

/** Work that arrived while paused, all of it about the page on screen then. */
interface WaitingWork {
  /** A post-load run was asked for. */
  run: boolean
  /** A reload was asked for; `true` when one asked to bypass the cache. */
  reload: boolean | null
  /** The reload policy's latest decision. */
  decision: ReloadDecision | null
}

const NO_WORK: Readonly<WaitingWork> = Object.freeze({ run: false, reload: null, decision: null })

/** Two decisions for one page: a reload covers a swap, and two different swaps need one. */
function mergeDecisions(earlier: ReloadDecision | null, later: ReloadDecision): ReloadDecision {
  if (earlier === null) {
    return later
  }
  const sameSwap =
    earlier.action === 'swap' &&
    later.action === 'swap' &&
    earlier.changedPath === later.changedPath
  return sameSwap ? later : { action: 'reload' }
}

/**
 * Read at most `PREVIEW.MAX_ENTRY_HTML_BYTES` of the entry HTML for static-link
 * discovery. Bounding the read bounds the synchronous parse5 parse that follows,
 * so a large or generated entry file cannot freeze the main thread on reload.
 */
async function readEntryHtmlBounded(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(PREVIEW.MAX_ENTRY_HTML_BYTES)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total)
      if (bytesRead === 0) break
      total += bytesRead
    }
    return buffer.toString('utf8', 0, total)
  } finally {
    await handle.close()
  }
}

/** Create the post-load pipeline for one live view. */
export function createPreviewLivePipeline(deps: PreviewLivePipelineDeps): PreviewLivePipeline {
  const readEntryHtml = deps.readEntryHtml ?? readEntryHtmlBounded
  let swapVersion = 0
  // Negative-infinity so the FIRST post-load pipeline always clears the rate-limit
  // window and runs immediately; subsequent runs are gated to one per interval.
  let lastPipelineAt = Number.NEGATIVE_INFINITY
  let trailingTimer: ReturnType<typeof setTimeout> | null = null
  // The page the last run read: another page's first run is not rate-limited.
  let lastRunPage: string | null = null
  // The watched files the page's frames use (WI-15). Only the run that started
  // last may set them, so an older run that finishes late cannot bring back a
  // frame the page no longer has.
  let frameAssets: ReadonlySet<string> = new Set()
  let runSerial = 0
  // Issue #124, WI-17b: a pending navigation pauses the pipeline; a failed one
  // keeps its `ready` back until the next commit.
  let paused = false
  let failedPage = false
  let waiting: WaitingWork = { ...NO_WORK }
  let replayTimer: ReturnType<typeof setTimeout> | null = null

  function reload(ignoreCache: boolean): void {
    if (deps.isTornDown()) {
      return
    }
    if (paused) {
      waiting.reload = waiting.reload === true || ignoreCache
      return
    }
    deps.reloadPage(ignoreCache)
  }

  /** Hot-swap a stylesheet in an isolated world; any non-`true` outcome reloads. */
  async function swap(absPath: string): Promise<boolean> {
    const base = deps.urlFor(absPath)
    swapVersion += 1
    const script = buildCssSwapScript(base, buildCacheBustHref(base, swapVersion))

    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<'timeout'>((res) => {
      timer = setTimeout(() => res('timeout'), PREVIEW.SWAP_TIMEOUT_MS)
    })
    const swapped = deps.contents
      .executeJavaScriptInIsolatedWorld(SWAP_WORLD_ID, [{ code: script }])
      .then((value) => value, () => 'error' as const)

    const outcome = await Promise.race([swapped, timeout])
    if (timer !== null) {
      clearTimeout(timer)
    }
    if (outcome === true) {
      return true
    }
    // Timeout, throw, `false` or a non-boolean ⇒ fall back to a full reload –
    // held back like any other while a navigation is pending.
    reload(false)
    return false
  }

  /**
   * Watch the page's files, then its frames' (WI-15), and keep which of the
   * watched files a frame uses. `null` when the view was torn down on the way.
   */
  async function watchPageFiles(
    page: string,
    html: string,
    serial: number
  ): Promise<WatchSetResult | null> {
    const sources = await collectPreviewFrameSources({
      entryPath: page,
      entryHtml: html,
      readHtml: readEntryHtml,
      realRoot: deps.realRoot
    })
    // Another page committed meanwhile (issue #124): its own run sets the watch set.
    if (deps.isTornDown() || deps.currentPage() !== page) {
      return null
    }
    const { candidates } = sources
    let result: WatchSetResult
    try {
      result = await deps.setWatchSet(candidates)
    } catch (error) {
      // The page loaded; only auto-refresh is degraded. This used to be an
      // unhandled rejection that left the panel on 'loading' forever (#112).
      logger.warn('Preview auto-refresh: could not watch the page files', {
        panelId: stablePathDigest(deps.panelId),
        ...errorFieldsOf(error)
      })
      result = {
        watched: [],
        dropped: candidates.map((candidate) => ({ candidate, reason: 'watch-failed' as const }))
      }
    }
    if (deps.isTornDown()) {
      return null
    }
    const assets = await watchedFrameAssets(sources.frameAssets, result)
    if (serial === runSerial) {
      frameAssets = assets
    }
    return result
  }

  /** One post-load pipeline: read the page → watch its and its frames' files → emit ready. */
  async function run(): Promise<void> {
    if (deps.isTornDown()) {
      return
    }
    lastPipelineAt = deps.now()
    runSerial += 1
    const serial = runSerial
    // Asked once, so the links resolve against the page that was read.
    const page = deps.currentPage()
    lastRunPage = page

    let html: string
    try {
      html = await readEntryHtml(page)
    } catch {
      // A missing entry surfaces via the entry-file unlink event, not here.
      return
    }
    if (deps.isTornDown()) {
      return
    }

    const result = await watchPageFiles(page, html, serial)
    if (result === null || deps.isTornDown()) {
      return
    }
    // A navigation that committed with an error status (issue #124): the load
    // state is `failed`, and a `ready` would hide the failed banner.
    if (failedPage) {
      return
    }
    // Drop the old picture only when a new one will follow: `captureWhileVisible`
    // below captures only while the view is drawn, so invalidating behind a
    // hidden tab left it with nothing to show until it was looked at again.
    if (deps.isWanted()) {
      deps.stillFrameCache.invalidate(deps.panelId)
    }
    deps.emit.loadStateChanged(deps.panelId, 'ready', result.dropped.length)
    // The page has painted and the watch set is established: the one moment we
    // know the view is showing something worth photographing.
    deps.captureWhileVisible()
  }

  /** The rate-limited post-load pipeline scheduler (§1.4). */
  function schedule(): void {
    if (deps.isTornDown()) {
      return
    }
    if (paused) {
      waiting.run = true
      return
    }
    const elapsed = deps.now() - lastPipelineAt
    // Another page's first run runs at once (see the header).
    if (elapsed >= PREVIEW.RELOAD_MIN_INTERVAL_MS || deps.currentPage() !== lastRunPage) {
      void run()
    } else if (trailingTimer === null) {
      // One trailing run at the window's end; further did-finish-loads are dropped.
      trailingTimer = setTimeout(() => {
        trailingTimer = null
        void run()
      }, PREVIEW.RELOAD_MIN_INTERVAL_MS - elapsed)
    }
  }

  function cancel(): void {
    if (trailingTimer !== null) {
      clearTimeout(trailingTimer)
      trailingTimer = null
    }
    if (replayTimer !== null) {
      clearTimeout(replayTimer)
      replayTimer = null
    }
  }

  function onWatchChanged(paths: readonly string[]): void {
    if (deps.isTornDown()) {
      return
    }
    for (const path of paths) {
      deps.recordChange(path)
    }
  }

  function handleReloadDecision(decision: ReloadDecision): void {
    if (deps.isTornDown()) {
      return
    }
    if (paused) {
      waiting.decision = mergeDecisions(waiting.decision, decision)
      return
    }
    deps.stillFrameCache.invalidate(deps.panelId)
    // The policy classified the burst without frames. A swap replaces only the
    // top page's `<link>`, so a stylesheet a frame uses too reloads instead.
    const applied =
      decision.action === 'swap' ? classifyReload([decision.changedPath], frameAssets) : decision
    if (applied.action === 'swap') {
      void swap(applied.changedPath)
    } else {
      reload(false)
    }
  }

  /** Run what waited while paused, on the page that stayed. */
  function replay(): void {
    replayTimer = null
    if (deps.isTornDown() || paused) {
      return
    }
    const work = waiting
    waiting = { ...NO_WORK }
    // A reload covers everything else: its own load runs the pipeline again.
    if (work.reload !== null) {
      reload(work.reload)
      return
    }
    if (work.decision !== null) {
      handleReloadDecision(work.decision)
    }
    if (work.run) {
      schedule()
    }
  }

  function pause(): void {
    if (deps.isTornDown()) {
      return
    }
    paused = true
    // A trailing run was about the page on screen: it waits with the rest.
    if (trailingTimer !== null) {
      clearTimeout(trailingTimer)
      trailingTimer = null
      waiting.run = true
    }
  }

  function resume(outcome: PreviewPipelineResume): void {
    paused = false
    if (outcome.replaced) {
      waiting = { ...NO_WORK }
      failedPage = outcome.failed === true
      return
    }
    const work = waiting
    if (replayTimer === null && (work.run || work.reload !== null || work.decision !== null)) {
      // Deferred: this runs inside the page's own navigation event, and a
      // reload started from there would re-enter the load that just ended.
      replayTimer = setTimeout(replay, 0)
    }
  }

  return { schedule, cancel, onWatchChanged, handleReloadDecision, reload, swap, pause, resume }
}
