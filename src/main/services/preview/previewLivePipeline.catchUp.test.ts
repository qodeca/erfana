// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The save the AC24 e2e lost (issue #124 audit, follow-up). A stylesheet saved
 * after its page had loaded, but before the link scan had named it – so before
 * anything watched it – never reached the page: the page kept the old styling
 * until the next save. The link scan worker made that gap long enough for the
 * e2e's first save to land in it every run.
 *
 * The real pipeline, watch coordinator, watch pool and chokidar run against
 * real files. Only the scan is held, so the save lands exactly in the gap, and
 * the timers that coalesce changes are manual, so "once" and "nothing" are
 * counted rather than waited for.
 */
import { lstat, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW } from '../../../shared/constants'
import { inProcessLinkScanner } from './__test-helpers__/inProcessLinkScanner'
import type { PreviewLinkScanner } from './PreviewLinkScanWorkerAdapter'
import { createPreviewReloadPolicy } from './PreviewReloadPolicy'
import {
  createPreviewWatchCoordinator,
  type IPreviewWatchCoordinator
} from './PreviewWatchCoordinator'
import { createPreviewWatchPool } from './PreviewWatchPool'
import { createPreviewLivePipeline } from './previewLivePipeline'
import { createPreviewWatchBudget } from './previewWatchBudget'

/** chokidar starting on a real file, with Windows Defender's headroom. */
const TEST_TIMEOUT_MS = 30_000

/** How long before the load the files were last written: well outside any slack. */
const LONG_AGO_MS = 60_000

const coordinators: IPreviewWatchCoordinator[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(coordinators.splice(0).map((coordinator) => coordinator.dispose()))
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** Let settled promises and the work queued behind them run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Timers that fire only when the test says so. */
function manualTimers() {
  const pending = new Map<number, () => void>()
  let nextId = 1
  return {
    setTimer: (callback: () => void): ReturnType<typeof setTimeout> => {
      const id = nextId++
      pending.set(id, callback)
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: (handle: ReturnType<typeof setTimeout>): void => {
      pending.delete(handle as unknown as number)
    },
    /** Fire every pending timer, and those the fired ones set. */
    runAll(): void {
      for (let next = pending.entries().next(); !next.done; next = pending.entries().next()) {
        const [id, callback] = next.value
        pending.delete(id)
        callback()
      }
    },
    get size(): number {
      return pending.size
    }
  }
}

/** The worker's own scan, held until the test releases it. */
function heldScanner() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let started!: () => void
  const scanning = new Promise<void>((resolve) => (started = resolve))
  const scanner: PreviewLinkScanner = {
    async scan(html, options) {
      started()
      await gate
      return inProcessLinkScanner.scan(html, options)
    }
  }
  return { scanner, scanning, release }
}

/** A page linking one stylesheet, both last written long before the load. */
async function setUp() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'erfana-catch-up-')))
  dirs.push(root)
  const page = join(root, 'index.html')
  const style = join(root, 'styles.css')
  await writeFile(page, '<link rel="stylesheet" href="styles.css"><p>page</p>')
  await writeFile(style, 'body { background: #112233; }')
  const longAgo = (Date.now() - LONG_AGO_MS) / 1000
  await utimes(page, longAgo, longAgo)
  await utimes(style, longAgo, longAgo)

  const timers = manualTimers()
  const held = heldScanner()
  let stamped!: () => void
  /** The new watch is listening and has read its file's stamp. */
  const stampRead = new Promise<void>((resolve) => (stamped = resolve))
  const pool = createPreviewWatchPool({
    budget: createPreviewWatchBudget(PREVIEW.MAX_WATCHED_FILES),
    statFile: async (filePath) => {
      try {
        return await lstat(filePath)
      } finally {
        stamped()
      }
    }
  })
  const coordinator = createPreviewWatchCoordinator({
    realRoot: root,
    pool,
    onChanged: (paths) => pipeline.onWatchChanged(paths),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  })
  coordinators.push(coordinator)
  const policy = createPreviewReloadPolicy({
    onDecision: (decision) => pipeline.handleReloadDecision(decision),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  })
  const swap = vi.fn((_worldId: number, _scripts: { code: string }[]) => Promise.resolve<unknown>(true))
  const reloadPage = vi.fn<(ignoreCache: boolean) => void>()
  const loadStateChanged = vi.fn()
  const pipeline = createPreviewLivePipeline({
    panelId: 'panel-A',
    contents: { executeJavaScriptInIsolatedWorld: swap },
    emit: { loadStateChanged },
    stillFrameCache: { invalidate: vi.fn(), markLoaded: vi.fn() },
    now: () => Date.now(),
    linkScanner: held.scanner,
    currentPage: () => page,
    urlFor: (absPath) => `erfana-preview://token/${absPath}`,
    realRoot: root,
    setWatchSet: (candidates, options) => coordinator.setWatchSet(candidates, options),
    recordChange: (path) => policy.record(path),
    reloadPage,
    isWanted: () => true,
    captureWhileVisible: vi.fn(),
    isTornDown: () => false
  })
  return { style, timers, held, stampRead, pipeline, swap, reloadPage, loadStateChanged }
}

describe("live pipeline – a save made before the page's files were watched", () => {
  it(
    'swaps the stylesheet once when it was saved after the load, before the scan named it',
    async () => {
      const t = await setUp()
      t.pipeline.loadStarted()
      t.pipeline.schedule()
      await t.held.scanning
      // The page has loaded the old stylesheet, and nothing watches it yet.
      await writeFile(t.style, 'body { background: #445566; }')
      t.held.release()

      await t.stampRead
      await settle()
      expect(t.loadStateChanged).toHaveBeenCalledWith('panel-A', 'ready', 0)
      t.timers.runAll()
      await settle()

      expect(t.swap).toHaveBeenCalledTimes(1)
      expect(t.swap.mock.calls[0][1][0].code).toContain('styles.css')
      expect(t.reloadPage).not.toHaveBeenCalled()
    },
    TEST_TIMEOUT_MS
  )

  it(
    'refreshes nothing when no linked file changed since the load began',
    async () => {
      const t = await setUp()
      t.pipeline.loadStarted()
      t.pipeline.schedule()
      await t.held.scanning
      t.held.release()

      await t.stampRead
      await settle()
      expect(t.loadStateChanged).toHaveBeenCalledWith('panel-A', 'ready', 0)
      // Nothing was recorded, so nothing is waiting to coalesce.
      expect(t.timers.size).toBe(0)
      t.timers.runAll()
      await settle()

      expect(t.swap).not.toHaveBeenCalled()
      expect(t.reloadPage).not.toHaveBeenCalled()
    },
    TEST_TIMEOUT_MS
  )
})
