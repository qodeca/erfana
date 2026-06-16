// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FileService } from './FileService'

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<any>('fs/promises')
  return {
    ...actual,
    readdir: vi.fn(),
  }
})

describe('FileService.readDirectory symlink flagging', () => {
  let fs: any
  let svc: FileService

  beforeEach(async () => {
    fs = await import('fs/promises')
    vi.resetAllMocks()
    svc = new FileService()
  })

  it('sets isSymlink=true on symlink entries', async () => {
    const dirents = [
      { name: 'linked', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => true },
      { name: 'file.md', isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
      { name: 'subdir', isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
    ]
    ;(fs.readdir as any).mockResolvedValueOnce(dirents)
    // For recursive call on subdir, return empty array
    ;(fs.readdir as any).mockResolvedValueOnce([])

    const nodes = await svc.readDirectory('/proj')
    const names = nodes.map((n) => n.name)
    expect(names).toContain('linked')
    const linked = nodes.find((n) => n.name === 'linked') as any
    expect(linked.isSymlink).toBe(true)
  })
})

