// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment parse worker's shared runner and its message contract
 * (docs/designs/comments/html-preview-comments.md §19 R3-12; spec 024
 * architecture note 001 § 8 C22). The runner answers only well-formed
 * requests for a job a registered file kind's table names – here the HTML
 * kind's, as the worker entry registers it – transfers the buffers the job
 * names, and answers a throw with `error` and no text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeText } from '../../../shared/htmlComments'
import { fixedId } from '../../../shared/comments/__fixtures__/commentTestData'
import { buttonBlock } from '../preview/comments/__test-helpers__/commentParseBench'
import { PAGE as WRITER_PAGE, draftFor, byId } from '../preview/comments/__test-helpers__/commentWriterHarness'
import { htmlCommentJobTable, type InstrumentJobResult } from '../preview/comments/htmlCommentJobs'
import { isInstrumentOutcome } from '../preview/comments/htmlCommentParseClient'
import { commentWorkerJobs } from '../workers/comment-parse.worker'
import { CommentDocCache, sha256HexOf } from './commentJobDocs'
import type { WriteJobResult } from './commentWriteCore'
import * as core from '../preview/comments/commentParseCore'
import {
  COMMENT_PARSE_WORKER_ROLE,
  MAX_POISONED_HASHES,
  isParseBegin,
  isParseReply,
  isParseRequest,
  type CommentParseBegin,
  type CommentParseReply
} from './commentParseProtocol'
import {
  answerParseRequest,
  isCommentParseWorker,
  rawTransferablesOf,
  startCommentParseWorker,
  type CommentParsePort,
  type CommentParseWorkerContext
} from './commentParseWorker'

const PAGE = encodeText('<!doctype html><p id="a">x</p><!-- erfana:comment v2 id=c-x\n-->')
const JOBS = commentWorkerJobs()

/** The worker's context: every registered kind's jobs, and `cache`. */
const contextWith = (cache = new CommentDocCache()): CommentParseWorkerContext => ({ jobs: JOBS, cache })

/** A request to instrument `bytes` as an HTML page. */
const instrumentRequest = (id: number, bytes: unknown) => ({ type: 'job', id, fileKind: 'html', bytes, job: { kind: 'instrument' } })

/** The outcome an instrument reply carries. */
function outcomeOf(message: CommentParseReply): core.InstrumentOutcome {
  if (message.type !== 'job') throw new Error('expected a job answer')
  return (message.result as InstrumentJobResult).outcome
}

