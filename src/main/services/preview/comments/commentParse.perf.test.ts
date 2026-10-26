// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * F-002 – main-thread cost of comment instrumentation per load
 * (docs/designs/html-preview-comments.md §5.8, §12.2 F-002, §19 R3-12; spike
 * S9).
 *
 * The real worker entry (`commentParseWorker.ts`) is bundled with esbuild –
 * the bundler Vite itself runs on – into a temporary folder and started as a
 * real `worker_threads` worker, exactly as the app starts its built bundle.
 * Each load goes through the real serving path (`bodyFor`: the gate, the copy
 * into the worker, the reply and the token table), and the test thread's
 * event-loop utilisation (ELU) over that call is its main-thread busy time.
 *
 * Gate (R3-12): main-thread busy, median of the measured runs, ≤ 10 ms for a
 * 1 MB page and ≤ 30 ms for a 4 MB page; the 10-frame page (10 × 200 KB at
 * once) is held to the 4 MB figure. Worker latency and the cold first parse
 * are recorded, not gated – on the emulated Windows box they are upper
 * bounds, and they are gated on macOS/Linux at the handoff (§16), as F-001.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { encodeText, serializeBlock } from '../../../../shared/htmlComments'
import { fixedId, makeComment } from '../../../../shared/htmlComments/__fixtures__/commentTestData'
import { CommentParseClient } from './CommentParseWorkerAdapter'
import { createPreviewCommentServing, type CommentServeRequest } from './commentInstrumentation'
import { COMMENT_PARSE_WORKER_ROLE } from './commentParseProtocol'

vi.mock('../../LoggingService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const MB = 1024 * 1024
/** §19 R3-12: main-thread busy per load. */
const BUDGET_MS = { oneMb: 10, fourMb: 30 }
const WARM_UP_RUNS = 2
const MEASURED_RUNS = 5
const FRAMES = 10
const FRAME_BYTES = 200 * 1024

/**
 * A real block (the P1 serializer) with its own id, anchored to a `<button>`.
 * It is placed right before one, so it attaches by position – as every block
 * Erfana writes does until the page around it changes.
 */
function buttonBlock(n: number): string {
  const result = serializeBlock(makeComment({ id: fixedId('c-', n) }), { indent: '  ', eol: '\n' })
  if (!result.ok) throw new Error(`serializeBlock: ${result.reason}`)
  return result.block
}

/** Body text, so the page has S9's density (about 60 bytes per element), not just markup. */
const LOREM =
  'Small-batch beans roasted every Monday and delivered to your door before the week gets busy. ' +
  'Each bag carries the farm, the altitude and the roast date, and every order can be paused, ' +
  'skipped or changed from your account at any time without a fee. Our roasters taste every ' +
  'batch before it ships, and anything that does not meet the mark is given to local shelters. ' +
  'Subscriptions start at two bags a month, shipping is free above three, and the grind can be ' +
  'set per bag: whole bean, espresso, filter, French press or cold brew. Questions go to a real ' +
  'person who answers within a working day, and returns are accepted for thirty days after the ' +
  'roast date, no receipt needed. Gift cards never expire and can be split across orders.'

/**
 * A dense, deterministic page of about `bytes` UTF-8 bytes: nested wrappers,
 * cards, tables, inline SVG, scripts, styles and body text, and a real
 * comment block every few sections – the shape of the S9 inputs (about 60–66
 * bytes per eligible element, the dense end of real pages; a 4 MB page has
 * about 65,000 elements, under the 100,000 token cap).
 */
function benchPage(bytes: number): Uint8Array {
  const parts: string[] = ['<!doctype html>\n<html lang="en"><head><title>bench</title>']
  parts.push('<style>.card{border:1px solid #ccc}.row{display:flex}</style></head>\n<body>\n')
  let size = parts.join('').length
  for (let n = 0; size < bytes; n += 1) {
    const section =
      `<section class="s s-${n}" id="sec-${n}"><div class="container"><div class="row">\n` +
      `  <article class="card"><h3 class="t">Card ${n}</h3><p class="d">Some <a href="#a${n}">text</a> ` +
      `with <em>emphasis</em> and <b>bold</b>.</p>\n` +
      `  <svg viewBox="0 0 24 24" width="16"><path d="M0 0h24v24H0z"/><circle cx="12" cy="12" r="4"/></svg>\n` +
      `  <table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>\n` +
      `  <ul><li>one</li><li>two</li><li>three</li></ul>${n % 4 === 0 ? buttonBlock(n) : ''}` +
      `<button class="btn">Go</button>\n` +
      `  <p class="long">${LOREM}</p></article>\n` +
      (n % 9 === 0 ? `  <script>window.n${n} = "<p>not a tag</p>"</script>\n` : '') +
      `</div></div></section>\n`
    parts.push(section)
    size += section.length
  }
  parts.push('</body></html>\n')
  return encodeText(parts.join(''))
}

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

interface Sample {
  busyMs: number
  latencyMs: number
}

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const max = (values: number[]): number => Math.max(...values)
const round = (value: number): number => Math.round(value * 10) / 10

/** Main-thread busy time and wall time of one awaited call. */
async function measure(run: () => Promise<unknown>): Promise<Sample> {
  const elu = performance.eventLoopUtilization()
  const started = performance.now()
  await run()
  const latencyMs = performance.now() - started
  return { busyMs: performance.eventLoopUtilization(elu).active, latencyMs }
}

let outDir: string
let client: CommentParseClient
const recorded: Record<string, unknown> = {}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'erfana-f002-'))
  const workerFile = join(outDir, 'comment-parse.worker.cjs')
  const { build } = await import('esbuild')
  await build({
    entryPoints: [join(__dirname, 'commentParseWorker.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: workerFile,
    logLevel: 'warning'
  })
  client = new CommentParseClient({
    createWorker: () => new Worker(workerFile, { workerData: { role: COMMENT_PARSE_WORKER_ROLE } })
  })
}, 60_000)

