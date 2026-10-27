// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Main-thread cost of auto-refresh's link scan (issue #124 audit, follow-up).
 *
 * The frame walk used to scan each page and frame document on the main
 * thread: a 4 MiB page cost 0.16–0.3 s of tokenizing on the emulated Windows
 * box (0.2–0.6 s in the app), a page of 270,000 links 0.3 s more to resolve
 * them, and one walk could scan 51 documents – every Erfana window froze for
 * seconds. Now every document is scanned in the link scan worker. The real
 * worker entry (`previewLinkScanWorker.ts`) is bundled with esbuild into a
 * temporary folder and started as a real `worker_threads` worker, as the app
 * starts its built bundle (`out/main/preview-link-scan.worker.js`); each walk
 * goes through the real client and the real walk.
 *
 * Gate: the longest event-loop stall while a walk runs, as
 * `monitorEventLoopDelay` sees it at a 10 ms resolution, ≤ {@link STALL_BUDGET_MS}
 * – for a dense 4 MiB page, for a 4 MiB page of links, and for a framed walk
 * that reaches the byte budget. The smallest of {@link RUNS} runs is gated:
 * contention from other suites only ever adds to a stall, while a scan back on
 * the main thread stalls every run by its whole length (recorded beside it as
 * `inlineMs`). The worker's results are held to the in-process scan's.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { logger } from '../LoggingService'
import { benchPage } from './comments/__test-helpers__/commentParseBench'
import type { ConfineFn } from './PreviewWatchCoordinator'
import { PreviewLinkScanClient, WORKER_HEAP_MB } from './PreviewLinkScanWorkerAdapter'
import { collectPreviewFrameSources, type PreviewFrameSources } from './previewFrameSources'
import { scanLinkDocument } from './previewLinkScanCore'
import { MAX_LINKS_PER_DOCUMENT, PREVIEW_LINK_SCAN_WORKER_ROLE } from './previewLinkScanProtocol'

/** The longest event-loop stall a walk may cause (the gate of `commentFileJobs.perf.test.ts`). */
const STALL_BUDGET_MS = 60
const RUNS = 3
const MB = 1024 * 1024
/** A page just under the read bound (`PREVIEW.MAX_ENTRY_HTML_BYTES`). */
const PAGE_BYTES = 4 * MB - 1024
const FRAMES = 5

const SITE = resolve('/proj/site')
const PAGE = resolve(SITE, 'index.html')
const insideSite: ConfineFn = (_root, candidate) => Promise.resolve({ ok: true, realTarget: candidate, rel: candidate })

let outDir = ''
let client: PreviewLinkScanClient
const recorded: Record<string, unknown> = {}

/** `<img src=N>` up to `bytes`: about 270,000 links in 4 MiB. */
function linkDensePage(bytes: number): Uint8Array {
  const parts: string[] = []
  let size = 0
  for (let n = 0; size < bytes; n += 1) {
    const tag = `<img src=${n}>`
    parts.push(tag)
    size += tag.length
  }
  return new TextEncoder().encode(parts.join(''))
}

/** A page whose first tags frame `count` documents, filled with a dense page to `bytes`. */
function framingPage(count: number, filler: Uint8Array): Uint8Array {
  const frames = Array.from({ length: count }, (_, n) => `<iframe src="f${n}.html"></iframe>`).join('')
  const head = new TextEncoder().encode(frames)
  const page = new Uint8Array(head.length + filler.length - 1024)
  page.set(head)
  page.set(filler.subarray(0, page.length - head.length), head.length)
  return page
}

interface WalkSample {
  readonly stallMs: number
  readonly busyMs: number
  readonly latencyMs: number
  readonly sources: PreviewFrameSources
}

/** One walk from `entry`, with the stall and main-thread busy time it caused. */
async function walkOnce(entry: () => Uint8Array, frame: () => Uint8Array): Promise<WalkSample> {
  // Fresh bytes per run, made before the measurement: the walk moves them to the worker.
  const entryHtml = entry()
  const delay = monitorEventLoopDelay({ resolution: 10 })
  const elu = performance.eventLoopUtilization()
  const started = performance.now()
  delay.enable()
  const sources = await collectPreviewFrameSources({
    entryPath: PAGE,
    entryHtml,
    readHtml: () => Promise.resolve(frame()),
    realRoot: SITE,
    confine: insideSite,
    scanner: client
  })
  delay.disable()
  return {
    stallMs: delay.max / 1e6,
    busyMs: performance.eventLoopUtilization(elu).active,
    latencyMs: performance.now() - started,
    sources
  }
}

