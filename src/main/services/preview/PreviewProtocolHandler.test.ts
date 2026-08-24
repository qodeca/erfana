// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the `erfana-preview://` protocol handler (Issue #74, work item 20;
 * design §2.4, §2.6, §7 test rows 6 + 7b).
 *
 * Covers: a revoked/unknown token ⇒ 404; a served file carries the CSP from the
 * registry entry; a CSP missing `sandbox allow-scripts` ⇒ 500 + a `csp-missing`
 * badge; an octet-stream fallthrough for a `.tsx` script destination ⇒ an
 * `unsupported-asset-type` badge (still 200); and that the handler registers on
 * the PASSED session's `protocol`, not the global one.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import {
  attach,
  type PreviewProtocolContext,
  type PreviewRootEntryLike
} from './PreviewProtocolHandler'

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

/** Build a fake `GlobalRequest` with a controllable method and `sec-fetch-dest`. */
function makeRequest(
  url: string,
  opts: { method?: string; dest?: string } = {}
): GlobalRequest {
  const headers = new Headers()
  if (opts.dest) {
    headers.set('sec-fetch-dest', opts.dest)
  }
  return {
    url,
    method: opts.method ?? 'GET',
    headers,
    destination: opts.dest ?? ''
  } as unknown as GlobalRequest
}

const VALID_CSP = "default-src 'none'; sandbox allow-scripts"
const INVALID_CSP = "default-src 'self'; img-src *"
const TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef'

let root: string
let recordFailure: ReturnType<typeof vi.fn<(input: PreviewFailureInput) => void>>

beforeEach(() => {
  globalProtocolHandle.mockClear()
  root = realpathSync(mkdtempSync(join(tmpdir(), 'erfana-preview-')))
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>ok</title>')
  writeFileSync(join(root, 'app.tsx'), 'export const x = 1')
  recordFailure = vi.fn<(input: PreviewFailureInput) => void>()
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
    recordFailure
  }
  const detach = attach(session.session, ctx)
  const listener = session.handle.mock.calls[0][1] as ProtocolListener
  return { listener, detach, session }
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
    const res = await listener(makeRequest(`erfana-preview://${TOKEN}/index.html`))
    expect(res.status).toBe(404)
    expect(recordFailure).not.toHaveBeenCalled()
  })

  it('serves a file with the CSP header taken from the registry entry', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await listener(makeRequest(`erfana-preview://${TOKEN}/index.html`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBe(VALID_CSP)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toContain('ok')
  })

  it('returns 500 and badges csp-missing when the entry CSP lacks the sandbox', async () => {
    const { listener } = install({ realRoot: root, csp: INVALID_CSP })
    const res = await listener(makeRequest(`erfana-preview://${TOKEN}/index.html`))
    expect(res.status).toBe(500)
    expect(res.headers.get('content-security-policy')).toBeNull()
    expect(recordFailure).toHaveBeenCalledTimes(1)
    expect(recordFailure.mock.calls[0][0]).toMatchObject({
      type: 'csp-missing',
      reasonCode: ErrorCode.PREVIEW_CSP_INVALID
    })
  })

  it('badges unsupported-asset-type on an octet-stream fallthrough for a script dest', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await listener(
      makeRequest(`erfana-preview://${TOKEN}/app.tsx`, { dest: 'script' })
    )
    // Still served (200), just badged so the panel can show the "needs a bundler" hint.
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(recordFailure).toHaveBeenCalledTimes(1)
    expect(recordFailure.mock.calls[0][0]).toMatchObject({ type: 'unsupported-asset-type' })
  })

  it('does not badge a known-type asset even for a script destination', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    // index.html is a known type, so no unsupported-asset-type badge regardless of dest.
    const res = await listener(
      makeRequest(`erfana-preview://${TOKEN}/index.html`, { dest: 'script' })
    )
    expect(res.status).toBe(200)
    expect(recordFailure).not.toHaveBeenCalled()
  })

  it('returns 405 for a non-GET/HEAD method', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await listener(
      makeRequest(`erfana-preview://${TOKEN}/index.html`, { method: 'POST' })
    )
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  it('returns 404 when the URL carries a port', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await listener(makeRequest(`erfana-preview://${TOKEN}:8080/index.html`))
    expect(res.status).toBe(404)
  })

  it('returns 400 for a malformed percent-escape in a segment', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await listener(makeRequest(`erfana-preview://${TOKEN}/%E0%A4%A.html`))
    expect(res.status).toBe(400)
  })

  it('maps a confinement failure (missing file) to its status', async () => {
    const { listener } = install({ realRoot: root, csp: VALID_CSP })
    const res = await listener(makeRequest(`erfana-preview://${TOKEN}/does-not-exist.css`))
    expect(res.status).toBe(404)
  })
})
