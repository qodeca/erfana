// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Large-file timing of the comment parse work (spec 024 024-NFR-001,
 * 024-AC-024): the 1 MB Markdown and HTML fixtures with 200 comments
 * (`largeFixtures.ts`), 20 samples each, in process – the jobs the parse
 * worker runs, on the calling thread:
 *
 * - **list** – a cold `list` job (a fresh job runner, so no cached parse):
 *   the parse work between the preview being rendered and the pins being
 *   known, the floor of the "pins visible ≤ 0.5 s" budget;
 * - **save** – the `write` job of one add (Markdown: a pick, after the list
 *   the app has always run on the file by then, untimed; HTML: an add naming
 *   the draft made at pick time, untimed), main's `assembleSplice`, then the
 *   `list` of the new bytes (from the cache the write fills): the floor of
 *   the "saved comment visible ≤ 1 s" budget. The Markdown save with no list
 *   before it is recorded too, not gated.
 *
 * What it does not time: IPC, the worker's message copy, the renderer's
 * draw and the `performance.mark` points of the e2e test 024-AC-024 names –
 * the report says so. Two modes, as the corpus round trip:
 * `TIMING_RUN=1` (`npm run test:timing`) measures and writes
 * `verification/large-file-timing.md`; always, the merge-time test reads it.
 */
import { cpus, platform, release } from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeText } from '../../../../shared/comments/encoding'
import { htmlKind } from '../../../../shared/comments/htmlKind'
import type { CommentDocument } from '../../../../shared/htmlComments'
import { pickOf } from '../../../../shared/markdownComments/__test-helpers__/mdHarness'
import { markdownKind } from '../../../../shared/markdownComments/markdownKind'
import type { MdIndex } from '../../../../shared/markdownComments/mdIndex'
import { createInProcessCommentFileJobs } from '../../preview/comments/htmlCommentJobs'
import type { CommentFileJobRunner } from '../commentFileJobs'
import type { ListJobResult } from '../commentListCore'
import { assembleSplice, type WriteJobResult, type WritePlanRequest } from '../commentWriteCore'
import { createInProcessMarkdownJobs } from '../markdown/markdownCommentJobs'
import { percentile } from './__test-helpers__/corpusReport'
import { LARGE_FILE_BYTES, LARGE_FILE_COMMENTS, largeHtml, largeMarkdown } from './__test-helpers__/largeFixtures'

const ROOT = join(__dirname, '..', '..', '..', '..', '..')
const REPORT = join(ROOT, 'specs', 'spec-t3-024-unified-comments', 'verification', 'large-file-timing.md')
/** 024-NFR-001: 20 samples per preview. */
const SAMPLES = 20
/** Untimed runs first, so the samples do not time the first compile of the code. */
const WARM_UP = 2
/** 024-NFR-001's budgets, P50 and P95 both. */
const PINS_BUDGET_MS = 500
const SAVE_BUDGET_MS = 1_000
const SUMMARY_START = '<!-- timing-summary'
const SUMMARY_END = 'timing-summary -->'
/** A hand-kept section between these markers (the before and after of changes) survives a rerun. */
const HISTORY_START = '<!-- timing-history (kept by reruns) -->'
const HISTORY_END = '<!-- /timing-history -->'
const VIEW = { w: 900, h: 700, dpr: 2, x: 0, y: 0 }
const ACT = { author: { name: 'Timing Reviewer', email: 'timing@example.invalid', role: 'human' as const }, nowMs: Date.UTC(2026, 9, 30, 12) }

/** One kind's measurement. */
interface KindTiming {
  readonly kind: 'markdown' | 'html'
  readonly bytes: number
  readonly comments: number
  readonly attached: number
  readonly listMs: number[]
  readonly saveMs: number[]
  /** Markdown: the save with no list before it on the worker (a cold cache) – recorded, not gated. */
  readonly saveColdMs?: number[]
}

interface TimingSummary {
  readonly platform: string
  readonly date: string
  readonly kinds: KindTiming[]
}

/** Both kinds' runners take the shared `list` and `write` jobs. */
type Runner = CommentFileJobRunner

