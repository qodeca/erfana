// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pending-load lifecycle of one live view (issue #124, WI-29; part 2 §2.3),
 * driven by fake Electron event sequences in the orders spikes S15 and S16
 * measured on Electron 39.8.10.
 */
import { posix } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import {
  createPreviewLivePage,
  isNavigationKind,
  type PreviewLivePageDeps
} from './previewLivePage'
import { buildPreviewUrl } from './previewUrl'

afterEach(() => {
  vi.restoreAllMocks()
})

const TOKEN = '0123456789abcdef0123456789abcdef' // gitleaks:allow
const PAGE_A = '/proj/a.html'
const PAGE_B = '/proj/b.html'
const PAGE_C = '/proj/c.html'
const urlFor = (absPath: string): string => buildPreviewUrl(TOKEN, '/proj', absPath, posix)
const URL_A = urlFor(PAGE_A)
const URL_B = urlFor(PAGE_B)
const URL_C = urlFor(PAGE_C)

type Listener = (...args: unknown[]) => void

/**
 * The view's contents. `keepListeners` makes `removeListener` a no-op, as some
 * fakes are, so a test can prove a listener that outlives `dispose` is inert.
 */
function makeContents(keepListeners = false) {
  const listeners = new Map<string, Set<Listener>>()
  const contents = {
    on: vi.fn((event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
    }),
    removeListener: vi.fn((event: string, listener: Listener) => {
      if (!keepListeners) {
        listeners.get(event)?.delete(listener)
      }
    })
  }
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args)
    }
  }
  return { contents, emit, listenerCount: (event: string) => listeners.get(event)?.size ?? 0 }
}

function makeHarness(options: { keepListeners?: boolean } = {}) {
  const { contents, emit, listenerCount } = makeContents(options.keepListeners)
  const pageScopes = {
    beginPending: vi.fn<() => void>(),
    commit: vi.fn<() => void>(),
    dropPending: vi.fn<() => void>()
  }
  const page = createPreviewLivePage({
    panelId: 'panel-A',
    contents: contents as unknown as PreviewLivePageDeps['contents'],
    pageScopes,
    initialPage: PAGE_A,
    urlFor
  })
  const event = {}
  const fire = {
    didNavigate: (url: unknown, status = 200) =>
      emit('did-navigate', event, url, status, status === 200 ? 'OK' : 'Not Found'),
    inPage: (url: string, isMainFrame = true) =>
      emit('did-navigate-in-page', event, url, isMainFrame, 1, 1),
    stopLoading: () => emit('did-stop-loading'),
    // Events the lifecycle must NOT end on. The module does not listen to them,
    // so firing them proves they change nothing.
    failLoad: (url: string, code = -3, isMainFrame = true) =>
      emit('did-fail-load', event, code, 'ERR_ABORTED', url, isMainFrame, 1, 1),
    finishLoad: () => emit('did-finish-load'),
    startNavigation: (url: string) => emit('did-start-navigation', { url, isMainFrame: true }),
    startLoading: () => emit('did-start-loading')
  }
  return { page, pageScopes, contents, fire, listenerCount }
}

/** A load call that neither resolves nor rejects, like `loadURL` before the commit. */
const never = (): Promise<void> => new Promise<void>(() => {})

describe('previewLivePage — the first load', () => {
  it("opens on the entry page and puts no pending page in place for a view's first load", () => {
    const { page, pageScopes } = makeHarness()
    const load = vi.fn(never)

    void page.startPageLoad(PAGE_A, 'initial', load)

    expect(page.currentPage()).toBe(PAGE_A)
    expect(load).toHaveBeenCalledTimes(1)
    expect(pageScopes.beginPending).not.toHaveBeenCalled()
    expect(page.pendingLoad()).toEqual(
      expect.objectContaining({ filePath: PAGE_A, kind: 'initial', scoped: false })
    )
  })

  it("ends the first load's intent at its commit, with no page scope to commit", () => {
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_A, 'initial', never)

    fire.didNavigate(URL_A)

    expect(page.pendingLoad()).toBeNull()
    expect(pageScopes.commit).not.toHaveBeenCalled()
    expect(page.currentPage()).toBe(PAGE_A)
  })
})

