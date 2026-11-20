// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project tree's Delete (#486): the first question moves the item to the
 * platform's trash; a `TRASH_UNAVAILABLE` answer asks a second question, and
 * only that answer sends `permanent: true`. An `IN_USE` answer, to either
 * request, is an error toast asking to close what holds the item – never a
 * second question.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isMacOS, isWindows } from '../../../utils/platform'
import { DeleteDirectoryCommand, DeleteFileCommand } from './deleteCommands'
import {
  DELETE_PERMANENTLY_LABEL,
  PERMANENT_CONFIRM_ARM_DELAY_MS,
  inUseMessage,
  permanentConfirmMessage,
  trashConfirmMessage,
  trashCopy
} from './treeDelete'
import { createMockFileNode, createMockMenuContext } from '../__test__/testUtils'
import type { FileNodeDirectory, FileNodeFile, MenuContext } from './types'

vi.mock('../../../utils/platform', () => ({
  isMacOS: vi.fn(() => false),
  isWindows: vi.fn(() => true)
}))

const UNAVAILABLE = { ok: false, code: 'TRASH_UNAVAILABLE' } as const
const IN_USE = { ok: false, code: 'IN_USE' } as const

function onPlatform(platform: 'win32' | 'darwin' | 'linux'): void {
  vi.mocked(isWindows).mockReturnValue(platform === 'win32')
  vi.mocked(isMacOS).mockReturnValue(platform === 'darwin')
}

const file = (): FileNodeFile => createMockFileNode('test.md', 'file') as FileNodeFile
const folder = (): FileNodeDirectory => createMockFileNode('folder', 'directory') as FileNodeDirectory

describe('trash copy per platform', () => {
  it.each([
    ['win32', 'the Recycle Bin', 'Move to Recycle Bin'],
    ['darwin', 'the Trash', 'Move to Trash'],
    ['linux', 'the trash', 'Move to trash']
  ] as const)('%s names its trash "%s" and its button "%s"', (platform, place, moveLabel) => {
    onPlatform(platform)
    expect(trashCopy()).toEqual({ place, moveLabel })
  })

  it('says a folder takes its contents with it, and that the item can be restored', () => {
    const copy = { place: 'the Trash', moveLabel: 'Move to Trash' }
    expect(trashConfirmMessage('file', 'a.md', copy)).toBe(
      '“a.md” will be moved to the Trash. You can restore it from there.'
    )
    expect(trashConfirmMessage('folder', 'docs', copy)).toBe(
      '“docs” and everything in it will be moved to the Trash. You can restore it from there.'
    )
    expect(permanentConfirmMessage('folder', 'docs', copy)).toBe(
      '“docs” and everything in it cannot be moved to the Trash. Delete it permanently instead? You cannot undo this.'
    )
    expect(inUseMessage('docs')).toBe('“docs” is in use – close the programs or terminals using it, then try again.')
  })
})

