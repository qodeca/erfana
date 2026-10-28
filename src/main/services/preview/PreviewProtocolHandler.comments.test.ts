// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments through the real serving path
 * (docs/designs/comments/html-preview-comments.md §4.2, §6, §19 R3-1; M-030, M-031,
 * M-059, M-060, M-065, M-066, U-091 at the handler).
 *
 * The REAL request filter notes each request in the session's REAL ledger,
 * the REAL protocol handler confines and reads a REAL temporary project, and
 * the session's REAL comment context instruments the page. Only Electron's
 * session is faked (it captures the listeners `attach` installs), and the
 * parse worker runs the real pipeline in-process.
 *
 * Requests look the way Electron 44 hands them over (spike S1e): a document
 * load carries no `user-agent` header, every fetch and subresource does.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ELEMENT_TOKEN_ATTRIBUTE, indexHtml } from '../../../shared/htmlComments'
import { commentedPage } from './comments/__test-helpers__/commentedPages'
import { instrumentDocument } from './comments/commentParseCore'
import type { CommentParseResult } from './comments/CommentParseWorkerAdapter'
import { attach as attachHandler } from './PreviewProtocolHandler'
import { attach as attachFilter } from './PreviewRequestFilter'
import {
  buildPreviewSessionContexts,
  type PreviewSessionContexts,
  type PreviewSessionPageScopes
} from './previewSessionFilterContext'

vi.mock('../LoggingService', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const TOKEN = 'abc123abc123abc123abc123abc123ab'
const CSP = "default-src 'none'; sandbox allow-scripts"
const UA = { 'user-agent': 'Mozilla/5.0 Electron' }
const TOKEN_ATTRIBUTE = / data-erfana-el="[a-z2-7]{12}"/g
/** Not global: a `test` never depends on an earlier one. */
const HAS_TOKEN = / data-erfana-el="[a-z2-7]{12}"/

type FilterListener = (
  details: { id: number; url: string; resourceType: string },
  callback: (response: { cancel: boolean }) => void
) => void
type ErrorListener = (details: { id: number }) => void
type ProtocolListener = (request: GlobalRequest) => Promise<GlobalResponse>

let root: string
let enabled: boolean
let harness: ReturnType<typeof openSession>

function pageScopes(): PreviewSessionPageScopes {
  const page = { recordFailure: vi.fn(), frameRefusals: { record: vi.fn() } }
  return { committed: () => page, forMainDocument: () => page, recordViewFailure: vi.fn() }
}

type InstrumentClient = { instrument: (bytes: Uint8Array) => Promise<CommentParseResult>; warm: () => void }

/** One preview session over `root`: filter, ledger, handler and comment context. */
function openSession(
  client: InstrumentClient = { instrument: async bytes => instrumentDocument(bytes), warm: () => {} }
) {
  const contexts: PreviewSessionContexts = buildPreviewSessionContexts({
    token: TOKEN,
    resolve: host => (host === TOKEN ? { realRoot: root, csp: CSP } : null),
    getAllowedHosts: () => new Set<string>(),
    pageScopes,
    onBlocked: vi.fn(),
    comments: {
      isEnabled: () => enabled,
      client,
      registerE2e: () => () => {}
    }
  })
  const captured: { filter?: FilterListener; error?: ErrorListener; handler?: ProtocolListener } =
    {}
  const session = {
    webRequest: {
      onBeforeRequest: (listener: FilterListener | null) =>
        (captured.filter = listener ?? undefined),
      onCompleted: () => {},
      onErrorOccurred: (listener: ErrorListener | null) => (captured.error = listener ?? undefined)
    },
    protocol: {
      handle: (_scheme: string, listener: ProtocolListener) => (captured.handler = listener),
      unhandle: () => {}
    }
  } as unknown as Parameters<typeof attachFilter>[0]
  const detachFilter = attachFilter(session, contexts.filter)
  const detachHandler = attachHandler(session, contexts.protocol)
  let nextId = 0

  const url = (name: string): string => `erfana-preview://${TOKEN}/${name}`
  /** The filter's half: returns the webRequest id it noted. */
  const note = (name: string, resourceType: string): number => {
    const id = ++nextId
    captured.filter!({ id, url: url(name), resourceType }, () => {})
    return id
  }
  /** The handler's half; `subresource` requests carry `user-agent`. */
  const serve = (name: string, subresource = false): Promise<GlobalResponse> =>
    captured.handler!({
      url: url(name),
      method: 'GET',
      headers: new Headers(subresource ? UA : {}),
      destination: ''
    } as unknown as GlobalRequest)
  return {
    contexts,
    comments: contexts.comments!,
    note,
    serve,
    fail: (id: number) => captured.error!({ id }),
    /** A document load: noted as `resourceType`, served without `user-agent`. */
    loadDocument: async (name: string, resourceType = 'mainFrame') => {
      note(name, resourceType)
      return serve(name)
    },
    /** A fetch of `name`: noted as xhr, served with `user-agent`. */
    fetch: async (name: string) => {
      note(name, 'xhr')
      return serve(name, true)
    },
    close: () => {
      detachFilter()
      detachHandler()
    }
  }
}

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-hpc-')))
  writeFileSync(join(root, 'index.html'), commentedPage().text)
  writeFileSync(join(root, 'plain.html'), '<!doctype html><title>plain</title><p>no blocks</p>')
  enabled = true
  harness = openSession()
})