describe('previewLivePage — rule 1: a main-frame did-navigate', () => {
  it('commits a reload of the page on screen', () => {
    const { page, pageScopes, fire } = makeHarness()

    void page.startPageLoad(PAGE_A, 'reload', () => undefined)
    expect(pageScopes.beginPending).toHaveBeenCalledTimes(1)
    fire.didNavigate(URL_A)

    expect(pageScopes.commit).toHaveBeenCalledTimes(1)
    expect(page.pendingLoad()).toBeNull()
  })

  it("commits on Chromium's form of the target: a raw fragment comes back re-encoded (S15)", () => {
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_B, 'open', never)

    fire.didNavigate(`${URL_B}#sec%201`)

    expect(pageScopes.commit).toHaveBeenCalledTimes(1)
    expect(page.currentPage()).toBe(PAGE_B)
  })

  it('commits a refused page, which commits with its 404 and fires no fail event (S15)', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_B, 'open', never)

    fire.didNavigate(URL_B, 404)

    expect(pageScopes.commit).toHaveBeenCalledTimes(1)
    expect(page.currentPage()).toBe(PAGE_B)
    expect(info).toHaveBeenCalledWith(
      'Preview page committed with an error status',
      expect.objectContaining({ status: 404 })
    )
  })

  it('drops the load when another document commits, logs it, and keeps the page on screen', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_B, 'open', never)

    // Page A reloaded itself: taken as the move, the tab would claim B.
    fire.didNavigate(URL_A)

    expect(pageScopes.dropPending).toHaveBeenCalledTimes(1)
    expect(pageScopes.commit).not.toHaveBeenCalled()
    expect(page.currentPage()).toBe(PAGE_A)
    expect(info).toHaveBeenCalledWith(
      'Preview page load ended without a commit',
      expect.objectContaining({ panelId: stablePathDigest('panel-A'), reason: 'other-document' })
    )
  })

  it('with nothing pending, a page reloading itself changes nothing', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { page, pageScopes, fire } = makeHarness()

    fire.didNavigate(URL_A)

    expect(pageScopes.commit).not.toHaveBeenCalled()
    expect(pageScopes.dropPending).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(page.currentPage()).toBe(PAGE_A)
  })

  it('with nothing pending, a commit of another document is logged and moves nothing', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { page, fire } = makeHarness()

    fire.didNavigate(URL_B)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(page.currentPage()).toBe(PAGE_A)
  })

  it('ignores an event with no URL', () => {
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_B, 'open', never)

    fire.didNavigate(undefined)

    expect(pageScopes.commit).not.toHaveBeenCalled()
    expect(pageScopes.dropPending).not.toHaveBeenCalled()
    expect(page.pendingLoad()).not.toBeNull()
  })
})

describe('previewLivePage — rule 2: a main-frame in-page step to the target', () => {
  it('ends an anchor step on the page on screen, which gets no pending page (RS2-1)', () => {
    const { page, pageScopes, fire } = makeHarness()

    void page.startPageLoad(PAGE_A, 'open', never)
    expect(page.pendingLoad()).toEqual(expect.objectContaining({ scoped: false }))
    fire.inPage(`${URL_A}#section`)

    expect(page.pendingLoad()).toBeNull()
    expect(pageScopes.beginPending).not.toHaveBeenCalled()
    expect(pageScopes.dropPending).not.toHaveBeenCalled()
  })

  it('drops the pending page of a load whose step turned out same-document', () => {
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_B, 'back', never)

    fire.inPage(`${URL_B}#x`)

    expect(pageScopes.dropPending).toHaveBeenCalledTimes(1)
    expect(page.pendingLoad()).toBeNull()
    expect(page.currentPage()).toBe(PAGE_A)
  })

  it('ignores an in-page step in a subframe (S4) and one to another document', () => {
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_B, 'forward', never)

    fire.inPage(`${URL_B}#x`, false)
    fire.inPage(`${URL_A}#x`)

    expect(pageScopes.dropPending).not.toHaveBeenCalled()
    expect(page.pendingLoad()).toEqual(expect.objectContaining({ filePath: PAGE_B }))
  })

  it("never ends a reload: the old page's in-page step, like a scroll spy's replaceState, names the same document", () => {
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_A, 'reload', () => undefined)

    fire.inPage(`${URL_A}#spy`)
    expect(pageScopes.dropPending).not.toHaveBeenCalled()
    fire.didNavigate(URL_A)

    expect(pageScopes.commit).toHaveBeenCalledTimes(1)
  })
})

