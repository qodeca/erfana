// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the `erfana-preview://` protocol handler (Issue #74, work item 20;
 * design §2.4, §2.6, §7 test rows 6 + 7b; issue #124 WI-12, design part 2 §2.2).
 *
 * Covers: a revoked/unknown token ⇒ 404; a served file carries the CSP from the
 * registry entry; a CSP missing `sandbox allow-scripts` ⇒ 500 + a `csp-missing`
 * badge; an octet-stream fallthrough for a script or style request ⇒ an
 * `unsupported-asset-type` badge (still 200); a refused main-frame document
 * badged on the page it belongs to; a refused subframe listed as a frame
 * refusal; and that the handler registers on the PASSED session's `protocol`,
 * not the global one.
 *
 * Requests look the way Electron 39 really hands them over: no `sec-fetch-dest`
 * header and an empty `destination` (spike S1). The request kind comes from a
 * note the request filter leaves in the session's ledger, so these tests note
 * what the filter would have noted – they no longer fake the header (§5.2).
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW } from '../../../shared/constants'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import type { PreviewFrameRefusalType } from './previewFrameRefusals'
import {
  attach,
  type PreviewProtocolContext,
  type PreviewRootEntryLike
} from './PreviewProtocolHandler'
import {
  createPreviewRequestKindLedger,
  type PreviewRequestKindLedger
} from './PreviewRequestKindLedger'

// A per-file `electron` mock exposing a global `protocol.handle` spy, so the test
// can assert the handler NEVER touches the global protocol (it must register on
// the passed session's protocol instead).
const globalProtocolHandle = vi.fn()
vi.mock('electron', () => ({
  protocol: { handle: globalProtocolHandle, unhandle: vi.fn() }
}))

/** The handler signature `session.protocol.handle` receives. */
type ProtocolListener = (request: GlobalRequest) => Promise<GlobalResponse>

/** A fake partition session whose `protocol.handle` captures the listener. */
function makeSession(): {
  session: Parameters<typeof attach>[0]
  handle: ReturnType<typeof vi.fn>
  unhandle: ReturnType<typeof vi.fn>
} {
  const handle = vi.fn<(scheme: string, listener: ProtocolListener) => void>()
  const unhandle = vi.fn<(scheme: string) => void>()
  const session = { protocol: { handle, unhandle } }
  return { session: session as unknown as Parameters<typeof attach>[0], handle, unhandle }
}

/**
 * A request as Electron 39 hands it to `protocol.handle`: no `sec-fetch-dest`
 * and an empty `destination` (S1, 11 of 11 cases). `headers` exists only to pin
 * that a header is no longer read.
 */
function makeRequest(
  url: string,
  opts: { method?: string; headers?: Record<string, string> } = {}
): GlobalRequest {
  return {
    url,
    method: opts.method ?? 'GET',
    headers: new Headers(opts.headers),
    destination: ''
  } as unknown as GlobalRequest
}

const VALID_CSP = "default-src 'none'; sandbox allow-scripts"
const INVALID_CSP = "default-src 'self'; img-src *"
const TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef'
const BASE = `erfana-preview://${TOKEN}`

let root: string
let ledger: PreviewRequestKindLedger
let recordFailure: ReturnType<typeof vi.fn<(input: PreviewFailureInput) => void>>
let recordDocumentFailure: ReturnType<typeof vi.fn<(input: PreviewFailureInput) => void>>
let recordFrameRefusal: ReturnType<
  typeof vi.fn<(type: PreviewFrameRefusalType, address: string) => void>
>

