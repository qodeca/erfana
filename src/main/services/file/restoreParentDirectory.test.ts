// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { restoreParentDirectory } from './restoreParentDirectory'
import { FileService } from '../FileService'
import { resolveConfinedPath } from '../../ipc/confinement/resolveConfinedPath'
import { PROJECT_FOLDER_GONE_MESSAGE, OUTSIDE_PROJECT_MESSAGE } from '../../ipc/confinement/ConfinementError'

describe('restoreParentDirectory', () => {
  let base: string
  let project: string
  let outside: string

  /** The path as the write handler resolves it for the project at `root`. */
  const resolveWrite = async (filePath: string, root: string = project) =>
    resolveConfinedPath(
      filePath,
      {
        session: {
          root,
          realRoot: await realpath(root).catch(() => root),
          caseSensitive: process.platform === 'linux',
          ownerWebContentsId: null
        },
        senderId: null
      },
      { mode: 'project', allowRoot: false }
    )

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
    await restoreParentDirectory(await resolveWrite(join(project, 'docs', 'deep', 'open.md')))

    expect((await stat(join(project, 'docs', 'deep'))).isDirectory()).toBe(true)
  })

  it('is a no-op when the folder already exists', async () => {
    await mkdir(join(project, 'docs'))
    await expect(
      restoreParentDirectory(await resolveWrite(join(project, 'docs', 'open.md')))
    ).resolves.toBeUndefined()
  })

  it('refuses a path outside the project and creates nothing', async () => {
    await expect(resolveWrite(join(outside, 'new', 'a.md'))).rejects.toThrow(OUTSIDE_PROJECT_MESSAGE)
    await expect(stat(join(outside, 'new'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('names the real reason when the project folder itself is gone', async () => {
    await rm(project, { recursive: true })

    await expect(resolveWrite(join(project, 'docs', 'a.md'))).rejects.toThrow(
      PROJECT_FOLDER_GONE_MESSAGE
    )
  })

  it.skipIf(process.platform === 'win32')(
    'restores through an alias of the project path (canonical check, not lexical)',
    async () => {
      // `/var` vs `/private/var` on macOS: same folder, different spelling
      await symlink(project, join(base, 'alias'))

      await restoreParentDirectory(await resolveWrite(join(base, 'alias', 'docs', 'a.md')))

      expect((await stat(join(project, 'docs'))).isDirectory()).toBe(true)
    }
  )

  it.runIf(process.platform === 'darwin')(
    'restores when the project path differs only in letter case (case-insensitive volume)',
    async () => {
      await restoreParentDirectory(await resolveWrite(join(project, 'docs', 'a.md'), project.toUpperCase()))

      expect((await stat(join(project, 'docs'))).isDirectory()).toBe(true)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refuses when the nearest existing ancestor is a symlink out of the project',
    async () => {
      await symlink(outside, join(project, 'link'))

      await expect(resolveWrite(join(project, 'link', 'new', 'a.md'))).rejects.toThrow(
        OUTSIDE_PROJECT_MESSAGE
      )
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

  it('writes at the original path once the folders are restored', async () => {
    const target = join(project, 'docs', 'open.md')
    const resolved = await resolveConfinedPath(
      target,
      {
        session: { root: project, realRoot: project, caseSensitive: true, ownerWebContentsId: null },
        senderId: null
      },
      { mode: 'project', allowRoot: false }
    )
    await restoreParentDirectory(resolved)
    await svc.writeFile(resolved.real, '# restored')

    expect(await readFile(target, 'utf-8')).toBe('# restored')
  })
})