async function listOf(runner: Runner, bytes: Uint8Array): Promise<Extract<ListJobResult, { ok: true }>> {
  const result = (await runner.runJob(bytes, { kind: 'list', placements: true })) as ListJobResult
  if (result.kind !== 'list' || !result.ok) throw new Error(`list failed: ${JSON.stringify(result)}`)
  return result
}

async function writeOf(runner: Runner, bytes: Uint8Array, request: WritePlanRequest): Promise<Uint8Array> {
  const result = (await runner.runJob(bytes, { kind: 'write', request, act: ACT })) as WriteJobResult
  if (result.kind !== 'write' || !result.ok) throw new Error(`write refused: ${JSON.stringify(result)}`)
  return assembleSplice(bytes, result)
}

/** Time `samples` + {@link WARM_UP} runs of `run(i)`, dropping the warm-up ones. */
async function timed(run: (i: number) => Promise<void>): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < SAMPLES + WARM_UP; i += 1) {
    const started = performance.now()
    await run(i)
    if (i >= WARM_UP) out.push(Math.round((performance.now() - started) * 10) / 10)
  }
  return out
}

async function markdownTiming(): Promise<KindTiming> {
  const { text } = largeMarkdown()
  const bytes = encodeText(text)
  const doc = markdownKind.parse(text, 0)
  const paragraphs = (doc.index as MdIndex).elements.filter(t => t.kind === 'paragraph')
  const picks = Array.from({ length: SAMPLES + WARM_UP }, (_, i) => pickOf(doc, paragraphs[Math.floor((i * paragraphs.length) / (SAMPLES + WARM_UP))]))
  const first = await listOf(createInProcessMarkdownJobs(), bytes)
  const listMs = await timed(async () => void (await listOf(createInProcessMarkdownJobs(), bytes)))
  const save = async (runner: Runner, i: number): Promise<void> => {
    const out = await writeOf(runner, bytes, { op: 'pick', pick: picks[i], view: VIEW, text: 'Timing save.' })
    await listOf(runner, out)
  }
  // The app lists a file's comments before any save on it, on the same worker: that list is not timed.
  const saveMs: number[] = []
  for (let i = 0; i < SAMPLES + WARM_UP; i += 1) {
    const runner = createInProcessMarkdownJobs()
    await listOf(runner, bytes)
    const started = performance.now()
    await save(runner, i)
    if (i >= WARM_UP) saveMs.push(Math.round((performance.now() - started) * 10) / 10)
  }
  const saveColdMs = await timed(async i => save(createInProcessMarkdownJobs(), i))
  const attached = first.summary.threads.filter(t => t.attached).length
  return { kind: 'markdown', bytes: bytes.length, comments: first.summary.threads.length, attached, listMs, saveMs, saveColdMs }
}

async function htmlTiming(): Promise<KindTiming> {
  const { text } = largeHtml()
  const bytes = encodeText(text)
  const doc = htmlKind.parse(text, 0) as CommentDocument
  const hash = (await import('../commentJobDocs')).sha256HexOf(bytes)
  const paragraphs = doc.index.elements.filter(el => el.tag === 'p')
  const targets = Array.from({ length: SAMPLES + WARM_UP }, (_, i) => paragraphs[Math.floor((i * paragraphs.length) / (SAMPLES + WARM_UP))])
  const first = await listOf(createInProcessCommentFileJobs(), bytes)
  const attached = first.summary.threads.filter(t => t.attached).length
  const listMs = await timed(async () => void (await listOf(createInProcessCommentFileJobs(), bytes)))
  const saveMs: number[] = []
  for (const [i, el] of targets.entries()) {
    const runner = createInProcessCommentFileJobs()
    // The draft is made when the element is picked, before Save: not timed.
    const draft = await runner.runJob(bytes, { kind: 'draft', entry: { startOffset: el.start, tagName: el.tag, fileHash: hash }, pick: { ws: 'collapse' } })
    if (draft.kind !== 'draft' || !draft.ok) throw new Error('html timing: no draft')
    const started = performance.now()
    const out = await writeOf(runner, bytes, { op: 'add', draft: { offset: draft.offset, fileHash: draft.fileHash, anchor: draft.anchor, ws: 'collapse' }, view: VIEW, text: 'Timing save.' })
    await listOf(runner, out)
    if (i >= WARM_UP) saveMs.push(Math.round((performance.now() - started) * 10) / 10)
  }
  return { kind: 'html', bytes: bytes.length, comments: first.summary.threads.length, attached, listMs, saveMs }
}