beforeEach(() => {
  globalProtocolHandle.mockClear()
  // `realpathSync.native`, NOT `realpathSync`: the handler resolves paths with
  // `fsPromises.realpath`, which has NATIVE semantics and so expands a Windows
  // 8.3 short name (a `C:\Users\MARCIN~1\...` TMP path becomes
  // `C:\Users\marcinobel\...`). A non-native root would not expand, the two
  // spellings would not be `relative()`-comparable, and every request here would
  // fail confinement with a 403. Matching the production resolver keeps the root
  // and the resolved target in the same namespace on every platform.
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-preview-')))
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>ok</title>')
  writeFileSync(join(root, 'app.tsx'), 'export const x = 1')
  ledger = createPreviewRequestKindLedger()
  recordFailure = vi.fn<(input: PreviewFailureInput) => void>()
  recordDocumentFailure = vi.fn<(input: PreviewFailureInput) => void>()
  recordFrameRefusal = vi.fn<(type: PreviewFrameRefusalType, address: string) => void>()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Attach with a resolver returning `entry` for TOKEN and capture the listener. */
function install(entry: PreviewRootEntryLike | null): {
  listener: ProtocolListener
  detach: () => void
  session: ReturnType<typeof makeSession>
} {
  const session = makeSession()
  const ctx: PreviewProtocolContext = {
    resolve: (token) => (token === TOKEN ? entry : null),
    recordFailure,
    recordDocumentFailure,
    recordFrameRefusal,
    ledger
  }
  const detach = attach(session.session, ctx)
  const listener = session.handle.mock.calls[0][1] as ProtocolListener
  return { listener, detach, session }
}

/** Send `url`, first noting it as the request filter would for `resourceType`. */
function send(
  listener: ProtocolListener,
  url: string,
  resourceType?: string,
  opts?: { method?: string; headers?: Record<string, string> }
): Promise<GlobalResponse> {
  if (resourceType !== undefined) {
    ledger.note(url, resourceType)
  }
  return listener(makeRequest(url, opts))
}

describe('PreviewProtocolHandler.attach', () => {
  it('registers on the passed session protocol, not the global protocol', () => {
    const { session } = install({ realRoot: root, csp: VALID_CSP })
    expect(session.handle).toHaveBeenCalledTimes(1)
    expect(session.handle.mock.calls[0][0]).toBe('erfana-preview')
    expect(globalProtocolHandle).not.toHaveBeenCalled()
  })

  it('unhandles the scheme on the passed session when detached', () => {
    const { detach, session } = install({ realRoot: root, csp: VALID_CSP })
    detach()
    expect(session.unhandle).toHaveBeenCalledWith('erfana-preview')
  })
})

describe('PreviewProtocolHandler request handling', () => {
  it('returns 404 for a revoked/unknown token', async () => {
    const { listener } = install(null)
    const res = await send(listener, `${BASE}/index.html`, 'mainFrame')
    expect(res.status).toBe(404)
    expect(recordFailure).not.toHaveBeenCalled()
    expect(recordDocumentFailure).not.toHaveBeenCalled()
  })

  it('serves a file with the CSP header taken from the registry entry', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await send(listener, `${BASE}/index.html`, 'mainFrame')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(VALID_CSP)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toContain('ok')
  })

  it('returns 500 and badges csp-missing when the entry CSP lacks the sandbox', async () => {
    const { listener } = install({ realRoot: root, csp: INVALID_CSP })
    // No note: a subresource of no particular kind, so the page on screen.
    const res = await send(listener, `${BASE}/index.html`)
    expect(res.status).toBe(500)
    expect(res.headers.get('content-security-policy')).toBeNull()
    expect(recordFailure).toHaveBeenCalledTimes(1)
    expect(recordFailure.mock.calls[0][0]).toMatchObject({
      type: 'csp-missing',
      reasonCode: ErrorCode.PREVIEW_CSP_INVALID
    })
  })

  it('badges csp-missing for a main-frame document on the page that document belongs to', async () => {
    // The document was not served: it commits as a bodyless 500 (S15), so its
    // badge must be on the page being loaded, not on the one it replaces.
    const { listener } = install({ realRoot: root, csp: INVALID_CSP })
    const res = await send(listener, `${BASE}/index.html`, 'mainFrame')
    expect(res.status).toBe(500)
    expect(recordDocumentFailure).toHaveBeenCalledTimes(1)
    expect(recordDocumentFailure.mock.calls[0][0]).toMatchObject({ type: 'csp-missing' })
    expect(recordFailure).not.toHaveBeenCalled()
  })

  it.each([
    ['script', 'script'],
    ['stylesheet', 'style']
  ])(
    'badges unsupported-asset-type for a %s request with no sec-fetch-dest and no destination (S1, answer 5)',
    async (resourceType) => {
      // RED before WI-12: the handler read `sec-fetch-dest`, which Electron never
      // sends to `protocol.handle`, so this badge never fired in the real app.
      const { listener } = install({ realRoot: root, csp: VALID_CSP })
      const res = await send(listener, `${BASE}/app.tsx`, resourceType)
      // Still served (200), just badged so the panel can show the "needs a bundler" hint.
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/octet-stream')
      expect(recordFailure).toHaveBeenCalledTimes(1)
      expect(recordFailure.mock.calls[0][0]).toMatchObject({
        type: 'unsupported-asset-type',
        resourceUrlOrHost: '/app.tsx'
      })
    }
  )

  it('reads the kind from the ledger only: a sec-fetch-dest header alone badges nothing', async () => {
    // One source of truth (§2.2). The header never reaches the handler in the
    // real app; a test that fakes it must not be able to pass on it.
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await send(listener, `${BASE}/app.tsx`, undefined, {
      headers: { 'sec-fetch-dest': 'script' }
    })
    expect(res.status).toBe(200)
    expect(recordFailure).not.toHaveBeenCalled()
  })

  it('does not badge a known-type asset even for a script request', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    // index.html is a known type, so no unsupported-asset-type badge regardless of kind.
    const res = await send(listener, `${BASE}/index.html`, 'script')
    expect(res.status).toBe(200)
    expect(recordFailure).not.toHaveBeenCalled()
  })

  it('serves an unknown type with no note and badges nothing (unknown kind is fail-safe)', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await send(listener, `${BASE}/app.tsx`)
    expect(res.status).toBe(200)
    expect(recordFailure).not.toHaveBeenCalled()
  })

  it('returns 405 for a non-GET/HEAD method', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await send(listener, `${BASE}/index.html`, 'mainFrame', { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  it('returns 404 when the URL carries a port', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await send(listener, `erfana-preview://${TOKEN}:8080/index.html`)
    expect(res.status).toBe(404)
  })

  it('returns 400 for a malformed percent-escape in a segment', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await send(listener, `${BASE}/%E0%A4%A.html`)
    expect(res.status).toBe(400)
  })

  it('maps a confinement failure (missing file) to its status', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await send(listener, `${BASE}/does-not-exist.css`, 'stylesheet')
    expect(res.status).toBe(404)
  })
})

