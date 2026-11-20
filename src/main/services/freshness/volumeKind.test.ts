// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PathFlavour } from '../../utils/pathCompare'

const { debug } = vi.hoisted(() => ({ debug: vi.fn() }))
vi.mock('../LoggingService', () => ({ logger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { LIMITED_FS_MAGIC, volumeKind, type StatfsFn } from './volumeKind'

const win32: PathFlavour = { path: path.win32, platform: 'win32' }
const linux: PathFlavour = { path: path.posix, platform: 'linux' }
const darwin: PathFlavour = { path: path.posix, platform: 'darwin' }

const EXT4_MAGIC = 0xef53

function statfsOf(type: number | bigint): StatfsFn {
  return vi.fn(async () => ({ type }))
}

beforeEach(() => {
  debug.mockClear()
})

describe('volumeKind – Windows (path only)', () => {
  it.each([
    ['\\\\server\\share\\proj\\a.md', 'network'],
    ['\\\\?\\UNC\\server\\share\\a.md', 'network'],
    ['\\\\wsl$\\Ubuntu\\home\\u\\a.md', 'wsl'],
    ['\\\\WSL$\\Ubuntu\\home\\u\\a.md', 'wsl'],
    ['\\\\wsl.localhost\\Ubuntu\\home\\u\\a.md', 'wsl'],
    ['C:\\Users\\u\\proj\\a.md', 'local'],
    ['\\\\?\\C:\\Users\\u\\proj\\a.md', 'local'],
    ['Z:\\proj\\a.md', 'local'],
  ])('%s → %s', async (real, kind) => {
    const statfs = vi.fn()
    await expect(volumeKind(real, { flavour: win32, statfs })).resolves.toBe(kind)
    expect(statfs).not.toHaveBeenCalled()
  })
})

describe('volumeKind – Linux (statfs type)', () => {
  it.each(Object.entries(LIMITED_FS_MAGIC))('%s is network', async (_name, magic) => {
    await expect(volumeKind('/mnt/x/a.md', { flavour: linux, statfs: statfsOf(magic) })).resolves.toBe('network')
  })

  it('a local filesystem (ext4) is local', async () => {
    await expect(volumeKind('/home/u/a.md', { flavour: linux, statfs: statfsOf(EXT4_MAGIC) })).resolves.toBe('local')
  })

  it('reads a negative (signed) magic as its unsigned value', async () => {
    const signedCifs = LIMITED_FS_MAGIC.CIFS - 0x1_0000_0000
    await expect(volumeKind('/mnt/x/a.md', { flavour: linux, statfs: statfsOf(signedCifs) })).resolves.toBe('network')
  })

  it('accepts a bigint type', async () => {
    const statfs = statfsOf(BigInt(LIMITED_FS_MAGIC.NFS))
    await expect(volumeKind('/mnt/x/a.md', { flavour: linux, statfs })).resolves.toBe('network')
  })

  it('a failed statfs answers local and logs no raw path', async () => {
    const statfs: StatfsFn = vi.fn(async () => {
      throw Object.assign(new Error("EACCES: permission denied, statfs '/home/secret/a.md'"), {
        code: 'EACCES',
        syscall: 'statfs',
        path: '/home/secret/a.md',
      })
    })
    await expect(volumeKind('/home/secret/a.md', { flavour: linux, statfs })).resolves.toBe('local')
    expect(JSON.stringify(debug.mock.calls)).not.toContain('/home/secret')
  })
})

describe('volumeKind – macOS', () => {
  it('is always local (documented limit) and never calls statfs', async () => {
    const statfs = vi.fn()
    await expect(volumeKind('/Volumes/share/a.md', { flavour: darwin, statfs })).resolves.toBe('local')
    expect(statfs).not.toHaveBeenCalled()
  })
})
