// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Handler tests for the `file-watch:*` channels (#478 plan S12): the sender
 * gate, the path check before any file-system call (F5), the stale guards
 * (N5: a write is never undone by a project switch, a subscribe that raced
 * one leaves no watch), and the replies of probe, readText and writeText.
 * Real files in a temp folder and a real `FileWatcherService`; Electron and
 * the sender check are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path, { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { openTestProject } from './__test-helpers__/openTestProject'
import { createFakeConfinementFs } from './__test-helpers__/fakeConfinementFs'
import type { ConfinementDeps } from './confinement/resolveConfinedPath'
import type { FileStamp } from '../../shared/freshness/freshnessTypes'

const handlers: Record<string, (...args: any[]) => any> = {}
const trusted = vi.hoisted(() => ({ value: true }))

vi.mock('./senderValidation', () => ({
  isTrustedSender: vi.fn(() => trusted.value),
  isTrustedAppSender: () => true
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => {
      handlers[channel] = fn
    }
  },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() }
}))

vi.mock('electron-store', () => {
  class MockStore {
    get(): any {
      return null
    }
    set(): void {}
    delete(): void {}
  }
  return { default: MockStore }
})

vi.mock('../services/ProjectLockService', () => ({
  projectLockService: {
    acquireLock: vi.fn(async () => ({ status: 'acquired' })),
    releaseLock: vi.fn(async () => {}),
    checkLock: vi.fn(async () => ({ status: 'unlocked' })),
    requestFocus: vi.fn(async () => true),
    cleanupStaleLocks: vi.fn(async () => 0),
    dispose: vi.fn(async () => {})
  }
}))

const EVENT = { sender: { id: 1 }, senderFrame: { url: 'file:///app/index.html' } }
const call = (channel: string, request: unknown): Promise<any> => handlers[`file-watch:${channel}`](EVENT, request)

/** A `FileWatcherService` whose stamp read (after ready) can be held. */
async function makeWatcher(gate?: Promise<void>) {
  const { projectService } = await import('./file-handlers')
  const { FileWatcherService } = await import('../services/FileWatcherService')
  const { readStartStamp } = await import('../services/watcher/startStamp')
  return new FileWatcherService({
    session: projectService.session,
    stampFile: async (real) => {
      if (gate) await gate
      return readStartStamp(real)
    }
  })
}

