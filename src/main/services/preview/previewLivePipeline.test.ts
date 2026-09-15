// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The post-load pipeline and live reload of one preview view, driven through
 * its injected deps (Issue #124, WI-1). The view-level behaviour stays pinned by
 * `PreviewViewService.test.ts`; this file covers the module's own branches.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW } from '../../../shared/constants'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import type { WatchSetResult } from './PreviewWatchCoordinator'
import { createPreviewLivePipeline, type PreviewLivePipelineDeps } from './previewLivePipeline'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const PAGE = resolve('/proj/site/index.html')
const STYLE = resolve(dirname(PAGE), 'style.css')
const ONE_LINK = '<link rel="stylesheet" href="style.css">'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolvePromise = res
  })
  return { promise, resolve: resolvePromise }
}

/** Let the pipeline's awaits on already-settled promises run. */
function flush(): Promise<void> {
  return new Promise((resolveFlush) => setImmediate(resolveFlush))
}

function makeHarness(overrides: Partial<PreviewLivePipelineDeps> = {}) {
  const state = { tornDown: false, wanted: true, now: 0 }
  const fakes = {
    loadStateChanged: vi.fn(),
    invalidate: vi.fn<(panelId: string) => void>(),
    executeJavaScriptInIsolatedWorld: vi.fn<
      (worldId: number, scripts: { code: string }[]) => Promise<unknown>
    >(() => Promise.resolve(true)),
    readEntryHtml: vi.fn<(filePath: string) => Promise<string>>(() => Promise.resolve(ONE_LINK)),
    setWatchSet: vi.fn<(candidates: readonly string[]) => Promise<WatchSetResult>>((candidates) =>
      Promise.resolve({ watched: [...candidates], dropped: [] })
    ),
    recordChange: vi.fn<(path: string) => void>(),
    reloadPage: vi.fn<(ignoreCache: boolean) => void>(),
    captureWhileVisible: vi.fn<() => void>()
  }
  const deps: PreviewLivePipelineDeps = {
    panelId: 'panel-A',
    contents: { executeJavaScriptInIsolatedWorld: fakes.executeJavaScriptInIsolatedWorld },
    emit: { loadStateChanged: fakes.loadStateChanged },
    stillFrameCache: { invalidate: fakes.invalidate },
    now: () => state.now,
    readEntryHtml: fakes.readEntryHtml,
    currentPage: () => PAGE,
    urlFor: (absPath) => `erfana-preview://token/${absPath}`,
    setWatchSet: fakes.setWatchSet,
    recordChange: fakes.recordChange,
    reloadPage: fakes.reloadPage,
    isWanted: () => state.wanted,
    captureWhileVisible: fakes.captureWhileVisible,
    isTornDown: () => state.tornDown,
    ...overrides
  }
  return { ...fakes, state, pipeline: createPreviewLivePipeline(deps) }
}

describe('createPreviewLivePipeline — one run', () => {
  it('reads the current page, watches its links and reports ready', async () => {
    const h = makeHarness()
    h.pipeline.schedule()
    await flush()

    expect(h.readEntryHtml).toHaveBeenCalledWith(PAGE)
    expect(h.setWatchSet).toHaveBeenCalledWith([STYLE])
    expect(h.invalidate).toHaveBeenCalledWith('panel-A')
    expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'ready', 0)
    expect(h.captureWhileVisible).toHaveBeenCalledTimes(1)
  })

  it('keeps the old picture behind a hidden tab, because no new one would follow', async () => {
    const h = makeHarness()
    h.state.wanted = false
    h.pipeline.schedule()
    await flush()

    expect(h.invalidate).not.toHaveBeenCalled()
    expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'ready', 0)
    expect(h.captureWhileVisible).toHaveBeenCalledTimes(1)
  })

  it('counts the candidates the watch set dropped', async () => {
    const h = makeHarness()
    h.setWatchSet.mockResolvedValueOnce({
      watched: [],
      dropped: [{ candidate: STYLE, reason: 'over-cap' }]
    })
    h.pipeline.schedule()
    await flush()

    expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'ready', 1)
  })

  it('reports nothing when the entry cannot be read', async () => {
    const h = makeHarness()
    h.readEntryHtml.mockRejectedValueOnce(new Error('ENOENT'))
    h.pipeline.schedule()
    await flush()

    expect(h.setWatchSet).not.toHaveBeenCalled()
    expect(h.loadStateChanged).not.toHaveBeenCalled()
    expect(h.captureWhileVisible).not.toHaveBeenCalled()
  })

  it.each([
    [new Error('pool closed'), { error: 'Error' }],
    ['pool closed', { error: 'string' }],
    [Object.assign(new Error('EMFILE: /Users/me/a.css'), { code: 'EMFILE' }), { error: 'Error', code: 'EMFILE' }]
  ])(
    'still reports ready, every candidate dropped, when the watch set fails (%s)',
    async (failure, logged) => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
      const h = makeHarness()
      h.readEntryHtml.mockResolvedValueOnce(`${ONE_LINK}<script src="app.js"></script>`)
      h.setWatchSet.mockRejectedValueOnce(failure)
      h.pipeline.schedule()
      await flush()

      expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'ready', 2)
      expect(warn).toHaveBeenCalledWith('Preview auto-refresh: could not watch the page files', {
        panelId: stablePathDigest('panel-A'),
        ...logged
      })
      expect(h.captureWhileVisible).toHaveBeenCalledTimes(1)
    }
  )

  it('stops when the view is torn down during the entry read', async () => {
    const h = makeHarness()
    const read = deferred<string>()
    h.readEntryHtml.mockReturnValueOnce(read.promise)
    h.pipeline.schedule()
    h.state.tornDown = true
    read.resolve(ONE_LINK)
    await flush()

    expect(h.setWatchSet).not.toHaveBeenCalled()
    expect(h.loadStateChanged).not.toHaveBeenCalled()
  })

  it('stops when the view is torn down while the watch set is being set', async () => {
    const h = makeHarness()
    const watch = deferred<WatchSetResult>()
    h.setWatchSet.mockReturnValueOnce(watch.promise)
    h.pipeline.schedule()
    await flush()
    h.state.tornDown = true
    watch.resolve({ watched: [STYLE], dropped: [] })
    await flush()

    expect(h.loadStateChanged).not.toHaveBeenCalled()
    expect(h.captureWhileVisible).not.toHaveBeenCalled()
  })

  it('does not run once the view is torn down', async () => {
    const h = makeHarness()
    h.state.tornDown = true
    h.pipeline.schedule()
    await flush()

    expect(h.readEntryHtml).not.toHaveBeenCalled()
  })
})