afterAll(async () => {
  await client?.dispose()
  rmSync(outDir, { recursive: true, force: true })
  // Recorded per OS (§12.2): the numbers travel in the test output.
  console.info(`F-002 ${process.platform}/${process.arch} ${JSON.stringify(recorded)}`)
})

/** Instrument `page` through the serving path: cold first, then warm-up and measured runs. */
async function profile(label: string, page: Uint8Array): Promise<Sample[]> {
  const serving = createPreviewCommentServing({
    isEnabled: () => true,
    client,
    registerE2e: () => () => {}
  })
  const load = () => serving.bodyFor(request(page, `/bench/${label}.html`))
  const cold = await measure(load)
  for (let i = 0; i < WARM_UP_RUNS; i += 1) await load()
  const samples: Sample[] = []
  for (let i = 0; i < MEASURED_RUNS; i += 1) samples.push(await measure(load))
  // Every run really instrumented the page, and every block found its element.
  const [latest] = serving.tokens.views().slice(-1)
  expect(latest.blocks.length).toBeGreaterThan(0)
  expect(latest.blocks.every(block => block.kind === 'ok' && block.token !== undefined)).toBe(true)
  serving.dispose()
  recorded[label] = {
    bytes: page.length,
    busyMedianMs: round(median(samples.map(s => s.busyMs))),
    busyMaxMs: round(max(samples.map(s => s.busyMs))),
    latencyMedianMs: round(median(samples.map(s => s.latencyMs))),
    latencyMaxMs: round(max(samples.map(s => s.latencyMs))),
    coldLatencyMs: round(cold.latencyMs)
  }
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

  it(`a ${FRAMES}-frame page (${FRAMES} × 200 KB at once): main-thread busy ≤ ${BUDGET_MS.fourMb} ms`, async () => {
    const frame = benchPage(FRAME_BYTES)
    const serving = createPreviewCommentServing({
      isEnabled: () => true,
      client,
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
    recorded['10x200KB'] = {
      busyMedianMs: round(median(samples.map(s => s.busyMs))),
      busyMaxMs: round(max(samples.map(s => s.busyMs))),
      latencyMedianMs: round(median(samples.map(s => s.latencyMs)))
    }
    expect(median(samples.map(s => s.busyMs))).toBeLessThanOrEqual(BUDGET_MS.fourMb)
  }, 180_000)
})
