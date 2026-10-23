// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Handler tests for `markdown-image:read` (#71): the sender gate, the request
 * shape, confinement (links included), the type allow-list, the size cap, and
 * that an SVG comes back as an image `data:` URL. Real files on a real temp
 * folder; only Electron and the sender check are faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import path, { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openTestProject } from './__test-helpers__/openTestProject'
import { createFakeConfinementFs } from './__test-helpers__/fakeConfinementFs'
import type { ConfinementDeps } from './confinement/resolveConfinedPath'

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

const CHANNEL = 'markdown-image:read'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><script>x()</script></svg>'

describe('markdown-image:read', () => {
  let tmp: string
  let outside: string
  const call = (request: unknown): Promise<unknown> =>
    handlers[CHANNEL]({ sender: { id: 1 }, senderFrame: { url: 'file:///app/index.html' } }, request)

  beforeEach(async () => {
    for (const key of Object.keys(handlers)) delete handlers[key]
    trusted.value = true
    vi.resetModules()
    tmp = mkdtempSync(join(tmpdir(), 'erfana-mdimage-'))
    outside = mkdtempSync(join(tmpdir(), 'erfana-mdimage-outside-'))
    mkdirSync(join(tmp, 'assets'))
    writeFileSync(join(tmp, 'assets', 'icon.svg'), SVG)
    writeFileSync(join(tmp, 'assets', 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    writeFileSync(join(tmp, 'notes.txt'), 'not an image')
    writeFileSync(join(outside, 'secret.png'), 'secret')

    await openTestProject(tmp)
    const { projectService } = await import('./file-handlers')
    const { registerMarkdownImageHandlers } = await import('./markdown-image-handlers')
    registerMarkdownImageHandlers(projectService.session)
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('returns an in-project PNG as an image data URL with a version', async () => {
    const result = (await call({ filePath: join(tmp, 'assets', 'pixel.png') })) as any
    expect(result.status).toBe('ok')
    expect(result.dataUrl).toBe('data:image/png;base64,iVBORw==')
    expect(result.version).toMatch(/^\d+:\d+:\d+$/)
  })

  it('returns an SVG as an image/svg+xml data URL for an <img>, never as markup', async () => {
    const result = (await call({ filePath: join(tmp, 'assets', 'icon.svg') })) as any
    expect(result.status).toBe('ok')
    expect(result.dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true)
    // Base64, so the response carries no markup a caller could inline
    expect(result.dataUrl).not.toContain('<svg')
    expect(result).not.toHaveProperty('svg')
  })

  it('answers unchanged when the caller already holds the current version', async () => {
    const filePath = join(tmp, 'assets', 'pixel.png')
    const first = (await call({ filePath })) as any
    await expect(call({ filePath, knownVersion: first.version })).resolves.toEqual({
      status: 'unchanged',
      version: first.version
    })
  })

  it('refuses a path outside the project the same way whether or not it exists', async () => {
    await expect(call({ filePath: join(outside, 'secret.png') })).resolves.toEqual({
      status: 'refused',
      reason: 'outside-project'
    })
    await expect(call({ filePath: join(outside, 'absent.png') })).resolves.toEqual({
      status: 'refused',
      reason: 'outside-project'
    })
  })

  it('refuses a dot-dot path that climbs out of the project', async () => {
    await expect(call({ filePath: join(tmp, 'assets', '..', '..', 'x.png') })).resolves.toEqual({
      status: 'refused',
      reason: 'outside-project'
    })
  })

  it.skipIf(process.platform === 'win32')(
    'refuses an in-project link whose target is outside the project',
    async () => {
      symlinkSync(join(outside, 'secret.png'), join(tmp, 'assets', 'innocent.png'), 'file')
      await expect(call({ filePath: join(tmp, 'assets', 'innocent.png') })).resolves.toEqual({
        status: 'refused',
        reason: 'outside-project'
      })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refuses an in-project folder link that leads outside the project',
    async () => {
      symlinkSync(outside, join(tmp, 'linked'), 'dir')
      await expect(call({ filePath: join(tmp, 'linked', 'secret.png') })).resolves.toEqual({
        status: 'refused',
        reason: 'outside-project'
      })
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refuses an image-named link to an in-project file of another type',
    async () => {
      symlinkSync(join(tmp, 'notes.txt'), join(tmp, 'alias.png'), 'file')
      await expect(call({ filePath: join(tmp, 'alias.png') })).resolves.toEqual({
        status: 'refused',
        reason: 'unsupported-type'
      })
    }
  )

  it('refuses a file type outside the allow-list, including ones the viewer opens', async () => {
    writeFileSync(join(tmp, 'icon.bmp'), 'BM')
    for (const name of ['notes.txt', 'icon.bmp']) {
      await expect(call({ filePath: join(tmp, name) })).resolves.toEqual({
        status: 'refused',
        reason: 'unsupported-type'
      })
    }
  })

  it('answers not-found for a missing image and for a folder', async () => {
    mkdirSync(join(tmp, 'folder.png'))
    await expect(call({ filePath: join(tmp, 'assets', 'missing.png') })).resolves.toEqual({
      status: 'refused',
      reason: 'not-found'
    })
    await expect(call({ filePath: join(tmp, 'folder.png') })).resolves.toEqual({
      status: 'refused',
      reason: 'not-found'
    })
  })

  it('refuses an image over the 16 MB document-image cap, below the viewer cap too', async () => {
    const big = join(tmp, 'big.png')
    writeFileSync(big, '')
    truncateSync(big, 16 * 1024 * 1024 + 1)
    await expect(call({ filePath: big })).resolves.toEqual({ status: 'refused', reason: 'too-large' })
    const exact = join(tmp, 'exact.png')
    writeFileSync(exact, '')
    truncateSync(exact, 16 * 1024 * 1024)
    await expect(call({ filePath: exact })).resolves.toMatchObject({ status: 'ok' })
  })

  it.skipIf(process.platform === 'win32')(
    'refuses a junction-type link that leads outside the project',
    async () => {
      // 'junction' is honoured on Windows (no admin rights needed) and is a
      // plain folder link elsewhere
      symlinkSync(outside, join(tmp, 'junction'), 'junction')
      await expect(call({ filePath: join(tmp, 'junction', 'secret.png') })).resolves.toEqual({
        status: 'refused',
        reason: 'outside-project'
      })
    }
  )

  const hasMkfifo = ((): boolean => {
    if (process.platform === 'win32') return false
    try {
      execFileSync('which', ['mkfifo'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()

  it.runIf(hasMkfifo)(
    'refuses a FIFO with an image name at once, without waiting for a writer',
    { timeout: 2_000 },
    async () => {
      const fifo = join(tmp, 'assets', 'pipe.png')
      execFileSync('mkfifo', [fifo])
      const started = Date.now()
      await expect(call({ filePath: fifo })).resolves.toEqual({ status: 'refused', reason: 'not-found' })
      expect(Date.now() - started).toBeLessThan(1_000)
      // Nothing can exist below it either
      await expect(call({ filePath: join(fifo, 'child.png') })).resolves.toEqual({
        status: 'refused',
        reason: 'not-found'
      })
      // The handle was closed: the FIFO can be removed and the folder cleaned up
      rmSync(fifo)
    }
  )

  it('refuses a path outside the project before asking the file system anything', async () => {
    const fsCalls: string[] = []
    const spyDeps: ConfinementDeps = {
      path,
      platform: process.platform,
      fs: {
        lstat: async (target) => {
          fsCalls.push(target)
          const { lstat } = await import('node:fs/promises')
          return lstat(target)
        },
        stat: async (target) => {
          fsCalls.push(target)
          const { stat } = await import('node:fs/promises')
          return stat(target)
        },
        realpath: async (target) => {
          fsCalls.push(target)
          const { realpath } = await import('node:fs/promises')
          return realpath(target)
        }
      }
    }
    const { projectService } = await import('./file-handlers')
    const { registerMarkdownImageHandlers } = await import('./markdown-image-handlers')
    registerMarkdownImageHandlers(projectService.session, spyDeps)

    for (const filePath of [join(outside, 'secret.png'), join(outside, 'secret.png', 'below'), join(tmp, '..', 'x.png')]) {
      await expect(call({ filePath })).resolves.toEqual({ status: 'refused', reason: 'outside-project' })
    }
    expect(fsCalls).toEqual([])
  })

  it('refuses an untrusted sender before looking at the request', async () => {
    trusted.value = false
    const imageRead = await import('../services/file/imageRead')
    const read = vi.spyOn(imageRead, 'readImage')
    await expect(call({ filePath: join(tmp, 'assets', 'pixel.png') })).resolves.toEqual({
      status: 'refused',
      reason: 'unreadable'
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses a malformed request: extra key, relative path, oversized version', async () => {
    const filePath = join(tmp, 'assets', 'pixel.png')
    for (const request of [
      { filePath, extra: true },
      { filePath: 'assets/pixel.png' },
      { filePath, knownVersion: 'x'.repeat(129) },
      'not-an-object'
    ]) {
      await expect(call(request)).resolves.toEqual({ status: 'refused', reason: 'unreadable' })
    }
  })

  it('answers outside-project when no project is open', async () => {
    await openTestProject(null)
    await expect(call({ filePath: join(tmp, 'assets', 'pixel.png') })).resolves.toEqual({
      status: 'refused',
      reason: 'outside-project'
    })
  })
})

describe('markdown-image:read – Windows paths (fake file system)', () => {
  const win = path.win32
  const winDeps: ConfinementDeps = {
    path: win,
    platform: 'win32',
    fs: createFakeConfinementFs(
      win,
      {
        'C:\\': 'dir',
        'C:\\p': 'dir',
        'C:\\p\\img.png': 'file',
        'C:\\outside': 'dir',
        'C:\\outside\\secret.png': 'file',
        'C:\\p\\junction': { link: 'C:\\outside' },
        'C:\\p\\LINKED~1': { alias: 'C:\\outside' },
        'C:\\p\\foo.pngx': 'file',
        'C:\\p\\FOO~1.PNG': { alias: 'C:\\p\\foo.pngx' }
      },
      true
    )
  }
  const call = (request: unknown): Promise<unknown> =>
    handlers[CHANNEL]({ sender: { id: 1 }, senderFrame: { url: 'file:///app/index.html' } }, request)

  beforeEach(async () => {
    for (const key of Object.keys(handlers)) delete handlers[key]
    trusted.value = true
    vi.resetModules()
    const { projectService } = await import('./file-handlers')
    vi.spyOn(projectService.session, 'current').mockReturnValue({
      generation: 1,
      root: 'C:\\p',
      realRoot: 'C:\\p',
      caseSensitive: false,
      ownerWebContentsId: null
    })
    const { registerMarkdownImageHandlers } = await import('./markdown-image-handlers')
    registerMarkdownImageHandlers(projectService.session, winDeps)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it.each([
    ['an alternate data stream', 'C:\\p\\img.png:x'],
    ['a trailing dot', 'C:\\p\\img.png.'],
    ['a trailing space', 'C:\\p\\img.png '],
    ['a device name', 'C:\\p\\CON.png'],
    ['a device name with digits', 'C:\\p\\com1.png']
  ])('refuses %s inside the project as unreadable', async (_label, filePath) => {
    await expect(call({ filePath })).resolves.toEqual({ status: 'refused', reason: 'unreadable' })
  })

  it.each([
    ['a UNC share', '\\\\srv\\share\\img.png'],
    ['a device namespace path', '\\\\?\\C:\\p\\img.png'],
    ['a dot device path', '\\\\.\\pipe\\img.png'],
    ['another folder on the drive', 'C:\\outside\\secret.png'],
    ['a junction leading out', 'C:\\p\\junction\\secret.png'],
    ['an 8.3 short name leading out', 'C:\\p\\LINKED~1\\secret.png']
  ])('refuses %s as outside the project', async (_label, filePath) => {
    await expect(call({ filePath })).resolves.toEqual({ status: 'refused', reason: 'outside-project' })
  })

  it('refuses an 8.3 short name that looks like an image but names another type', async () => {
    await expect(call({ filePath: 'C:\\p\\FOO~1.PNG' })).resolves.toEqual({
      status: 'refused',
      reason: 'unsupported-type'
    })
  })

  it('refuses a drive-relative path as unreadable', async () => {
    await expect(call({ filePath: 'C:img.png' })).resolves.toEqual({ status: 'refused', reason: 'unreadable' })
  })
})
