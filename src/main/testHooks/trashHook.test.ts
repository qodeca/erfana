// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { trashItem: vi.fn() } }))

import { createTrashTestHook } from './trashHook'
import type { EntryRemover } from '../services/file/entryRemoval'

function setup() {
  let installed: EntryRemover | undefined
  const remove = vi.fn<EntryRemover>(async () => {})
  const hook = createTrashTestHook((impl) => {
    installed = impl
  }, remove)
  if (!installed) throw new Error('the hook installed no stub')
  return { hook, remove, trash: installed }
}

describe('trash test hook (#486)', () => {
  it('installs a stub that removes the entry and records it', async () => {
    const { hook, remove, trash } = setup()
    await trash('/p/a.md')
    await trash('/p/docs')
    expect(remove.mock.calls).toEqual([['/p/a.md'], ['/p/docs']])
    expect(hook.trashed()).toEqual(['/p/a.md', '/p/docs'])
  })

  it('records Erfana’s watch handles open under each entry when the trash was asked', async () => {
    let installed: EntryRemover | undefined
    const open = new Map([['/p/docs', 2]])
    const hook = createTrashTestHook(
      (impl) => {
        installed = impl
      },
      async () => {},
      (entryPath) => open.get(entryPath) ?? 0
    )
    await installed!('/p/docs')
    await installed!('/p/a.md')
    expect(hook.handlesAtTrash()).toEqual([2, 0])
    hook.reset()
    expect(hook.handlesAtTrash()).toEqual([])
  })

  it('failNext refuses the next calls, removes nothing, then recovers', async () => {
    const { hook, remove, trash } = setup()
    hook.failNext(2)
    await expect(trash('/p/a.md')).rejects.toThrow('trash is unavailable')
    await expect(trash('/p/a.md')).rejects.toThrow('trash is unavailable')
    expect(remove).not.toHaveBeenCalled()
    await trash('/p/a.md')
    expect(hook.trashed()).toEqual(['/p/a.md'])
  })

  it('inUseNext refuses with EBUSY, removes nothing, then recovers', async () => {
    const { hook, remove, trash } = setup()
    hook.inUseNext()
    await expect(trash('/p/docs')).rejects.toMatchObject({ code: 'EBUSY' })
    expect(remove).not.toHaveBeenCalled()
    await trash('/p/docs')
    expect(hook.trashed()).toEqual(['/p/docs'])
  })

  it('reset forgets the record and pending failures', async () => {
    const { hook, trash } = setup()
    await trash('/p/a.md')
    hook.failNext()
    hook.inUseNext()
    hook.reset()
    await trash('/p/b.md')
    expect(hook.trashed()).toEqual(['/p/b.md'])
  })
})
