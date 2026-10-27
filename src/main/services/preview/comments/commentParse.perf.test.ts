// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * F-002 – main-thread cost of comment instrumentation per load
 * (docs/designs/html-preview-comments.md §5.8, §12.2 F-002, §19 R3-12; spike
 * S9).
 *
 * The real worker entry is bundled and started as a real `worker_threads`
 * worker (`__test-helpers__/commentParseBench.ts`), under the app's heap
 * ceiling. Each load goes through the real serving path (`bodyFor`: the gate,
 * the bytes lent to the worker, the reply and the token table), and the test
 * thread's event-loop utilisation (ELU) over that call is its main-thread
 * busy time. The body is read before the clock starts, as the protocol
 * handler reads it before it calls `bodyFor`.
 *
 * Gate (R3-12): main-thread busy, median of the measured runs, ≤ 10 ms for a
 * 1 MB page and ≤ 30 ms for a 4 MB page; the 10-frame page (10 × 200 KB at
 * once) is held to the 4 MB figure. The 25 MB page – the comment file limit
 * since §19 Rev 4 – is gated on its fastest of seven runs, the rule of
 * `commentFileJobs.perf.test.ts` (that suite's module comment says why), at
 * {@link BUDGET_MS}`.largest`: 30 ms, the 4 MB figure. On the emulated Windows
 * box a dense 25 MB page (about 456,000 elements, 100 blocks) measured 8.5 ms
 * fastest, 9.9 ms median and 13.1 ms slowest alone, and 10.4 ms fastest inside
 * the full coverage suite – what grows with the file is the token table and
 * the copy of the instrumented body, not a parse – so 30 ms leaves about three
 * times that, while a parse back on main (seconds) fails it.
 * Worker latency and the cold first parse are
 * recorded, not gated – on the emulated Windows box they are upper bounds,
 * and they are gated on macOS/Linux at the handoff (§16), as F-001.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  benchPage,
  MB,
  measure,
  median,
  round,
  startBenchWorker,
  summarize,
  type BenchWorker,
  type Sample
} from './__test-helpers__/commentParseBench'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import { createPreviewCommentServing, type CommentServeRequest } from './commentInstrumentation'

vi.mock('../../LoggingService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

/** §19 R3-12: main-thread busy per load; `largest` is the 25 MB page's (§19 Rev 4). */
const BUDGET_MS = { oneMb: 10, fourMb: 30, largest: 30 }
const WARM_UP_RUNS = 2
const MEASURED_RUNS = 5
/** The 25 MB page: the fastest of seven is gated; one warm-up, as the smaller pages already warmed the code. */
const LARGEST = { bytes: PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES - 64 * 1024, warmUps: 1, runs: 7 }
const FRAMES = 10
const FRAME_BYTES = 200 * 1024

function request(body: Uint8Array, realPath: string): CommentServeRequest {
  return {
    body: Buffer.from(body),
    ext: '.html',
    realPath,
    method: 'GET',
    noteType: 'mainFrame',
    requestClass: 'navigation'
  }
}

let bench: BenchWorker
const recorded: Record<string, unknown> = {}

beforeAll(async () => {
  bench = await startBenchWorker('erfana-f002-')
}, 60_000)

afterAll(async () => {
  await bench?.dispose()
  // Recorded per OS (§12.2): the numbers travel in the test output.
  console.info(`F-002 ${process.platform}/${process.arch} ${JSON.stringify(recorded)}`)
})

/** Instrument `page` through the serving path: cold first, then warm-up and measured runs. */
async function profile(
  label: string,
  page: Uint8Array,
  { warmUps, runs }: { readonly warmUps: number; readonly runs: number } = { warmUps: WARM_UP_RUNS, runs: MEASURED_RUNS }
): Promise<Sample[]> {
  const serving = createPreviewCommentServing({
    isEnabled: () => true,
    client: bench.client,
    registerE2e: () => () => {}
  })
  // Each load gets bytes of its own, read before the clock starts: they are lent to the worker.
  const load = async (): Promise<Sample> => {
    const served = request(page, `/bench/${label}.html`)
    return measure(() => serving.bodyFor(served))
  }
  const cold = await load()
  for (let i = 0; i < warmUps; i += 1) await load()
  const samples: Sample[] = []
  for (let i = 0; i < runs; i += 1) samples.push(await load())
  // Every run really instrumented the page, and every block found its element.
  const [latest] = serving.tokens.views().slice(-1)
  expect(latest.blocks.length).toBeGreaterThan(0)
  expect(latest.blocks.every(block => block.kind === 'ok' && block.token !== undefined)).toBe(true)
  serving.dispose()
  recorded[label] = { bytes: page.length, ...summarize(samples), coldLatencyMs: round(cold.latencyMs) }
  return samples
}

describe('F-002 main-thread cost of instrumentation per load', () => {
  it('0.5 MB page: recorded', async () => {
    const samples = await profile('0.5MB', benchPage(MB / 2))
    expect(samples).toHaveLength(MEASURED_RUNS)
  }, 120_000)

  it(`1 MB page: main-thread busy ≤ ${BUDGET_MS.oneMb} ms`, async () => {
    const samples = await profile('1MB', benchPage(MB))
    expect(median(samples.map(s => s.busyMs))).toBeLessThanOrEqual(BUDGET_MS.oneMb)
  }, 120_000)

  it(`4 MB page: main-thread busy ≤ ${BUDGET_MS.fourMb} ms`, async () => {
    const page = benchPage(4 * MB - 64 * 1024)
    expect(page.length).toBeLessThanOrEqual(4 * MB)
    const samples = await profile('4MB', page)
    expect(median(samples.map(s => s.busyMs))).toBeLessThanOrEqual(BUDGET_MS.fourMb)
  }, 180_000)

  it(`25 MB page (§19 Rev 4): main-thread busy, fastest of ${LARGEST.runs}, ≤ ${BUDGET_MS.largest} ms`, async () => {
    // At most 100 blocks, one every 25 sections: a well-reviewed page, not one past the block cap.
    const page = benchPage(LARGEST.bytes, { blockEvery: 25, maxBlocks: 100 })
    expect(page.length).toBeLessThanOrEqual(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES)
    const samples = await profile('25MB', page, LARGEST)
    const fastest = round(Math.min(...samples.map(s => s.busyMs)))
    recorded['25MB'] = { ...(recorded['25MB'] as object), busyMinMs: fastest }
    expect(fastest).toBeLessThanOrEqual(BUDGET_MS.largest)
  }, 600_000)

  it(`a ${FRAMES}-frame page (${FRAMES} × 200 KB at once): main-thread busy ≤ ${BUDGET_MS.fourMb} ms`, async () => {
    const frame = benchPage(FRAME_BYTES)
    const serving = createPreviewCommentServing({
      isEnabled: () => true,
      client: bench.client,
      registerE2e: () => () => {}
    })
    const loadAll = () =>
      Promise.all(
        Array.from({ length: FRAMES }, (_, i) =>
          serving.bodyFor({ ...request(frame, `/bench/frame-${i}.html`), noteType: 'subFrame' })
        )
      )
    for (let i = 0; i < WARM_UP_RUNS; i += 1) await loadAll()
    const samples: Sample[] = []
    for (let i = 0; i < MEASURED_RUNS; i += 1) samples.push(await measure(loadAll))
    expect(serving.unavailableReason('/bench/frame-0.html')).toBeUndefined()
    serving.dispose()
    recorded['10x200KB'] = summarize(samples)
    expect(median(samples.map(s => s.busyMs))).toBeLessThanOrEqual(BUDGET_MS.fourMb)
  }, 180_000)
})