/** A port that records every reply, and apart from them every `begin` (S-M). */
function makePort(): CommentParsePort & {
  replies: Array<{ message: CommentParseReply; transfer?: ArrayBuffer[] }>
  begins: CommentParseBegin[]
  listener?: (message: unknown) => void
} {
  const port = {
    replies: [] as Array<{ message: CommentParseReply; transfer?: ArrayBuffer[] }>,
    begins: [] as CommentParseBegin[],
    listener: undefined as ((message: unknown) => void) | undefined,
    on(_event: 'message', listener: (message: unknown) => void) {
      port.listener = listener
      return port
    },
    postMessage(message: CommentParseReply | CommentParseBegin, transfer?: ArrayBuffer[]) {
      if (message.type === 'begin') port.begins.push(message)
      else port.replies.push({ message, transfer })
    }
  }
  return port
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('commentParseWorker', () => {
  it('answers an instrument request with the outcome and transfers its buffers', () => {
    const port = makePort()
    answerParseRequest(port, instrumentRequest(7, PAGE), contextWith())

    expect(port.replies).toHaveLength(1)
    const { message, transfer } = port.replies[0]
    expect(message).toMatchObject({ type: 'job', id: 7, result: { kind: 'instrument', outcome: { kind: 'ok' } } })
    expect(isParseReply(message)).toBe(true)
    const outcome = outcomeOf(message)
    if (outcome.kind !== 'ok') throw new Error('expected ok')
    // §19 Rev 4: the request's own bytes go back too – main may have lent them.
    expect(message.raw).toBe(PAGE)
    expect(transfer).toEqual([outcome.html.buffer, outcome.offsets.buffer, outcome.lines.buffer, outcome.tagCodes.buffer, PAGE.buffer])
  })

  it('transfers only the bytes it was sent back with a refusal', () => {
    const port = makePort()
    const bytes = Uint8Array.from([0xff, 0xfe])
    answerParseRequest(port, instrumentRequest(1, bytes), contextWith())
    expect(port.replies[0]).toEqual({
      message: { type: 'job', id: 1, result: { kind: 'instrument', outcome: { kind: 'unavailable', reason: 'encoding' } }, raw: bytes },
      transfer: [bytes.buffer]
    })
  })

  it('answers a throw with error and no text – and the bytes it was sent', () => {
    vi.spyOn(core, 'instrumentDocument').mockImplementation(() => {
      throw new Error('secret page text')
    })
    const port = makePort()
    answerParseRequest(port, instrumentRequest(3, PAGE), contextWith())
    expect(port.replies).toEqual([{ message: { type: 'error', id: 3, raw: PAGE }, transfer: [PAGE.buffer] }])
  })

  it('§19 Rev 4 moves the bytes back when they own their buffer, and copies a view into a larger one', () => {
    const own = new Uint8Array(8)
    expect(rawTransferablesOf(own)).toEqual([own.buffer])
    expect(rawTransferablesOf(own.subarray(2, 6))).toEqual([])
    expect(rawTransferablesOf(own.subarray(0, 4))).toEqual([])
  })

  it('ignores anything that is not a well-formed request for a registered job', () => {
    const port = makePort()
    for (const noise of [
      null,
      'instrument',
      { type: 'job', id: 1, fileKind: 'html', job: { kind: 'instrument' } },
      instrumentRequest(1.5, PAGE),
      instrumentRequest('1' as unknown as number, PAGE),
      { ...instrumentRequest(1, PAGE), type: 'other' },
      // The shape before the C22 split: no file kind, no job.
      { type: 'instrument', id: 1, bytes: PAGE },
      instrumentRequest(1, [1, 2]),
      { ...instrumentRequest(1, PAGE), fileKind: undefined },
      { ...instrumentRequest(1, PAGE), fileKind: 'markdown' },
      { ...instrumentRequest(1, PAGE), job: { kind: '__proto__' } },
      { ...instrumentRequest(1, PAGE), job: { kind: 'toString' } }
    ]) {
      answerParseRequest(port, noise, contextWith())
    }
    expect(port.replies).toEqual([])
    expect(port.begins).toEqual([])
  })

  it('answers a job with its result, from one document cache across requests', () => {
    const port = makePort()
    const cache = new CommentDocCache()
    const page = encodeText(WRITER_PAGE.replace('    <button', `    ${buttonBlock(1)}<button`))
    answerParseRequest(port, { type: 'job', id: 4, fileKind: 'html', bytes: page, job: { kind: 'list' } }, contextWith(cache))
    answerParseRequest(port, { type: 'job', id: 5, fileKind: 'html', bytes: page, job: { kind: 'list' } }, contextWith(cache))

    expect(port.replies.map(reply => reply.message)).toMatchObject([
      { type: 'job', id: 4, result: { kind: 'list', ok: true, summary: { threads: [{ threadId: fixedId('c-', 1) }] } } },
      { type: 'job', id: 5, result: { kind: 'list', ok: true } }
    ])
    expect(port.replies.every(reply => isParseReply(reply.message))).toBe(true)
    expect(port.replies[0].transfer).toEqual([page.buffer])
    expect(port.replies[0].message.raw).toBe(page)
    expect(cache.size).toBe(1)
  })

  it('transfers the block bytes of a write answer', () => {
    const port = makePort()
    const bytes = encodeText(WRITER_PAGE)
    const job = {
      kind: 'write' as const,
      request: { op: 'add' as const, draft: draftFor(bytes, byId('buy')), view: { w: 800, h: 600, dpr: 1, x: 0, y: 0 }, text: 'Hi' },
      act: { author: { name: 'Ada', role: 'human' as const }, nowMs: Date.UTC(2026, 9, 25) }
    }
    answerParseRequest(port, { type: 'job', id: 6, fileKind: 'html', bytes, job }, contextWith())

    const { message, transfer } = port.replies[0]
    if (message.type !== 'job') throw new Error('expected a job answer')
    const result = message.result as WriteJobResult
    if (result.kind !== 'write' || !result.ok) throw new Error('expected a write')
    expect(transfer).toEqual([result.insert.buffer, bytes.buffer])

    // Block bytes that are a view into a larger buffer stay put; the message copies them.
    const jobTransferablesOf = htmlCommentJobTable.write.transferables
    const shared = new Uint8Array(16)
    expect(jobTransferablesOf?.({ ...result, insert: shared.subarray(4, 8) })).toEqual([])
    expect(jobTransferablesOf?.({ kind: 'write', ok: false, refusal: 'conflict-markers' })).toEqual([])
  })

  it('starts listening on its port, with the jobs it is given', () => {
    const port = makePort()
    startCommentParseWorker(port, JOBS)
    port.listener!(instrumentRequest(2, PAGE))
    expect(port.replies[0].message).toMatchObject({ type: 'job', id: 2 })
  })

  it('S-M names the content before any work, and answers "poisoned" for a content that stopped a worker – without parsing it', () => {
    const port = makePort()
    const instrument = vi.spyOn(core, 'instrumentDocument')
    const hash = sha256HexOf(PAGE)
    answerParseRequest(port, instrumentRequest(3, PAGE), contextWith())
    expect(port.begins).toEqual([{ type: 'begin', id: 3, hash }])
    expect(isParseBegin(port.begins[0])).toBe(true)
    expect(instrument).toHaveBeenCalledTimes(1)

    const again = new Uint8Array(PAGE)
    answerParseRequest(port, { ...instrumentRequest(4, again), poisoned: ['0'.repeat(64), hash] }, contextWith())
    expect(port.begins.at(-1)).toEqual({ type: 'begin', id: 4, hash })
    expect(port.replies.at(-1)).toEqual({ message: { type: 'poisoned', id: 4, raw: again }, transfer: [again.buffer] })
    expect(isParseReply(port.replies.at(-1)!.message)).toBe(true)
    expect(instrument).toHaveBeenCalledTimes(1)
    // A job of the same bytes is not parsed either.
    answerParseRequest(port, { type: 'job', id: 5, fileKind: 'html', bytes: new Uint8Array(PAGE), job: { kind: 'list' }, poisoned: [hash] }, contextWith())
    expect(port.replies.at(-1)!.message).toMatchObject({ type: 'poisoned', id: 5 })
  })

  it('S-M a poison list is a short list of content hashes, and a begin names one', () => {
    const request = instrumentRequest(1, PAGE)
    expect(isParseRequest({ ...request, poisoned: [] }, JOBS)).toBe(true)
    expect(isParseRequest({ ...request, poisoned: ['a'.repeat(64)] }, JOBS)).toBe(true)
    expect(isParseRequest({ ...request, poisoned: 'a'.repeat(64) }, JOBS)).toBe(false)
    expect(isParseRequest({ ...request, poisoned: ['A'.repeat(64)] }, JOBS)).toBe(false)
    expect(isParseRequest({ ...request, poisoned: Array(MAX_POISONED_HASHES + 1).fill('a'.repeat(64)) }, JOBS)).toBe(false)
    expect(isParseBegin({ type: 'begin', id: 1, hash: 'a'.repeat(64) })).toBe(true)
    expect(isParseBegin({ type: 'begin', id: 1, hash: 'x' })).toBe(false)
    expect(isParseBegin({ type: 'begin', id: 'one', hash: 'a'.repeat(64) })).toBe(false)
    expect(isParseBegin(null)).toBe(false)
    // A begin is not a reply: it settles nothing.
    expect(isParseReply({ type: 'begin', id: 1, hash: 'a'.repeat(64) })).toBe(false)
  })

  it('starts only in its own role, with a port', () => {
    const port = {}
    expect(isCommentParseWorker({ role: COMMENT_PARSE_WORKER_ROLE }, port)).toBe(true)
    expect(isCommentParseWorker({ role: 'vitest' }, port)).toBe(false)
    expect(isCommentParseWorker(undefined, port)).toBe(false)
    expect(isCommentParseWorker(null, port)).toBe(false)
    expect(isCommentParseWorker({ role: COMMENT_PARSE_WORKER_ROLE }, null)).toBe(false)
  })
})

describe('commentParseProtocol', () => {
  it('isParseRequest accepts exactly the request shape, for a job a registered kind names', () => {
    expect(isParseRequest(instrumentRequest(1, PAGE), JOBS)).toBe(true)
    expect(isParseRequest(instrumentRequest(Number.MAX_SAFE_INTEGER + 2, PAGE), JOBS)).toBe(false)
    for (const kind of ['instrument', 'draft', 'pin', 'list', 'write']) {
      expect(isParseRequest({ type: 'job', id: 1, fileKind: 'html', bytes: PAGE, job: { kind } }, JOBS)).toBe(true)
    }
    for (const job of [undefined, null, 'list', { kind: 'other' }, {}, { kind: 1 }]) {
      expect(isParseRequest({ type: 'job', id: 1, fileKind: 'html', bytes: PAGE, job }, JOBS)).toBe(false)
    }
    expect(isParseRequest({ type: 'job', id: 1, fileKind: 'html', job: { kind: 'list' } }, JOBS)).toBe(false)
    for (const fileKind of [undefined, 1, 'markdown', '']) {
      expect(isParseRequest({ type: 'job', id: 1, fileKind, bytes: PAGE, job: { kind: 'list' } }, JOBS)).toBe(false)
    }
  })

  it('isParseReply accepts a job answer that names a job only', () => {
    expect(isParseReply({ type: 'job', id: 1, result: { kind: 'list', ok: false, refusal: 'encoding' } })).toBe(true)
    // Whether it names the job ASKED is the client's check (CommentParseWorkerAdapter.test.ts).
    for (const result of [undefined, null, 'list', {}, { kind: 1 }]) {
      expect(isParseReply({ type: 'job', id: 1, result })).toBe(false)
    }
  })

  it('§19 Rev 4 isParseReply accepts handed-back bytes only as a Uint8Array, on every reply type', () => {
    const raw = new Uint8Array(4)
    const job = { kind: 'list', ok: false, refusal: 'encoding' }
    const refusal = { kind: 'instrument', outcome: { kind: 'unavailable', reason: 'encoding' } }
    expect(isParseReply({ type: 'error', id: 1, raw })).toBe(true)
    expect(isParseReply({ type: 'job', id: 1, result: job, raw })).toBe(true)
    expect(isParseReply({ type: 'job', id: 1, result: refusal, raw })).toBe(true)
    for (const bad of [[1, 2], 'bytes', null, raw.buffer]) {
      expect(isParseReply({ type: 'error', id: 1, raw: bad })).toBe(false)
      expect(isParseReply({ type: 'job', id: 1, result: job, raw: bad })).toBe(false)
      expect(isParseReply({ type: 'job', id: 1, result: refusal, raw: bad })).toBe(false)
    }
  })

  it('the HTML instrument check accepts a consistent table or a refusal with a reason only', () => {
    const ok = core.instrumentDocument(PAGE)
    if (ok.kind !== 'ok') throw new Error('expected ok')
    expect(isInstrumentOutcome(ok)).toBe(true)
    expect(isParseReply({ type: 'error', id: 1 })).toBe(true)
    expect(isInstrumentOutcome({ kind: 'unavailable', reason: 'encoding' })).toBe(true)

    expect(isParseReply(null)).toBe(false)
    expect(isParseReply({ type: 'error' })).toBe(false)
    expect(isParseReply({ type: 'job', id: 1 })).toBe(false)
    expect(isParseReply({ type: 'nope', id: 1 })).toBe(false)
    const broken: unknown[] = [
      undefined,
      null,
      { kind: 'unavailable' },
      { kind: 'other' },
      { ...ok, tokens: ok.tokens.slice(1) },
      { ...ok, offsets: Array.from(ok.offsets) },
      { ...ok, tagCodes: new Uint32Array(0) },
      { ...ok, lines: new Uint32Array(0) },
      { ...ok, lines: Array.from(ok.lines) },
      { ...ok, html: 'text' },
      { ...ok, fileHash: 1 },
      { ...ok, tagNames: 'p' },
      { ...ok, blocks: {} }
    ]
    for (const outcome of broken) expect(isInstrumentOutcome(outcome)).toBe(false)
  })
})