const row = (label: string, samples: readonly number[], budget: number): string =>
  `| ${label} | ${samples.length} | ${percentile(samples, 0.5)} ms | ${percentile(samples, 0.95)} ms | ${percentile(samples, 1)} ms | ${budget} ms |`

function electronVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')) as { version: string }).version
  } catch {
    return 'not installed'
  }
}

/**
 * The package conditions this run resolved with. Under vitest they include
 * `development`, which loads the micromark packages' debug builds (with
 * their assertions); the app's bundle loads the default ones.
 */
function packageConditions(): string {
  const conditions = process.execArgv.flatMap((arg, i, all) => (arg === '--conditions' || arg === '-C' ? [all[i + 1]] : arg.startsWith('--conditions=') ? [arg.slice('--conditions='.length)] : []))
  return conditions.length === 0 ? 'none' : conditions.join(', ')
}

/** The hand-kept section a rerun carries over from the report it replaces. */
function keptHistory(): string | undefined {
  if (!existsSync(REPORT)) return undefined
  const report = readFileSync(REPORT, 'utf8')
  const start = report.indexOf(HISTORY_START)
  const end = report.indexOf(HISTORY_END)
  return start < 0 || end < start ? undefined : report.slice(start, end + HISTORY_END.length)
}

function renderReport(summary: TimingSummary, history: string | undefined): string {
  const tables = summary.kinds.flatMap(k => [
    `### ${k.kind === 'markdown' ? 'Markdown' : 'HTML'} – ${k.bytes.toLocaleString('en')} bytes, ${k.comments} comments, ${k.attached} attached`,
    '',
    '| Measure | Samples | P50 | P95 | Max | Budget (P50 and P95) |',
    '|---|---|---|---|---|---|',
    row('list (cold parse) – floor of "pins visible"', k.listMs, PINS_BUDGET_MS),
    row('save (write + list) – floor of "saved comment visible"', k.saveMs, SAVE_BUDGET_MS),
    ...(k.saveColdMs === undefined ? [] : [row('save with no list before it (cold cache) – recorded only', k.saveColdMs, SAVE_BUDGET_MS)]),
    '',
    `Samples (ms): list ${k.listMs.join(', ')}; save ${k.saveMs.join(', ')}${k.saveColdMs === undefined ? '' : `; cold save ${k.saveColdMs.join(', ')}`}`,
    ''
  ])
  return [
    '<!-- SPDX-License-Identifier: GPL-3.0-only -->',
    '<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->',
    '',
    '# Large-file timing (024-NFR-001, 024-AC-024)',
    '',
    'Generated by `npm run test:timing` (`src/main/services/comments/corpus/largeFileTiming.test.ts`); do not edit by hand.',
    '',
    '## Run',
    '',
    `- Machine: ${platform()} ${release()}, ${cpus()[0]?.model ?? 'unknown CPU'} × ${cpus().length}`,
    `- Runtime: Node ${process.version} under vitest (the app's Electron is ${electronVersion()}; its bundled Node runs the same code in the parse worker)`,
    `- Package conditions: ${packageConditions()} (with \`development\`, the micromark packages load their debug builds, with assertions; the app's bundle loads the default builds)`,
    `- Date: ${summary.date}`,
    `- Fixtures: seeded, generated by \`largeFixtures.ts\` – about ${LARGE_FILE_BYTES.toLocaleString('en')} bytes with ${LARGE_FILE_COMMENTS} comments each`,
    '- Markdown comments sit on paragraphs and headings, as in the first run, so the runs compare',
    `- Samples: ${SAMPLES} per measure after ${WARM_UP} untimed warm-up runs`,
    '',
    '## What is timed',
    '',
    'The parse work of the comment parse worker, on the calling thread: a cold `list` job (fresh runner, no cached parse), and a save – the `write` job of one add, main\'s `assembleSplice`, then the `list` of the new file. Before a save the app has listed the file on the same worker – the HTML draft and the Markdown list run first, untimed – so a Markdown save plans on the cached parse; the Markdown save with no list before it is recorded on its own row. IPC, the worker message copy and the preview\'s drawing are **not** in these numbers, so they are a floor of the budgets, not the 024-AC-024 measurement itself. That one is the e2e timing between the renderer\'s `performance.mark` points in the built app (`commentTiming.ts`), recorded by `e2e/markdown-comments.timing.e2e.ts` for Markdown and `html-preview-comments.perf.e2e.ts` for HTML.',
    '',
    '## Results',
    '',
    ...tables,
    ...(history === undefined ? [] : [history, '']),
    '## macOS and Linux',
    '',
    '024-NFR-001 gates macOS and Linux and records Windows. The owner runs this on a Mac before merge (owner decision 2026-10-30), from the repository root on the pull request\'s final commit:',
    '',
    '```sh',
    'npm ci',
    'npm run test:timing',
    'npx vitest run --project main src/main/services/comments/corpus/largeFileTiming.test.ts',
    '```',
    '',
    'The first command rewrites this report with the Mac\'s numbers; the second runs the merge-time test, which gates P50 and P95 when the report comes from macOS or Linux.',
    '',
    '## Summary (machine-readable)',
    '',
    `${SUMMARY_START}\n${JSON.stringify(summary)}\n${SUMMARY_END}`,
    ''
  ].join('\n')
}

