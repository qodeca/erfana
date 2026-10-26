// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Worker entry for `commentAnchoring.perf.test.ts`: times re-attaching the
 * blocks of one page and the whole parse-worker job for it.
 *
 * The test bundles this file with esbuild and starts it as a real
 * `worker_threads` worker, as F-002 does with the production worker: a
 * coverage run instruments the test thread only, so the timed code runs here
 * at the speed it runs in the app. Plain code; no `vi.mock()`.
 */
import { performance } from 'node:perf_hooks'
import { parentPort, workerData } from 'node:worker_threads'
import { encodeText, indexHtml, parseIndexedBlocks } from '../../../../../shared/htmlComments'
import { anchorLookupOf } from '../../../../../shared/htmlComments/anchorLookup'
import { instrumentDocument, NO_TARGET } from '../commentParseCore'

/** The `workerData.role` this entry answers to. */
export const ANCHORING_BENCH_ROLE = 'erfana-anchoring-bench'

/** What to time. */
export interface AnchoringBenchRequest {
  readonly text: string
  readonly warmUpRuns: number
  readonly measuredRuns: number
}

/** The timings of the measured runs and what the last run found. */
export interface AnchoringBenchResult {
  readonly bytes: number
  /** Blocks of the last re-attach, and how many of them are `ok` and orphaned. */
  readonly blocks: number
  readonly orphaned: number
  /** The last re-attach used up its quote budget. */
  readonly budgetSpent: boolean
  /** `parseIndexedBlocks` on a fresh parse, so no table survives from the run before. */
  readonly reattachMs: readonly number[]
  /** `instrumentDocument`: everything the worker runs for one load. */
  readonly workerJobMs: readonly number[]
  /** Blocks of the last worker job, and how many of them point at no element. */
  readonly jobBlocks: number
  readonly jobOrphaned: number
}

function timed<T>(run: () => T): { readonly value: T; readonly ms: number } {
  const started = performance.now()
  const value = run()
  return { value, ms: performance.now() - started }
}

/** Run the warm-up and measured runs of `request` and report them. */
export function runAnchoringBench(request: AnchoringBenchRequest): AnchoringBenchResult {
  const bytes = encodeText(request.text)
  const total = request.warmUpRuns + request.measuredRuns
  const reattachMs: number[] = []
  const workerJobMs: number[] = []
  let last = { blocks: 0, orphaned: 0, budgetSpent: false, jobBlocks: 0, jobOrphaned: 0 }
  for (let run = 0; run < total; run += 1) {
    const index = indexHtml(request.text)
    const reattach = timed(() => parseIndexedBlocks(index))
    const job = timed(() => instrumentDocument(bytes))
    if (job.value.kind !== 'ok') throw new Error(`instrumentDocument: ${job.value.reason}`)
    if (run >= request.warmUpRuns) {
      reattachMs.push(reattach.ms)
      workerJobMs.push(job.ms)
    }
    const { blocks } = reattach.value
    last = {
      blocks: blocks.length,
      orphaned: blocks.filter(block => block.kind === 'ok' && block.target.state === 'orphaned')
        .length,
      budgetSpent: anchorLookupOf(index).budgetSpent,
      jobBlocks: job.value.blocks.length,
      jobOrphaned: job.value.blocks.filter(
        block => block.kind === 'ok' && block.target === NO_TARGET
      ).length
    }
  }
  return { bytes: bytes.length, reattachMs, workerJobMs, ...last }
}

const data = workerData as { role?: unknown; request?: AnchoringBenchRequest } | null
if (parentPort && data?.role === ANCHORING_BENCH_ROLE && data.request) {
  parentPort.postMessage(runAnchoringBench(data.request))
}
