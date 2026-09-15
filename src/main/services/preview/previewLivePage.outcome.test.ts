// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the page module tells its listeners (issue #124, WI-17b; part 2 §2.3):
 * every end of a pending load, with its reason, and every main-frame in-page
 * step that ended none. The navigator and the view's collaborators hang off
 * these. Split from `previewLivePage.test.ts` by topic.
 */
import { posix } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import {
  createPreviewLivePage,
  type PreviewLivePageDeps,
  type PreviewPageLoadEnd
} from './previewLivePage'
import { buildPreviewUrl } from './previewUrl'

afterEach(() => {
  vi.restoreAllMocks()
})

const TOKEN = '0123456789abcdef0123456789abcdef'
const PAGE_A = '/proj/a.html'
const PAGE_B = '/proj/b.html'
const PAGE_C = '/proj/c.html'
const urlFor = (absPath: string): string => buildPreviewUrl(TOKEN, '/proj', absPath, posix)
const URL_A = urlFor(PAGE_A)
const URL_B = urlFor(PAGE_B)

type Listener = (...args: unknown[]) => void

/** A load call that neither resolves nor rejects, like `loadURL` before the commit. */
const never = (): Promise<void> => new Promise<void>(() => {})

/** A page on A whose contents' events the test fires. */
function makeHarness(listeners: Pick<PreviewLivePageDeps, 'onOutcome' | 'onInPageStep'>) {
  const handlers = new Map<string, Set<Listener>>()
  const contents = {
    on: (event: string, listener: Listener) => {
      handlers.set(event, (handlers.get(event) ?? new Set<Listener>()).add(listener))
    },
    removeListener: (event: string, listener: Listener) => handlers.get(event)?.delete(listener)
  }
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of handlers.get(event) ?? []) {
      listener(...args)
    }
  }
  const page = createPreviewLivePage({
    panelId: 'panel-A',
    contents: contents as unknown as PreviewLivePageDeps['contents'],
    pageScopes: { beginPending: vi.fn(), commit: vi.fn(), dropPending: vi.fn() },
    initialPage: PAGE_A,
    urlFor,
    ...listeners
  })
  const fire = {
    didNavigate: (url: string, status = 200) =>
      emit('did-navigate', {}, url, status, status === 200 ? 'OK' : 'Not Found'),
    inPage: (url: string, isMainFrame = true) =>
      emit('did-navigate-in-page', {}, url, isMainFrame, 1, 1),
    stopLoading: () => emit('did-stop-loading')
  }
  return { page, fire }
}

describe('previewLivePage — the outcome feed (issue #124, WI-17b)', () => {
  function withFeed() {
    const ends: PreviewPageLoadEnd[] = []
    const steps: string[] = []
    const h = makeHarness({
      onOutcome: (end) => ends.push(end),
      onInPageStep: (url) => steps.push(url)
    })
    return { ...h, ends, steps }
  }

  it('reports a commit with its load, the page before it, and whether it failed (S15)', () => {
    const h = withFeed()
    void h.page.startPageLoad(PAGE_B, 'open', never)
    const load = h.page.pendingLoad()

    h.fire.didNavigate(URL_B, 404)

    expect(h.ends).toEqual([{ load, reason: 'committed', failed: true, previousPage: PAGE_A }])
    // The page is settled before the listener hears of it.
    expect(h.page.currentPage()).toBe(PAGE_B)
  })

  it('reports a clean commit as not failed', () => {
    const h = withFeed()
    void h.page.startPageLoad(PAGE_A, 'reload', () => undefined)

    h.fire.didNavigate(URL_A)

    expect(h.ends).toEqual([
      expect.objectContaining({ reason: 'committed', failed: false, previousPage: PAGE_A })
    ])
  })

  it('reports every drop with its reason, and never as failed', () => {
    const h = withFeed()

    void h.page.startPageLoad(PAGE_B, 'open', never)
    h.fire.didNavigate(URL_A) // another document
    void h.page.startPageLoad(PAGE_B, 'open', never)
    void h.page.startPageLoad(PAGE_C, 'open', never) // superseded
    h.fire.stopLoading() // stopped
    void h.page.startPageLoad(PAGE_A, 'open', never)
    h.fire.inPage(`${URL_A}#x`) // same-document
    expect(() =>
      h.page.startPageLoad(PAGE_B, 'back', () => {
        throw new Error('destroyed')
      })
    ).toThrow('destroyed')

    expect(h.ends.map((end) => [end.reason, end.load.filePath, end.failed])).toEqual([
      ['other-document', PAGE_B, false],
      ['superseded', PAGE_B, false],
      ['stopped', PAGE_C, false],
      ['same-document', PAGE_A, false],
      ['not-started', PAGE_B, false]
    ])
  })

  it('reports nothing for a commit main did not start', () => {
    const h = withFeed()

    h.fire.didNavigate(URL_A)
    h.fire.didNavigate(URL_B)

    expect(h.ends).toEqual([])
  })

  it('passes on a main-frame in-page step that ended no load, and no other', () => {
    const h = withFeed()

    h.fire.inPage(`${URL_A}#one`) // nothing pending
    void h.page.startPageLoad(PAGE_A, 'reload', () => undefined)
    h.fire.inPage(`${URL_A}#spy`) // the old page, while it reloads
    h.fire.didNavigate(URL_A)
    void h.page.startPageLoad(PAGE_B, 'open', never)
    h.fire.inPage(`${URL_A}#left`) // the page being left, while a move is on its way
    h.fire.inPage(`${URL_B}#frame`, false) // a subframe (S4)
    h.fire.inPage(`${URL_B}#here`) // the target: it ends the move instead

    expect(h.steps).toEqual([`${URL_A}#one`, `${URL_A}#spy`, `${URL_A}#left`])
    expect(h.ends.at(-1)?.reason).toBe('same-document')
  })

  it('contains a listener that throws, so the Electron event does not, and logs it by name', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    // A listener's error can quote a path – a watcher retarget, for one – so
    // only its name and code are logged, never the message (QG-7 S5's class).
    const thrown = (): never => {
      throw Object.assign(new Error('EACCES: permission denied, watch /Users/e2e/pages/b.html'), {
        code: 'EACCES'
      })
    }
    const h = makeHarness({ onOutcome: thrown, onInPageStep: thrown })
    void h.page.startPageLoad(PAGE_B, 'open', never)

    expect(() => h.fire.didNavigate(URL_B)).not.toThrow()
    expect(() => h.fire.inPage(`${URL_B}#x`)).not.toThrow()

    expect(h.page.currentPage()).toBe(PAGE_B)
    expect(error).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledWith('Preview page: a navigation listener failed', undefined, {
      panelId: stablePathDigest('panel-A'),
      error: 'Error',
      code: 'EACCES'
    })
    expect(JSON.stringify(error.mock.calls)).not.toContain('/Users/e2e')
  })
})
