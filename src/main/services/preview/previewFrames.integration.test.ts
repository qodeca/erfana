// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Frames refused and frames shown (issue #124, WI-12 + WI-14; design part 2
 * §2.2–§2.6, §2.10 – acceptance P2-AC3), on a real temporary project with
 * real symlinks, shaped like the e2e corpus page `frames/refused.html`.
 *
 * All three writers run for real and write through one real page scope: the
 * frame guard and the failed-load writer (`attachPreviewFrameEvents`), the
 * request filter, and the protocol handler behind the request-kind ledger. So
 * does the registry, and the realpath confinement that decides what a frame
 * document is. Only Electron is faked: the session captures the listeners
 * `attach` installs, and the page's `webContents` is an event emitter fed the
 * event shapes the spikes measured on Electron 39 (S4, S10).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW } from '../../../shared/constants'
import { createPreviewFailureLog } from './PreviewFailureLog'
import { attach as attachHandler } from './PreviewProtocolHandler'
import { attach as attachFilter } from './PreviewRequestFilter'
import { PreviewRootRegistry } from './PreviewRootRegistry'
import { attachPreviewFrameEvents, type PreviewFrameEventsDeps } from './previewFrameEvents'
import { ERR_BLOCKED_BY_CSP } from './previewFrameGuard'
import { createPageScopeHolder, createPreviewPageScope, type PreviewPageScopeHolder } from './previewPageScope'
import { buildPreviewSessionContexts } from './previewSessionFilterContext'
import { buildPreviewUrl } from './previewUrl'

type FilterListener = (
  details: { id: number; url: string; resourceType: string },
  callback: (response: { cancel: boolean }) => void
) => void
type ProtocolListener = (request: GlobalRequest) => Promise<GlobalResponse>
type Listener = (...args: unknown[]) => void

interface FakeFrame {
  readonly frameTreeNodeId: number
  readonly parent: FakeFrame | null
}

const REMOTE = 'https://example.com/remote.html'
const DATA_URL = 'data:text/html,<title>-DATA-</title>'

let base: string
let project: string
let registry: PreviewRootRegistry
let cleanups: Array<() => void>