afterEach(() => {
  harness.close()
  rmSync(root, { recursive: true, force: true })
})

describe('the served page', () => {
  it('M-030 the served copy carries tokens; the file on disk keeps its bytes and mtime', async () => {
    const path = join(root, 'index.html')
    const before = readFileSync(path)
    const mtimeBefore = statSync(path).mtimeMs

    const response = await harness.loadDocument('index.html')
    const served = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe(CSP)
    expect(served).toMatch(HAS_TOKEN)
    expect(served.replace(TOKEN_ATTRIBUTE, '')).toBe(before.toString('utf8'))
    expect(readFileSync(path).equals(before)).toBe(true)
    expect(statSync(path).mtimeMs).toBe(mtimeBefore)
  })

  it('M-031 the table maps each served token to its start tag in the file on disk', async () => {
    const served = await (await harness.loadDocument('index.html')).text()
    const [load] = harness.comments.tokens.views()
    const original = readFileSync(join(root, 'index.html'), 'utf8')
    const originalIndex = indexHtml(original)

    expect(load.realPath).toBe(realpathSync.native(join(root, 'index.html')))
    for (const el of indexHtml(served).elements) {
      const token = el.node.attrs.find(a => a.name === ELEMENT_TOKEN_ATTRIBUTE)!.value
      const entry = harness.comments.tokens.lookup(load.loadId, token)!
      expect(original[entry.startOffset]).toBe('<')
      expect(originalIndex.elementAt(entry.startOffset)?.tag).toBe(el.tag)
      expect(entry.tagName).toBe(el.tag)
    }
  })

  it('every pre-seeded block resolves to the token of its own element in the served copy', async () => {
    const { targets } = commentedPage()
    const served = indexHtml(await (await harness.loadDocument('index.html')).text())
    const [load] = harness.comments.tokens.views()

    expect(load.blocks).toHaveLength(targets.size)
    for (const block of load.blocks) {
      const el = served.elements.find(e =>
        e.node.attrs.some(a => a.name === ELEMENT_TOKEN_ATTRIBUTE && a.value === block.token)
      )
      expect(el?.id).toBe(targets.get(block.id!))
    }
  })

  it('M-059 the same file as the page and inside a frame gets two tables', async () => {
    await harness.loadDocument('index.html', 'mainFrame')
    await harness.loadDocument('index.html', 'subFrame')
    const loads = harness.comments.tokens.views()
    expect(loads.map(l => l.scope)).toEqual(['page', 'frame'])
    expect(loads[0].realPath).toBe(loads[1].realPath)
    expect(loads[0].loadId).not.toBe(loads[1].loadId)
  })

  it('U-091 (handler) a source that already carries data-erfana-el is served raw', async () => {
    const page = commentedPage().text.replace(
      '<main id="main">',
      '<main id="main" data-erfana-el="x">'
    )
    writeFileSync(join(root, 'index.html'), page)
    expect(await (await harness.loadDocument('index.html')).text()).toBe(page)
    expect(harness.comments.unavailableReason(realpathSync.native(join(root, 'index.html')))).toBe(
      'collision'
    )
  })
})