describe('previewLivePage — rule 3: another startPageLoad', () => {
  it('supersedes the earlier load, though no event of its own ever fires (S15)', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_B, 'open', never)

    void page.startPageLoad(PAGE_C, 'open', never)

    expect(pageScopes.beginPending).toHaveBeenCalledTimes(2)
    expect(pageScopes.dropPending).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      'Preview page load ended without a commit',
      expect.objectContaining({ reason: 'superseded' })
    )
    fire.didNavigate(URL_C)
    expect(pageScopes.commit).toHaveBeenCalledTimes(1)
    expect(page.currentPage()).toBe(PAGE_C)
  })

  it("ignores the superseded load's promise rejecting -3 with the successor's URL (S15)", async () => {
    const { page, pageScopes } = makeHarness()
    let rejectB: (reason: unknown) => void = () => {}
    const first = page.startPageLoad(
      PAGE_B,
      'open',
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectB = reject
        })
    )
    void page.startPageLoad(PAGE_C, 'open', never)

    rejectB(Object.assign(new Error('ERR_ABORTED (-3) loading'), { errno: -3, url: URL_C }))

    await expect(first).resolves.toBeUndefined()
    expect(page.pendingLoad()).toEqual(expect.objectContaining({ filePath: PAGE_C }))
    expect(pageScopes.dropPending).toHaveBeenCalledTimes(1)
  })
})

describe('previewLivePage — rule 4: did-stop-loading while pending', () => {
  it('ends a load the page stopped with window.stop(): no fail event, no commit (S16)', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_B, 'open', never)

    // S16 7a: the OLD page finishes, then the tree stops; nothing commits.
    fire.finishLoad()
    fire.stopLoading()

    expect(pageScopes.dropPending).toHaveBeenCalledTimes(1)
    expect(page.pendingLoad()).toBeNull()
    expect(page.currentPage()).toBe(PAGE_A)
    expect(info).toHaveBeenCalledWith(
      'Preview page load ended without a commit',
      expect.objectContaining({ reason: 'stopped' })
    )
  })

  it('does nothing after the commit, where it always arrived for a load that committed (S16)', () => {
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_A, 'reload', () => undefined)

    fire.didNavigate(URL_A)
    fire.finishLoad()
    fire.stopLoading()

    expect(pageScopes.commit).toHaveBeenCalledTimes(1)
    expect(pageScopes.dropPending).not.toHaveBeenCalled()
  })
})