/** One live preview page: its session layers, its frame events and its page scopes. */
async function openPage(projectPath = project) {
  const token = await registry.issue(projectPath, [])
  const realRoot = registry.resolve(token)!.realRoot
  const hostBlocked = vi.fn()
  const holder: PreviewPageScopeHolder = createPageScopeHolder(() =>
    createPreviewPageScope({
      panelId: 'panel-1',
      emit: { failuresChanged: vi.fn(), hostBlocked },
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

  // The page's webContents: a main frame and the frames under it.
  const listeners = new Map<string, Set<Listener>>()
  const main = { frameTreeNodeId: 1, parent: null, framesInSubtree: [] as FakeFrame[] }
  main.framesInSubtree.push(main)
  const frames = new Map<number, FakeFrame>([[1, main]])
  const contents = {
    on: (event: string, listener: Listener) => {
      listeners.set(event, (listeners.get(event) ?? new Set<Listener>()).add(listener))
    },
    removeListener: (event: string, listener: Listener) => listeners.get(event)?.delete(listener),
    mainFrame: main
  }
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }
  const frameEvents = attachPreviewFrameEvents({
    panelId: 'panel-1',
    contents: contents as unknown as PreviewFrameEventsDeps['contents'],
    pageScopes: holder,
    ownToken: token,
    frameFromIds: (_processId, routingId) => frames.get(routingId) ?? null
  })
  cleanups.push(() => {
    frameEvents.dispose()
    detachFilter()
    detachHandler()
    holder.dispose()
  })
  let nextId = 0

  const load = async (url: string, resourceType: string): Promise<GlobalResponse | null> => {
    let cancel = true
    captured.filter!({ id: ++nextId, url, resourceType }, (answer) => {
      cancel = answer.cancel
    })
    if (cancel) return null
    const request = { url, method: 'GET', headers: new Headers(), destination: '' }
    return captured.handler!(request as unknown as GlobalRequest)
  }

  return {
    token,
    holder,
    onBlocked,
    hostBlocked,
    url: (...segments: string[]) => buildPreviewUrl(token, realRoot, join(realRoot, ...segments)),
    /** Both request layers, in Chromium's order; `null` when the filter cancelled. */
    load,
    /** A new frame under `parent` (the page by default). */
    frame(parent: FakeFrame = main): FakeFrame {
      const frame = { frameTreeNodeId: frames.size + 1, parent }
      frames.set(frame.frameTreeNodeId, frame)
      main.framesInSubtree.push(frame)
      return frame
    },
    /** `will-frame-navigate` (S4): `true` when the guard cancelled the load. */
    willNavigate(url: string, frame: FakeFrame): boolean {
      const preventDefault = vi.fn()
      emit('will-frame-navigate', { url, isMainFrame: false, frame, preventDefault })
      return preventDefault.mock.calls.length > 0
    },
    /** `did-frame-navigate`: the frame showed a document. */
    committed(url: string, frame: FakeFrame): void {
      emit('did-frame-navigate', {}, url, 200, 'OK', false, 1, frame.frameTreeNodeId)
    },
    /** `did-fail-provisional-load` of a subframe the browser refused first (S10). */
    failed(url: string, frame: FakeFrame, code = ERR_BLOCKED_BY_CSP): void {
      emit('did-fail-provisional-load', {}, code, 'ERR_BLOCKED_BY_CSP', url, false, 1, frame.frameTreeNodeId)
    },
    /** The page on screen's badge, grouped by type, addresses sorted. */
    groups(scope = holder.committed()): Record<string, string[]> {
      const grouped: Record<string, string[]> = {}
      for (const entry of scope.failures()) {
        ;(grouped[entry.type] ??= []).push(entry.resourceUrlOrHost)
      }
      for (const addresses of Object.values(grouped)) addresses.sort()
      return grouped
    }
  }
}

function write(rel: string, content: string): void {
  writeFileSync(join(project, rel), content)
}

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-frames-')))
  project = join(base, 'site')
  const frames = join(project, 'frames')
  mkdirSync(join(frames, 'node_modules'), { recursive: true })
  mkdirSync(join(frames, '.hidden'))
  mkdirSync(join(base, 'outside'))
  write('frames/refused.html', '<title>-REFUSED-</title>')
  write('frames/child.html', '<link rel="stylesheet" href="child.css"><title>-CHILD-</title>')
  write('frames/child.css', 'body { color: red }')
  write('frames/private.html', '<title>Private frame -PRIVATE-</title>')
  write('frames/.gitignore', 'private.html\n')
  write('frames/node_modules/x.html', '<title>-EXCLUDED-</title>')
  write('frames/.hidden/x.html', '<title>-EXCLUDED-</title>')
  write('frames/big.html', '')
  truncateSync(join(frames, 'big.html'), PREVIEW.MAX_ASSET_BYTES + 1)
  writeFileSync(join(base, 'outside', 'outside.html'), '<title>-OUTSIDE-</title>')
  writeFileSync(join(base, 'outside', 'x.html'), '<title>-OUTSIDE-</title>')
  // What the e2e makes in setup: a link out of the project, and a linked folder.
  symlinkSync(join(base, 'outside', 'outside.html'), join(frames, 'escape.html'))
  symlinkSync(join(base, 'outside'), join(frames, 'outdir'), 'dir')
  mkdirSync(join(base, 'other'))
  registry = new PreviewRootRegistry()
  cleanups = []
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  registry.clear()
  rmSync(base, { recursive: true, force: true })
})