function readSummary(): TimingSummary {
  if (!existsSync(REPORT)) throw new Error('verification/large-file-timing.md is missing: run `npm run test:timing`')
  const report = readFileSync(REPORT, 'utf8')
  const start = report.indexOf(SUMMARY_START)
  const end = report.indexOf(SUMMARY_END)
  if (start < 0 || end < start) throw new Error('the timing report has no summary block')
  return JSON.parse(report.slice(start + SUMMARY_START.length, end)) as TimingSummary
}

describe.runIf(process.env.TIMING_RUN === '1')('large-file timing (measures, writes the report)', () => {
  it('times list and save on the 1 MB fixtures and writes verification/large-file-timing.md', async () => {
    const summary: TimingSummary = { platform: platform(), date: new Date().toISOString().slice(0, 10), kinds: [await markdownTiming(), await htmlTiming()] }
    writeFileSync(REPORT, renderReport(summary, keptHistory()))
  })
})

describe('024-AC-024 large-file timing report (merge-time)', () => {
  it('024-AC-024 both 1 MB fixtures hold 200 comments, every one attached, with 20 samples of list and save', () => {
    const summary = readSummary()
    expect(summary.kinds.map(k => k.kind)).toEqual(['markdown', 'html'])
    for (const k of summary.kinds) {
      expect(k.bytes, k.kind).toBeGreaterThanOrEqual(LARGE_FILE_BYTES * 0.95)
      expect(k.bytes, k.kind).toBeLessThanOrEqual(LARGE_FILE_BYTES * 1.25)
      expect(k.comments, k.kind).toBe(LARGE_FILE_COMMENTS)
      expect(k.attached, k.kind).toBe(LARGE_FILE_COMMENTS)
      expect(k.listMs, k.kind).toHaveLength(SAMPLES)
      expect(k.saveMs, k.kind).toHaveLength(SAMPLES)
    }
  })

  it('024-AC-024 on macOS and Linux, P50 and P95 are within 0.5 s (list) and 1 s (save); Windows is recorded only', () => {
    const summary = readSummary()
    if (summary.platform === 'win32') return
    for (const k of summary.kinds) {
      for (const p of [0.5, 0.95]) {
        expect(percentile(k.listMs, p), `${k.kind} list P${p * 100}`).toBeLessThanOrEqual(PINS_BUDGET_MS)
        expect(percentile(k.saveMs, p), `${k.kind} save P${p * 100}`).toBeLessThanOrEqual(SAVE_BUDGET_MS)
      }
    }
  })
})