describe('previewLivePage — events that end nothing (S15, S16)', () => {
  it('listens to the three events that end a load, and to nothing else', () => {
    const { contents } = makeHarness()

    expect(contents.on.mock.calls.map(([event]) => event).sort()).toEqual([
      'did-navigate',
      'did-navigate-in-page',
      'did-stop-loading'
    ])
  })

  it("keeps the load pending through a start, the old page's did-finish-load and a main-frame fail", () => {
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_B, 'open', never)

    fire.startLoading()
    fire.startNavigation(URL_B)
    // S16 2a: the OLD page's did-finish-load can land 2 ms before B commits.
    fire.finishLoad()
    fire.failLoad(URL_B, -3)

    expect(pageScopes.commit).not.toHaveBeenCalled()
    expect(pageScopes.dropPending).not.toHaveBeenCalled()
    expect(page.pendingLoad()).toEqual(expect.objectContaining({ filePath: PAGE_B }))
    fire.didNavigate(URL_B)
    expect(pageScopes.commit).toHaveBeenCalledTimes(1)
  })

  it('ignores the stale -3 naming the OLD page that arrives 3–4 ms after the commit (S16)', () => {
    const { page, pageScopes, fire } = makeHarness()
    void page.startPageLoad(PAGE_B, 'open', never)

    fire.didNavigate(URL_B)
    fire.failLoad(URL_A, -3)
    fire.stopLoading()

    expect(pageScopes.commit).toHaveBeenCalledTimes(1)
    expect(pageScopes.dropPending).not.toHaveBeenCalled()
    expect(page.currentPage()).toBe(PAGE_B)
  })

  it("does not take the load call's promise resolving before the commit as the commit (S16)", async () => {
    const { page, pageScopes } = makeHarness()

    await page.startPageLoad(PAGE_B, 'open', () => Promise.resolve())

    expect(pageScopes.commit).not.toHaveBeenCalled()
    expect(page.pendingLoad()).toEqual(expect.objectContaining({ filePath: PAGE_B }))
    expect(page.currentPage()).toBe(PAGE_A)
  })
})

describe('previewLivePage — a load that never starts', () => {
  it('ends at once when the load call throws synchronously, and rethrows to the caller', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {})
    const { page, pageScopes } = makeHarness()

    expect(() =>
      page.startPageLoad(PAGE_A, 'reload', () => {
        throw new Error('Object has been destroyed')
      })
    ).toThrow('Object has been destroyed')

    expect(pageScopes.beginPending).toHaveBeenCalledTimes(1)
    expect(pageScopes.dropPending).toHaveBeenCalledTimes(1)
    expect(page.pendingLoad()).toBeNull()
    expect(info).toHaveBeenCalledWith(
      'Preview page load ended without a commit',
      expect.objectContaining({ reason: 'not-started' })
    )
  })

  it('leaves a load the throwing call replaced alone', () => {
    const { page, pageScopes } = makeHarness()

    expect(() =>
      page.startPageLoad(PAGE_B, 'open', () => {
        void page.startPageLoad(PAGE_C, 'open', never)
        throw new Error('replaced, then threw')
      })
    ).toThrow('replaced, then threw')

    expect(page.pendingLoad()).toEqual(expect.objectContaining({ filePath: PAGE_C }))
    expect(pageScopes.dropPending).toHaveBeenCalledTimes(1)
  })
})

describe('previewLivePage — dispose', () => {
  it('detaches the feed, forgets the pending load and starts nothing afterwards', async () => {
    const { page, pageScopes, fire, listenerCount } = makeHarness()
    void page.startPageLoad(PAGE_B, 'open', never)

    page.dispose()
    page.dispose()

    expect(listenerCount('did-navigate')).toBe(0)
    expect(listenerCount('did-navigate-in-page')).toBe(0)
    expect(listenerCount('did-stop-loading')).toBe(0)
    expect(page.pendingLoad()).toBeNull()
    fire.didNavigate(URL_B)
    expect(pageScopes.commit).not.toHaveBeenCalled()
    const load = vi.fn(() => Promise.resolve())
    await page.startPageLoad(PAGE_B, 'reload', load)
    expect(load).not.toHaveBeenCalled()
  })

  it('a listener that outlives dispose does nothing', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { page, pageScopes, fire } = makeHarness({ keepListeners: true })
    void page.startPageLoad(PAGE_B, 'open', never)
    page.dispose()

    fire.didNavigate(URL_C)
    fire.inPage(`${URL_B}#x`)
    fire.stopLoading()

    expect(pageScopes.commit).not.toHaveBeenCalled()
    expect(pageScopes.dropPending).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(page.currentPage()).toBe(PAGE_A)
  })
})

describe('isNavigationKind — the one "is this a move" rule (QG-6 A6)', () => {
  it.each([
    ['initial', false],
    ['reload', false],
    ['open', true],
    ['back', true],
    ['forward', true]
  ] as const)('%s → %s', (kind, expected) => {
    expect(isNavigationKind(kind)).toBe(expected)
  })
})
