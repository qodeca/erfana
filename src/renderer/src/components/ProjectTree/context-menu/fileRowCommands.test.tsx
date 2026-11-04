// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Paste on a file row, the Delete key's command and the menu's shortcut
 * hints in the project tree (#463).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PasteIntoParentFolderCommand, deleteCommandFor } from './fileRowCommands'
import { DirectoryContextMenuStrategy, FileContextMenuStrategy } from './strategies'
import { createMockMenuContext, createMockFileNode } from '../__test__/testUtils'
import type { MenuContext, FileNodeDirectory, FileNodeFile } from './types'
import { isMacOS } from '../../../utils/platform'

vi.mock('../../../utils/platform', () => ({ isMacOS: vi.fn(), isWindows: vi.fn() }))

describe('PasteIntoParentFolderCommand', () => {
  let ctx: MenuContext

  beforeEach(() => {
    vi.mocked(isMacOS).mockReturnValue(false)
    ctx = createMockMenuContext()
    vi.mocked(ctx.clipboard.getOperation).mockReturnValue('copy')
  })

  it("pastes into the file's folder", async () => {
    const file = createMockFileNode('notes.md', 'file', '/test/project/docs/notes.md') as FileNodeFile

    await new PasteIntoParentFolderCommand(ctx, file).execute()

    expect(ctx.clipboard.paste).toHaveBeenCalledWith('/test/project/docs', false)
    expect(ctx.refreshProjectTree).toHaveBeenCalled()
  })

  it('pastes into the project root for a file at the top level', async () => {
    const file = createMockFileNode('README.md', 'file') as FileNodeFile

    await new PasteIntoParentFolderCommand(ctx, file).execute()

    expect(ctx.clipboard.paste).toHaveBeenCalledWith('/test/project', false)
  })

  it('checks a cut for a name conflict in the parent folder, not the file', async () => {
    vi.mocked(ctx.clipboard.getOperation).mockReturnValue('cut')
    const file = createMockFileNode('notes.md', 'file', '/test/project/docs/notes.md') as FileNodeFile

    await new PasteIntoParentFolderCommand(ctx, file).execute()

    expect(ctx.api.checkConflict).toHaveBeenCalledWith({ targetParentPath: '/test/project/docs', itemName: 'item.md' })
  })
})

describe('deleteCommandFor', () => {
  let ctx: MenuContext

  beforeEach(() => {
    ctx = createMockMenuContext()
  })

  it('asks for confirmation, then deletes a file', async () => {
    const file = createMockFileNode('notes.md', 'file') as FileNodeFile

    await deleteCommandFor(ctx, file).execute()

    expect(ctx.dialogs.showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete File', danger: true }))
    expect(ctx.api.deleteFile).toHaveBeenCalledWith({ filePath: file.path })
  })

  it('deletes a folder with the folder confirmation', async () => {
    const folder = createMockFileNode('docs', 'directory') as FileNodeDirectory

    await deleteCommandFor(ctx, folder).execute()

    expect(ctx.dialogs.showConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete Folder' }))
    expect(ctx.api.deleteFolder).toHaveBeenCalledWith({ filePath: folder.path })
  })

  it('deletes nothing when the confirmation is cancelled', async () => {
    vi.mocked(ctx.dialogs.showConfirm).mockResolvedValue(false)

    await deleteCommandFor(ctx, createMockFileNode('notes.md', 'file')).execute()

    expect(ctx.api.deleteFile).not.toHaveBeenCalled()
  })
})

describe('tree menu shortcut hints', () => {
  let ctx: MenuContext

  beforeEach(() => {
    ctx = createMockMenuContext()
  })

  const hints = (items: { label: string; shortcut?: string }[]) =>
    Object.fromEntries(items.filter((i) => ['Cut', 'Copy', 'Paste', 'Delete'].includes(i.label)).map((i) => [i.label, i.shortcut]))

  it('shows Cut, Copy, Paste and Delete hints on a file row (Windows)', () => {
    vi.mocked(isMacOS).mockReturnValue(false)
    const items = new FileContextMenuStrategy().build(createMockFileNode('notes.md', 'file'), ctx)
    expect(hints(items)).toEqual({ Cut: 'Ctrl+X', Copy: 'Ctrl+C', Paste: 'Ctrl+V', Delete: 'Delete' })
  })

  it('shows ⌘⌫ for Delete on macOS', () => {
    vi.mocked(isMacOS).mockReturnValue(true)
    const items = new DirectoryContextMenuStrategy().build(createMockFileNode('docs', 'directory'), ctx)
    expect(hints(items)).toEqual({ Cut: '⌘X', Copy: '⌘C', Paste: '⌘V', Delete: '⌘⌫' })
  })

  it('shows no hints on the project root, whose keys are not wired', () => {
    vi.mocked(isMacOS).mockReturnValue(false)
    const root = createMockFileNode('project', 'directory', '/test/project')
    const items = new DirectoryContextMenuStrategy().build(root, ctx)
    expect(Object.values(hints(items)).every((h) => h === undefined)).toBe(true)
  })
})
