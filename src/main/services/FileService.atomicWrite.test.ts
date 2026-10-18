// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FileService.writeFile saves atomically: the bytes arrive through a same-folder
 * temp file that is renamed over the document, so the saved file gets a new inode
 * and no temp file is left behind. (A plain `writeFile` rewrites the same inode.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { FileService } from './FileService'

const posixOnly = process.platform === 'win32' ? it.skip : it

describe('FileService.writeFile atomic save', () => {
  let fileService: FileService
  let testDir: string

  beforeEach(async () => {
    fileService = new FileService()
    testDir = await mkdtemp(join(tmpdir(), 'erfana-atomic-save-'))
    fileService.setProjectPath(testDir)
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  posixOnly('replaces the file through a temp file (new inode) and leaves no temp behind', async () => {
    const file = join(testDir, 'doc.md')
    await writeFile(file, 'old')
    const before = (await stat(file)).ino

    await fileService.writeFile(file, 'new')

    expect(await readFile(file, 'utf-8')).toBe('new')
    expect((await stat(file)).ino).not.toBe(before)
    expect(await readdir(testDir)).toEqual(['doc.md'])
  })

  it('still recreates missing folders with createParentDirs', async () => {
    const file = join(testDir, 'gone', 'sub', 'doc.md')

    await fileService.writeFile(file, 'restored', { createParentDirs: true })

    expect(await readFile(file, 'utf-8')).toBe('restored')
  })

  it('still fails with ENOENT for a missing folder without createParentDirs', async () => {
    await mkdir(join(testDir, 'x'))
    await expect(fileService.writeFile(join(testDir, 'gone', 'doc.md'), 'x')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('never lists an atomic-save temp file in the tree', async () => {
    await mkdir(join(testDir, 'docs'))
    await writeFile(join(testDir, 'docs', 'note.md'), 'x')
    await writeFile(join(testDir, 'docs', '.erfana-tmp-1234'), 'partial')
    await writeFile(join(testDir, '.erfana-tmp-root'), 'partial')

    const tree = await fileService.readDirectory(testDir)

    const names = JSON.stringify(tree)
    expect(names).toContain('note.md')
    expect(names).not.toContain('.erfana-tmp-')
  })
})
