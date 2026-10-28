// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Re-attach cost of orphaned blocks in the comment parse worker
 * (docs/designs/html-preview-comments.md §5.9, §19 R3-10, R3-12).
 *
 * A block whose element is gone falls through every re-attach tier – position,
 * `id`, CSS path, text quote – before it is orphaned. Scanned per block, the
 * 4 MB page below with 450 such blocks took about 7 s in the worker on the
 * emulated Windows box (450 blocks on one common tag: up to 23 s), close to or
 * past the client's 10 s watchdog: a hostile page could kill the worker twice
 * and switch comments off for the session. The tiers now answer from
 * per-parse tables (`anchorLookup.ts`), and the quote reads of one parse share
 * a character budget, so a page built to make them slow leaves its blocks
 * orphaned instead.
 *
 * The timed code runs in a real `worker_threads` worker, bundled with esbuild
 * from `__test-helpers__/anchoringBenchWorker.ts` – the technique of F-002
 * (`commentParse.perf.test.ts`): a coverage run instruments the test thread
 * only, so the numbers are the app's. It times `instrumentDocument`, which is
 * all the parse worker runs per load, and the re-attach step inside it on a
 * fresh parse each run, so no table survives from the run before.
 *
 * Gates (median of the measured runs, generous for the slowest box measured):
 * re-attaching all blocks of a page ≤ 600 ms, the whole worker job ≤ 5 s – half
 * the watchdog. Measured on the emulated Windows box: about 240–360 ms and
 * 0.8–1.0 s, most of it the parse itself.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serializeBlock, type CommentAnchor } from '../../../../shared/htmlComments'
import { fixedId, makeComment } from '../../../../shared/htmlComments/__fixtures__/commentTestData'
import {
  ANCHORING_BENCH_ROLE,
  type AnchoringBenchRequest,
  type AnchoringBenchResult
} from './__test-helpers__/anchoringBenchWorker'

const MB = 1024 * 1024
const PAGE_BYTES = 4 * MB - 64 * 1024
const ORPHANS = 450
const BUDGET_MS = { reattach: 600, workerJob: 5_000 }
const WARM_UP_RUNS = 1
const MEASURED_RUNS = 3
/** Hostile page: nested wrappers around one long whitespace run. */
const NESTED_DEPTH = 3_000
const WHITESPACE_RUN = 3_500_000

/**
 * Every tag of {@link section} but `button`, which follows each block: a block
 * on `button` would attach by position. Cycling through all of them builds
 * every table of the parse – the most a page of orphans can cost.
 */
const ORPHAN_TAGS = [
  'section',
  'div',
  'article',
  'h3',
  'p',
  'a',
  'em',
  'b',
  'svg',
  'path',
  'circle',
  'table',
  'tr',
  'td',
  'ul',
  'li',
  'script'
]

const LOREM =
  'Small-batch beans roasted every Monday and delivered to your door before the week gets busy. ' +
  'Each bag carries the farm, the altitude and the roast date, and every order can be paused, ' +
  'skipped or changed from your account at any time without a fee. Our roasters taste every ' +
  'batch before it ships, and anything that does not meet the mark is given to local shelters. ' +
  'Subscriptions start at two bags a month, shipping is free above three, and the grind can be ' +
  'set per bag: whole bean, espresso, filter, French press or cold brew. Questions go to a real ' +
  'person who answers within a working day, and returns are accepted for thirty days after the ' +
  'roast date, no receipt needed. Gift cards never expire and can be split across orders.'

/** A real block (the P1 serializer) whose element is gone: no tier can find it. */
function orphanBlock(n: number, tag: string): string {
  const anchor: CommentAnchor = {
    tag,
    id: `gone-${n}`,
    cls: ['gone'],
    path: `html > body > section:nth-of-type(${n + 1}) > aside:nth-of-type(1)`,
    quote: {
      exact: `A sentence that was deleted, number ${n}`,
      prefix: 'Words that came before it',
      suffix: 'and words after it'
    }
  }
  const result = serializeBlock(makeComment({ id: fixedId('c-', n), anchor }), {
    indent: '  ',
    eol: '\n'
  })
  if (!result.ok) throw new Error(`serializeBlock: ${result.reason}`)
  return result.block
}

/** One dense section, as F-002's pages (about 60 bytes per element). */
function section(n: number, block: string): string {
  return (
    `<section class="s s-${n}" id="sec-${n}"><div class="container"><div class="row">\n` +
    `  <article class="card"><h3 class="t">Card ${n}</h3><p class="d">Some <a href="#a${n}">text</a> ` +
    `with <em>emphasis</em> and <b>bold</b>.</p>\n` +
    `  <svg viewBox="0 0 24 24" width="16"><path d="M0 0h24v24H0z"/><circle cx="12" cy="12" r="4"/></svg>\n` +
    `  <table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>\n` +
    `  <ul><li>one</li><li>two</li><li>three</li></ul>${block}<button class="btn">Go</button>\n` +
    `  <p class="long">${LOREM}</p></article>\n` +
    (n % 9 === 0 ? `  <script>window.n${n} = "<p>not a tag</p>"</script>\n` : '') +
    `</div></div></section>\n`
  )
}

