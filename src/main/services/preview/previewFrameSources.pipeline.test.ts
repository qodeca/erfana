// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Frame sources in the post-load pipeline (issue #124, WI-15; design part 2
 * §2.9): the frames' files are watched after the page's, a stylesheet a frame
 * uses too reloads instead of swapping, and a late run cannot bring back a
 * frame the page no longer has. Split from `previewFrameSources.test.ts` to keep
 * both under the file-size cap.
 */
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW } from '../../../shared/constants'
import type { WatchSetResult } from './PreviewWatchCoordinator'
import { createPreviewLivePipeline } from './previewLivePipeline'

/** A reader over an in-memory project; any other path rejects as missing. */
function readerFor(files: Readonly<Record<string, string>>) {
  const byPath = new Map(Object.entries(files))
  return vi.fn((filePath: string): Promise<string> => {
    const html = byPath.get(filePath)
    return html === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(html)
  })
}

describe('frame sources in the post-load pipeline', () => {
  const FRAMED_PAGE =
    '<link rel="stylesheet" href="shared.css"><link rel="stylesheet" href="top.css">' +
    '<iframe src="child.html"></iframe>'
  const CHILD = '<link rel="stylesheet" href="shared.css"><img src="child.png">'
  // On disk, because the pipeline confines each frame document with the real gate.
  let dir = ''
  const inDir = (rel: string): string => join(dir, rel)

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'erfana-frame-pipeline-')))
    await writeFile(inDir('index.html'), FRAMED_PAGE)
    await writeFile(inDir('child.html'), CHILD)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
    let resolvePromise!: (value: T) => void
    const promise = new Promise<T>(res => {
      resolvePromise = res
    })
    return { promise, resolve: resolvePromise }
  }

  function makePipeline() {
    const state = { tornDown: false, now: 0 }
    const fakes = {
      readEntryHtml: readerFor({
        [inDir('index.html')]: FRAMED_PAGE,
        [inDir('child.html')]: CHILD
      }),
      setWatchSet: vi.fn(
        (candidates: readonly string[]): Promise<WatchSetResult> =>
          Promise.resolve({ watched: [...candidates], dropped: [] })
      ),
      reloadPage: vi.fn<(ignoreCache: boolean) => void>(),
      executeJavaScriptInIsolatedWorld: vi.fn(
        (_worldId: number, _scripts: { code: string }[]): Promise<unknown> => Promise.resolve(true)
      ),
      loadStateChanged: vi.fn()
    }
    const pipeline = createPreviewLivePipeline({
      panelId: 'panel-A',
      contents: { executeJavaScriptInIsolatedWorld: fakes.executeJavaScriptInIsolatedWorld },
      emit: { loadStateChanged: fakes.loadStateChanged },
      stillFrameCache: { invalidate: vi.fn() },
      now: () => state.now,
      readEntryHtml: fakes.readEntryHtml,
      currentPage: () => inDir('index.html'),
      urlFor: absPath => `erfana-preview://token/${absPath}`,
      realRoot: dir,
      setWatchSet: fakes.setWatchSet,
      recordChange: vi.fn(),
      reloadPage: fakes.reloadPage,
      isWanted: () => true,
      captureWhileVisible: vi.fn(),
      isTornDown: () => state.tornDown
    })
    return { ...fakes, state, pipeline }
  }

  async function ready(h: ReturnType<typeof makePipeline>, times = 1): Promise<void> {
    await vi.waitFor(() => expect(h.loadStateChanged).toHaveBeenCalledTimes(times))
  }

  it("watches the page's files first, then its frame's", async () => {
    const h = makePipeline()
    h.pipeline.schedule()
    await ready(h)

    expect(h.setWatchSet).toHaveBeenCalledWith(
      ['shared.css', 'top.css', 'child.html', 'child.png'].map(inDir)
    )
    expect(h.loadStateChanged).toHaveBeenCalledWith('panel-A', 'ready', 0)
  })

  it('reloads, instead of swapping, a stylesheet a frame uses too', async () => {
    const h = makePipeline()
    h.pipeline.schedule()
    await ready(h)
    h.pipeline.handleReloadDecision({ action: 'swap', changedPath: inDir('shared.css') })

    expect(h.reloadPage).toHaveBeenCalledWith(false)
    expect(h.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })

  it('still swaps a stylesheet only the page uses', async () => {
    const h = makePipeline()
    h.pipeline.schedule()
    await ready(h)
    h.pipeline.handleReloadDecision({ action: 'swap', changedPath: inDir('top.css') })

    await vi.waitFor(() => expect(h.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1))
    expect(h.reloadPage).not.toHaveBeenCalled()
  })

  it('stops when the view is torn down while a frame document is read', async () => {
    const h = makePipeline()
    const frameRead = deferred<string>()
    h.readEntryHtml.mockResolvedValueOnce(FRAMED_PAGE).mockReturnValueOnce(frameRead.promise)
    h.pipeline.schedule()
    await vi.waitFor(() => expect(h.readEntryHtml).toHaveBeenCalledTimes(2))
    h.state.tornDown = true
    frameRead.resolve(CHILD)
    await new Promise(resolveFlush => setImmediate(resolveFlush))

    expect(h.setWatchSet).not.toHaveBeenCalled()
    expect(h.loadStateChanged).not.toHaveBeenCalled()
  })

  it('keeps the frame assets of the newest run when an older run finishes last', async () => {
    const h = makePipeline()
    const slowWatch = deferred<WatchSetResult>()
    h.setWatchSet.mockReturnValueOnce(slowWatch.promise)
    h.pipeline.schedule() // the page still has its frame; its watch set hangs
    await vi.waitFor(() => expect(h.setWatchSet).toHaveBeenCalledTimes(1))

    h.readEntryHtml.mockResolvedValueOnce('<link rel="stylesheet" href="shared.css">')
    h.state.now = PREVIEW.RELOAD_MIN_INTERVAL_MS
    h.pipeline.schedule() // the frame is gone, and this run finishes first
    await ready(h)
    slowWatch.resolve({ watched: [inDir('shared.css'), inDir('child.html')], dropped: [] })
    await ready(h, 2)
    h.pipeline.handleReloadDecision({ action: 'swap', changedPath: inDir('shared.css') })

    await vi.waitFor(() => expect(h.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1))
    expect(h.reloadPage).not.toHaveBeenCalled()
  })
})
