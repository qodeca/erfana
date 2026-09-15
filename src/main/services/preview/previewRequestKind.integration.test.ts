// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Request kinds end to end (issue #124, WI-12; design part 2 §2.2), on a real
 * temporary project with real symlinks.
 *
 * The REAL request filter notes each preview request's `resourceType` in the
 * session's REAL ledger; the REAL protocol handler takes that note back and
 * serves real bytes through real realpath confinement; the REAL page scopes
 * hold what gets badged; the REAL registry mints the token. Only Electron's
 * session is faked – an object that captures the listeners `attach` installs.
 * Requests look the way Electron 39 hands them over – no `sec-fetch-dest`, an
 * empty `destination` (spike S1) – so the ledger is the only way a badge can
 * know what a request was.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { createPreviewFailureLog } from './PreviewFailureLog'
import { attach as attachHandler } from './PreviewProtocolHandler'
import { attach as attachFilter } from './PreviewRequestFilter'
import { PreviewRootRegistry } from './PreviewRootRegistry'
import {
  createPageScopeHolder,
  createPreviewPageScope,
  type PreviewPageScope,
  type PreviewPageScopeHolder
} from './previewPageScope'
import { buildPreviewSessionContexts } from './previewSessionFilterContext'
import { buildPreviewUrl } from './previewUrl'

const skipSymlinks = process.platform === 'win32'

type FilterListener = (
  details: { id: number; url: string; resourceType: string },
  callback: (response: { cancel: boolean }) => void
) => void
type ProtocolListener = (request: GlobalRequest) => Promise<GlobalResponse>

/** One preview session over a real registry entry: filter, ledger, handler, page scopes. */
interface SessionHarness {
  readonly token: string
  readonly realRoot: string
  readonly holder: PreviewPageScopeHolder
  readonly onBlocked: ReturnType<typeof vi.fn>
  /** The URL of a file inside the real root, built as the live view builds it. */
  url(...segments: string[]): string
  /** The filter's half of a request: `true` when it let it through (and noted it). */
  note(url: string, resourceType: string): boolean
  /** The handler's half: what `protocol.handle` answers. */
  serve(url: string): Promise<GlobalResponse>
  /** Both halves, in Chromium's order; `null` when the filter cancelled. */
  load(url: string, resourceType: string): Promise<GlobalResponse | null>
  close(): void
}

/** A request as Electron 39 hands it to `protocol.handle` (S1). */
function electronRequest(url: string): GlobalRequest {
  return { url, method: 'GET', headers: new Headers(), destination: '' } as unknown as GlobalRequest
}

async function openSession(
  registry: PreviewRootRegistry,
  projectPath: string
): Promise<SessionHarness> {
  const token = await registry.issue(projectPath, [])
  const realRoot = registry.resolve(token)!.realRoot
  const holder = createPageScopeHolder(() =>
    createPreviewPageScope({
      panelId: 'panel-1',
      emit: { failuresChanged: vi.fn(), hostBlocked: vi.fn() },
      createFailureLog: (onEmit) => createPreviewFailureLog({ onEmit })
    })
  )
  const onBlocked = vi.fn()
  const contexts = buildPreviewSessionContexts({
    token,
    resolve: (host) => registry.resolve(host) ?? null,
    getAllowedHosts: () => new Set<string>(),
    pageScopes: () => holder,
    onBlocked
  })
  const captured: { filter?: FilterListener; handler?: ProtocolListener } = {}
  const session = {
    webRequest: {
      onBeforeRequest: (listener: FilterListener | null) => {
        captured.filter = listener ?? undefined
      },
      onCompleted: () => {},
      onErrorOccurred: () => {}
    },
    protocol: {
      handle: (_scheme: string, listener: ProtocolListener) => {
        captured.handler = listener
      },
      unhandle: () => {}
    }
  } as unknown as Parameters<typeof attachFilter>[0]
  const detachFilter = attachFilter(session, contexts.filter)
  const detachHandler = attachHandler(session, contexts.protocol)
  let nextId = 0

  const note = (url: string, resourceType: string): boolean => {
    let cancel = true
    captured.filter!({ id: ++nextId, url, resourceType }, (answer) => {
      cancel = answer.cancel
    })
    return !cancel
  }
  const serve = (url: string): Promise<GlobalResponse> => captured.handler!(electronRequest(url))

  return {
    token,
    realRoot,
    holder,
    onBlocked,
    url: (...segments) => buildPreviewUrl(token, realRoot, join(realRoot, ...segments)),
    note,
    serve,
    load: async (url, resourceType) => (note(url, resourceType) ? serve(url) : null),
    close: () => {
      detachFilter()
      detachHandler()
      holder.dispose()
    }
  }
}

