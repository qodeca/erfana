// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Forget of the Chromium folder while the running session holds it open
 * (Windows `EBUSY`), and a delete that fails for another reason. Split from
 * `browserProfileFolders.test.ts` because `rm` is mocked at module scope
 * (docs/windows/contributing.md § Test-file split policy).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const rmFault = vi.hoisted(() => ({ code: null as string | null }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: vi.fn(async (...args: Parameters<typeof actual.rm>) => {
      if (rmFault.code !== null) throw Object.assign(new Error(rmFault.code), { code: rmFault.code })
      return actual.rm(...args)
    })
  }
})
vi.mock('../LoggingService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { rm } from 'node:fs/promises'
import { canonicalProjectPath } from './browserProfileGuards'
import {
  clearProfileFolder,
  ensureChromiumDir,
  finishAllPendingClears,
  finishPendingClear,
  resolveProfileFolder
} from './browserProfileFolders'

let base: string

beforeEach(async () => {
  rmFault.code = null
  base = await canonicalProjectPath(await mkdtemp(join(tmpdir(), 'erfana-folders-pending-')))
})

afterEach(async () => {
  rmFault.code = null
  await rm(base, { recursive: true, force: true })
})

async function seeded(platform: NodeJS.Platform): Promise<Awaited<ReturnType<typeof resolveProfileFolder>>> {
  const folder = await resolveProfileFolder(join(base, 'data'), '/p', platform)
  await ensureChromiumDir(folder)
  await writeFile(join(folder.chromiumDir, 'Cookies'), 'x')
  return folder
}

describe('Forget while the session holds the folder open', () => {
  it('Windows: a busy entry leaves forget-pending, and the next open finishes the delete', async () => {
    const folder = await seeded('win32')
    rmFault.code = 'EBUSY'
    expect(await clearProfileFolder(folder, 'win32')).toBe('pending')
    // A second Forget in the same run keeps the one marker
    expect(await clearProfileFolder(folder, 'win32')).toBe('pending')
    const dir = join(base, 'data', 'browser-profiles', '-p')
    expect((await readdir(dir)).sort()).toEqual(['chromium', 'forget-pending', 'project.json'])

    // Next open, still busy (cannot happen under the project lock, but fails closed)
    await expect(finishPendingClear(folder, 'win32')).rejects.toMatchObject({ code: 'delete-failed' })

    rmFault.code = null
    await finishPendingClear(folder, 'win32')
    expect(await readdir(dir)).toEqual(['project.json'])
  })

  it('macOS and Linux: a delete that fails is reported naming the entry, never deferred', async () => {
    const folder = await seeded('darwin')
    rmFault.code = 'EBUSY'
    await expect(clearProfileFolder(folder, 'darwin')).rejects.toMatchObject({
      code: 'delete-failed',
      relPath: 'browser-profiles/-p/chromium'
    })
  })

  it('Windows: a failure that is not "busy" is reported, not deferred', async () => {
    const folder = await seeded('win32')
    rmFault.code = 'EACCES'
    await expect(clearProfileFolder(folder, 'win32')).rejects.toMatchObject({ code: 'delete-failed' })
    expect(await readdir(join(base, 'data', 'browser-profiles', '-p'))).not.toContain('forget-pending')
  })
})

describe('finishAllPendingClears at start', () => {
  it('finishes every pending Forget and leaves other folders alone', async () => {
    const pending = await seeded('win32')
    const other = await resolveProfileFolder(join(base, 'data'), '/q', 'win32')
    await ensureChromiumDir(other)
    rmFault.code = 'EBUSY'
    expect(await clearProfileFolder(pending, 'win32')).toBe('pending')
    rmFault.code = null
    await finishAllPendingClears(join(base, 'data'), 'win32')
    expect(await readdir(join(base, 'data', 'browser-profiles', '-p'))).toEqual(['project.json'])
    expect((await readdir(join(base, 'data', 'browser-profiles', '-q'))).sort()).toEqual(['chromium', 'project.json'])
  })

  it('never rejects: a folder still busy is logged and kept', async () => {
    const pending = await seeded('win32')
    rmFault.code = 'EBUSY'
    await clearProfileFolder(pending, 'win32')
    await expect(finishAllPendingClears(join(base, 'data'), 'win32')).resolves.toBeUndefined()
    expect(await readdir(join(base, 'data', 'browser-profiles', '-p'))).toContain('forget-pending')
  })

  it('skips an entry of browser-profiles that is not a folder', async () => {
    await seeded('win32')
    await writeFile(join(base, 'data', 'browser-profiles', 'stray-file'), 'x')
    await expect(finishAllPendingClears(join(base, 'data'), 'win32')).resolves.toBeUndefined()
  })

  it('never rejects when the data folder cannot be used', async () => {
    await writeFile(join(base, 'not-a-folder'), 'x')
    await expect(finishAllPendingClears(join(base, 'not-a-folder'), 'win32')).resolves.toBeUndefined()
  })
})
