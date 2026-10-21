// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one check `FileService` keeps for itself: it never removes or moves the
 * project root, even when called with a path nobody checked first. Everything
 * else about where a path may lead is decided before the service is reached
 * (see src/main/ipc/confinement).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, stat, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileService } from './FileService'

describe('FileService project root', () => {
  let base: string
  let root: string
  let svc: FileService

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'erfana-root-')))
    root = join(base, 'proj')
    await mkdir(join(root, 'sub'), { recursive: true })
    svc = new FileService()
    svc.setProjectPath(root)
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('refuses to delete the root', async () => {
    await expect(svc.deleteFolder(root)).rejects.toThrow('Cannot delete the project root directory')
    expect((await stat(root)).isDirectory()).toBe(true)
  })

  it('refuses to move the root', async () => {
    await expect(svc.moveItem(root, join(root, 'sub'))).rejects.toThrow(
      'Cannot move the project root directory'
    )
    expect((await stat(root)).isDirectory()).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'refuses when the root is named through another spelling of the same folder',
    async () => {
      const alias = join(base, 'alias')
      await symlink(root, alias)
      // The service was pointed at the alias; the path it is handed is the canonical one
      svc.setProjectPath(alias)

      await expect(svc.deleteFolder(root)).rejects.toThrow('Cannot delete the project root directory')
      await expect(svc.moveItem(root, join(root, 'sub'))).rejects.toThrow(
        'Cannot move the project root directory'
      )
      expect((await stat(root)).isDirectory()).toBe(true)
    }
  )

  it('still deletes and moves anything below the root', async () => {
    await mkdir(join(root, 'gone'))
    await svc.deleteFolder(join(root, 'gone'))
    await expect(stat(join(root, 'gone'))).rejects.toMatchObject({ code: 'ENOENT' })

    await mkdir(join(root, 'moving'))
    const moved = await svc.moveItem(join(root, 'moving'), join(root, 'sub'))
    expect(moved.path).toBe(join(root, 'sub', 'moving'))
  })
})
