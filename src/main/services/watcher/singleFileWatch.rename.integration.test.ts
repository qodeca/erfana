// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Real-chokidar premise check for the atomic-save re-arm (issue #70, M-7).
 *
 * The mocked re-arm tests in `FileWatcherService.atomicSave.test.ts` encode the
 * assumption they are meant to verify: they prove "given an unlink and a file
 * that is back, we re-arm", but they cannot prove that chokidar v3 with
 * `awaitWriteFinish` on a single-file watch actually emits `unlink` for
 * `mv tmp target`. On some platforms it may collapse the rename into `change`.
 *
 * This test runs the PRODUCTION watcher factory - the same options, the same
 * three handler registrations - against a real file in `os.tmpdir()`, performs
 * a real `rename` over it, and records what comes out. No Electron is involved,
 * so it runs under `npm run test:ci` - which matters, because e2e is CI
 * disabled.
 *
 * Measured when this landed: on macOS (fsevents, `usePolling: false`) chokidar
 * reports `mv tmp target` as **change**, not `unlink`, and the watch keeps
 * working afterwards - so the re-arm branch is dormant there and the plain
 * debounced change path carries the fix. The branch still matters wherever the
 * rename surfaces as `unlink`. The test asserts that disjunction rather than
 * either platform's answer, so a platform that reports `change` and then goes
 * deaf fails loudly instead of silently breaking the fix.
 *
 * Waits are bounded polls on a condition, never fixed sleeps.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { FSWatcher } from 'chokidar'
import { mkdtemp, realpath, rm, rename, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSingleFileWatcher, SINGLE_FILE_WATCH_OPTIONS } from './singleFileWatch'

/** stabilityThreshold (300ms) + pollInterval + CI/Defender headroom. */
const EVENT_BUDGET_MS = 10_000
const TEST_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 25

type RecordedEvent = 'change' | 'unlink' | 'error'

const openWatchers: FSWatcher[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(openWatchers.splice(0).map(watcher => watcher.close().catch(() => {})))
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }).catch(() => {}))
  )
})

/** Poll a condition until it holds or the budget expires. Never a fixed sleep. */
async function waitUntil(
  condition: () => boolean,
  description: string,
  timeoutMs = EVENT_BUDGET_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description}`)
}

async function createTempFile(name: string, contents: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'erfana-watch-')))
  tempDirs.push(dir)
  const filePath = join(dir, name)
  await writeFile(filePath, contents, 'utf-8')
  return filePath
}

/** Start the production watcher and resolve once chokidar reports it is ready. */
async function startRecordingWatcher(filePath: string): Promise<RecordedEvent[]> {
  const events: RecordedEvent[] = []
  const watcher = createSingleFileWatcher(filePath, {
    onChange: () => events.push('change'),
    onUnlink: () => events.push('unlink'),
    onError: () => events.push('error')
  })
  openWatchers.push(watcher)

  let ready = false
  watcher.once('ready', () => {
    ready = true
  })
  await waitUntil(() => ready, `chokidar to become ready for ${filePath}`)

  return events
}

describe('single-file chokidar watch, real filesystem', () => {
  it(
    'either reports the dead inode or keeps working after a rename over the path',
    async () => {
      const filePath = await createTempFile('icon.svg', '<svg id="before" />')
      const events = await startRecordingWatcher(filePath)

      // The dominant agent / design-tool write pattern
      await writeFile(`${filePath}.tmp`, '<svg id="after" />', 'utf-8')
      await rename(`${filePath}.tmp`, filePath)

      await waitUntil(
        () => events.length > 0,
        'an event after renaming a temp file over the watched path'
      )

      // A rename over the watched path is never silent, and never an error
      expect(events[0]).not.toBe('error')

      if (events[0] === 'unlink') {
        // The premise the atomic-save re-arm is built on: the watch is now
        // bound to a dead inode, so `FileWatcherService` must replace it. That
        // half is covered by FileWatcherService.atomicSave.test.ts.
        expect(events[0]).toBe('unlink')
        return
      }

      // The platform collapsed the rename into a change (macOS/fsevents does).
      // The re-arm branch is then never entered - which is only safe if the
      // watch is still alive. A platform that reported `change` and then went
      // deaf would break the fix silently, so pin it.
      expect(events[0]).toBe('change')
      const seenSoFar = events.length
      await writeFile(filePath, '<svg id="later" />', 'utf-8')

      await waitUntil(
        () => events.length > seenSoFar,
        'a further change after the rename, proving the watch survived'
      )
    },
    TEST_TIMEOUT_MS
  )

  it(
    'emits change for an in-place rewrite',
    async () => {
      const filePath = await createTempFile('note.md', '# before\n')
      const events = await startRecordingWatcher(filePath)

      await writeFile(filePath, '# after\n', 'utf-8')

      await waitUntil(() => events.length > 0, 'an event after an in-place rewrite')

      expect(events).toContain('change')
      expect(events).not.toContain('unlink')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'emits unlink for a genuine delete',
    async () => {
      const filePath = await createTempFile('gone.svg', '<svg />')
      const events = await startRecordingWatcher(filePath)

      await rm(filePath)

      await waitUntil(() => events.includes('unlink'), 'an unlink after deleting the watched file')

      expect(events).toContain('unlink')
    },
    TEST_TIMEOUT_MS
  )

  it('pins the load-bearing watch options', () => {
    // chokidar v3 treats a path as a glob unless this is set, so a file whose
    // name contains glob characters would silently never be watched.
    expect(SINGLE_FILE_WATCH_OPTIONS.disableGlobbing).toBe(true)
    expect(SINGLE_FILE_WATCH_OPTIONS.usePolling).toBe(false)
    expect(SINGLE_FILE_WATCH_OPTIONS.awaitWriteFinish).toEqual({
      stabilityThreshold: 300,
      pollInterval: 100
    })
  })

  it('does not mutate the shared options object', async () => {
    const before = JSON.stringify(SINGLE_FILE_WATCH_OPTIONS)
    const filePath = await createTempFile('stable.svg', '<svg />')

    await startRecordingWatcher(filePath)

    expect(JSON.stringify(SINGLE_FILE_WATCH_OPTIONS)).toBe(before)
  })
})