/** A page's badge entries, without their timestamps. */
function listed(scope: PreviewPageScope): Array<{ type: string; resourceUrlOrHost: string; reasonCode: ErrorCode }> {
  return scope.failures().map(({ type, resourceUrlOrHost, reasonCode }) => ({
    type,
    resourceUrlOrHost,
    reasonCode
  }))
}

let base: string
let project: string
let registry: PreviewRootRegistry
let sessions: SessionHarness[]

function write(rel: string, content: string): void {
  writeFileSync(join(project, rel), content)
}

async function session(projectPath = project): Promise<SessionHarness> {
  const opened = await openSession(registry, projectPath)
  sessions.push(opened)
  return opened
}

beforeEach(() => {
  // `.native`, as the registry resolves: a Windows 8.3 TMP path expands.
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-kind-')))
  project = join(base, 'site')
  mkdirSync(join(project, 'node_modules'), { recursive: true })
  mkdirSync(join(project, '.hidden'))
  mkdirSync(join(base, 'outside'))
  write('index.html', '<!doctype html><title>-INDEX-</title>')
  write('app.js', 'export const ok = 1')
  write('app.tsx', 'export const needsABundler = 1')
  write('data.unknownext', 'body { color: red }')
  write('style.css', 'body { color: red }')
  write('node_modules/x.html', '<title>-EXCLUDED-</title>')
  write('.hidden/x.html', '<title>-HIDDEN-</title>')
  writeFileSync(join(base, 'outside', 'x.html'), '<title>-OUTSIDE-</title>')
  registry = new PreviewRootRegistry()
  sessions = []
})

afterEach(() => {
  for (const opened of sessions.splice(0)) opened.close()
  registry.clear()
  rmSync(base, { recursive: true, force: true })
})

describe("the page's own document", () => {
  it('serves the entry page with a CSP whose frame-src names its own token, and badges nothing', async () => {
    const s = await session()
    const response = await s.load(s.url('index.html'), 'mainFrame')

    expect(response?.status).toBe(200)
    expect(await response!.text()).toContain('-INDEX-')
    expect(response!.headers.get('Content-Security-Policy')).toMatch(
      new RegExp(`frame-src[^;]*${s.token}`)
    )
    expect(listed(s.holder.committed())).toEqual([])
  })

  it("badges a missing entry page on the view's first page, which has nothing pending", async () => {
    const s = await session()

    expect((await s.load(s.url('gone.html'), 'mainFrame'))?.status).toBe(404)
    expect(listed(s.holder.committed())).toEqual([
      {
        type: 'missing-local-file',
        resourceUrlOrHost: '/gone.html',
        reasonCode: ErrorCode.PREVIEW_LOCAL_FILE_MISSING
      }
    ])
  })

  it('badges a refused page main is loading on THAT page, which keeps it past the commit (S15)', async () => {
    const s = await session()
    s.holder.beginPending()

    expect((await s.load(s.url('node_modules', 'x.html'), 'mainFrame'))?.status).toBe(403)
    const expected = [
      {
        type: 'excluded-path',
        resourceUrlOrHost: '/node_modules/x.html',
        reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED
      }
    ]
    // The page on screen stays clean while the refused one loads.
    expect(listed(s.holder.committed())).toEqual([])
    expect(listed(s.holder.forMainDocument())).toEqual(expected)

    s.holder.commit()
    expect(listed(s.holder.committed())).toEqual(expected)
  })
})

