// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared set-up for the main-thread cost suites of the comment parse worker
 * (F-002 `commentParse.perf.test.ts`, `commentFileJobs.perf.test.ts`;
 * docs/designs/html-preview-comments.md §5.8, §12.2, §19 R3-12).
 *
 * The real worker entry (`commentParseWorker.ts`) is bundled with esbuild –
 * the bundler Vite itself runs on – into a temporary folder and started as a
 * real `worker_threads` worker, exactly as the app starts its built bundle.
 * The test thread's event-loop utilisation (ELU) over an awaited call is its
 * main-thread busy time. Plain code; no `vi.mock()`.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { encodeText, serializeBlock } from '../../../../../shared/htmlComments'
import { fixedId, makeComment } from '../../../../../shared/htmlComments/__fixtures__/commentTestData'
import { CommentParseClient } from '../CommentParseWorkerAdapter'
import { COMMENT_PARSE_WORKER_ROLE } from '../commentParseProtocol'

export const MB = 1024 * 1024

/** One awaited call: main-thread busy time and wall time. */
export interface Sample {
  readonly busyMs: number
  readonly latencyMs: number
}

export const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
export const max = (values: readonly number[]): number => Math.max(...values)
export const round = (value: number): number => Math.round(value * 10) / 10

/** Main-thread busy time and wall time of one awaited call. */
export async function measure(run: () => Promise<unknown>): Promise<Sample> {
  const elu = performance.eventLoopUtilization()
  const started = performance.now()
  await run()
  const latencyMs = performance.now() - started
  return { busyMs: performance.eventLoopUtilization(elu).active, latencyMs }
}

/** The figures a suite records for a set of samples. */
export function summarize(samples: readonly Sample[]): Record<string, number> {
  return {
    busyMedianMs: round(median(samples.map(s => s.busyMs))),
    busyMaxMs: round(max(samples.map(s => s.busyMs))),
    latencyMedianMs: round(median(samples.map(s => s.latencyMs))),
    latencyMaxMs: round(max(samples.map(s => s.latencyMs)))
  }
}

/** A real parse worker client over the bundled entry; `dispose` stops it and removes the bundle. */
export interface BenchWorker {
  readonly client: CommentParseClient
  dispose(): Promise<void>
}

/** Bundle `commentParseWorker.ts` and start a client on it. */
export async function startBenchWorker(prefix: string): Promise<BenchWorker> {
  const outDir = mkdtempSync(join(tmpdir(), prefix))
  const workerFile = join(outDir, 'comment-parse.worker.cjs')
  const { build } = await import('esbuild')
  await build({
    entryPoints: [join(__dirname, '..', 'commentParseWorker.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: workerFile,
    logLevel: 'warning'
  })
  const client = new CommentParseClient({
    createWorker: () => new Worker(workerFile, { workerData: { role: COMMENT_PARSE_WORKER_ROLE } })
  })
  return {
    client,
    async dispose() {
      await client.dispose()
      rmSync(outDir, { recursive: true, force: true })
    }
  }
}

/**
 * A real block (the P1 serializer) with its own id, anchored to a `<button>`.
 * It is placed right before one, so it attaches by position – as every block
 * Erfana writes does until the page around it changes.
 */
export function buttonBlock(n: number): string {
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

/** How {@link benchPage} places comment blocks. */
export interface BenchPageOptions {
  /** A block before the button of every `blockEvery`-th section; 4 by default. */
  readonly blockEvery?: number
  /** At most this many blocks; unlimited by default. */
  readonly maxBlocks?: number
}

/**
 * A dense, deterministic page of about `bytes` UTF-8 bytes: nested wrappers,
 * cards, tables, inline SVG, scripts, styles and body text, and a real
 * comment block every few sections – the shape of the S9 inputs (about 60–66
 * bytes per eligible element, the dense end of real pages; a 4 MB page has
 * about 65,000 elements, under the 100,000 token cap).
 */
export function benchPage(bytes: number, options: BenchPageOptions = {}): Uint8Array {
  const blockEvery = options.blockEvery ?? 4
  const maxBlocks = options.maxBlocks ?? Number.POSITIVE_INFINITY
  const parts: string[] = ['<!doctype html>\n<html lang="en"><head><title>bench</title>']
  parts.push('<style>.card{border:1px solid #ccc}.row{display:flex}</style></head>\n<body>\n')
  let size = parts.join('').length
  let blocks = 0
  for (let n = 0; size < bytes; n += 1) {
    const withBlock = n % blockEvery === 0 && blocks < maxBlocks
    if (withBlock) blocks += 1
    const section =
      `<section class="s s-${n}" id="sec-${n}"><div class="container"><div class="row">\n` +
      `  <article class="card"><h3 class="t">Card ${n}</h3><p class="d">Some <a href="#a${n}">text</a> ` +
      `with <em>emphasis</em> and <b>bold</b>.</p>\n` +
      `  <svg viewBox="0 0 24 24" width="16"><path d="M0 0h24v24H0z"/><circle cx="12" cy="12" r="4"/></svg>\n` +
      `  <table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>\n` +
      `  <ul><li>one</li><li>two</li><li>three</li></ul>${withBlock ? buttonBlock(n) : ''}` +
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