describe('M-060 – what is served raw', () => {
  it('flag off: raw bytes, no table', async () => {
    enabled = false
    const response = await harness.loadDocument('index.html')
    expect(await response.text()).toBe(commentedPage().text)
    expect(harness.comments.tokens.size).toBe(0)
  })

  it('a fetch of the page (user-agent, xhr note) gets raw bytes', async () => {
    expect(await (await harness.fetch('index.html')).text()).toBe(commentedPage().text)
    expect(harness.comments.tokens.size).toBe(0)
  })

  it('a page without erfana:comment, comment mode off: raw', async () => {
    expect(await (await harness.loadDocument('plain.html')).text()).not.toMatch(HAS_TOKEN)
    harness.comments.setCommentMode(true)
    expect(await (await harness.loadDocument('plain.html')).text()).toMatch(HAS_TOKEN)
  })

  it('a stylesheet or script request never gets tokens, even for an .html file', async () => {
    harness.note('index.html', 'script')
    expect(await (await harness.serve('index.html', true)).text()).not.toMatch(HAS_TOKEN)
  })
})

describe('the ledger fix (S1e, R3-1)', () => {
  it('M-065 a page fetching its own URL during 30 reloads: 30 of 30 documents instrumented, no fetch', async () => {
    let instrumented = 0
    let fetchesWithTokens = 0
    for (let reload = 0; reload < 30; reload += 1) {
      // In flight when the reload hits: two fetches the reload aborts (one
      // reports onErrorOccurred, one never does) and one that completes later.
      const aborted = harness.note('index.html', 'xhr')
      harness.note('index.html', 'xhr')
      harness.fail(aborted)
      harness.note('index.html', 'xhr')
      // The reload's document request, then the surviving fetch.
      const page = await harness.loadDocument('index.html')
      const fetched = await harness.serve('index.html', true)
      if (HAS_TOKEN.test(await page.text())) instrumented += 1
      if (HAS_TOKEN.test(await fetched.text())) fetchesWithTokens += 1
    }
    expect(instrumented).toBe(30)
    expect(fetchesWithTokens).toBe(0)
  })

  it('M-066 a request that fails before the handler drops its note', async () => {
    const id = harness.note('index.html', 'mainFrame')
    harness.fail(id)
    // The same URL now arrives with no note at all: unknown, served raw.
    expect(await (await harness.serve('index.html')).text()).not.toMatch(HAS_TOKEN)
    expect(harness.comments.unavailableReason(realpathSync.native(join(root, 'index.html')))).toBe(
      'request-unknown'
    )
    // A failure after the handler took the note finds nothing to drop.
    const taken = harness.note('index.html', 'mainFrame')
    expect(await (await harness.serve('index.html')).text()).toMatch(HAS_TOKEN)
    expect(() => harness.fail(taken)).not.toThrow()
  })
})

describe('§19 Rev 4 bytes lent to the parse worker', () => {
  /** A worker that took the bytes as a transfer and died with them: the handler's view is empty. */
  function losingClient(before: () => void = () => {}): InstrumentClient {
    return {
      instrument: async bytes => {
        structuredClone(bytes.buffer, { transfer: [bytes.buffer as ArrayBuffer] })
        before()
        return { kind: 'failed', failure: 'crashed' }
      },
      warm: () => {}
    }
  }

  it('reads the file again and serves it raw when the worker lost the bytes it was lent', async () => {
    harness.close()
    harness = openSession(losingClient())
    const response = await harness.loadDocument('index.html')
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer()).equals(readFileSync(join(root, 'index.html')))).toBe(true)
    expect(harness.comments.unavailableReason(realpathSync.native(join(root, 'index.html')))).toBe('parse-failed')
  })

  it('answers 503 when the file cannot be read again either', async () => {
    harness.close()
    harness = openSession(losingClient(() => rmSync(join(root, 'index.html'))))
    expect((await harness.loadDocument('index.html')).status).toBe(503)
  })
})

describe('lifecycle', () => {
  it('detaching the handler disposes the session’s comment state', async () => {
    await harness.loadDocument('index.html')
    expect(harness.comments.tokens.size).toBe(1)
    harness.close()
    expect(harness.comments.tokens.size).toBe(0)
    // afterEach closes again: detaching twice is harmless.
  })

  it('a session without comment deps has no comment context and serves raw', () => {
    const contexts = buildPreviewSessionContexts({
      token: TOKEN,
      resolve: () => null,
      getAllowedHosts: () => new Set<string>(),
      pageScopes,
      onBlocked: vi.fn()
    })
    expect(contexts.comments).toBeUndefined()
    expect(contexts.protocol.comments).toBeUndefined()
    expect(harness.contexts.protocol.comments).toBe(harness.contexts.comments)
  })
})