describe('DeleteFileCommand', () => {
  let ctx: MenuContext

  beforeEach(() => {
    onPlatform('win32')
    ctx = { ...createMockMenuContext(), onGitRefresh: vi.fn() }
  })

  it('is the danger "Delete" item with an icon', () => {
    const cmd = new DeleteFileCommand(ctx, file())
    expect(cmd.label).toBe('Delete')
    expect(cmd.icon).toBeDefined()
    expect(cmd.danger).toBe(true)
  })

  it.each([
    ['win32', 'Move to Recycle Bin', 'the Recycle Bin'],
    ['darwin', 'Move to Trash', 'the Trash'],
    ['linux', 'Move to trash', 'the trash']
  ] as const)('on %s asks to "%s"', async (platform, confirmLabel, place) => {
    onPlatform(platform)
    await new DeleteFileCommand(ctx, file()).execute()

    expect(ctx.dialogs.showConfirm).toHaveBeenCalledTimes(1)
    expect(ctx.dialogs.showConfirm).toHaveBeenCalledWith({
      title: 'Delete File',
      message: `“test.md” will be moved to ${place}. You can restore it from there.`,
      confirmLabel,
      danger: true
    })
  })

  it('never claims the delete cannot be undone in the first question', async () => {
    await new DeleteFileCommand(ctx, file()).execute()
    const [opts] = vi.mocked(ctx.dialogs.showConfirm).mock.calls[0]
    expect(opts.message).not.toMatch(/cannot be undone|permanent/i)
  })

  it('sends a trash delete (no `permanent`) when confirmed, then refreshes inside the watcher pause', async () => {
    await new DeleteFileCommand(ctx, file()).execute()

    expect(ctx.api.deleteFile).toHaveBeenCalledTimes(1)
    expect(ctx.api.deleteFile).toHaveBeenCalledWith({ filePath: '/test/project/test.md' })
    expect(ctx.withWatcherPause).toHaveBeenCalledTimes(1)
    expect(ctx.refreshProjectTree).toHaveBeenCalledTimes(1)
    expect(ctx.onGitRefresh).toHaveBeenCalledTimes(1)
  })

  it('deletes nothing when the first question is cancelled', async () => {
    vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(false)

    await new DeleteFileCommand(ctx, file()).execute()

    expect(ctx.api.deleteFile).not.toHaveBeenCalled()
    expect(ctx.refreshProjectTree).not.toHaveBeenCalled()
  })

  it('shows an error toast when the delete fails', async () => {
    vi.mocked(ctx.api.deleteFile).mockRejectedValue(new Error('Delete failed'))
    vi.mocked(ctx.formatFileOperationError).mockReturnValue('Delete failed')

    await new DeleteFileCommand(ctx, file()).execute()

    expect(ctx.toast).toHaveBeenCalledWith({ type: 'error', title: 'Error', message: 'Delete failed' })
    expect(ctx.dialogs.showConfirm).toHaveBeenCalledTimes(1)
  })

  describe('when the trash refuses the item', () => {
    beforeEach(() => {
      vi.mocked(ctx.api.deleteFile).mockResolvedValueOnce(UNAVAILABLE)
    })

    it('asks a second question that says the delete is permanent', async () => {
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

      await new DeleteFileCommand(ctx, file()).execute()

      expect(ctx.dialogs.showConfirm).toHaveBeenCalledTimes(2)
      expect(ctx.dialogs.showConfirm).toHaveBeenLastCalledWith({
        title: 'Delete permanently?',
        message: '“test.md” cannot be moved to the Recycle Bin. Delete it permanently instead? You cannot undo this.',
        confirmLabel: DELETE_PERMANENTLY_LABEL,
        danger: true,
        confirmArmDelayMs: PERMANENT_CONFIRM_ARM_DELAY_MS
      })
      expect(PERMANENT_CONFIRM_ARM_DELAY_MS).toBe(500)
    })

    it('"Delete permanently" on an item that turns out to be in use shows the in-use error', async () => {
      vi.mocked(ctx.api.deleteFile).mockResolvedValueOnce(IN_USE)

      await new DeleteFileCommand(ctx, file()).execute()

      expect(ctx.api.deleteFile).toHaveBeenLastCalledWith({ filePath: '/test/project/test.md', permanent: true })
      expect(ctx.refreshProjectTree).not.toHaveBeenCalled()
      expect(ctx.toast).toHaveBeenCalledWith({ type: 'error', title: 'Error', message: inUseMessage('test.md') })
    })

    it('Cancel on the second question deletes nothing and leaves the tree alone', async () => {
      vi.mocked(ctx.dialogs.showConfirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

      await new DeleteFileCommand(ctx, file()).execute()

      expect(ctx.api.deleteFile).toHaveBeenCalledTimes(1)
      expect(ctx.api.deleteFile).not.toHaveBeenCalledWith(expect.objectContaining({ permanent: true }))
      expect(ctx.refreshProjectTree).not.toHaveBeenCalled()
      expect(ctx.onGitRefresh).not.toHaveBeenCalled()
      expect(ctx.toast).not.toHaveBeenCalled()
    })

    it('"Delete permanently" sends `permanent: true` and refreshes', async () => {
      await new DeleteFileCommand(ctx, file()).execute()

      expect(ctx.api.deleteFile).toHaveBeenNthCalledWith(1, { filePath: '/test/project/test.md' })
      expect(ctx.api.deleteFile).toHaveBeenNthCalledWith(2, { filePath: '/test/project/test.md', permanent: true })
      expect(ctx.refreshProjectTree).toHaveBeenCalledTimes(1)
      expect(ctx.onGitRefresh).toHaveBeenCalledTimes(1)
    })

    it('asks the second question outside the watcher pause', async () => {
      let paused = false
      vi.mocked(ctx.withWatcherPause).mockImplementation(async (op) => {
        paused = true
        try {
          return await op()
        } finally {
          paused = false
        }
      })
      const pausedWhenAsked: boolean[] = []
      vi.mocked(ctx.dialogs.showConfirm).mockImplementation(async () => {
        pausedWhenAsked.push(paused)
        return true
      })

      await new DeleteFileCommand(ctx, file()).execute()

      expect(pausedWhenAsked).toEqual([false, false])
    })
  })
})

describe('DeleteFileCommand when the item is in use', () => {
  let ctx: MenuContext

  beforeEach(() => {
    onPlatform('win32')
    ctx = { ...createMockMenuContext(), onGitRefresh: vi.fn() }
    vi.mocked(ctx.api.deleteFile).mockResolvedValueOnce(IN_USE)
  })

  it('shows an error asking to close what holds it, and never asks about a permanent delete', async () => {
    await new DeleteFileCommand(ctx, file()).execute()

    expect(ctx.dialogs.showConfirm).toHaveBeenCalledTimes(1)
    expect(ctx.api.deleteFile).toHaveBeenCalledTimes(1)
    expect(ctx.api.deleteFile).not.toHaveBeenCalledWith(expect.objectContaining({ permanent: true }))
    expect(ctx.toast).toHaveBeenCalledWith({
      type: 'error',
      title: 'Error',
      message: '“test.md” is in use – close the programs or terminals using it, then try again.'
    })
    // The message is the flow's own, not a generic mapping of the error
    expect(ctx.formatFileOperationError).not.toHaveBeenCalled()
  })

  it('leaves the tree and the git badges alone, and still resumes the watcher', async () => {
    let resumed = false
    vi.mocked(ctx.withWatcherPause).mockImplementation(async (op) => {
      try {
        return await op()
      } finally {
        resumed = true
      }
    })

    await new DeleteFileCommand(ctx, file()).execute()

    expect(resumed).toBe(true)
    expect(ctx.refreshProjectTree).not.toHaveBeenCalled()
    expect(ctx.onGitRefresh).not.toHaveBeenCalled()
  })
})

describe('DeleteDirectoryCommand', () => {
  let ctx: MenuContext

  beforeEach(() => {
    onPlatform('darwin')
    ctx = createMockMenuContext()
  })

  it('is the danger "Delete" item', () => {
    const cmd = new DeleteDirectoryCommand(ctx, folder())
    expect(cmd.label).toBe('Delete')
    expect(cmd.danger).toBe(true)
  })

  it('asks with the folder message, naming its contents', async () => {
    await new DeleteDirectoryCommand(ctx, folder()).execute()

    expect(ctx.dialogs.showConfirm).toHaveBeenCalledWith({
      title: 'Delete Folder',
      message: '“folder” and everything in it will be moved to the Trash. You can restore it from there.',
      confirmLabel: 'Move to Trash',
      danger: true
    })
  })

  it('sends a trash delete for the folder when confirmed', async () => {
    await new DeleteDirectoryCommand(ctx, folder()).execute()
    expect(ctx.api.deleteFolder).toHaveBeenCalledWith({ filePath: '/test/project/folder' })
  })

  it('falls back to a permanent folder delete only after the second confirmation', async () => {
    vi.mocked(ctx.api.deleteFolder).mockResolvedValueOnce(UNAVAILABLE)

    await new DeleteDirectoryCommand(ctx, folder()).execute()

    expect(ctx.dialogs.showConfirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Delete permanently?',
        message: expect.stringContaining('“folder” and everything in it cannot be moved to the Trash'),
        confirmLabel: 'Delete permanently'
      })
    )
    expect(ctx.api.deleteFolder).toHaveBeenLastCalledWith({ filePath: '/test/project/folder', permanent: true })
  })

  it('shows the in-use error for a folder in use, with no second question', async () => {
    vi.mocked(ctx.api.deleteFolder).mockResolvedValueOnce(IN_USE)

    await new DeleteDirectoryCommand(ctx, folder()).execute()

    expect(ctx.dialogs.showConfirm).toHaveBeenCalledTimes(1)
    expect(ctx.api.deleteFolder).toHaveBeenCalledTimes(1)
    expect(ctx.toast).toHaveBeenCalledWith({ type: 'error', title: 'Error', message: inUseMessage('folder') })
  })
})