describe('frames on a preview page (P2-AC3)', () => {
  // The one case here that is macOS-shaped. It expects `/frames/escape.html`
  // under `missing-local-file`, which is what `O_NOFOLLOW` produces: the open of
  // the leaf symlink is refused outright, so the frame reads as missing. Windows
  // has no `O_NOFOLLOW`, follows the link, resolves the target outside the root
  // and files it under `frame-escape` instead — the label known-flakes.md
  // predicted, and the more accurate of the two. Skipped here rather than at the
  // `describe`, which hid the other 21 cases from every Windows run.
  it.skipIf(process.platform === 'win32')('lists every refused frame of refused.html once, under its label, and loads the gitignored frame', async () => {
    const page = await openPage()
    const foreign = `erfana-preview://${await registry.issue(join(base, 'other'), [])}/index.html`
    const blob = `blob:erfana-preview://${page.token}/5f0c7a1e-0000-4000-8000-000000000000`

    // The browser's own-token frame-src refuses these before any other layer (S10).
    for (const url of [REMOTE, foreign, DATA_URL, blob]) page.failed(url, page.frame())
    // Same token: the guard lets them through, the handler decides.
    for (const rel of ['escape.html', 'node_modules/x.html', '.hidden/x.html', 'missing.html']) {
      const url = page.url('frames', ...rel.split('/'))
      expect(page.willNavigate(url, page.frame()), rel).toBe(false)
      expect((await page.load(url, 'subFrame'))?.status, rel).toBeGreaterThanOrEqual(400)
    }
    const privateFrame = await page.load(page.url('frames', 'private.html'), 'subFrame')

    expect(privateFrame?.status).toBe(200)
    expect(await privateFrame!.text()).toContain('-PRIVATE-')
    expect(page.groups()).toEqual({
      'frame-remote': ['blob:', 'data:', REMOTE].sort(),
      'frame-escape': [foreign],
      'frame-excluded': ['/frames/.hidden/x.html', '/frames/node_modules/x.html'],
      // A frame that IS a link out of the project is refused by the `O_NOFOLLOW`
      // open (previewPathResolve step 8e) before confinement can name it an
      // escape, so it is listed as missing. The e2e soft-expects `frame-escape`
      // for it (html-preview-frames.e2e.ts) – reported, not decided here.
      'missing-local-file': ['/frames/escape.html', '/frames/missing.html']
    })
    // Frame refusals go to the failure badge, never to the permission band.
    expect(page.onBlocked).not.toHaveBeenCalled()
    expect(page.hostBlocked).not.toHaveBeenCalled()
  })

  it('gives one entry per frame when all three layers see it', async () => {
    const page = await openPage()
    const foreign = `erfana-preview://${await registry.issue(join(base, 'other'), [])}/index.html`

    for (const url of [REMOTE, foreign, DATA_URL]) {
      const frame = page.frame()
      page.failed(url, frame)
      expect(page.willNavigate(url, frame), url).toBe(true)
      expect(await page.load(url, 'subFrame'), url).toBeNull()
    }

    expect(page.groups()).toEqual({
      'frame-remote': ['data:', REMOTE].sort(),
      'frame-escape': [foreign]
    })
  })

  it.each([
    ['node_modules/x.html', 403, 'frame-excluded'],
    ['.hidden/x.html', 403, 'frame-excluded'],
    ['missing.html', 404, 'missing-local-file'],
    ['outdir/x.html', 403, 'frame-escape'],
    ['big.html', 413, 'asset-too-large']
  ])('the handler refuses the own-token frame frames/%s (%i) as %s, listed by path', async (rel, status, type) => {
    const page = await openPage()
    const url = page.url('frames', ...rel.split('/'))

    expect(page.willNavigate(url, page.frame())).toBe(false)
    expect((await page.load(url, 'subFrame'))?.status).toBe(status)
    expect(page.groups()).toEqual({ [type]: [`/frames/${rel}`] })
    expect(JSON.stringify(page.groups())).not.toContain(page.token)
  })

  it("serves an own-token frame and its stylesheet; the gitignore check never blocks a served request (§2.10)", async () => {
    const page = await openPage()

    const child = await page.load(page.url('frames', 'child.html'), 'subFrame')
    const css = await page.load(page.url('frames', 'child.css'), 'stylesheet')
    const gitignored = await page.load(page.url('frames', 'private.html'), 'subFrame')

    expect([child?.status, css?.status, gitignored?.status]).toEqual([200, 200, 200])
    expect(page.groups()).toEqual({})
  })

  it('refuses a frame deeper than three levels and lists its path, never the token', async () => {
    const page = await openPage()
    const level3 = page.frame(page.frame(page.frame()))
    const level4 = page.frame(level3)

    expect(page.willNavigate(page.url('frames', 'child.html'), level3)).toBe(false)
    expect(page.willNavigate(page.url('frames', 'child.html'), level4)).toBe(true)
    expect(page.groups()).toEqual({ 'frame-too-deep': ['/frames/child.html'] })
  })

  it('lists a link inside a frame that showed a document by scheme and host only', async () => {
    const page = await openPage()
    const frame = page.frame()
    page.committed(page.url('frames', 'child.html'), frame)

    expect(page.willNavigate('https://evil.example/path?secret=1#x', frame)).toBe(true)
    page.failed('https://evil.example/other', frame)

    expect(page.groups()).toEqual({ 'frame-link-blocked': ['https://evil.example'] })
  })

  it("keeps page A's refused frames with A while B loads, so B starts clean", async () => {
    const page = await openPage()
    page.holder.beginPending()

    page.failed(REMOTE, page.frame())
    await page.load(page.url('frames', 'missing.html'), 'subFrame')
    expect(page.groups()).toEqual({
      'frame-remote': [REMOTE],
      'missing-local-file': ['/frames/missing.html']
    })
    expect(page.groups(page.holder.forMainDocument())).toEqual({})

    page.holder.commit()
    expect(page.groups()).toEqual({})
  })

  it('lists at most 100 refused frames per page and counts the rest', async () => {
    const page = await openPage()

    for (let i = 0; i < PREVIEW.MAX_FAILURES + 50; i += 1) {
      await page.load(page.url('frames', `gone-${i}.html`), 'subFrame')
    }

    expect(page.holder.committed().failures()).toHaveLength(PREVIEW.MAX_FAILURES)
    expect(page.holder.committed().frameRefusals.overflowCount()).toBe(50)
  })
})