describe('asset types', () => {
  it.each([
    ['script', 'app.tsx'],
    ['stylesheet', 'data.unknownext']
  ])('badges a %s the app cannot type (%s), and still serves its bytes', async (resourceType, name) => {
    const s = await session()

    expect((await s.load(s.url(name), resourceType))?.status).toBe(200)
    expect(listed(s.holder.committed())).toEqual([
      {
        type: 'unsupported-asset-type',
        resourceUrlOrHost: `/${name}`,
        reasonCode: ErrorCode.UNKNOWN_ERROR
      }
    ])
  })

  it.each([
    ['image', 'app.tsx'],
    ['script', 'app.js'],
    ['stylesheet', 'style.css']
  ])('badges nothing for a %s of %s', async (resourceType, name) => {
    const s = await session()

    expect((await s.load(s.url(name), resourceType))?.status).toBe(200)
    expect(listed(s.holder.committed())).toEqual([])
  })
})

describe('the ledger between the filter and the handler', () => {
  it('serves a request the filter never noted, and badges nothing (fail-safe)', async () => {
    const s = await session()

    expect((await s.serve(s.url('app.tsx'))).status).toBe(200)
    expect((await s.serve(s.url('gone.html'))).status).toBe(404)
    expect(listed(s.holder.committed())).toEqual([])
  })

  it('keeps each kind when one URL is requested as an image and as a frame (FIFO)', async () => {
    const s = await session()
    const url = s.url('missing.html')
    expect(s.note(url, 'image')).toBe(true)
    expect(s.note(url, 'subFrame')).toBe(true)

    // The image first: a broken <img> is the page's own console's business.
    expect((await s.serve(url)).status).toBe(404)
    expect(listed(s.holder.committed())).toEqual([])
    // Then the frame, which is listed.
    expect((await s.serve(url)).status).toBe(404)
    expect(listed(s.holder.committed())).toEqual([
      {
        type: 'missing-local-file',
        resourceUrlOrHost: '/missing.html',
        reasonCode: ErrorCode.PREVIEW_LOCAL_FILE_MISSING
      }
    ])
  })

  it('takes each note once, so a second request for the same URL has no kind', async () => {
    const s = await session()
    s.note(s.url('app.tsx'), 'script')

    await s.serve(s.url('app.tsx'))
    await s.serve(s.url('app.tsx'))
    expect(listed(s.holder.committed())).toHaveLength(1)
  })

  it('matches a note whose URL carries a fragment to the request without one', async () => {
    const s = await session()
    s.note(`${s.url('gone.html')}#top`, 'mainFrame')

    await s.serve(s.url('gone.html'))
    expect(listed(s.holder.committed()).map((entry) => entry.type)).toEqual(['missing-local-file'])
  })
})

describe('tokens', () => {
  it('answers 404 for a revoked token and badges nothing', async () => {
    const s = await session()
    registry.revoke(s.token)

    expect((await s.load(s.url('index.html'), 'mainFrame'))?.status).toBe(404)
    expect(listed(s.holder.committed())).toEqual([])
  })

  it("refuses a frame on a token the session does not own – a revoked view's included (RX9)", async () => {
    const first = await session()
    const stale = first.url('index.html')
    registry.revoke(first.token)
    const next = await session()

    expect(await next.load(stale, 'subFrame')).toBeNull()
    expect(listed(next.holder.committed())).toEqual([
      { type: 'frame-escape', resourceUrlOrHost: stale, reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED }
    ])
    // A frame refusal is a badge, never a permission-band request.
    expect(next.onBlocked).not.toHaveBeenCalled()
    // As a page it passes the filter and reaches the handler, which no longer knows it.
    expect((await next.load(stale, 'mainFrame'))?.status).toBe(404)
  })
})

describe.skipIf(skipSymlinks)('symlinks', () => {
  it('serves a project opened through a symlinked folder when the URL is built from the real root', async () => {
    symlinkSync(project, join(base, 'site-link'), 'dir')
    const s = await session(join(base, 'site-link'))

    expect(s.realRoot).toBe(project)
    const response = await s.load(s.url('index.html'), 'mainFrame')
    expect(response?.status).toBe(200)
    expect(await response!.text()).toContain('-INDEX-')
  })

  it('refuses a page behind a symlinked folder that leaves the project, as an escape', async () => {
    symlinkSync(join(base, 'outside'), join(project, 'outdir'), 'dir')
    const s = await session()

    expect((await s.load(s.url('outdir', 'x.html'), 'mainFrame'))?.status).toBe(403)
    expect(listed(s.holder.committed())).toEqual([
      {
        type: 'path-escape',
        resourceUrlOrHost: '/outdir/x.html',
        reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED
      }
    ])
  })
})
