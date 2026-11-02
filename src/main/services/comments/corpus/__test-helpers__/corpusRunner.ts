// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One corpus file through Erfana's writer (spec 024 024-NFR-003,
 * 024-AC-026): the write jobs the parse worker runs (`runWriteJob` with the
 * file's kind), on the calling thread, on the file's bytes – then main's
 * own steps: `isSafeInsert` on the block bytes and `assembleSplice` from the
 * bytes read. Nothing is written to disk.
 *
 * For each chosen target: add (Markdown: a pick, as the Markdown Preview
 * sends it; HTML: the `draft` job, then an `add` naming its draft, as the
 * HTML Preview does), then reply, edit, resolve and delete on that thread.
 * The oracle (`corpusOracle.ts`) checks every step; delete must give back
 * the original bytes. A refused add is counted by its refusal; a step after
 * an accepted add that is refused or fails a check is a failure.
 */
import { readFileSync } from 'node:fs'
import { seededRandom } from '../../../../../shared/comments/__fixtures__/commentTestData'
import { hashText } from '../../../../../shared/comments/blocks'
import { decodeLossless } from '../../../../../shared/comments/encoding'
import { htmlKind } from '../../../../../shared/comments/htmlKind'
import type { CommentAuthor, CommentView } from '../../../../../shared/comments/format'
import type { CommentDocument, IndexedElement } from '../../../../../shared/htmlComments'
import { pickOf } from '../../../../../shared/markdownComments/__test-helpers__/mdHarness'
import { markdownLimitBreach } from '../../../../../shared/markdownComments/markdownLimits'
import { markdownKind } from '../../../../../shared/markdownComments/markdownKind'
import type { MdIndex, MdTarget } from '../../../../../shared/markdownComments/mdIndex'
import { createInProcessCommentFileJobs, type HtmlFileJobRunner } from '../../../preview/comments/htmlCommentJobs'
import type { CommentFileJobRunner } from '../../commentFileJobs'
import { assembleSplice, isSafeInsert, type ThreadChange, type WriteJob, type WriteJobResult, type WritePlanRequest } from '../../commentWriteCore'
import { createInProcessMarkdownJobs } from '../../markdown/markdownCommentJobs'
import {
  addOutsideRangeProblem,
  blockRangeOf,
  changeOutsideRangeProblem,
  firstMessageId,
  frozenCount,
  renderDifferences,
  renderPrint,
  type RenderPrint
} from './corpusOracle'
import type { CorpusEntry } from './corpusSources'
import { chooseTargets, fileSeed, htmlTargetKind, markdownTargetKind, seededUnit } from './corpusTargets'

/** The made-up identity every corpus comment is written by (C20). */
export const CORPUS_AUTHOR: CommentAuthor = { name: 'Corpus Runner', email: 'corpus@example.invalid', role: 'human' }
/** The fixed clock of every corpus comment. */
export const CORPUS_NOW_MS = Date.UTC(2026, 9, 30, 12, 0, 0)
const VIEW: CommentView = { w: 900, h: 700, dpr: 2, x: 0, y: 0 }
const MESSAGE = 'Corpus round trip: please look at this.'
/**
 * Files larger than this are listed as not run instead of run in process
 * (`CORPUS_MAX_FILE_BYTES` overrides it). A draft on a large element's whole
 * text (an HTML `<body>`) collapses that text in time quadratic in its
 * length (`collapseRange`, reported with the run): a 20 MB page's `<body>`
 * would take hours. The production worker gives the same job 10 s plus 1 s
 * per MB and refuses it as timed out.
 */
export const CORPUS_MAX_FILE_BYTES = Number(process.env.CORPUS_MAX_FILE_BYTES ?? 8 * 1024 * 1024)

/** How a step that should have worked went wrong. */
export type FailureKind =
  | 'outside-range'
  | 'render'
  | 'frozen-reader'
  | 'delete-not-identity'
  | 'step-refused'
  | 'unsafe-insert'
  | 'limit-not-refused'
  | 'error'

/** One target's result. */
export interface TargetOutcome {
  readonly kind: string
  /** Where the block went: on its own lines (at column 0 or indented) or mid-line. */
  readonly shape?: 'own-lines' | 'own-lines-indented' | 'mid-line'
  readonly refusal?: string
  readonly failure?: { readonly kind: FailureKind; readonly detail: string }
  /** markdown-it saw a change the preview's pipeline did not. */
  readonly markdownItOnly?: true
  /** Markdown: v0.23.1's HTML parse of the file has no comment node at the block, so it cannot read it (`frozenCount`). */
  readonly frozenBlind?: true
  /** Time of the add's write job, in ms. */
  readonly addMs?: number
}

/** One file's result. */
export interface FileOutcome {
  readonly entry: CorpusEntry
  /** Refused as a whole before any target (too large, encoding, read-only, …). */
  readonly fileRefusal?: string
  /** Not run: why ({@link CORPUS_MAX_FILE_BYTES}). */
  readonly notRun?: string
  /** Which Markdown limit the file is past, when one. */
  readonly limitBreach?: string
  readonly targetsAvailable: number
  readonly targets: readonly TargetOutcome[]
  readonly failure?: { readonly kind: FailureKind; readonly detail: string }
  readonly ms: number
}

/** Both kinds' runners take the shared `list` and `write` jobs; HTML's also takes `draft`. */
type AnyRunner = CommentFileJobRunner
type Write = { ok: true; bytes: Uint8Array; text: string; result: Extract<WriteJobResult, { ok: true }> } | { ok: false; refusal: string; unsafe?: true }

const textOf = (bytes: Uint8Array): string => {
  const decoded = decodeLossless(bytes)
  if (!decoded.ok) throw new Error(`written bytes do not decode: ${decoded.reason}`)
  return decoded.text
}

async function write(runner: AnyRunner, bytes: Uint8Array, request: WritePlanRequest): Promise<Write> {
  const job: WriteJob = { kind: 'write', request, act: { author: CORPUS_AUTHOR, nowMs: CORPUS_NOW_MS } }
  const outcome = await runner.runJob(bytes, job)
  if (outcome.kind === 'failed') return { ok: false, refusal: `job-${outcome.failure}` }
  const result = outcome as WriteJobResult
  if (!result.ok) return { ok: false, refusal: result.refusal }
  if (!isSafeInsert(result.insert)) return { ok: false, refusal: 'unsafe-insert', unsafe: true }
  const out = assembleSplice(bytes, result)
  return { ok: true, bytes: out, text: textOf(out), result }
}

function shapeOf(text: string, id: string): TargetOutcome['shape'] {
  const [start, end] = blockRangeOf(text, id)!
  const lineStart = Math.max(text.lastIndexOf('\n', start - 1), text.lastIndexOf('\r', start - 1)) + 1
  const lead = text.slice(lineStart, start)
  if (!/^[ \t]*$/.test(lead) || !/^(?:\r\n|\r|\n)/.test(text.slice(end))) return 'mid-line'
  return lead === '' ? 'own-lines' : 'own-lines-indented'
}

const fail = (kind: FailureKind, detail: string): { failure: { kind: FailureKind; detail: string } } => ({ failure: { kind, detail } })

/** One thread change, checked; the new bytes, or the failure. */
async function change(runner: AnyRunner, bytes: Uint8Array, text: string, id: string, op: string, make: (block: string) => ThreadChange): Promise<Write | ReturnType<typeof fail>> {
  const range = blockRangeOf(text, id)
  if (range === undefined) return fail('outside-range', `${op}: the block is not found`)
  const block = text.slice(range[0], range[1])
  const next = await write(runner, bytes, { op: 'thread', threadId: id, rawHash: hashText(block), change: make(block) })
  if (!next.ok) return fail(next.unsafe ? 'unsafe-insert' : 'step-refused', `${op}: ${next.refusal}`)
  const problem = op === 'delete' ? null : changeOutsideRangeProblem(text, next.text, id)
  return problem === null ? next : fail('outside-range', `${op}: ${problem}`)
}

/** The thread changes after an add, in order; delete last. */
const STEPS: ReadonlyArray<readonly [string, (block: string) => ThreadChange]> = [
  ['reply', () => ({ op: 'reply', text: 'A reply from the corpus run.' })],
  ['edit', block => ({ op: 'editMessage', messageId: firstMessageId(block) ?? 'm-missing', text: 'Corpus round trip: edited.' })],
  ['resolve', () => ({ op: 'setStatus', status: 'resolved' })],
  ['delete', () => ({ op: 'deleteThread' })]
]

interface FileContext {
  readonly runner: AnyRunner
  readonly bytes: Uint8Array
  readonly text: string
  readonly kind: CorpusEntry['kind']
  readonly before: RenderPrint
  readonly frozen: ReturnType<typeof frozenCount>
  readonly md: Parameters<typeof renderPrint>[2]
}

/** Add, check, then every thread change and delete, on one target. */
async function roundTrip(ctx: FileContext, kind: string, add: () => Promise<Write | { ok: false; refusal: string }>): Promise<TargetOutcome> {
  const started = performance.now()
  const added = await add()
  const addMs = performance.now() - started
  if (!added.ok) return 'unsafe' in added && added.unsafe ? { kind, addMs, ...fail('unsafe-insert', 'add') } : { kind, addMs, refusal: added.refusal }
  const id = added.result.threadId!
  const shape = shapeOf(added.text, id)
  const outside = addOutsideRangeProblem(ctx.text, added.text, id)
  if (outside !== null) return { kind, shape, addMs, ...fail('outside-range', `add: ${outside}`) }
  const diffs = renderDifferences(ctx.before, renderPrint(added.text, ctx.kind, ctx.md))
  const writerDiffs = diffs.filter(d => d !== 'markdown-it')
  if (writerDiffs.length > 0) return { kind, shape, addMs, ...fail('render', `add: ${writerDiffs.join(', ')} changed`) }
  const frozen = frozenCount(added.text)
  // v0.23.1 reads every file as HTML; in Markdown the text before a block can hide it (`frozenCount`).
  // It then reads exactly what it read before. Never in an HTML file: there it would be a failure.
  const unseen = !frozen.commentStarts.has(blockRangeOf(added.text, id)![0])
  const blind = ctx.kind === 'markdown' && unseen && frozen.blocks === ctx.frozen.blocks && frozen.ok === ctx.frozen.ok
  if (!blind && (frozen.ok !== ctx.frozen.ok + 1 || frozen.blocks !== ctx.frozen.blocks + 1)) {
    return { kind, shape, addMs, ...fail('frozen-reader', `v0.23.1 reads ${frozen.ok}/${frozen.blocks} ok/blocks, was ${ctx.frozen.ok}/${ctx.frozen.blocks}`) }
  }
  let bytes = added.bytes
  let text = added.text
  for (const [op, make] of STEPS) {
    const next = await change(ctx.runner, bytes, text, id, op, make)
    if ('failure' in next) return { kind, shape, addMs, ...next }
    if (!next.ok) return { kind, shape, addMs, ...fail('step-refused', `${op}: ${next.refusal}`) }
    bytes = next.bytes
    text = next.text
  }
  if (Buffer.compare(Buffer.from(bytes), Buffer.from(ctx.bytes)) !== 0) return { kind, shape, addMs, ...fail('delete-not-identity', 'the bytes after delete differ from the original') }
  return { kind, shape, addMs, ...(diffs.includes('markdown-it') ? { markdownItOnly: true as const } : {}), ...(blind ? { frozenBlind: true as const } : {}) }
}

/** A whole-file refusal: the writer is asked once for an add and must refuse. */
async function refusalOf(runner: AnyRunner, bytes: Uint8Array, kind: CorpusEntry['kind']): Promise<string> {
  if (kind === 'markdown') {
    const added = await write(runner, bytes, { op: 'pick', pick: { lineStart: 1, lineEnd: 1, tag: 'p', ordinal: 1 }, view: VIEW, text: MESSAGE })
    return added.ok ? 'accepted' : added.refusal
  }
  const outcome = await (runner as unknown as HtmlFileJobRunner).runJob(bytes, { kind: 'draft', entry: { startOffset: 0, tagName: 'p', fileHash: '' }, pick: {} })
  return outcome.kind === 'draft' && !outcome.ok ? (outcome.refusal ?? 'not-here') : 'accepted'
}

async function markdownTargets(ctx: FileContext, random: () => number): Promise<{ available: number; targets: TargetOutcome[] }> {
  const doc = markdownKind.parse(ctx.text, ctx.text.startsWith('﻿') ? 1 : 0)
  const index = doc.index as MdIndex
  const chosen = chooseTargets<MdTarget>(index.elements, markdownTargetKind, random)
  const targets: TargetOutcome[] = []
  for (const target of chosen) {
    const pick = pickOf(doc, target)
    targets.push(await roundTrip(ctx, target.kind, () => write(ctx.runner, ctx.bytes, { op: 'pick', pick, view: VIEW, text: MESSAGE })))
  }
  return { available: index.elements.length, targets }
}

async function htmlTargets(ctx: FileContext, random: () => number, hash: string): Promise<{ available: number; targets: TargetOutcome[] }> {
  const doc = htmlKind.parse(ctx.text, ctx.text.startsWith('﻿') ? 1 : 0) as CommentDocument
  const chosen = chooseTargets<IndexedElement>(doc.index.elements, htmlTargetKind, random)
  const runner = ctx.runner as unknown as HtmlFileJobRunner
  const targets: TargetOutcome[] = []
  for (const el of chosen) {
    const ws = el.preformatted ? 'preserve' : 'collapse'
    targets.push(
      await roundTrip(ctx, htmlTargetKind(el), async () => {
        const draft = await runner.runJob(ctx.bytes, { kind: 'draft', entry: { startOffset: el.start, tagName: el.tag, fileHash: hash }, pick: { ws } })
        if (draft.kind !== 'draft' || !draft.ok) return { ok: false, refusal: `draft-${draft.kind === 'draft' ? (draft.refusal ?? 'not-here') : 'failed'}` }
        const target = { offset: draft.offset, fileHash: draft.fileHash, anchor: draft.anchor, ...(draft.ws === undefined ? {} : { ws: draft.ws }) }
        return write(runner, ctx.bytes, { op: 'add', draft: target, view: VIEW, text: MESSAGE })
      })
    )
  }
  return { available: doc.index.elements.length, targets }
}

/** Run one corpus file. Never throws: an exception is the file's failure. */
export async function runCorpusFile(entry: CorpusEntry, runSeed: number, md: FileContext['md']): Promise<FileOutcome> {
  const started = performance.now()
  const base = { entry, targetsAvailable: 0, targets: [] as TargetOutcome[] }
  const done = (rest: Partial<FileOutcome>): FileOutcome => ({ ...base, ...rest, ms: performance.now() - started })
  if (entry.bytes > CORPUS_MAX_FILE_BYTES) return done({ notRun: `larger than ${CORPUS_MAX_FILE_BYTES} bytes` })
  try {
    const bytes = new Uint8Array(readFileSync(entry.absolute))
    const seed = fileSeed(runSeed, entry.sha256)
    const runner: AnyRunner = entry.kind === 'markdown' ? createInProcessMarkdownJobs({ random: seededRandom(seed) }) : createInProcessCommentFileJobs({ random: seededRandom(seed) })
    const decoded = decodeLossless(bytes)
    if (!decoded.ok) return done({ fileRefusal: await refusalOf(runner, bytes, entry.kind) })
    const text = decoded.text
    const breach = entry.kind === 'markdown' ? markdownLimitBreach(text) : undefined
    if (breach !== undefined) {
      const refusal = await refusalOf(runner, bytes, entry.kind)
      return done({ limitBreach: breach, fileRefusal: refusal, ...(refusal === 'too-large' ? {} : fail('limit-not-refused', `past ${breach}, answered ${refusal}`)) })
    }
    const state = (entry.kind === 'markdown' ? markdownKind : htmlKind).parse(text, decoded.hasBom ? 1 : 0).state
    if (!state.writable) return done({ fileRefusal: await refusalOf(runner, bytes, entry.kind) })
    const ctx: FileContext = { runner, bytes, text, kind: entry.kind, before: renderPrint(text, entry.kind, md), frozen: frozenCount(text), md }
    const random = seededUnit(seed)
    const found = entry.kind === 'markdown' ? await markdownTargets(ctx, random) : await htmlTargets(ctx, random, entry.sha256)
    return done({ targetsAvailable: found.available, targets: found.targets })
  } catch (error) {
    return done(fail('error', error instanceof Error ? error.message.slice(0, 200) : 'unknown error'))
  }
}