describe('PreviewProtocolHandler refusals by request kind (#124, WI-12)', () => {
  it('badges a missing ENTRY document on the page it belongs to, through forMainDocument', async () => {
    // RED before WI-12: with no `sec-fetch-dest` the handler never knew a
    // request was the page itself, so a 404 on it left no trace. The page
    // still commits with its 404 (S15), so the badge goes to the page being
    // loaded – the pending scope – and survives that commit.
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await send(listener, `${BASE}/gone.html`, 'mainFrame')
    expect(res.status).toBe(404)
    expect(recordDocumentFailure).toHaveBeenCalledTimes(1)
    expect(recordDocumentFailure.mock.calls[0][0]).toEqual({
      type: 'missing-local-file',
      resourceUrlOrHost: '/gone.html',
      reasonCode: ErrorCode.PREVIEW_LOCAL_FILE_MISSING
    })
    expect(recordFailure).not.toHaveBeenCalled()
    expect(recordFrameRefusal).not.toHaveBeenCalled()
  })

  it('badges a refused (not missing) entry document with the link-blocked code', async () => {
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'page.html'), '<p>x</p>')
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await send(listener, `${BASE}/node_modules/page.html`, 'mainFrame')
    expect(res.status).toBe(403)
    expect(recordDocumentFailure.mock.calls[0][0]).toEqual({
      type: 'excluded-path',
      resourceUrlOrHost: '/node_modules/page.html',
      reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED
    })
  })

  it('finds the note when only the request carries the fragment (S15)', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    ledger.note(`${BASE}/gone.html`, 'mainFrame')
    const res = await listener(makeRequest(`${BASE}/gone.html#top`))
    expect(res.status).toBe(404)
    expect(recordDocumentFailure).toHaveBeenCalledTimes(1)
  })

  it('does not badge a missing subresource (the page console already reports it)', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    await send(listener, `${BASE}/missing.png`, 'image')
    expect(recordFailure).not.toHaveBeenCalled()
    expect(recordDocumentFailure).not.toHaveBeenCalled()
    expect(recordFrameRefusal).not.toHaveBeenCalled()
  })

  describe('a refused subframe is listed on the page on screen as a frame refusal', () => {
    it.each<[string, () => string, number, PreviewFrameRefusalType]>([
      ['missing', () => 'missing.html', 404, 'missing-local-file'],
      [
        'in an excluded folder',
        () => {
          mkdirSync(join(root, 'node_modules'))
          writeFileSync(join(root, 'node_modules', 'x.html'), '<p>x</p>')
          return 'node_modules/x.html'
        },
        403,
        'frame-excluded'
      ],
      [
        'under a dot folder',
        () => {
          mkdirSync(join(root, '.hidden'))
          writeFileSync(join(root, '.hidden', 'x.html'), '<p>x</p>')
          return '.hidden/x.html'
        },
        403,
        'frame-excluded'
      ],
      // A backslash inside a segment is an escape attempt on every platform.
      ['escaping the root', () => 'a%5Cb.html', 400, 'frame-escape'],
      [
        'over the size cap',
        () => {
          const big = join(root, 'big.html')
          writeFileSync(big, '')
          truncateSync(big, PREVIEW.MAX_ASSET_BYTES + 1)
          return 'big.html'
        },
        413,
        'asset-too-large'
      ]
    ])('%s', async (_label, arrange, status, type) => {
      const path = arrange()
      const { listener } = install({ realRoot: root, csp: VALID_CSP })
      const res = await send(listener, `${BASE}/${path}`, 'subFrame')

      expect(res.status).toBe(status)
      expect(recordFrameRefusal).toHaveBeenCalledTimes(1)
      expect(recordFrameRefusal).toHaveBeenCalledWith(type, `/${path}`)
      // Never on the page being loaded, and never twice.
      expect(recordDocumentFailure).not.toHaveBeenCalled()
      expect(recordFailure).not.toHaveBeenCalled()
    })
  })

  it('takes exactly one note per request, whatever the outcome, so FIFO stays aligned', async () => {
    // The same URL noted as the page and then as an image: a request refused
    // early (405) must still use up the first note, or the image would be
    // badged as a missing page.
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    ledger.note(`${BASE}/gone.html`, 'mainFrame')
    ledger.note(`${BASE}/gone.html`, 'image')

    expect((await listener(makeRequest(`${BASE}/gone.html`, { method: 'POST' }))).status).toBe(405)
    expect((await listener(makeRequest(`${BASE}/gone.html`))).status).toBe(404)

    expect(recordDocumentFailure).not.toHaveBeenCalled()
    expect(recordFrameRefusal).not.toHaveBeenCalled()
    expect(ledger.take(`${BASE}/gone.html`)).toBeUndefined()
  })
})