describe('createPreviewLivePipeline — rate limit', () => {
  beforeEach(() => vi.useFakeTimers())

  it('runs at once, then once more at the end of the window, dropping the rest', async () => {
    const h = makeHarness()
    h.pipeline.schedule()
    h.state.now = 100
    h.pipeline.schedule()
    h.pipeline.schedule()
    expect(h.readEntryHtml).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(PREVIEW.RELOAD_MIN_INTERVAL_MS - 100 - 1)
    expect(h.readEntryHtml).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.readEntryHtml).toHaveBeenCalledTimes(2)
  })

  it('runs at once again when the window has passed', () => {
    const h = makeHarness()
    h.pipeline.schedule()
    h.state.now = PREVIEW.RELOAD_MIN_INTERVAL_MS
    h.pipeline.schedule()

    expect(h.readEntryHtml).toHaveBeenCalledTimes(2)
  })

  it("runs another page's first run at once, inside the last page's window (RS2-8)", async () => {
    // A same-tab move lands inside the old page's window. The new page's run is
    // its only still capture: held back, a tab hidden first had no picture.
    let page = PAGE
    const h = makeHarness({ currentPage: () => page })
    h.pipeline.schedule()
    h.state.now = 100
    page = resolve('/proj/site/pricing.html')
    h.pipeline.schedule()

    expect(h.readEntryHtml.mock.calls).toEqual([[PAGE], [page]])
    await vi.advanceTimersByTimeAsync(PREVIEW.RELOAD_MIN_INTERVAL_MS)
    expect(h.readEntryHtml).toHaveBeenCalledTimes(2)
  })

  it('cancel() drops the pending trailing run, and is harmless with none pending', async () => {
    const h = makeHarness()
    h.pipeline.cancel()
    h.pipeline.schedule()
    h.pipeline.schedule()
    h.pipeline.cancel()
    await vi.advanceTimersByTimeAsync(PREVIEW.RELOAD_MIN_INTERVAL_MS)

    expect(h.readEntryHtml).toHaveBeenCalledTimes(1)
  })

  it('does nothing when a trailing run fires after teardown', async () => {
    const h = makeHarness()
    h.pipeline.schedule()
    h.pipeline.schedule()
    h.state.tornDown = true
    await vi.advanceTimersByTimeAsync(PREVIEW.RELOAD_MIN_INTERVAL_MS)

    expect(h.readEntryHtml).toHaveBeenCalledTimes(1)
  })
})

