// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Same-tab moves through the service (issue #124, WI-17b; part 3 §3.4–§3.6):
 * what a commit resets, what an aborted move keeps, the zoom, the still frame,
 * a move that commits with 404, link routing in project space, the pipeline
 * held while a move is on its way, and the gesture an in-page step spends to be
 * pushed (QG-7 S1, QG-8 T1). Resume after a suspend is in
 * `PreviewViewService.resume.test.ts`; the harness is shared.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW } from '../../../shared/constants'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import {
  frameOf,
  makeHarness,
  nativeHistory,
  removeProjects
} from './__test-helpers__/previewViewServiceNavHarness'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  removeProjects()
})

/** The page is refused before it commits: what the protocol handler records. */
const REFUSED_B: PreviewFailureInput = {
  type: 'missing-local-file',
  resourceUrlOrHost: '/b.html',
  reasonCode: ErrorCode.PREVIEW_LOCAL_FILE_MISSING
}

describe('PreviewViewService — a same-tab move', () => {
  it('a commit retargets the page watch, the watch set and the links, and drops the still (part 3 §3.4)', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    const answer = await h.move('b.html')
    expect(answer).toEqual({
      ok: true,
      target: { filePath: h.file('b.html'), anchor: null },
      generation: 0
    })
    expect(page.contents.loadURL).toHaveBeenLastCalledWith(h.url('b.html'))
    page.commit(h.url('b.html'))

    expect(h.entryWatchers.map((watcher) => watcher.filePath)).toEqual([
      join(h.realRoot, 'a.html'),
      join(h.realRoot, 'b.html')
    ])
    expect(h.entryWatchers[0].close).toHaveBeenCalledTimes(1)
    expect(h.stillFrameCache.invalidate).toHaveBeenCalledWith('panel-A')
    expect(h.emit.pageChanged).toHaveBeenLastCalledWith('panel-A', {
      filePath: h.file('b.html'),
      anchor: null,
      sameDocument: false,
      failed: false,
      canGoBack: true,
      canGoForward: false,
      backTarget: { filePath: h.file('a.html'), anchor: null },
      forwardTarget: null,
      generation: 1
    })

    // The watch set follows at the run after B's did-finish-load (WI-15).
    page.finish()
    await vi.advanceTimersByTimeAsync(PREVIEW.RELOAD_MIN_INTERVAL_MS)
    expect(h.readEntryHtml).toHaveBeenLastCalledWith(join(h.realRoot, 'b.html'))
    expect(h.loadStates().at(-1)).toBe('ready')

    // Links resolve against B now: a link into B is a scroll, one to A opens it.
    page.click(h.url('b.html', '#faq'))
    page.click(h.url('a.html'))
    await vi.waitFor(() => expect(h.emit.openFileRequested).toHaveBeenCalledTimes(1))
    expect(h.emit.openFileRequested).toHaveBeenCalledWith(
      'panel-A',
      h.file('a.html'),
      null,
      1,
      'by-mode'
    )
  })

  it('a move supersedes a reload in flight: only a navigation is pending (RS2-5)', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    await h.service.reload('panel-A')
    expect(page.contents.reload).toHaveBeenCalledTimes(1)

    expect(await h.move('b.html')).toEqual(expect.objectContaining({ ok: true }))
    expect(await h.move('c.html')).toEqual({
      ok: false,
      errorCode: ErrorCode.PREVIEW_NAV_SKIPPED
    })
    page.commit(h.url('b.html'))

    expect(h.emit.pageChanged).toHaveBeenLastCalledWith(
      'panel-A',
      expect.objectContaining({ filePath: h.file('b.html'), generation: 1 })
    )
  })

  it("keeps the reader's zoom on the page a move lands on", async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    await h.service.setZoom('panel-A', 1)
    const level = page.contents.setZoomLevel.mock.calls.at(-1)?.[0]
    expect(level).not.toBe(0)

    await h.move('b.html')
    page.commit(h.url('b.html'))

    expect(page.contents.setZoomLevel).toHaveBeenCalledTimes(2)
    expect(page.contents.setZoomLevel).toHaveBeenLastCalledWith(level)
  })

  it("an aborted move – a did-stop-loading with no commit – keeps A's watch, badge and log", async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    page.emit('unresponsive')
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    expect(h.lastSnapshot()).toEqual([expect.objectContaining({ type: 'render-crash' })])
    // The crash dropped A's picture already; the aborted move drops nothing more.
    const invalidated = h.stillFrameCache.invalidate.mock.calls.length

    await h.move('b.html')
    page.emit('did-finish-load') // S16: the OLD page's, while B is pending
    page.stop() // the move never committed

    expect(h.entryWatchers).toHaveLength(1)
    expect(h.entryWatchers[0].close).not.toHaveBeenCalled()
    expect(h.stillFrameCache.invalidate).toHaveBeenCalledTimes(invalidated)
    expect(h.logs[0].drop).not.toHaveBeenCalled()
    expect(h.emit.pageChanged).toHaveBeenCalledTimes(1) // the first page only
    // A is still on screen: its next failure joins its own badge.
    page.emit('unresponsive')
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    expect(h.lastSnapshot()).toHaveLength(2)
    // And the next move is not refused as pending.
    expect(await h.move('b.html')).toEqual(expect.objectContaining({ ok: true }))
  })

  it('Back after a #section jump stays on the page: same document, badge kept', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    page.emit('unresponsive')
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    // The reader's click on the #faq link: the step is pushed (QG-7 S1).
    page.input('mouseDown')
    page.inPage(h.url('a.html', '#faq'))
    expect(h.emit.pageChanged).toHaveBeenLastCalledWith(
      'panel-A',
      expect.objectContaining({ anchor: 'faq', sameDocument: true, generation: 1 })
    )
    const native = nativeHistory([h.url('a.html'), h.url('a.html', '#faq')])
    page.contents.navigationHistory = native

    const answer = await h.service.navigate(
      { panelId: 'panel-A', phase: 'commit', action: 'back', generation: 1 },
      1
    )
    expect(answer).toEqual({
      ok: true,
      target: { filePath: h.file('a.html'), anchor: null },
      generation: 1
    })
    expect(native.goToIndex).toHaveBeenCalledWith(0)
    page.inPage(h.url('a.html'))

    expect(h.emit.pageChanged).toHaveBeenLastCalledWith(
      'panel-A',
      expect.objectContaining({ anchor: null, sameDocument: true, canGoForward: true })
    )
    expect(h.logs[0].drop).not.toHaveBeenCalled()
    expect(h.lastSnapshot()).toEqual([expect.objectContaining({ type: 'render-crash' })])
    expect(h.entryWatchers).toHaveLength(1)
  })

  it("a move drops A's still, and a hide as soon as B has loaded publishes B's frame (RS2-8)", async () => {
    const h = makeHarness()
    await h.service.open(h.request('panel-A', 'a.html'), h.window)
    await h.service.setVisibility('panel-A', true, 'test')
    const page = h.pages[0]
    page.commit(h.url('a.html'))
    page.finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.stillFrameCache.get('panel-A')).toEqual(frameOf(h.url('a.html')))

    await h.move('b.html')
    page.commit(h.url('b.html'))
    expect(h.stillFrameCache.get('panel-A')).toBeUndefined()

    // Hidden as soon as B has loaded, inside A's rate-limit window: a reader
    // who moves and then switches tab at once.
    page.finish()
    await vi.advanceTimersByTimeAsync(0)
    await h.service.setVisibility('panel-A', false, 'test')

    expect(h.emit.stillFrameChanged).toHaveBeenCalledTimes(1)
    expect(h.emit.stillFrameChanged).toHaveBeenCalledWith('panel-A', frameOf(h.url('b.html')))
  })

  it('a move onto a page deleted after the check commits with 404: listed, failed, never ready (RS3-1)', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    expect(await h.move('b.html')).toEqual(expect.objectContaining({ ok: true }))
    rmSync(join(h.realRoot, 'b.html'))

    // The protocol handler refuses the page before it commits (S15).
    h.contexts[0].pageScopes().forMainDocument().recordFailure(REFUSED_B)
    page.commit(h.url('b.html'), 404)

    expect(h.lastSnapshot()).toEqual([expect.objectContaining(REFUSED_B)])
    expect(h.emit.pageChanged).toHaveBeenLastCalledWith(
      'panel-A',
      expect.objectContaining({ filePath: h.file('b.html'), failed: true })
    )
    expect(h.loadStates().at(-1)).toBe('failed')
    page.finish()
    await vi.advanceTimersByTimeAsync(PREVIEW.RELOAD_MIN_INTERVAL_MS * 2)
    expect(h.loadStates().at(-1)).toBe('failed')

    // The next page that commits clears it.
    await h.move('a.html')
    page.commit(h.url('a.html'))
    page.finish()
    await vi.advanceTimersByTimeAsync(PREVIEW.RELOAD_MIN_INTERVAL_MS)
    expect(h.loadStates().at(-1)).toBe('ready')
  })

  it('holds file-change work while a move is on its way: an aborted move replays it, a landed one drops it', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    await h.move('b.html')
    h.decide({ action: 'reload' })
    expect(page.contents.reload).not.toHaveBeenCalled()
    page.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(page.contents.reload).toHaveBeenCalledTimes(1)
    page.commit(h.url('a.html')) // the replayed reload lands

    await h.move('b.html')
    h.decide({ action: 'reload' })
    page.commit(h.url('b.html'))
    await vi.advanceTimersByTimeAsync(0)
    expect(page.contents.reload).toHaveBeenCalledTimes(1)
  })
})