describe('file-watch:* handlers', () => {
  let tmp: string
  let outside: string
  let file: string
  let watcher: Awaited<ReturnType<typeof makeWatcher>> | null

  async function register(options: { gate?: Promise<void>; confinementDeps?: ConfinementDeps } = {}) {
    watcher = await makeWatcher(options.gate)
    const { projectService } = await import('./file-handlers')
    const { registerFileWatcherHandlers } = await import('./file-watcher-handlers')
    registerFileWatcherHandlers(projectService.session, {
      watcher,
      confinementDeps: options.confinementDeps,
      volumeKind: async () => 'local'
    })
    return watcher
  }

  beforeEach(async () => {
    for (const key of Object.keys(handlers)) delete handlers[key]
    trusted.value = true
    watcher = null
    vi.resetModules()
    tmp = mkdtempSync(join(tmpdir(), 'erfana-fwh-'))
    outside = mkdtempSync(join(tmpdir(), 'erfana-fwh-outside-'))
    file = join(tmp, 'a.md')
    writeFileSync(file, '# A\r\n\r\nstart\r\n')
    writeFileSync(join(outside, 'secret.md'), 'secret')
    await openTestProject(tmp)
  })

  afterEach(async () => {
    await watcher?.dispose()
    rmSync(tmp, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.resetModules()
  })

  describe('readText and probe', () => {
    it('reads an in-project file with its stamp and line ending', async () => {
      await register()
      const reply = await call('readText', { filePath: file })
      expect(reply).toMatchObject({ status: 'ok', text: '# A\r\n\r\nstart\r\n', eol: 'crlf' })
      expect(reply.stamp.hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('answers missing for a file that is gone, and probes it the same way', async () => {
      await register()
      await expect(call('readText', { filePath: join(tmp, 'gone.md') })).resolves.toEqual({ status: 'missing' })
      await expect(call('probe', { filePath: join(tmp, 'gone.md') })).resolves.toEqual({ status: 'missing' })
    })

    it('a probe with the hash of the current bytes answers same; any other hash answers changed', async () => {
      await register()
      const read = await call('readText', { filePath: file })
      await expect(call('probe', { filePath: file, knownHash: read.stamp.hash })).resolves.toEqual({
        status: 'same',
        stamp: read.stamp
      })
      writeFileSync(file, 'other')
      const probe = await call('probe', { filePath: file, knownHash: read.stamp.hash })
      expect(probe.status).toBe('changed')
      expect(probe.stamp.hash).not.toBe(read.stamp.hash)
    })

    it('a folder is unsupported, not missing', async () => {
      await register()
      const folder = join(tmp, 'sub')
      mkdirSync(folder)
      await expect(call('readText', { filePath: folder })).resolves.toEqual({ status: 'unsupported' })
    })
  })

  describe('writeText', () => {
    it('writes and answers the stamp of the bytes written', async () => {
      await register()
      const reply = await call('writeText', { filePath: file, content: 'new text' })
      expect(reply.status).toBe('written')
      expect(readFileSync(file, 'utf8')).toBe('new text')
      const probe = await call('probe', { filePath: file, knownHash: reply.stamp.hash })
      expect(probe.status).toBe('same')
    })

    it('an autosave with a stale expected stamp writes nothing and says changed-on-disk', async () => {
      await register()
      const read = await call('readText', { filePath: file })
      writeFileSync(file, 'outside edit, longer than before')
      const reply = await call('writeText', { filePath: file, content: 'mine', expectedStamp: read.stamp as FileStamp })
      expect(reply.status).toBe('changed-on-disk')
      expect(readFileSync(file, 'utf8')).toBe('outside edit, longer than before')
    })

    it('N5: a project switch while the write runs does not turn a landed write into a throw', async () => {
      await register()
      const { textWriter } = await import('../services/freshness/textWrite')
      const write = textWriter.write
      vi.spyOn(textWriter, 'write').mockImplementation(async (...args) => {
        const reply = await write(...args)
        await openTestProject(tmp, { generation: 2 })
        return reply
      })
      const reply = await call('writeText', { filePath: file, content: 'landed', generation: 1 })
      expect(reply.status).toBe('written')
      expect(readFileSync(file, 'utf8')).toBe('landed')
    })

    it('a write for another project generation is refused before anything is written', async () => {
      await register()
      await expect(call('writeText', { filePath: file, content: 'stale', generation: 7 })).rejects.toThrow()
      expect(readFileSync(file, 'utf8')).toBe('# A\r\n\r\nstart\r\n')
    })
  })

  describe('subscribe', () => {
    it('answers started with a stamp, and the subscription is held for this window only', async () => {
      const svc = await register()
      const watchId = randomUUID()
      const reply = await call('subscribe', { watchId, filePath: file, profile: 'editor' })
      expect(reply).toMatchObject({ status: 'started', liveRefresh: 'full' })
      expect(svc.getStats().subscriptions).toBe(1)

      // Another window cannot unsubscribe it
      await handlers['file-watch:unsubscribe']({ ...EVENT, sender: { id: 2 } }, { watchId })
      expect(svc.getStats().subscriptions).toBe(1)
      await expect(call('unsubscribe', { watchId })).resolves.toEqual({ success: true })
      expect(svc.getStats().subscriptions).toBe(0)
    })

    it('a file on a network volume starts limited (G7)', async () => {
      watcher = await makeWatcher()
      const { projectService } = await import('./file-handlers')
      const { registerFileWatcherHandlers } = await import('./file-watcher-handlers')
      registerFileWatcherHandlers(projectService.session, { watcher, volumeKind: async () => 'network' })
      const reply = await call('subscribe', { watchId: randomUUID(), filePath: file, profile: 'image' })
      expect(reply).toMatchObject({ status: 'started', liveRefresh: 'limited' })
    })

    it('refuses a missing file as NOT_FOUND and a main-only profile at the schema', async () => {
      await register()
      await expect(call('subscribe', { watchId: randomUUID(), filePath: join(tmp, 'gone.md'), profile: 'editor' })).resolves.toEqual({
        status: 'refused',
        code: 'NOT_FOUND'
      })
      await expect(call('subscribe', { watchId: randomUUID(), filePath: file, profile: 'preview' })).resolves.toEqual({
        status: 'refused',
        code: 'WATCH_FAILED'
      })
    })

    it('a project switch during the subscribe refuses it with PROJECT_CHANGED and leaves no watch', async () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const svc = await register({ gate })
      const pending = call('subscribe', { watchId: randomUUID(), filePath: file, profile: 'editor' })
      await vi.waitFor(() => expect(svc.getStats().totalWatched).toBe(1))
      await openTestProject(tmp, { generation: 2 })
      release()
      await expect(pending).resolves.toEqual({ status: 'refused', code: 'PROJECT_CHANGED' })
      expect(svc.getStats()).toMatchObject({ totalWatched: 0, subscriptions: 0 })
    })

    it('pause and resume are scoped to the window that holds the id', async () => {
      const svc = await register()
      const watchId = randomUUID()
      await call('subscribe', { watchId, filePath: file, profile: 'editor' })
      await handlers['file-watch:pauseWatch']({ ...EVENT, sender: { id: 2 } }, { watchId })
      expect(svc.getStats().paused).toBe(0)
      await call('pauseWatch', { watchId })
      expect(svc.getStats().paused).toBe(1)
      await expect(call('resumeWatch', { watchId })).resolves.toEqual({ success: true, missed: false })
      await expect(call('resumeWatch', { watchId: randomUUID() })).resolves.toEqual({ success: false, missed: true })
      await expect(call('pauseWatch', { watchId: 'not-a-uuid' })).resolves.toMatchObject({ success: false })
    })
  })

  describe('gates', () => {
    it('refuses an untrusted sender before looking at the request', async () => {
      await register()
      trusted.value = false
      await expect(call('subscribe', { watchId: randomUUID(), filePath: file, profile: 'editor' })).resolves.toEqual({
        status: 'refused',
        code: 'WATCH_FAILED'
      })
      await expect(call('readText', { filePath: file })).resolves.toEqual({ status: 'unreadable' })
      await expect(call('writeText', { filePath: file, content: 'x' })).rejects.toThrow('Untrusted sender')
      await expect(call('unsubscribe', { watchId: randomUUID() })).resolves.toMatchObject({ success: false })
      expect(readFileSync(file, 'utf8')).toBe('# A\r\n\r\nstart\r\n')
    })

    it('F5: outside and UNC paths are refused with zero file-system calls', async () => {
      const win = path.win32
      const fsCalls: string[] = []
      const fake = createFakeConfinementFs(win, { 'C:\\': 'dir', 'C:\\p': 'dir', 'C:\\p\\a.md': 'file' }, true)
      const counted: ConfinementDeps = {
        path: win,
        platform: 'win32',
        fs: {
          lstat: async (target) => (fsCalls.push(target), fake.lstat(target)),
          stat: async (target) => (fsCalls.push(target), fake.stat(target)),
          realpath: async (target) => (fsCalls.push(target), fake.realpath(target))
        }
      }
      const { projectService } = await import('./file-handlers')
      vi.spyOn(projectService.session, 'current').mockReturnValue({
        generation: 1,
        root: 'C:\\p',
        realRoot: 'C:\\p',
        caseSensitive: false,
        ownerWebContentsId: null
      })
      await register({ confinementDeps: counted })
      const refused = [
        '\\\\srv\\share\\a.md',
        'C:\\outside\\secret.md',
        'C:\\p\\..\\x.md',
        // A short-name candidate is expanded only on a local drive (G6), never on a share or a device path
        '\\\\srv\\share\\P~1\\a.md',
        '\\\\?\\C:\\P~1\\a.md',
        '\\\\.\\C:\\P~1\\a.md'
      ]
      for (const filePath of refused) {
        await expect(call('subscribe', { watchId: randomUUID(), filePath, profile: 'editor' })).resolves.toEqual({
          status: 'refused',
          code: 'OUTSIDE_PROJECT'
        })
        // Said as outside the project, not as a lock (G6)
        await expect(call('readText', { filePath })).resolves.toEqual({ status: 'outside-project' })
        await expect(call('probe', { filePath })).resolves.toEqual({ status: 'unreadable', code: 'OUTSIDE_PROJECT' })
        await expect(call('writeText', { filePath, content: 'x' })).rejects.toThrow()
      }
      expect(fsCalls).toEqual([])
    })
  })
})

describe('readTextRefusal', () => {
  it.each([
    ['NOT_FOUND', { status: 'missing' }],
    ['WRONG_KIND', { status: 'unsupported' }],
    // G6: an outside path is said as such, never as a locked file
    ['OUTSIDE_PROJECT', { status: 'outside-project' }],
    ['UNVERIFIABLE', { status: 'unreadable' }],
    ['PERMISSION_DENIED', { status: 'unreadable' }]
  ] as const)('maps %s to %j', async (code, reply) => {
    const { readTextRefusal } = await import('./file-watcher-handlers')
    const { ConfinementError } = await import('./confinement/ConfinementError')
    expect(readTextRefusal(new ConfinementError(code))).toEqual(reply)
  })
})
