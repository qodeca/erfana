// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * NativeRecursiveWatcher on the real Windows file system (#211, W14).
 *
 * The expectations come from the W0 spike (`docs/spikes/211-windows-fs-watch.md`,
 * libuv 1.51.0): a deleted watched folder reports itself as a `\\?\` absolute
 * path in a tight loop until its handle closes, a renamed watched folder's
 * handle follows the folder, a burst overflows the 4 KB change buffer into
 * `null` filenames, and links are leaves. If an Electron or Node upgrade
 * changes any of that, this suite is meant to fail.
 *
 * Real `fs.watch`, `lstat` and `readdir` throughout; the only wrappers count
 * raw events per handle and record `lstat` calls. Every temp folder is
 * resolved with `realpathSync.native` (no 8.3 short form), every watcher is
 * closed before its folder is removed, and every wait is `vi.waitFor` on a
 * condition – never a fixed sleep. The one timed window (the self-event count
 * across 500 ms) is itself a condition polled by `vi.waitFor`.
 *
 * Windows only: `describe.runIf`, so the suite is skipped on Linux CI and runs
 * on a Windows host and in the advisory `Windows checks` job.
 */
import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { NativeRecursiveWatcher, type NativeFsWatch } from './NativeRecursiveWatcher'
import type { DirectoryWatchResyncReason } from './directoryWatchBackend'

const execFileAsync = promisify(execFile)

/** Budget for one expected event – generous for Defender scans and a loaded host. */
const EVENT_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 25
const TEST_TIMEOUT_MS = 90_000
/** W0: a deleted watched folder's own handle floods ~70,000 events a second until closed. */
const SELF_EVENT_WINDOW_MS = 500
const SELF_EVENT_CEILING = 100
const CHURN_FILES = 200
const BURST_FILES = 1000

const PATH_EVENTS = ['add', 'addDir', 'unlink', 'unlinkDir', 'change'] as const
type PathEvent = (typeof PATH_EVENTS)[number]

interface RecordedEvent {
  readonly type: PathEvent
  readonly path: string
}

/** One real `fs.watch` handle the watcher opened, with its raw-event counts. */
interface HandleRecord {
  readonly target: string
  readonly recursive: boolean
  raw: number
  rawAfterClose: number
  closed: boolean
}

interface Probe {
  readonly root: string
  readonly watcher: NativeRecursiveWatcher
  readonly events: RecordedEvent[]
  readonly errorCodes: string[]
  readonly resyncs: DirectoryWatchResyncReason[]
  readonly handles: HandleRecord[]
  readonly lstatCalls: string[]
  ready: boolean
}

interface ProbeOptions {
  /** Root-relative `/` paths dropped with everything under them. */
  readonly dropped?: readonly string[]
  readonly splitPaths?: readonly string[]
}

const openWatchers: NativeRecursiveWatcher[] = []
const tempDirs: string[] = []

afterEach(async () => {
  // Close before cleanup: removing a folder under an open handle floods it
  await Promise.all(openWatchers.splice(0).map(watcher => watcher.close()))
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const fold = (value: string): string => value.toLowerCase()

/** `candidate` is `ancestor` itself or lies under it (case-insensitive, like NTFS). */
function isAtOrUnder(candidate: string, ancestor: string): boolean {
  const c = fold(candidate)
  const a = fold(ancestor)
  return c === a || c.startsWith(a + path.sep)
}

function isStrictlyUnder(candidate: string, ancestor: string): boolean {
  return fold(candidate).startsWith(fold(ancestor) + path.sep)
}

function makeTempDir(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

function write(file: string, content = 'x'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function startProbe(root: string, options: ProbeOptions = {}): Probe {
  const dropped = options.dropped ?? []
  const handles: HandleRecord[] = []
  const lstatCalls: string[] = []

  const fsWatch: NativeFsWatch = (target, watchOptions, listener) => {
    const record: HandleRecord = { target, recursive: watchOptions.recursive, raw: 0, rawAfterClose: 0, closed: false }
    const handle = fs.watch(target, watchOptions, (eventType, filename) => {
      record.raw++
      if (record.closed) record.rawAfterClose++
      listener(eventType, filename)
    })
    handles.push(record)
    return {
      close: () => {
        record.closed = true
        handle.close()
      },
      on: (event, errorListener) => handle.on(event, errorListener)
    }
  }

  const watcher = new NativeRecursiveWatcher(root, {
    shouldDrop: rel => dropped.some(entry => rel === entry || rel.startsWith(`${entry}/`)),
    splitPaths: options.splitPaths ?? [],
    caseSensitive: false,
    fsWatch,
    lstat: target => {
      lstatCalls.push(target)
      return fs.promises.lstat(target)
    }
  })
  openWatchers.push(watcher)

  const probe: Probe = {
    root,
    watcher,
    events: [],
    errorCodes: [],
    resyncs: [],
    handles,
    lstatCalls,
    ready: false
  }
  for (const type of PATH_EVENTS) {
    watcher.on(type, (eventPath: string) => probe.events.push({ type, path: eventPath }))
  }
  watcher.on('error', (error: Error) => probe.errorCodes.push(String((error as NodeJS.ErrnoException).code)))
  watcher.on('resync', (reason: DirectoryWatchResyncReason) => probe.resyncs.push(reason))
  watcher.on('ready', () => {
    probe.ready = true
  })
  return probe
}

async function startReadyProbe(root: string, options: ProbeOptions = {}): Promise<Probe> {
  const probe = startProbe(root, options)
  await vi.waitFor(() => expect(probe.ready).toBe(true), { timeout: EVENT_TIMEOUT_MS, interval: POLL_INTERVAL_MS })
  return probe
}

function count(probe: Probe, type: PathEvent, eventPath: string): number {
  return probe.events.filter(event => event.type === type && fold(event.path) === fold(eventPath)).length
}

async function waitForEvent(probe: Probe, type: PathEvent, eventPath: string): Promise<void> {
  await vi.waitFor(() => expect(count(probe, type, eventPath), `${type} ${eventPath}`).toBeGreaterThan(0), {
    timeout: EVENT_TIMEOUT_MS,
    interval: POLL_INTERVAL_MS
  })
}

function handlesAt(probe: Probe, target: string): HandleRecord[] {
  return probe.handles.filter(handle => fold(handle.target) === fold(target))
}

function onlyHandleAt(probe: Probe, target: string): HandleRecord {
  const found = handlesAt(probe, target)
  expect(found, `handles at ${target}`).toHaveLength(1)
  return found[0]
}

describe.runIf(process.platform === 'win32')('NativeRecursiveWatcher on the real Windows file system (#211, W14)', () => {
  it(
    'reports add, remove and rename of a file and a folder, at the root and inside a recursive watch',
    async () => {
      const root = makeTempDir('erfana-w14-events-')
      fs.mkdirSync(path.join(root, 'src'))
      const probe = await startReadyProbe(root)
      const src = path.join(root, 'src')
      expect(onlyHandleAt(probe, root).recursive).toBe(false)
      expect(onlyHandleAt(probe, src).recursive).toBe(true)

      // A file at the root (the root's own non-recursive watch)
      write(path.join(root, 'top.md'))
      await waitForEvent(probe, 'add', path.join(root, 'top.md'))
      fs.renameSync(path.join(root, 'top.md'), path.join(root, 'top-2.md'))
      await waitForEvent(probe, 'unlink', path.join(root, 'top.md'))
      await waitForEvent(probe, 'add', path.join(root, 'top-2.md'))

      // A file inside a recursive watch
      write(path.join(src, 'a.md'))
      await waitForEvent(probe, 'add', path.join(src, 'a.md'))
      fs.renameSync(path.join(src, 'a.md'), path.join(src, 'b.md'))
      await waitForEvent(probe, 'unlink', path.join(src, 'a.md'))
      await waitForEvent(probe, 'add', path.join(src, 'b.md'))
      fs.unlinkSync(path.join(src, 'b.md'))
      await waitForEvent(probe, 'unlink', path.join(src, 'b.md'))

      // A folder inside a recursive watch
      fs.mkdirSync(path.join(src, 'sub'))
      await waitForEvent(probe, 'addDir', path.join(src, 'sub'))
      fs.renameSync(path.join(src, 'sub'), path.join(src, 'sub-2'))
      await waitForEvent(probe, 'unlinkDir', path.join(src, 'sub'))
      await waitForEvent(probe, 'addDir', path.join(src, 'sub-2'))
      fs.rmdirSync(path.join(src, 'sub-2'))
      await waitForEvent(probe, 'unlinkDir', path.join(src, 'sub-2'))

      expect(probe.errorCodes).toEqual([])
    },
    TEST_TIMEOUT_MS
  )

  it(
    'watches a new top-level folder, reporting it only once its own watch is open',
    async () => {
      const root = makeTempDir('erfana-w14-newtop-')
      const probe = await startReadyProbe(root)
      const folder = path.join(root, 'new-top')

      fs.mkdirSync(folder)
      await waitForEvent(probe, 'addDir', folder)
      expect(onlyHandleAt(probe, folder).recursive).toBe(true)

      write(path.join(folder, 'inner.md'))
      await waitForEvent(probe, 'add', path.join(folder, 'inner.md'))
    },
    TEST_TIMEOUT_MS
  )

  it(
    `reports nothing, stats nothing and opens nothing for ${CHURN_FILES} files churned in excluded paths`,
    async () => {
      const root = makeTempDir('erfana-w14-churn-')
      const topExcluded = path.join(root, 'scratch')
      const nestedExcluded = path.join(root, 'pkg', 'scratch')
      fs.mkdirSync(topExcluded)
      fs.mkdirSync(nestedExcluded, { recursive: true })
      const probe = await startReadyProbe(root, {
        dropped: ['scratch', 'pkg/scratch'],
        splitPaths: ['pkg/scratch']
      })
      // The split plan: `pkg` is watched on its own, non-recursively, so its
      // excluded child gets no handle either
      expect(onlyHandleAt(probe, path.join(root, 'pkg')).recursive).toBe(false)

      for (const dir of [topExcluded, nestedExcluded]) {
        for (let i = 0; i < CHURN_FILES; i++) {
          const file = path.join(dir, `churn-${String(i).padStart(4, '0')}.log`)
          fs.writeFileSync(file, 'first')
          fs.appendFileSync(file, ' second')
          fs.unlinkSync(file)
        }
      }
      // Sentinels on the same handles as the excluded folders' parents: their
      // events arrive after any the churn caused there
      write(path.join(root, 'sentinel-root.md'))
      write(path.join(root, 'pkg', 'sentinel-pkg.md'))
      await waitForEvent(probe, 'add', path.join(root, 'sentinel-root.md'))
      await waitForEvent(probe, 'add', path.join(root, 'pkg', 'sentinel-pkg.md'))

      for (const dir of [topExcluded, nestedExcluded]) {
        expect(probe.events.filter(event => isAtOrUnder(event.path, dir))).toEqual([])
        expect(probe.lstatCalls.filter(call => isAtOrUnder(call, dir))).toEqual([])
        expect(probe.handles.filter(handle => isAtOrUnder(handle.target, dir))).toEqual([])
      }
    },
    TEST_TIMEOUT_MS
  )

  it(
    'closes a deleted watched top-level folder at once, reports it gone once, and watches a re-created one afresh',
    async () => {
      const root = makeTempDir('erfana-w14-delete-')
      const child = path.join(root, 'child')
      write(path.join(child, 'a.txt'))
      write(path.join(child, 'sub', 'b.txt'))
      const probe = await startReadyProbe(root)
      const oldHandle = onlyHandleAt(probe, child)
      expect(oldHandle.recursive).toBe(true)

      const deletedAt = performance.now()
      fs.rmSync(child, { recursive: true, force: true })
      await waitForEvent(probe, 'unlinkDir', child)

      expect(oldHandle.closed).toBe(true)
      // Fully gone: the name is free at once (W0: ENOENT, not a delete-pending EPERM)
      await expect(fs.promises.lstat(child)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(fs.readdirSync(root)).not.toContain('child')

      // Re-creatable, and watched by a new handle – the old one never sees it
      fs.mkdirSync(child)
      await waitForEvent(probe, 'addDir', child)
      const handles = handlesAt(probe, child)
      expect(handles).toHaveLength(2)
      expect(handles[1].closed).toBe(false)
      write(path.join(child, 'after.txt'))
      await waitForEvent(probe, 'add', path.join(child, 'after.txt'))

      // The self-event flood stayed shut for the whole window
      await vi.waitFor(
        () => expect(performance.now() - deletedAt).toBeGreaterThanOrEqual(SELF_EVENT_WINDOW_MS),
        { timeout: EVENT_TIMEOUT_MS, interval: POLL_INTERVAL_MS }
      )
      expect(oldHandle.raw).toBeLessThan(SELF_EVENT_CEILING)
      expect(oldHandle.rawAfterClose).toBe(0)
      expect(count(probe, 'unlinkDir', child)).toBe(1)
      expect(probe.errorCodes).toEqual([])
    },
    TEST_TIMEOUT_MS
  )

  it(
    'reports a file written in a renamed watched folder under the new path, and none under the old',
    async () => {
      const root = makeTempDir('erfana-w14-rename-')
      const before = path.join(root, 'top')
      const after = path.join(root, 'top-renamed')
      write(path.join(before, 'a.txt'))
      const probe = await startReadyProbe(root)
      const oldHandle = onlyHandleAt(probe, before)

      fs.renameSync(before, after)
      await waitForEvent(probe, 'unlinkDir', before)
      await waitForEvent(probe, 'addDir', after)
      expect(oldHandle.closed).toBe(true)
      expect(onlyHandleAt(probe, after).recursive).toBe(true)

      write(path.join(after, 'after.txt'))
      await waitForEvent(probe, 'add', path.join(after, 'after.txt'))

      expect(probe.events.filter(event => isStrictlyUnder(event.path, before))).toEqual([])
    },
    TEST_TIMEOUT_MS
  )

  it(
    `turns a ${BURST_FILES}-file burst from another process into at most two resyncs, and keeps reporting`,
    async () => {
      const root = makeTempDir('erfana-w14-burst-')
      const burst = path.join(root, 'burst')
      fs.mkdirSync(burst)
      const probe = await startReadyProbe(root)
      expect(onlyHandleAt(probe, burst).recursive).toBe(true)

      const script = [
        "const fs = require('fs')",
        "const path = require('path')",
        'const dir = process.argv[1]',
        `for (let i = 0; i < ${BURST_FILES}; i++) {`,
        "  fs.writeFileSync(path.join(dir, 'burst-file-' + String(i).padStart(5, '0') + '-with-a-longer-name.txt'), 'x')",
        '}'
      ].join('\n')
      await execFileAsync(process.execPath, ['-e', script, burst], { windowsHide: true })

      // Settled: either the lost batches were answered by a resync and none is
      // pending any more, or no batch was lost and every file was reported
      const isResyncIdle = (): boolean =>
        (probe.watcher as unknown as { resyncPending: unknown }).resyncPending === null
      const burstAdds = (): number =>
        probe.events.filter(event => event.type === 'add' && isStrictlyUnder(event.path, burst)).length
      await vi.waitFor(
        () => expect((probe.resyncs.length > 0 && isResyncIdle()) || burstAdds() >= BURST_FILES).toBe(true),
        { timeout: 60_000, interval: POLL_INTERVAL_MS }
      )

      write(path.join(burst, 'after-burst.txt'))
      await waitForEvent(probe, 'add', path.join(burst, 'after-burst.txt'))

      expect(probe.resyncs.length).toBeLessThanOrEqual(2)
      expect(onlyHandleAt(probe, burst).closed).toBe(false)
      expect(probe.errorCodes).toEqual([])
    },
    TEST_TIMEOUT_MS
  )

  it(
    'reports ENOENT when the watched root itself is deleted, with every handle closed',
    async () => {
      const root = makeTempDir('erfana-w14-root-')
      write(path.join(root, 'child', 'a.txt'))
      const probe = await startReadyProbe(root)
      expect(probe.handles.length).toBeGreaterThanOrEqual(2)

      fs.rmSync(root, { recursive: true, force: true })

      await vi.waitFor(() => expect(probe.errorCodes).toContain('ENOENT'), {
        timeout: EVENT_TIMEOUT_MS,
        interval: POLL_INTERVAL_MS
      })
      expect(probe.handles.every(handle => handle.closed)).toBe(true)
      for (const handle of probe.handles) {
        expect(handle.raw, handle.target).toBeLessThan(SELF_EVENT_CEILING)
      }
    },
    TEST_TIMEOUT_MS
  )

  it(
    'gives a junction child no handle and reports nothing inside it',
    async () => {
      const root = makeTempDir('erfana-w14-junction-')
      const outside = makeTempDir('erfana-w14-junction-target-')
      const link = path.join(root, 'link')
      const real = path.join(root, 'real')
      fs.mkdirSync(real)
      fs.symlinkSync(outside, link, 'junction')
      const probe = await startReadyProbe(root)

      expect(probe.handles.filter(handle => isAtOrUnder(handle.target, link))).toEqual([])
      expect(onlyHandleAt(probe, real).recursive).toBe(true)

      write(path.join(outside, 'direct.txt'))
      write(path.join(link, 'through-link.txt'))
      // Sentinel on the root's own watch, after the writes above
      write(path.join(root, 'sentinel.md'))
      await waitForEvent(probe, 'add', path.join(root, 'sentinel.md'))

      expect(probe.events.filter(event => isStrictlyUnder(event.path, link))).toEqual([])
    },
    TEST_TIMEOUT_MS
  )

  it(
    'releases every handle on close, so the folder can then be removed with nothing reported',
    async () => {
      const root = makeTempDir('erfana-w14-close-')
      write(path.join(root, 'src', 'a.md'))
      const probe = await startReadyProbe(root)
      expect(probe.handles.length).toBeGreaterThanOrEqual(2)

      await probe.watcher.close()
      expect(probe.handles.every(handle => handle.closed)).toBe(true)
      const eventsAtClose = probe.events.length
      fs.rmSync(root, { recursive: true, force: true })

      // Barrier: a fresh watch elsewhere reports a write, so the event loop has
      // processed file-system events since the removal
      const barrierDir = makeTempDir('erfana-w14-close-barrier-')
      let barrierSeen = false
      const barrier = fs.watch(barrierDir, () => {
        barrierSeen = true
      })
      try {
        write(path.join(barrierDir, 'barrier.txt'))
        await vi.waitFor(() => expect(barrierSeen).toBe(true), { timeout: EVENT_TIMEOUT_MS, interval: POLL_INTERVAL_MS })
      } finally {
        barrier.close()
      }

      expect(probe.events.length).toBe(eventsAtClose)
      expect(probe.errorCodes).toEqual([])
      expect(probe.handles.every(handle => handle.rawAfterClose === 0)).toBe(true)
    },
    TEST_TIMEOUT_MS
  )
})