describe('createPreviewLivePipeline — live reload', () => {
  it('feeds each changed path to the reload policy', () => {
    const h = makeHarness()
    h.pipeline.onWatchChanged(['/a.css', '/b.js'])

    expect(h.recordChange.mock.calls).toEqual([['/a.css'], ['/b.js']])
  })

  it('ignores changes once torn down', () => {
    const h = makeHarness()
    h.state.tornDown = true
    h.pipeline.onWatchChanged(['/a.css'])

    expect(h.recordChange).not.toHaveBeenCalled()
  })

  it('drops the old picture and reloads on a reload decision', () => {
    const h = makeHarness()
    h.pipeline.handleReloadDecision({ action: 'reload' })

    expect(h.invalidate).toHaveBeenCalledWith('panel-A')
    expect(h.reloadPage).toHaveBeenCalledWith(false)
  })

  it('swaps the stylesheet in its own isolated world on a swap decision', async () => {
    const h = makeHarness()
    h.pipeline.handleReloadDecision({ action: 'swap', changedPath: STYLE })
    await flush()

    expect(h.invalidate).toHaveBeenCalledWith('panel-A')
    const [worldId, scripts] = h.executeJavaScriptInIsolatedWorld.mock.calls[0]
    expect(worldId).toBe(999)
    expect(scripts[0].code).toContain(JSON.stringify(`erfana-preview://token/${STYLE}`))
    expect(h.reloadPage).not.toHaveBeenCalled()
  })

  it('ignores a decision once torn down', () => {
    const h = makeHarness()
    h.state.tornDown = true
    h.pipeline.handleReloadDecision({ action: 'reload' })

    expect(h.invalidate).not.toHaveBeenCalled()
    expect(h.reloadPage).not.toHaveBeenCalled()
  })

  it('passes a reload through, from the cache or around it', () => {
    const h = makeHarness()
    h.pipeline.reload(true)
    h.pipeline.reload(false)

    expect(h.reloadPage.mock.calls).toEqual([[true], [false]])
  })

  it('does not reload once torn down', () => {
    const h = makeHarness()
    h.state.tornDown = true
    h.pipeline.reload(true)

    expect(h.reloadPage).not.toHaveBeenCalled()
  })
})

describe('createPreviewLivePipeline — the stylesheet swap', () => {
  it('answers true, and does not reload, when the page swapped it', async () => {
    const h = makeHarness()

    await expect(h.pipeline.swap(STYLE)).resolves.toBe(true)
    expect(h.reloadPage).not.toHaveBeenCalled()
  })

  it.each([false, 'true', 1, undefined])(
    'falls back to a full reload when the page answers %s',
    async (answer) => {
      const h = makeHarness()
      h.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce(answer)

      await expect(h.pipeline.swap(STYLE)).resolves.toBe(false)
      expect(h.reloadPage).toHaveBeenCalledWith(false)
    }
  )

  it('falls back to a full reload when the script throws', async () => {
    const h = makeHarness()
    h.executeJavaScriptInIsolatedWorld.mockRejectedValueOnce(new Error('world gone'))

    await expect(h.pipeline.swap(STYLE)).resolves.toBe(false)
    expect(h.reloadPage).toHaveBeenCalledWith(false)
  })

  it('falls back to a full reload when the page never answers', async () => {
    vi.useFakeTimers()
    const h = makeHarness()
    h.executeJavaScriptInIsolatedWorld.mockReturnValueOnce(new Promise(() => {}))
    const swapped = h.pipeline.swap(STYLE)
    await vi.advanceTimersByTimeAsync(PREVIEW.SWAP_TIMEOUT_MS)

    await expect(swapped).resolves.toBe(false)
    expect(h.reloadPage).toHaveBeenCalledWith(false)
  })

  it('does not reload a view torn down while the swap ran', async () => {
    const h = makeHarness()
    const answer = deferred<unknown>()
    h.executeJavaScriptInIsolatedWorld.mockReturnValueOnce(answer.promise)
    const swapped = h.pipeline.swap(STYLE)
    h.state.tornDown = true
    answer.resolve(false)

    await expect(swapped).resolves.toBe(false)
    expect(h.reloadPage).not.toHaveBeenCalled()
  })

  it('busts the cache with a new version on every swap', async () => {
    const h = makeHarness()
    await h.pipeline.swap(STYLE)
    await h.pipeline.swap(STYLE)

    const codes = h.executeJavaScriptInIsolatedWorld.mock.calls.map(([, scripts]) => scripts[0].code)
    expect(codes[0]).toContain('?v=1')
    expect(codes[1]).toContain('?v=2')
  })
})

describe('createPreviewLivePipeline — the default entry reader', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'erfana-live-pipeline-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads the entry from disk when no reader is injected', async () => {
    const page = join(dir, 'index.html')
    await writeFile(page, '<link rel="stylesheet" href="a.css">')
    const h = makeHarness({ readEntryHtml: undefined, currentPage: () => page })
    h.pipeline.schedule()

    await vi.waitFor(() => expect(h.loadStateChanged).toHaveBeenCalled(), { timeout: 5000 })
    expect(h.setWatchSet).toHaveBeenCalledWith([join(dir, 'a.css')])
  })

  it('stops reading at MAX_ENTRY_HTML_BYTES, so a link past the cap is not watched', async () => {
    const page = join(dir, 'index.html')
    const padding = `<!--${'x'.repeat(PREVIEW.MAX_ENTRY_HTML_BYTES)}-->`
    await writeFile(
      page,
      `<link rel="stylesheet" href="early.css">${padding}<link rel="stylesheet" href="late.css">`
    )
    const h = makeHarness({ readEntryHtml: undefined, currentPage: () => page })
    h.pipeline.schedule()

    await vi.waitFor(() => expect(h.loadStateChanged).toHaveBeenCalled(), { timeout: 5000 })
    expect(h.setWatchSet).toHaveBeenCalledWith([join(dir, 'early.css')])
  })
})