/** A dense page of about `bytes` with {@link ORPHANS} orphaned blocks spread through it. */
function orphanPage(bytes: number): string {
  const blocks = Array.from({ length: ORPHANS }, (_, n) =>
    orphanBlock(n, ORPHAN_TAGS[n % ORPHAN_TAGS.length])
  )
  const blockBytes = blocks.reduce((sum, block) => sum + block.length, 0)
  const every = Math.floor((bytes - blockBytes) / section(0, '').length / ORPHANS)
  const parts = ['<!doctype html>\n<html lang="en"><head><title>orphans</title></head>\n<body>\n']
  let size = parts[0].length
  let placed = 0
  for (let n = 0; size < bytes - 1024; n += 1) {
    const block = n % every === 0 && placed < ORPHANS ? blocks[placed++] : ''
    const part = section(n, block)
    parts.push(part)
    size += part.length
  }
  parts.push('</body></html>\n')
  return parts.join('')
}

/**
 * A page built to make quote reads slow: {@link NESTED_DEPTH} nested `div`s
 * share one whitespace run, so reading every `div`'s quote reads the run once
 * per `div` – about 10 billion characters without the budget. A block sits
 * every few levels, kept off its `div` by an `<i>`, so position cannot find it.
 */
function nestedWhitespacePage(): string {
  let open = ''
  for (let depth = 0, n = 0; depth < NESTED_DEPTH; depth += 1) {
    if (depth % 6 === 0 && n < ORPHANS) open += `${orphanBlock(n++, 'div')}<i></i>`
    open += '<div>'
  }
  return `<!doctype html><body>${open}${' '.repeat(WHITESPACE_RUN)}x${'</div>'.repeat(NESTED_DEPTH)}</body>`
}

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const round = (value: number): number => Math.round(value)

let outDir: string
let benchFile: string
const recorded: Record<string, unknown> = {}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'erfana-reattach-'))
  benchFile = join(outDir, 'anchoring-bench.worker.cjs')
  const { build } = await import('esbuild')
  await build({
    entryPoints: [join(__dirname, '__test-helpers__', 'anchoringBenchWorker.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: benchFile,
    logLevel: 'warning'
  })
}, 60_000)

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
  // Recorded per OS (§12.2): the numbers travel in the test output.
  console.info(`re-attach ${process.platform}/${process.arch} ${JSON.stringify(recorded)}`)
})

/** Time `text` in a fresh bench worker. */
function bench(text: string): Promise<AnchoringBenchResult> {
  const request: AnchoringBenchRequest = {
    text,
    warmUpRuns: WARM_UP_RUNS,
    measuredRuns: MEASURED_RUNS
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(benchFile, { workerData: { role: ANCHORING_BENCH_ROLE, request } })
    worker.once('message', result => resolve(result as AnchoringBenchResult))
    worker.once('error', reject)
    worker.once('exit', code => reject(new Error(`bench worker exited (${code}) without a result`)))
  })
}

/** Every block is `ok` and orphaned, in the re-attach and in the worker job – none damaged, none guessed. */
function expectAllOrphaned(result: AnchoringBenchResult): void {
  expect(result).toMatchObject({
    blocks: ORPHANS,
    orphaned: ORPHANS,
    jobBlocks: ORPHANS,
    jobOrphaned: ORPHANS
  })
  expect(result.bytes).toBeLessThanOrEqual(4 * MB)
}

function record(label: string, result: AnchoringBenchResult): void {
  recorded[label] = {
    bytes: result.bytes,
    reattachMedianMs: round(median(result.reattachMs)),
    reattachMaxMs: round(Math.max(...result.reattachMs)),
    workerJobMedianMs: round(median(result.workerJobMs))
  }
}

describe('re-attach cost of orphaned blocks in the parse worker', () => {
  it(`a 4 MB page with ${ORPHANS} orphaned blocks on every tag: re-attach ≤ ${BUDGET_MS.reattach} ms, worker job ≤ ${BUDGET_MS.workerJob} ms`, async () => {
    const result = await bench(orphanPage(PAGE_BYTES))
    record('orphans4MB', result)
    expectAllOrphaned(result)
    // Fast because of the tables, not because the budget cut the reads short.
    expect(result.budgetSpent).toBe(false)
    expect(median(result.reattachMs)).toBeLessThanOrEqual(BUDGET_MS.reattach)
    expect(median(result.workerJobMs)).toBeLessThanOrEqual(BUDGET_MS.workerJob)
  }, 180_000)

  it(`a page built to make quote reads slow spends the budget: every block orphaned, re-attach ≤ ${BUDGET_MS.reattach} ms`, async () => {
    const result = await bench(nestedWhitespacePage())
    record('nestedWhitespace', result)
    expectAllOrphaned(result)
    expect(result.budgetSpent).toBe(true)
    expect(median(result.reattachMs)).toBeLessThanOrEqual(BUDGET_MS.reattach)
    expect(median(result.workerJobMs)).toBeLessThanOrEqual(BUDGET_MS.workerJob)
  }, 180_000)
})
