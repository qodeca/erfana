// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The watch-start gap on the real Windows file system (design #211 risk R4,
 * fixed by the catch-up refresh at `ready`).
 *
 * The directory watcher starts only after the first tree read (D12), and on
 * Windows a folder below the root gets its own watch later still – while the
 * native watcher plans, after it has listed the root. A file created inside
 * such a folder in between is in no tree read and in no event: the watch that
 * would report it did not exist yet, and the root's non-recursive watch sees at
 * most a timestamp change of the folder, which is dropped as noise. Before the
 * fix nothing re-read the tree for it, so the row never appeared – not on
 * collapse and re-expand either, because the tree serves the listing it read –
 * until the user pressed Refresh (the `html-preview-comments` E-004 failure).
 *
 * The test puts the write exactly there: the real `NativeRecursiveWatcher` is
 * given a `readdir` that creates `comments/crlf-bom.html` while it lists the
 * root, before `comments` has its watch. Real `fs.watch`, `lstat` and
 * `readdir` otherwise; every wait is `vi.waitFor` on a condition.
 *
 * Windows only (`describe.runIf`), like `NativeRecursiveWatcher.win32.test.ts`:
 * the event mechanics asserted here are libuv's on Windows. The fix itself is
 * pinned on every platform by the `ready` cases in
 * `DirectoryWatcherService.native.test.ts`.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { FileNode } from '../../shared/ipc/file-schema'
import type { NativeDirEntry, NativeRecursiveWatcherOptions } from './watcher/NativeRecursiveWatcher'

const harness = vi.hoisted(() => ({
  sends: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
  /** Runs before each folder listing of the native watcher's plan. */
  beforeList: null as ((target: string) => void) | null,
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          id: 1,
          send: (channel: string, payload: Record<string, unknown>) => harness.sends.push({ channel, payload })
        }
      }
    ])
  },
  webContents: { getAllWebContents: vi.fn(() => [{ id: 1, isDestroyed: () => false }]) }
}))

vi.mock('./SettingsService', () => ({
  settingsService: { getDirectoryWatchDepth: vi.fn(async () => undefined) }
}))

vi.mock('./LoggingService', () => ({ logger: harness.logger }))

// The real watcher, with a hook into its plan's folder listings
vi.mock('./watcher/NativeRecursiveWatcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./watcher/NativeRecursiveWatcher')>()
  class PlanHookedWatcher extends actual.NativeRecursiveWatcher {
    constructor(root: string, options: NativeRecursiveWatcherOptions) {
      super(root, {
        ...options,
        readdir: async (target: string): Promise<readonly NativeDirEntry[]> => {
          harness.beforeList?.(target)
          return fs.promises.readdir(target, { withFileTypes: true })
        }
      })
    }
  }
  return { ...actual, NativeRecursiveWatcher: PlanHookedWatcher }
})

import { DirectoryWatcherService } from './DirectoryWatcherService'

/** Budget for one expected event – generous for Defender scans and a loaded host. */
const EVENT_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 25
const TEST_TIMEOUT_MS = 90_000

const webContents = { id: 1 } as unknown as WebContents
const services: DirectoryWatcherService[] = []
const tempDirs: string[] = []

afterEach(async () => {
  // Close before cleanup: removing a folder under an open handle floods it
  await Promise.all(services.splice(0).map(svc => svc.dispose()))
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  harness.sends.length = 0
  harness.beforeList = null
  vi.clearAllMocks()
})

function makeTempDir(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

function write(file: string, content = 'x'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

const fileNode = (root: string, ...segments: string[]): FileNode => ({
  name: segments[segments.length - 1],
  path: path.join(root, ...segments),
  type: 'file'
})

/** The `directory-watch:changed` broadcasts that make the tree re-read. */
const structuralSends = (): Array<Record<string, unknown>> =>
  harness.sends
    .filter(s => s.channel === 'directory-watch:changed' && s.payload.structural === true)
    .map(s => s.payload)

const nativeReady = (): boolean =>
  harness.logger.info.mock.calls.some(([message]) => message === 'Native directory watcher ready')

const waitOptions = { timeout: EVENT_TIMEOUT_MS, interval: POLL_INTERVAL_MS }

describe.runIf(process.platform === 'win32')('a file created before its folder\'s watch opened (start gap)', () => {
  it(
    'has the tree re-read once the watch is ready, though no event ever reports the file',
    async () => {
      const root = makeTempDir('erfana-start-gap-')
      write(path.join(root, 'notes.md'))
      write(path.join(root, 'comments', 'e001.html'))
      const gapFile = path.join(root, 'comments', 'crlf-bom.html')
      const sentinel = path.join(root, 'comments', 'after-ready.html')

      const svc = new DirectoryWatcherService({ backend: 'native-recursive' })
      services.push(svc)
      svc.setProjectPath(root)
      // The first tree read ran before the watch starts (D12): it showed these
      svc.beginKnownEntriesRead(root).commit([
        { name: 'comments', path: path.join(root, 'comments'), type: 'directory', children: [fileNode(root, 'comments', 'e001.html')] },
        fileNode(root, 'notes.md')
      ])
      // While the plan lists the root – its own watch is open, comments/ has none yet
      let gapWritten = false
      harness.beforeList = target => {
        if (gapWritten || target.toLowerCase() !== root.toLowerCase()) return
        write(gapFile, '<html></html>')
        gapWritten = true
      }
      const queueEvent = vi.spyOn(
        svc as unknown as { queueEvent: (dirPath: string, event: { type: string; path: string }) => void },
        'queueEvent'
      )
      const queued = (type: string, file: string): boolean =>
        queueEvent.mock.calls.some(([, event]) => event.type === type && event.path.toLowerCase() === file.toLowerCase())

      await svc.watchDirectory(root, webContents)
      await vi.waitFor(() => expect(nativeReady()).toBe(true), waitOptions)
      expect(gapWritten).toBe(true)

      // With nothing else changing on disk, the window is still told to re-read
      await vi.waitFor(() => expect(structuralSends()).not.toEqual([]), waitOptions)
      expect(structuralSends()[0]).toEqual(expect.objectContaining({ dirPath: root, catchUp: true }))

      // …and that re-read is the only way the file reaches the tree: a file
      // written after `ready` arrives as an `add`; the gap file never did
      write(sentinel)
      await vi.waitFor(() => expect(queued('add', sentinel)).toBe(true), waitOptions)
      expect(queued('add', gapFile)).toBe(false)
    },
    TEST_TIMEOUT_MS
  )
})
