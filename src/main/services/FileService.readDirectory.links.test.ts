// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Folder links (junctions, directory symlinks) in the project tree: a link to a
 * folder inside the project is a folder row; everything else stays as it was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import { FileService, MAX_LINK_DEPTH } from './FileService'

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<any>('fs/promises')
  return { ...actual, readdir: vi.fn(), stat: vi.fn(), realpath: vi.fn() }
})

type Kind = 'dir' | 'file' | 'link'
const dirent = (name: string, kind: Kind) => ({
  name,
  isDirectory: () => kind === 'dir',
  isFile: () => kind === 'file',
  isSymbolicLink: () => kind === 'link'
})

const abs = (...parts: string[]): string => path.resolve(path.sep, ...parts)
const ROOT = abs('proj')

describe('FileService.readDirectory folder links', () => {
  let fs: any
  let svc: FileService
  /** readdir answers by folder path; stat/realpath answers by link path */
  let listing: Record<string, ReturnType<typeof dirent>[]>
  let statDir: Record<string, boolean>
  let real: Record<string, string>

  beforeEach(async () => {
    fs = await import('fs/promises')
    vi.resetAllMocks()
    listing = {}
    statDir = {}
    real = {}
    fs.readdir.mockImplementation(async (p: string) => listing[path.resolve(p)] ?? [])
    fs.stat.mockImplementation(async (p: string) => {
      const key = path.resolve(p)
      if (!(key in statDir)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return { isDirectory: () => statDir[key] }
    })
    fs.realpath.mockImplementation(async (p: string) => real[path.resolve(p)] ?? path.resolve(p))
    svc = new FileService()
    svc.setProjectPath(ROOT)
    svc.bindSession({
      current: () =>
        ({ root: ROOT, realRoot: ROOT, caseSensitive: false, generation: 1, ownerWebContentsId: null }) as any
    })
  })

  it('shows a link to a folder inside the project as a folder, flagged as a link', async () => {
    listing[ROOT] = [dirent('shared', 'link'), dirent('docs', 'dir')]
    listing[abs('proj', 'docs')] = [dirent('a.md', 'file')]
    // readdir follows the link, so the link's own path lists the target's entries
    listing[abs('proj', 'shared')] = listing[abs('proj', 'docs')]
    statDir[abs('proj', 'shared')] = true
    real[abs('proj', 'shared')] = abs('proj', 'docs')

    const nodes = await svc.readDirectory(ROOT)

    const shared = nodes.find((n) => n.name === 'shared')!
    expect(shared.type).toBe('directory')
    expect(shared.isSymlink).toBe(true)
    expect(shared.children?.map((c) => c.name)).toEqual(['a.md'])
  })

  it('keeps a link to a folder outside the project as a file row, and does not read it', async () => {
    listing[ROOT] = [dirent('out', 'link')]
    statDir[abs('proj', 'out')] = true
    real[abs('proj', 'out')] = abs('elsewhere')
    listing[abs('elsewhere')] = [dirent('secret.md', 'file')]

    const nodes = await svc.readDirectory(ROOT)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('file')
    expect(nodes[0].isSymlink).toBe(true)
    expect(fs.readdir).toHaveBeenCalledTimes(1)
  })

  it('keeps a link to a file, and a broken link, as file rows', async () => {
    listing[ROOT] = [dirent('to-file', 'link'), dirent('broken', 'link')]
    statDir[abs('proj', 'to-file')] = false

    const nodes = await svc.readDirectory(ROOT)

    expect(nodes.map((n) => [n.name, n.type])).toEqual([
      ['broken', 'file'],
      ['to-file', 'file']
    ])
  })

  it('keeps every link a file row when no project is open', async () => {
    svc = new FileService()
    listing[ROOT] = [dirent('shared', 'link')]
    statDir[abs('proj', 'shared')] = true

    const nodes = await svc.readDirectory(ROOT)

    expect(nodes[0].type).toBe('file')
  })

  it('shows but does not enter a link back to a folder that contains it', async () => {
    listing[ROOT] = [dirent('docs', 'dir')]
    listing[abs('proj', 'docs')] = [dirent('up', 'link')]
    statDir[abs('proj', 'docs', 'up')] = true
    real[abs('proj', 'docs', 'up')] = ROOT

    const nodes = await svc.readDirectory(ROOT)

    const up = nodes[0].children![0]
    expect(up.type).toBe('directory')
    expect(up.children).toEqual([])
    expect(fs.readdir).toHaveBeenCalledTimes(2)
  })

  it('stops a pair of links that point at each other', async () => {
    listing[ROOT] = [dirent('x', 'link'), dirent('y', 'dir'), dirent('z', 'dir')]
    listing[abs('proj', 'y')] = [dirent('toZ', 'link')]
    listing[abs('proj', 'z')] = [dirent('toY', 'link')]
    statDir[abs('proj', 'x')] = true
    real[abs('proj', 'x')] = abs('proj', 'y')
    statDir[abs('proj', 'y', 'toZ')] = true
    real[abs('proj', 'y', 'toZ')] = abs('proj', 'z')
    statDir[abs('proj', 'z', 'toY')] = true
    real[abs('proj', 'z', 'toY')] = abs('proj', 'y')
    statDir[abs('proj', 'x', 'toZ')] = true
    real[abs('proj', 'x', 'toZ')] = abs('proj', 'z')
    listing[abs('proj', 'x')] = listing[abs('proj', 'y')]
    // The walk below x resolves its parent through the link
    real[abs('proj', 'x')] = abs('proj', 'y')

    await expect(svc.readDirectory(ROOT)).resolves.toBeDefined()
    expect(fs.readdir.mock.calls.length).toBeLessThanOrEqual(MAX_LINK_DEPTH * 4)
  })
})