const round = (value: number): number => Math.round(value * 10) / 10

/** {@link RUNS} walks; records them with the in-process scan's cost, and returns the smallest stall and a result. */
async function profile(label: string, entry: () => Uint8Array, frame: () => Uint8Array = entry) {
  const inline = entry()
  const before = performance.now()
  scanLinkDocument(inline, true)
  const inlineMs = performance.now() - before
  const samples: WalkSample[] = []
  for (let run = 0; run < RUNS; run += 1) samples.push(await walkOnce(entry, frame))
  const stallMs = Math.min(...samples.map(sample => sample.stallMs))
  recorded[label] = {
    inlineMs: round(inlineMs),
    stallMs: samples.map(sample => round(sample.stallMs)),
    busyMs: samples.map(sample => round(sample.busyMs)),
    latencyMs: samples.map(sample => round(sample.latencyMs))
  }
  return { stallMs, sources: samples[0].sources }
}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'erfana-link-scan-'))
  const workerFile = join(outDir, 'preview-link-scan.worker.cjs')
  const { build } = await import('esbuild')
  await build({
    entryPoints: [join(__dirname, 'previewLinkScanWorker.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: workerFile,
    logLevel: 'warning'
  })
  client = new PreviewLinkScanClient({
    createWorker: () =>
      new Worker(workerFile, {
        workerData: { role: PREVIEW_LINK_SCAN_WORKER_ROLE },
        resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB }
      })
  })
  // Started and warmed, so no run pays the worker's start-up.
  await client.scan(benchPage(64 * 1024), { frames: true })
}, 120_000)

afterAll(async () => {
  await client?.dispose()
  if (outDir !== '') rmSync(outDir, { recursive: true, force: true })
  // Recorded per OS: the numbers travel in the test output.
  console.info(`link scan ${process.platform}/${process.arch} ${JSON.stringify(recorded)}`)
})

describe('link scan – the main thread while a 4 MiB walk runs', () => {
  const dense = benchPage(PAGE_BYTES)
  const links = linkDensePage(PAGE_BYTES)

  it('scans in the worker what the in-process scan finds', async () => {
    for (const page of [dense, links, framingPage(FRAMES, dense)]) {
      expect(await client.scan(new Uint8Array(page), { frames: true })).toEqual(scanLinkDocument(page, true))
    }
  }, 120_000)

  it(`a dense 4 MiB page: stall ≤ ${STALL_BUDGET_MS} ms`, async () => {
    const { stallMs, sources } = await profile('dense-4MiB', () => new Uint8Array(dense))
    expect(sources.candidates).toEqual([])
    expect(stallMs).toBeLessThanOrEqual(STALL_BUDGET_MS)
  }, 120_000)

  it(`a 4 MiB page of links: stall ≤ ${STALL_BUDGET_MS} ms, its first ${MAX_LINKS_PER_DOCUMENT} links kept`, async () => {
    vi.mocked(logger.warn).mockClear()
    const { stallMs, sources } = await profile('links-4MiB', () => new Uint8Array(links))
    expect(sources.candidates).toHaveLength(MAX_LINKS_PER_DOCUMENT)
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith('Preview auto-refresh: a page was scanned only up to a limit', {
      limits: ['links-per-document']
    })
    expect(stallMs).toBeLessThanOrEqual(STALL_BUDGET_MS)
  }, 120_000)

  it(`a 4 MiB page framing ${FRAMES} 4 MiB documents: stall ≤ ${STALL_BUDGET_MS} ms, the byte budget skips two`, async () => {
    vi.mocked(logger.warn).mockClear()
    const { stallMs, sources } = await profile(
      `framed-4MiB-x${FRAMES}`,
      () => framingPage(FRAMES, dense),
      () => new Uint8Array(dense)
    )
    expect(sources.candidates).toEqual(Array.from({ length: FRAMES }, (_, n) => resolve(SITE, `f${n}.html`)))
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith('Preview auto-refresh: a page was scanned only up to a limit', {
      limits: ['walk-bytes'],
      skippedDocuments: 2
    })
    expect(stallMs).toBeLessThanOrEqual(STALL_BUDGET_MS)
  }, 180_000)
})
