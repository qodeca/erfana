// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Releasing the file watches under a folder for a delete, and arming them
 * again (#486). Real files in `os.tmpdir()` and the real chokidar watch (only
 * Electron is mocked, at module scope – hence a file of its own).
 *
 * The folder is "trashed" by renaming it away, as the Recycle Bin does: on
 * Windows that rename fails while any watch handle is open below the folder,
 * so there it also proves the handles were closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const sends = vi.hoisted(() => [] as Array<{ channel: string; payload: Record<string, unknown> }>)

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          id: 1,
          send: (channel: string, payload: Record<string, unknown>) => sends.push({ channel, payload })
        }
      }
    ])
  }
}))

import { FileWatcherService } from './FileWatcherService'
import { testSession, type TestSession } from './watcher/__test__/testSession'
import { WindowWatches } from './watcher/__test__/windowWatches'

const EVENT_BUDGET_MS = 5_000

describe('FileWatcherService.releaseUnder (#486)', () => {
  let root: string
  let svc: FileWatcherService
  let w: WindowWatches
  let open: string
  let nested: string
  let other: string
  let session: TestSession

  const setup = async (caseSensitive = true): Promise<void> => {
    session = testSession(root, caseSensitive)
    svc = new FileWatcherService({ session })
    w = new WindowWatches(svc, sends)
  }

  beforeEach(async () => {
    sends.length = 0
    root = await realpath(await mkdtemp(join(tmpdir(), 'erfana-release-')))
    await mkdir(join(root, 'docs', 'deep'), { recursive: true })
    open = join(root, 'docs', 'open.md')
    nested = join(root, 'docs', 'deep', 'nested.md')
    other = join(root, 'other.md')
    await writeFile(open, '# open')
    await writeFile(nested, '# nested')
    await writeFile(other, '# other')
    await setup()
  })

  afterEach(async () => {
    await svc.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('closes every watch under the folder; after the folder is moved away its open files end deleted', async () => {
    await w.started(open)
    await w.started(nested)
    await w.started(other)
    expect(svc.openHandlesUnder(join(root, 'docs'))).toBe(2)

    const rearm = await svc.releaseUnder(join(root, 'docs'))
    expect(svc.openHandlesUnder(join(root, 'docs'))).toBe(0)
    expect(svc.openHandlesUnder(other)).toBe(1)

    // Fails with EPERM on Windows if a handle were still open below the folder
    await rename(join(root, 'docs'), join(root, 'docs-trashed'))
    await rearm()

    expect(w.filesWith('deleted').sort()).toEqual([nested, open].sort())
    expect(w.kinds().filter((kind) => kind !== 'deleted')).toEqual([])
    expect(svc.getStats().fileDetails.map((d) => d.path)).toEqual([other])
  })

  it('after a failed delete the watches follow again, told `restarted` and nothing else', async () => {
    await w.started(open)
    const rearm = await svc.releaseUnder(join(root, 'docs'))
    await rearm()

    expect(w.kinds()).toEqual(['restarted'])
    expect(svc.openHandlesUnder(join(root, 'docs'))).toBe(1)
    await writeFile(open, '# edited')
    await vi.waitFor(() => expect(w.to(open, 'changed').length).toBeGreaterThan(0), { timeout: EVENT_BUDGET_MS })
  })

  it('hears nothing while released, though the file changes', async () => {
    await w.started(open)
    const rearm = await svc.releaseUnder(join(root, 'docs'))
    await writeFile(open, '# while released')
    // The write gate settles in far less than this; a live watch would have spoken
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(w.kinds()).toEqual([])
    await rearm()
    expect(w.kinds()).toEqual(['restarted'])
  })

  it('a subscribe under a released folder waits for the delete, then opens its watch', async () => {
    const rearm = await svc.releaseUnder(join(root, 'docs'))
    let answered = false
    const reply = w.watch(open).then((r) => {
      answered = true
      return r
    })
    await vi.waitFor(() => expect(sends).toEqual([]))
    expect(answered).toBe(false)
    expect(svc.openHandlesUnder(join(root, 'docs'))).toBe(0)

    await rearm()
    expect((await reply).status).toBe('started')
    expect(svc.openHandlesUnder(join(root, 'docs'))).toBe(1)
  })

  it('a subscribe under a folder deleted meanwhile is refused as not found', async () => {
    const rearm = await svc.releaseUnder(join(root, 'docs'))
    const reply = w.watch(open)
    await rm(join(root, 'docs'), { recursive: true })
    await rearm()
    expect(await reply).toMatchObject({ status: 'refused', code: 'NOT_FOUND' })
  })

  it('two releases over one watch: it is armed again only when both have ended', async () => {
    await w.started(nested)
    const outer = await svc.releaseUnder(join(root, 'docs'))
    const inner = await svc.releaseUnder(join(root, 'docs', 'deep'))
    await outer()
    expect(svc.openHandlesUnder(nested)).toBe(0)
    expect(w.kinds()).toEqual([])
    await inner()
    expect(svc.openHandlesUnder(nested)).toBe(1)
    expect(w.kinds()).toEqual(['restarted'])
  })

  it('a window closed during the delete: its watches stay gone and nothing is sent', async () => {
    await w.started(open)
    const rearm = await svc.releaseUnder(join(root, 'docs'))
    await svc.cleanupForWebContentsId(1)
    await rearm()
    expect(w.kinds()).toEqual([])
    expect(svc.getStats().totalWatched).toBe(0)
  })

  it('matches another letter case when the project’s names ignore case', async () => {
    await svc.dispose()
    await setup(false)
    await w.started(open)
    const rearm = await svc.releaseUnder(join(root, 'DOCS'))
    expect(svc.openHandlesUnder(join(root, 'docs'))).toBe(0)
    await rearm()
    expect(svc.openHandlesUnder(join(root, 'docs'))).toBe(1)
  })

  it('releases the file’s own watch when the file itself is deleted', async () => {
    await w.started(open)
    const rearm = await svc.releaseUnder(open)
    expect(svc.openHandlesUnder(open)).toBe(0)
    await rm(open)
    await rearm()
    expect(w.filesWith('deleted')).toEqual([open])
  })

  // A delete and a project switch or a wake at once (#486 × decisions 18, 22): the
  // entry arms again exactly once, when both the delete and the switch let it go
  describe('with a project switch or a wake during the release', () => {
    const docs = (): string => join(root, 'docs')

    it('switch fails after the delete ended: the resume arms it, once', async () => {
      await w.started(open)
      const rearm = await svc.releaseUnder(docs())
      await svc.suspendAll()
      await rearm()
      expect(w.kinds()).toEqual([])

      await svc.resumeSuspended()
      expect(w.kinds()).toEqual(['restarted'])
      expect(svc.openHandlesUnder(docs())).toBe(1)
    })

    it('switch fails while the delete still runs: the resume skips it, the delete’s end arms it, once', async () => {
      await w.started(open)
      const rearm = await svc.releaseUnder(docs())
      await svc.suspendAll()
      await svc.resumeSuspended()
      expect(w.kinds()).toEqual([])
      expect(svc.openHandlesUnder(docs())).toBe(0)

      await rearm()
      expect(w.kinds()).toEqual(['restarted'])
      expect(svc.openHandlesUnder(docs())).toBe(1)
    })

    it('switch commits during the delete: the watch ends for the switch and the delete’s end does not arm it', async () => {
      await w.started(open)
      const rearm = await svc.releaseUnder(docs())
      await svc.suspendAll()
      await svc.endSuspended(session.switchTo(other))
      await rearm()

      expect(w.events().map(({ kind, reason }) => ({ kind, reason }))).toEqual([
        { kind: 'ended', reason: 'project-switch' }
      ])
      expect(svc.getStats().totalWatched).toBe(0)
    })

    it('a wake during the delete leaves the held watch closed; the delete’s end arms it, once', async () => {
      await w.started(open)
      const rearm = await svc.releaseUnder(docs())
      await svc.rearmAll()
      expect(w.kinds()).toEqual([])
      expect(svc.openHandlesUnder(docs())).toBe(0)

      await rearm()
      expect(w.kinds()).toEqual(['restarted'])
      expect(svc.openHandlesUnder(docs())).toBe(1)
    })
  })
})
