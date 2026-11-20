// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const { trashItem, probe } = vi.hoisted(() => ({
  trashItem: vi.fn<(p: string) => Promise<void>>(),
  probe: vi.fn<(p: string) => Promise<'free' | 'gone' | 'in-use'>>()
}))
vi.mock('electron', () => ({ shell: { trashItem } }))
vi.mock('./entryProbe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./entryProbe')>()),
  probeEntryAccess: probe
}))

import { TrashUnavailableError, replaceTrash, trashEntry } from './trashEntry'
import { EntryGoneError, EntryInUseError, ProbeRestoreError } from './entryProbe'

const refusal = (code?: string): Error => Object.assign(new Error('Failed to perform delete operation'), code ? { code } : {})

describe('trashEntry (#486)', () => {
  afterEach(() => {
    trashItem.mockReset()
    probe.mockReset()
    vi.unstubAllGlobals()
  })

  it('hands a native, absolute path to shell.trashItem', async () => {
    trashItem.mockResolvedValue(undefined)
    await trashEntry('proj/docs/../a.md')
    expect(trashItem).toHaveBeenCalledWith(path.resolve('proj/a.md'))
    expect(probe).not.toHaveBeenCalled()
  })

  describe('a refusal without an error code is sorted by probing the entry', () => {
    it.each([
      ['free', TrashUnavailableError],
      ['in-use', EntryInUseError],
      ['gone', EntryGoneError]
    ] as const)('probe %s → %o, carrying the trash error', async (access, expected) => {
      const error = refusal()
      trashItem.mockRejectedValue(error)
      probe.mockResolvedValue(access)

      const thrown = await trashEntry(path.resolve('a.md')).catch((e: unknown) => e)

      expect(thrown).toBeInstanceOf(expected)
      expect((thrown as Error).cause).toBe(error)
      expect(probe).toHaveBeenCalledWith(path.resolve('a.md'))
    })

    it('a gone entry rejects with ENOENT, so the renderer reads it as "not found"', async () => {
      trashItem.mockRejectedValue(refusal())
      probe.mockResolvedValue('gone')
      await expect(trashEntry('a.md')).rejects.toMatchObject({ code: 'ENOENT', message: expect.stringContaining('ENOENT') })
    })

    it('a probe that could not rename the entry back rejects with that error, not TRASH_UNAVAILABLE', async () => {
      trashItem.mockRejectedValue(refusal())
      const stranded = new ProbeRestoreError('.erfana-check-x')
      probe.mockRejectedValue(stranded)
      await expect(trashEntry('a.md')).rejects.toBe(stranded)
    })
  })

  describe('a refusal with an error code is sorted by the code, without a probe', () => {
    it.each(['EBUSY', 'EPERM', 'EACCES'])('%s → in use', async (code) => {
      trashItem.mockRejectedValue(refusal(code))
      await expect(trashEntry('a.md')).rejects.toBeInstanceOf(EntryInUseError)
      expect(probe).not.toHaveBeenCalled()
    })

    it('ENOENT → gone', async () => {
      trashItem.mockRejectedValue(refusal('ENOENT'))
      await expect(trashEntry('a.md')).rejects.toBeInstanceOf(EntryGoneError)
      expect(probe).not.toHaveBeenCalled()
    })

    it('an unknown code still probes', async () => {
      trashItem.mockRejectedValue(refusal('EIO'))
      probe.mockResolvedValue('free')
      await expect(trashEntry('a.md')).rejects.toBeInstanceOf(TrashUnavailableError)
      expect(probe).toHaveBeenCalledTimes(1)
    })
  })

  describe('replaceTrash (the e2e hook)', () => {
    it('refuses outside an e2e build, and the real trash stays in force', async () => {
      vi.stubGlobal('__ERFANA_TEST_HOOKS__', false)
      expect(() => replaceTrash(vi.fn())).toThrow('e2e builds only')
      trashItem.mockResolvedValue(undefined)
      await trashEntry('x')
      expect(trashItem).toHaveBeenCalledTimes(1)
    })

    it('puts another implementation in force in an e2e build', async () => {
      vi.stubGlobal('__ERFANA_TEST_HOOKS__', true)
      const stub = vi.fn(async () => {})
      replaceTrash(stub)
      await trashEntry('x')
      expect(stub).toHaveBeenCalledWith('x')
      expect(trashItem).not.toHaveBeenCalled()

      replaceTrash(async () => {
        throw new Error('stub refusal')
      })
      probe.mockResolvedValue('free')
      await expect(trashEntry('x')).rejects.toBeInstanceOf(TrashUnavailableError)
    })
  })
})
