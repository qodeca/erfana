// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment parse worker shell and its message contract
 * (docs/designs/html-preview-comments.md §19 R3-12). The shell answers only
 * well-formed requests – an instrument request or a comment file job – only
 * when started in its role, transfers the result's buffers, and answers a
 * throw with `error` and no text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeText } from '../../../../shared/htmlComments'
import { fixedId } from '../../../../shared/htmlComments/__fixtures__/commentTestData'
import { buttonBlock } from './__test-helpers__/commentParseBench'
import { PAGE as WRITER_PAGE, draftFor, byId } from './__test-helpers__/commentWriterHarness'
import { CommentDocCache } from './commentJobDocs'
import * as core from './commentParseCore'
import {
  COMMENT_PARSE_WORKER_ROLE,
  isParseReply,
  isParseRequest,
  type CommentParseReply
} from './commentParseProtocol'
import {
  answerParseRequest,
  isCommentParseWorker,
  jobTransferablesOf,
  startCommentParseWorker,
  type CommentParsePort
} from './commentParseWorker'

const PAGE = encodeText('<!doctype html><p id="a">x</p><!-- erfana:comment v2 id=c-x\n-->')

/** A port that records every reply. */
function makePort(): CommentParsePort & {
  replies: Array<{ message: CommentParseReply; transfer?: ArrayBuffer[] }>
  listener?: (message: unknown) => void
} {
  const port = {
    replies: [] as Array<{ message: CommentParseReply; transfer?: ArrayBuffer[] }>,
    listener: undefined as ((message: unknown) => void) | undefined,
    on(_event: 'message', listener: (message: unknown) => void) {
      port.listener = listener
      return port
    },
    postMessage(message: CommentParseReply, transfer?: ArrayBuffer[]) {
      port.replies.push({ message, transfer })
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
    answerParseRequest(port, { type: 'instrument', id: 7, bytes: PAGE })

    expect(port.replies).toHaveLength(1)
    const { message, transfer } = port.replies[0]
    expect(message).toMatchObject({ type: 'result', id: 7, outcome: { kind: 'ok' } })
    expect(isParseReply(message)).toBe(true)
    const outcome = (message as Extract<CommentParseReply, { type: 'result' }>).outcome
    if (outcome.kind !== 'ok') throw new Error('expected ok')
    expect(transfer).toEqual([outcome.html.buffer, outcome.offsets.buffer, outcome.tagCodes.buffer])
  })

  it('transfers nothing with a refusal', () => {
    const port = makePort()
    answerParseRequest(port, { type: 'instrument', id: 1, bytes: Uint8Array.from([0xff, 0xfe]) })
    expect(port.replies[0]).toEqual({
      message: { type: 'result', id: 1, outcome: { kind: 'unavailable', reason: 'encoding' } },
      transfer: []
    })
  })

  it('answers a throw with error and no text', () => {
    vi.spyOn(core, 'instrumentDocument').mockImplementation(() => {
      throw new Error('secret page text')
    })
    const port = makePort()
    answerParseRequest(port, { type: 'instrument', id: 3, bytes: PAGE })
    expect(port.replies).toEqual([{ message: { type: 'error', id: 3 }, transfer: undefined }])
  })

  it('ignores anything that is not a well-formed request', () => {
    const port = makePort()
    for (const noise of [
      null,
      'instrument',
      { type: 'instrument', id: 1 },
      { type: 'instrument', id: 1.5, bytes: PAGE },
      { type: 'instrument', id: '1', bytes: PAGE },
      { type: 'other', id: 1, bytes: PAGE },
      { type: 'instrument', id: 1, bytes: [1, 2] }
    ]) {
      answerParseRequest(port, noise)
    }
    expect(port.replies).toEqual([])
  })

  it('answers a job with its result, from one document cache across requests', () => {
    const port = makePort()
    const cache = new CommentDocCache()
    const page = encodeText(WRITER_PAGE.replace('    <button', `    ${buttonBlock(1)}<button`))
    answerParseRequest(port, { type: 'job', id: 4, bytes: page, job: { kind: 'list' } }, cache)
    answerParseRequest(port, { type: 'job', id: 5, bytes: page, job: { kind: 'list' } }, cache)

    expect(port.replies.map(reply => reply.message)).toMatchObject([
      { type: 'job', id: 4, result: { kind: 'list', ok: true, summary: { threads: [{ threadId: fixedId('c-', 1) }] } } },
      { type: 'job', id: 5, result: { kind: 'list', ok: true } }
    ])
    expect(port.replies.every(reply => isParseReply(reply.message))).toBe(true)
    expect(port.replies[0].transfer).toEqual([])
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
    answerParseRequest(port, { type: 'job', id: 6, bytes, job }, new CommentDocCache())

    const { message, transfer } = port.replies[0]
    if (message.type !== 'job' || message.result.kind !== 'write' || !message.result.ok) throw new Error('expected a write')
    expect(transfer).toEqual([message.result.insert.buffer])

    // Block bytes that are a view into a larger buffer stay put; the message copies them.
    const shared = new Uint8Array(16)
    expect(jobTransferablesOf({ ...message.result, insert: shared.subarray(4, 8) })).toEqual([])
    expect(jobTransferablesOf({ kind: 'write', ok: false, refusal: 'conflict-markers' })).toEqual([])
  })

  it('starts listening on its port', () => {
    const port = makePort()
    startCommentParseWorker(port)
    port.listener!({ type: 'instrument', id: 2, bytes: PAGE })
    expect(port.replies[0].message).toMatchObject({ type: 'result', id: 2 })
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
  it('isParseRequest accepts exactly the request shape', () => {
    expect(isParseRequest({ type: 'instrument', id: 1, bytes: PAGE })).toBe(true)
    expect(
      isParseRequest({ type: 'instrument', id: Number.MAX_SAFE_INTEGER + 2, bytes: PAGE })
    ).toBe(false)
    for (const kind of ['draft', 'pin-blocks', 'list', 'write']) {
      expect(isParseRequest({ type: 'job', id: 1, bytes: PAGE, job: { kind } })).toBe(true)
    }
    for (const job of [undefined, null, 'list', { kind: 'other' }, {}]) {
      expect(isParseRequest({ type: 'job', id: 1, bytes: PAGE, job })).toBe(false)
    }
    expect(isParseRequest({ type: 'job', id: 1, job: { kind: 'list' } })).toBe(false)
  })

  it('isParseReply accepts a job answer of a known kind only', () => {
    expect(isParseReply({ type: 'job', id: 1, result: { kind: 'list', ok: false, refusal: 'encoding' } })).toBe(true)
    for (const result of [undefined, null, 'list', { kind: 'other' }]) {
      expect(isParseReply({ type: 'job', id: 1, result })).toBe(false)
    }
  })

  it('isParseReply checks the table is internally consistent', () => {
    const ok = core.instrumentDocument(PAGE)
    if (ok.kind !== 'ok') throw new Error('expected ok')
    expect(isParseReply({ type: 'result', id: 1, outcome: ok })).toBe(true)
    expect(isParseReply({ type: 'error', id: 1 })).toBe(true)
    expect(
      isParseReply({ type: 'result', id: 1, outcome: { kind: 'unavailable', reason: 'encoding' } })
    ).toBe(true)

    const broken: unknown[] = [
      null,
      { type: 'error' },
      { type: 'result', id: 1 },
      { type: 'result', id: 1, outcome: null },
      { type: 'result', id: 1, outcome: { kind: 'unavailable' } },
      { type: 'result', id: 1, outcome: { kind: 'other' } },
      { type: 'nope', id: 1 },
      { type: 'result', id: 1, outcome: { ...ok, tokens: ok.tokens.slice(1) } },
      { type: 'result', id: 1, outcome: { ...ok, offsets: Array.from(ok.offsets) } },
      { type: 'result', id: 1, outcome: { ...ok, tagCodes: new Uint32Array(0) } },
      { type: 'result', id: 1, outcome: { ...ok, html: 'text' } },
      { type: 'result', id: 1, outcome: { ...ok, fileHash: 1 } },
      { type: 'result', id: 1, outcome: { ...ok, tagNames: 'p' } },
      { type: 'result', id: 1, outcome: { ...ok, blocks: {} } }
    ]
    for (const reply of broken) expect(isParseReply(reply)).toBe(false)
  })
})
