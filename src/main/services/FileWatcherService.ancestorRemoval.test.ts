// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * An open file whose parent folder is renamed or deleted (save after a folder
 * rename, found in the v0.21.0 macOS validation).
 *
 * A single-file chokidar watch reports nothing when its parent folder is
 * renamed away, so the editor never showed the "deleted" banner and the next
 * save failed against a path that no longer existed. `handleAncestorRemovals`
 * is fed the project watcher's removals and runs an affected watch through the
 * normal unlink branch. Real files in `os.tmpdir()` and the real chokidar watch
 * (only Electron is mocked, at module scope - hence a file of its own); waits
 * are condition-based polls, never fixed sleeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { WebContents } from 'electron'

const sends = vi.hoisted(() => [] as Array<{ channel: string; payload: Record<string, unknown> }>)

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          id: 1,
          send: (channel: string, payload: Record<string, unknown>) => sends.push({ channel, payload })
        }
      }
    ])
  }
}))

import { FileWatcherService } from './FileWatcherService'

const EVENT_BUDGET_MS = 5_000
const webContents = { id: 1 } as unknown as WebContents

describe('FileWatcherService.handleAncestorRemovals', () => {
  let root: string
  let svc: FileWatcherService

  beforeEach(async () => {
    sends.length = 0
    root = await realpath(await mkdtemp(join(tmpdir(), 'erfana-ancestor-')))
    await mkdir(join(root, 'docs', 'deep'), { recursive: true })
    await writeFile(join(root, 'docs', 'open.md'), '# open')
    await writeFile(join(root, 'docs', 'deep', 'nested.md'), '# nested')
    await writeFile(join(root, 'other.md'), '# other')
    svc = new FileWatcherService()
    svc.setProjectPath(root)
  })

  afterEach(async () => {
    await svc.dispose()
    await rm(root, { recursive: true, force: true })
  })

  const deleted = (): string[] =>
    sends.filter(s => s.channel === 'file-watch:deleted').map(s => String(s.payload.filePath))

  // Windows refuses to rename a folder while a watch holds a handle inside it (EPERM),
  // so this real-fs rename needs a POSIX host.
  it.skipIf(process.platform === 'win32')('marks every open file under a renamed folder deleted, and only those', async () => {
    const open = join(root, 'docs', 'open.md')
    const nested = join(root, 'docs', 'deep', 'nested.md')
    const other = join(root, 'other.md')
    await svc.watchFile(open, webContents)
    await svc.watchFile(nested, webContents)
    await svc.watchFile(other, webContents)

    await rename(join(root, 'docs'), join(root, 'docs2'))
    svc.handleAncestorRemovals([join(root, 'docs')])

    await vi.waitFor(() => expect(deleted().sort()).toEqual([nested, open].sort()), {
      timeout: EVENT_BUDGET_MS
    })
    // The dead watches are dropped, as for a direct delete; the unrelated one stays
    expect(svc.getStats().fileDetails.map(d => d.path)).toEqual([other])
  })

  it('does not mark a file deleted when it is still on disk (existence re-check)', async () => {
    const open = join(root, 'docs', 'open.md')
    await svc.watchFile(open, webContents)

    // A stale or wrong removal report: the folder is in fact still there
    svc.handleAncestorRemovals([join(root, 'docs')])

    await vi.waitFor(
      () => expect(sends.some(s => s.channel === 'file-watch:changed')).toBe(true),
      { timeout: EVENT_BUDGET_MS }
    )
    expect(deleted()).toEqual([])
    expect(svc.getStats().totalWatched).toBe(1)
  })

  it('ignores removals that are not an ancestor (a sibling with a shared prefix, or the file itself)', async () => {
    const open = join(root, 'docs', 'open.md')
    await svc.watchFile(open, webContents)
    const handleFileDeleted = vi.spyOn(
      svc as unknown as { handleFileDeleted: (p: string) => void },
      'handleFileDeleted'
    )

    svc.handleAncestorRemovals([join(root, 'doc'), join(root, 'docs-old'), open])

    expect(handleFileDeleted).not.toHaveBeenCalled()
  })
})