describe('PreviewViewService — an in-page step is pushed only after real input (QG-7 S1)', () => {
  const WINDOW = PREVIEW_LIMITS.HISTORY_GESTURE_WINDOW_MS

  it('replaces with no gesture, pushes one step per gesture inside the window, and replaces past it', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    const entry = (anchor: string) => ({ filePath: h.file('a.html'), anchor })
    const lastChange = () => h.emit.pageChanged.mock.calls.at(-1)?.[1]

    // Only a wheel so far: a scroll spy's hash takes the page's own entry.
    page.input('mouseWheel')
    page.inPage(h.url('a.html', '#spy'))
    expect(lastChange()).toEqual(
      expect.objectContaining({ ...entry('spy'), canGoBack: false, generation: 1 })
    )

    page.input('mouseDown')
    h.setNow(WINDOW)
    page.inPage(h.url('a.html', '#faq'))
    expect(lastChange()).toEqual(
      expect.objectContaining({ ...entry('faq'), backTarget: entry('spy'), generation: 2 })
    )

    // Still inside the window, but the click bought one entry and #faq spent
    // it: a script's step right after takes #faq's place (QG-8 T1).
    page.inPage(h.url('a.html', '#team'))
    expect(lastChange()).toEqual(
      expect.objectContaining({ ...entry('team'), backTarget: entry('spy'), generation: 3 })
    )

    page.input('keyDown')
    h.setNow(WINDOW * 2 + 1)
    page.inPage(h.url('a.html', '#end'))
    expect(lastChange()).toEqual(
      expect.objectContaining({ ...entry('end'), backTarget: entry('spy'), generation: 4 })
    )
  })

  it("a same-tab move the click made spends it: a hash step on B right after takes B's entry", async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    page.input('mouseDown')
    expect(await h.move('b.html')).toEqual(expect.objectContaining({ ok: true }))
    page.commit(h.url('b.html'))
    page.inPage(h.url('b.html', '#spy'))

    expect(h.emit.pageChanged).toHaveBeenLastCalledWith(
      'panel-A',
      expect.objectContaining({
        filePath: h.file('b.html'),
        anchor: 'spy',
        backTarget: { filePath: h.file('a.html'), anchor: null },
        generation: 2
      })
    )
  })

  it('a Back step pressed inside the page spends it: a hash step right after keeps Forward', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    await h.move('b.html')
    page.commit(h.url('b.html'))

    page.input('keyDown')
    const answer = await h.service.navigate(
      { panelId: 'panel-A', phase: 'commit', action: 'back', generation: 1 },
      1
    )
    expect(answer).toEqual(expect.objectContaining({ ok: true }))
    page.commit(h.url('a.html'))
    page.inPage(h.url('a.html', '#spy'))

    expect(h.emit.pageChanged).toHaveBeenLastCalledWith(
      'panel-A',
      expect.objectContaining({
        anchor: 'spy',
        canGoBack: false,
        forwardTarget: { filePath: h.file('b.html'), anchor: null }
      })
    )
  })
})

describe('PreviewViewService — link routing in project space (part 3 §3.1, §3.4)', () => {
  it('checks and names a linked page by its tree path in a project opened through a symlink', async () => {
    const h = makeHarness({ symlinked: true })
    await h.service.open(h.request('panel-A', 'a.html'), h.window)
    const page = h.pages[0]

    page.click(h.url('b.html'))
    await vi.waitFor(() => expect(h.emit.openFileRequested).toHaveBeenCalledTimes(1))
    vi.setSystemTime(Date.now() + 2_000)
    page.click(h.url('c.html'), 1)
    await vi.waitFor(() => expect(h.emit.openFileRequested).toHaveBeenCalledTimes(2))

    expect(h.checkEligibility).toHaveBeenCalledWith(h.file('b.html'), h.projectPath)
    expect(h.emit.openFileRequested.mock.calls).toEqual([
      ['panel-A', h.file('b.html'), null, 1, 'by-mode'],
      ['panel-A', h.file('c.html'), null, 1, 'new-tab']
    ])
  })
})
