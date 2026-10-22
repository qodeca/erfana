// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Handler tests for `markdown-image:read` (#71): the sender gate, the request
 * shape, confinement (links included), the type allow-list, the size cap, and
 * that an SVG comes back as an image `data:` URL. Real files on a real temp
 * folder; only Electron and the sender check are faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openTestProject } from './__test-helpers__/openTestProject'

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

  it('refuses an image over the image viewer size cap without reading it', async () => {
    const big = join(tmp, 'big.png')
    writeFileSync(big, '')
    truncateSync(big, 50 * 1024 * 1024 + 1)
    await expect(call({ filePath: big })).resolves.toEqual({ status: 'refused', reason: 'too-large' })
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
