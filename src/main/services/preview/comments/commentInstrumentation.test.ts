// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment instrumentation for one preview view
 * (docs/designs/comments/html-preview-comments.md §3 "Raw vs instrumented bytes", §4.2,
 * §6, §18 logging; M-060 gates). The parse client is the real pipeline run
 * in-process, so a served copy here is exactly what the worker produces.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { encodeText } from '../../../../shared/htmlComments'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import { logger } from '../../LoggingService'
import { PREVIEW_WEB_PREFERENCES } from '../previewSessionPolicy'
import { BASE_PAGE, commentedPage } from './__test-helpers__/commentedPages'
import { instrumentDocument } from './commentParseCore'
import type { CommentParseResult } from '../../comments/CommentParseWorkerAdapter'
import type { CommentE2eSource } from './commentE2eHook'
import {
  createPreviewCommentServing,
  decideCommentServing,
  type CommentServeRequest,
  type PreviewCommentServingDeps
} from './commentInstrumentation'

vi.mock('../../LoggingService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const REAL_PATH = 'C:\\Users\\someone\\secret-project\\pages\\index.html'
const COMMENTED = Buffer.from(encodeText(commentedPage().text))
const PLAIN = Buffer.from(encodeText(BASE_PAGE))

function request(overrides: Partial<CommentServeRequest> = {}): CommentServeRequest {
  return {
    body: COMMENTED,
    ext: '.html',
    realPath: REAL_PATH,
    method: 'GET',
    noteType: 'mainFrame',
    requestClass: 'navigation',
    ...overrides
  }
}

/** A client that runs the real pipeline in-process, or answers `override` when given. */
function inProcessClient(override?: () => CommentParseResult) {
  return {
    instrument: vi.fn(async (bytes: Uint8Array) => override?.() ?? instrumentDocument(bytes)),
    warm: vi.fn()
  }
}

type RegisterE2e = (source: CommentE2eSource) => () => void

function serving(
  overrides: Partial<Omit<PreviewCommentServingDeps, 'client' | 'registerE2e'>> & {
    client?: ReturnType<typeof inProcessClient>
    registerE2e?: Mock<RegisterE2e>
  } = {}
) {
  const client = overrides.client ?? inProcessClient()
  const registerE2e = overrides.registerE2e ?? vi.fn<RegisterE2e>(() => vi.fn())
  const deps: PreviewCommentServingDeps = {
    isEnabled: () => true,
    ...overrides,
    client,
    registerE2e
  }
  return { serving: createPreviewCommentServing(deps), client, registerE2e }
}

const TOKEN_ATTRIBUTE = / data-erfana-el="[a-z2-7]{12}"/g
/** Not global: a `test` never depends on an earlier one. */
const HAS_TOKEN = / data-erfana-el="[a-z2-7]{12}"/

beforeEach(() => {
  vi.mocked(logger.warn).mockClear()
  vi.mocked(logger.error).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('decideCommentServing – M-060 gates', () => {
  const on = { enabled: true, commentMode: false }

  it('M-060 flag off → raw bytes, and the session policy keeps nodeIntegrationInSubFrames false', () => {
    expect(decideCommentServing(request(), { enabled: false, commentMode: true })).toEqual({
      action: 'raw'
    })
    // The flag-off half of the policy freeze (the flip itself lands with the preload, P4).
    expect(PREVIEW_WEB_PREFERENCES.nodeIntegrationInSubFrames).toBe(false)
  })

  it('M-060 a request that is not a document load → raw', () => {
    // A fetch or subresource carries user-agent: never instrumented, whatever its note says.
    expect(decideCommentServing(request({ requestClass: 'subresource' }), on)).toEqual({
      action: 'raw'
    })
    expect(
      decideCommentServing(request({ requestClass: 'subresource', noteType: 'xhr' }), on)
    ).toEqual({ action: 'raw' })
    // An <object>/<embed> document is header-less but is not a frame we comment in.
    expect(decideCommentServing(request({ noteType: 'object' }), on)).toEqual({ action: 'raw' })
    // HEAD, and a file that is not HTML.
    expect(decideCommentServing(request({ method: 'HEAD' }), on)).toEqual({ action: 'raw' })
    expect(decideCommentServing(request({ ext: '.svg' }), on)).toEqual({ action: 'raw' })
  })

  it('M-060 a header-less request without a document note → raw with the reason request-unknown', () => {
    expect(decideCommentServing(request({ noteType: undefined }), on)).toEqual({
      action: 'raw',
      reason: 'request-unknown'
    })
  })

  it('M-060 §19 Rev 4 up to 25 MB → instrumented; one byte more → raw with the reason too-large', () => {
    const atLimit = Buffer.alloc(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES, 0x20)
    atLimit.write('<!-- erfana:comment v1 -->', 0)
    expect(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES).toBe(25 * 1024 * 1024)
    expect(decideCommentServing(request({ body: atLimit }), on)).toEqual({ action: 'instrument', scope: 'page' })
    const big = Buffer.alloc(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES + 1, 0x20)
    big.write('<!-- erfana:comment v1 -->', 0)
    expect(decideCommentServing(request({ body: big }), on)).toEqual({
      action: 'raw',
      reason: 'too-large'
    })
    // A large file nobody expects comments in gets no reason at all.
    expect(decideCommentServing(request({ body: Buffer.alloc(big.length, 0x20) }), on)).toEqual({
      action: 'raw'
    })
  })

  it('M-060 no erfana:comment and comment mode off → raw; comment mode on → instrumented', () => {
    expect(decideCommentServing(request({ body: PLAIN }), on)).toEqual({ action: 'raw' })
    expect(
      decideCommentServing(request({ body: PLAIN }), { enabled: true, commentMode: true })
    ).toEqual({
      action: 'instrument',
      scope: 'page'
    })
  })

  it('a page load is instrumented as the page, a frame load as a frame (.htm too)', () => {
    expect(decideCommentServing(request(), on)).toEqual({ action: 'instrument', scope: 'page' })
    expect(decideCommentServing(request({ noteType: 'subFrame', ext: '.htm' }), on)).toEqual({
      action: 'instrument',
      scope: 'frame'
    })
  })
})

describe('createPreviewCommentServing', () => {
  it('M-030 serves a copy with a token on every element and leaves the read bytes untouched', async () => {
    const { serving: s } = serving()
    const before = Buffer.from(COMMENTED)
    const body = await s.bodyFor(request())

    expect(body?.toString('utf8')).toMatch(HAS_TOKEN)
    expect(body?.toString('utf8').replace(TOKEN_ATTRIBUTE, '')).toBe(COMMENTED.toString('utf8'))
    expect(COMMENTED.equals(before)).toBe(true)
  })

  it('registers each instrumented load under its real path and scope, blocks resolved to tokens', async () => {
    const { serving: s } = serving()
    await s.bodyFor(request())
    await s.bodyFor(request({ noteType: 'subFrame' }))

    const views = s.tokens.views()
    expect(views.map(v => [v.realPath, v.scope])).toEqual([
      [REAL_PATH, 'page'],
      [REAL_PATH, 'frame']
    ])
    expect(views[0].blocks).toHaveLength(3)
    expect(views[0].blocks.every(block => block.token !== undefined)).toBe(true)
  })

  it('serves raw bytes, unregistered, for every gate that says raw', async () => {
    const { serving: s, client } = serving()
    expect(await s.bodyFor(request({ body: PLAIN }))).toBe(PLAIN)
    expect(await s.bodyFor(request({ requestClass: 'subresource' }))).toBe(COMMENTED)
    expect(client.instrument).not.toHaveBeenCalled()
    expect(s.tokens.size).toBe(0)
    expect(s.unavailableReason(REAL_PATH)).toBeUndefined()
  })

  it('comment mode instruments a page without blocks', async () => {
    const { serving: s } = serving()
    s.setCommentMode(true)
    expect((await s.bodyFor(request({ body: PLAIN })))?.toString('utf8')).toMatch(HAS_TOKEN)
    s.setCommentMode(false)
    expect(await s.bodyFor(request({ body: PLAIN }))).toBe(PLAIN)
  })

  it('records why comments are unavailable, logs it as a code and a digest, and clears it on success', async () => {
    const failing = inProcessClient(() => ({ kind: 'failed', failure: 'timeout' }))
    const { serving: s } = serving({ client: failing })
    expect(await s.bodyFor(request())).toBe(COMMENTED)
    expect(s.unavailableReason(REAL_PATH)).toBe('parse-failed')

    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).toContain('parse-failed:timeout')
    expect(logged).not.toContain('secret-project')
    expect(logged).not.toContain('index.html')

    failing.instrument.mockImplementation(async bytes => instrumentDocument(bytes))
    await s.bodyFor(request())
    expect(s.unavailableReason(REAL_PATH)).toBeUndefined()
  })

  it('passes a worker refusal on as the reason, and the gate reasons too', async () => {
    const collision = Buffer.from(
      encodeText(
        commentedPage().text.replace('<main id="main">', '<main id="main" data-erfana-el="x">')
      )
    )
    const { serving: s } = serving()
    expect(await s.bodyFor(request({ body: collision }))).toBe(collision)
    expect(s.unavailableReason(REAL_PATH)).toBe('collision')

    await s.bodyFor(request({ realPath: 'B', noteType: undefined }))
    expect(s.unavailableReason('B')).toBe('request-unknown')
  })

  it(`remembers at most 64 files as unavailable, forgetting the oldest`, async () => {
    const { serving: s } = serving()
    for (let i = 0; i < 70; i += 1)
      await s.bodyFor(request({ realPath: `f${i}`, noteType: undefined }))
    expect(s.unavailableReason('f0')).toBeUndefined()
    expect(s.unavailableReason('f5')).toBeUndefined()
    expect(s.unavailableReason('f6')).toBe('request-unknown')
    expect(s.unavailableReason('f69')).toBe('request-unknown')
  })

  it('never throws into the handler: a failure inside serves the raw bytes and logs no path', async () => {
    const throwing = inProcessClient(() => {
      throw new Error(`EACCES: ${REAL_PATH}`)
    })
    const { serving: s } = serving({ client: throwing })
    expect(await s.bodyFor(request())).toBe(COMMENTED)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('a settings read that throws counts as off: no warm-up, raw bytes', async () => {
    const client = inProcessClient()
    const s = createPreviewCommentServing({
      isEnabled: () => {
        throw new Error('settings not loaded')
      },
      client,
      registerE2e: () => () => {}
    })
    expect(client.warm).not.toHaveBeenCalled()
    expect(await s.bodyFor(request())).toBe(COMMENTED)
  })

  it('warms the worker when the view opens with comments on, not when they are off', () => {
    expect(serving().client.warm).toHaveBeenCalledTimes(1)
    expect(serving({ isEnabled: () => false }).client.warm).not.toHaveBeenCalled()
  })

  it('dispose drops the tables, unregisters from the e2e hook and serves raw from then on', async () => {
    const unregister = vi.fn()
    const { serving: s, registerE2e } = serving({
      registerE2e: vi.fn<RegisterE2e>(() => unregister)
    })
    await s.bodyFor(request())
    expect(s.tokens.size).toBe(1)

    s.dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(s.tokens.size).toBe(0)
    expect(await s.bodyFor(request())).toBe(COMMENTED)
    expect(registerE2e).toHaveBeenCalledTimes(1)
  })

  it('a load that finishes after dispose is not registered', async () => {
    let finish: (result: CommentParseResult) => void = () => {}
    const client = inProcessClient()
    client.instrument.mockImplementation(
      () => new Promise<CommentParseResult>(resolve => (finish = resolve))
    )
    const { serving: s } = serving({ client })
    const pending = s.bodyFor(request())
    s.dispose()
    finish(instrumentDocument(COMMENTED))
    expect(await pending).toBe(COMMENTED)
    expect(s.tokens.size).toBe(0)
  })

  describe('§19 Rev 4 bytes lent to the worker', () => {
    /** A body with an ArrayBuffer of its own, as the handler's exact-size read gives. */
    const ownBuffer = (): Buffer => Buffer.from(new Uint8Array(COMMENTED).buffer)
    /** A client that takes the bytes as a transfer does: the caller's view is left empty. */
    function lendingClient(answer: (raw: Uint8Array) => CommentParseResult) {
      const client = inProcessClient()
      client.instrument.mockImplementation(async (bytes: Uint8Array) =>
        answer(structuredClone(bytes, { transfer: [bytes.buffer as ArrayBuffer] }))
      )
      return client
    }

    it('serves the bytes the worker handed back after a refusal', async () => {
      const body = ownBuffer()
      const { serving: s } = serving({ client: lendingClient(raw => ({ kind: 'unavailable', reason: 'collision', raw })) })
      const served = await s.bodyFor(request({ body }))
      expect(body.length).toBe(0)
      expect(served?.equals(COMMENTED)).toBe(true)
      expect(s.unavailableReason(REAL_PATH)).toBe('collision')
    })

    it('answers undefined – read the file again – when the lent bytes were lost with the worker', async () => {
      const { serving: s } = serving({ client: lendingClient(() => ({ kind: 'failed', failure: 'crashed' })) })
      expect(await s.bodyFor(request({ body: ownBuffer() }))).toBeUndefined()
      expect(s.unavailableReason(REAL_PATH)).toBe('parse-failed')
    })

    it('answers undefined after a throw that took the lent bytes', async () => {
      const { serving: s } = serving({
        client: lendingClient(() => {
          throw new Error('lost')
        })
      })
      expect(await s.bodyFor(request({ body: ownBuffer() }))).toBeUndefined()
      expect(logger.error).toHaveBeenCalledTimes(1)
    })
  })

  it('gives the e2e hook the view’s loads and unavailable files', async () => {
    const { serving: s, registerE2e } = serving()
    await s.bodyFor(request())
    await s.bodyFor(request({ realPath: 'gone', noteType: undefined }))
    const source = registerE2e.mock.calls[0][0]
    expect(source.views?.()).toHaveLength(1)
    expect(source.unavailable?.()).toEqual([{ realPath: 'gone', reason: 'request-unknown' }])
  })
})
