// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  RESTORE_OUTSIDE_PROJECT_MESSAGE,
  RESTORE_PROJECT_GONE_MESSAGE,
  restoreParentDirectory
} from './restoreParentDirectory'
import { FileService } from '../FileService'

describe('restoreParentDirectory', () => {
  let base: string
  let project: string
  let outside: string

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'erfana-restore-')))
    project = join(base, 'proj')
    outside = join(base, 'outside')
    await mkdir(project)
    await mkdir(outside)
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('recreates the missing folder chain of a file inside the project', async () => {
    await restoreParentDirectory(join(project, 'docs', 'deep', 'open.md'), project)

    expect((await stat(join(project, 'docs', 'deep'))).isDirectory()).toBe(true)
  })

  it('is a no-op when the folder already exists', async () => {
    await mkdir(join(project, 'docs'))
    await expect(restoreParentDirectory(join(project, 'docs', 'open.md'), project)).resolves.toBeUndefined()
  })

  it('refuses a path outside the project and creates nothing', async () => {
    await expect(restoreParentDirectory(join(outside, 'new', 'a.md'), project)).rejects.toThrow(
      RESTORE_OUTSIDE_PROJECT_MESSAGE
    )
    await expect(stat(join(outside, 'new'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses when no project is open', async () => {
    await expect(restoreParentDirectory(join(project, 'docs', 'a.md'), null)).rejects.toThrow(
      'No project is open'
    )
  })

  it('names the real reason when the project folder itself is gone', async () => {
    await rm(project, { recursive: true })

    await expect(restoreParentDirectory(join(project, 'docs', 'a.md'), project)).rejects.toThrow(
      RESTORE_PROJECT_GONE_MESSAGE
    )
  })

  it.skipIf(process.platform === 'win32')(
    'restores through an alias of the project path (canonical check, not lexical)',
    async () => {
      // `/var` vs `/private/var` on macOS: same folder, different spelling
      await symlink(project, join(base, 'alias'))

      await restoreParentDirectory(join(base, 'alias', 'docs', 'a.md'), project)

      expect((await stat(join(project, 'docs'))).isDirectory()).toBe(true)
    }
  )

  it.runIf(process.platform === 'darwin')(
    'restores when the project path differs only in letter case (case-insensitive volume)',
    async () => {
      await restoreParentDirectory(join(project, 'docs', 'a.md'), project.toUpperCase())

      expect((await stat(join(project, 'docs'))).isDirectory()).toBe(true)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refuses when the nearest existing ancestor is a symlink out of the project',
    async () => {
      await symlink(outside, join(project, 'link'))

      await expect(
        restoreParentDirectory(join(project, 'link', 'new', 'a.md'), project)
      ).rejects.toThrow(RESTORE_OUTSIDE_PROJECT_MESSAGE)
      await expect(stat(join(outside, 'new'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )
})

describe('FileService.writeFile into a folder that is gone', () => {
  let project: string
  let svc: FileService

  beforeEach(async () => {
    project = await realpath(await mkdtemp(join(tmpdir(), 'erfana-write-')))
    svc = new FileService()
    svc.setProjectPath(project)
  })

  afterEach(async () => {
    await rm(project, { recursive: true, force: true })
  })

  it('fails with ENOENT by default and creates nothing', async () => {
    await expect(svc.writeFile(join(project, 'docs', 'open.md'), 'x')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(stat(join(project, 'docs'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores the file at its original path when asked to recreate the folder', async () => {
    const target = join(project, 'docs', 'open.md')
    await svc.writeFile(target, '# restored', { createParentDirs: true })

    expect(await readFile(target, 'utf-8')).toBe('# restored')
  })
})
