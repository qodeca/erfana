// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * An open file keeps reporting its changes, whatever writes it and however its
 * tab was opened (#464).
 *
 * Three ways the watch used to stop reporting, each with no error shown:
 *
 * 1. chokidar 5.0.0's `awaitWriteFinish` got stuck when its size check found
 *    the file missing mid-write, and swallowed every later change. The stress
 *    test below writes the file, deletes it while that check is due, puts it
 *    back, many times over, and then expects the last plain write to arrive.
 * 2. A terminal path link arrives as `C:/proj/a.md` on Windows; a plain prefix
 *    test against `C:\proj` refused to watch it at all.
 * 3. Closing one window dropped every later change for the other windows.
 *
 * Real files in `os.tmpdir()` and the real chokidar watch; only Electron is
 * mocked, at module scope – hence a file of its own. The short pauses in the
 * stress loop are the writer's timing being simulated, not waits for a result;
 * every wait for a result is a condition-based `vi.waitFor`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { WebContents } from 'electron'

const sends = vi.hoisted(() => [] as Array<{ id: number; channel: string; payload: Record<string, unknown> }>)

vi.mock('electron', () => {
  const win = (id: number) => ({
    isDestroyed: () => false,
    webContents: {
      id,
      send: (channel: string, payload: Record<string, unknown>) => sends.push({ id, channel, payload })
    }
  })
  return { BrowserWindow: { getAllWindows: vi.fn(() => [win(1), win(2)]) } }
})

import { FileWatcherService } from './FileWatcherService'

const EVENT_BUDGET_MS = 10_000
const wc = (id: number): WebContents => ({ id }) as unknown as WebContents
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('FileWatcherService keeps following an open file (#464)', () => {
  let root: string
  let svc: FileWatcherService

  beforeEach(async () => {
    sends.length = 0
    root = await realpath(await mkdtemp(join(tmpdir(), 'erfana-follow-')))
    svc = new FileWatcherService()
    svc.setProjectPath(root)
  })

  afterEach(async () => {
    await svc.dispose()
    await rm(root, { recursive: true, force: true })
  })

  const changedFor = (id: number, filePath: string): number =>
    sends.filter((s) => s.id === id && s.channel === 'file-watch:changed' && s.payload.filePath === filePath).length

  it(
    'still reports a plain write after many writes that leave the file briefly missing',
    async () => {
      const file = join(root, 'stress.md')
      await writeFile(file, '# start\n')
      await svc.watchFile(file, wc(1))

      // A write, then the file gone while the size check is due (it runs
      // ~100 ms after the change), then back – a delete-then-rename writer,
      // a branch switch, an antivirus lock on Windows
      for (let i = 0; i < 12; i++) {
        await writeFile(file, `# write ${i}\n`)
        await pause(60 + (i % 4) * 15)
        await rm(file, { force: true })
        await pause(40 + (i % 3) * 10)
        await writeFile(file, `# back ${i}\n`)
        await pause(30)
      }

      // Let everything above settle, then one ordinary save
      await vi.waitFor(() => expect(svc.getStats().totalWatched).toBe(1), { timeout: EVENT_BUDGET_MS })
      await pause(1_000)
      const before = changedFor(1, file)
      await writeFile(file, '# final, a plain save\n')

      await vi.waitFor(() => expect(changedFor(1, file)).toBeGreaterThan(before), {
        timeout: EVENT_BUDGET_MS,
        interval: 50
      })
    },
    60_000
  )

  it('watches a path that uses forward slashes, as a terminal link sends it on Windows', async () => {
    const file = join(root, 'linked.md')
    await writeFile(file, '# linked\n')
    const asLinked = `${root.replace(/\\/g, '/')}/linked.md`

    await expect(svc.watchFile(asLinked, wc(1))).resolves.toBeUndefined()

    await writeFile(file, '# linked, changed\n')
    await vi.waitFor(() => expect(changedFor(1, asLinked)).toBeGreaterThan(0), { timeout: EVENT_BUDGET_MS })
  })

  it('still refuses a path outside the project, including a sibling sharing its name prefix', async () => {
    const sibling = `${root}-other`
    await expect(svc.watchFile(join(sibling, 'a.md'), wc(1))).rejects.toThrow(
      'Cannot watch files outside the project directory'
    )
    await expect(svc.watchFile(join(root, '..', 'escape.md'), wc(1))).rejects.toThrow(
      'Cannot watch files outside the project directory'
    )
  })

  it('keeps reporting to one window after another window that watched the same file closes', async () => {
    const file = join(root, 'shared.md')
    await writeFile(file, '# shared\n')
    await svc.watchFile(file, wc(1))
    await svc.watchFile(file, wc(2))

    await svc.cleanupForWebContentsId(1)

    await writeFile(file, '# shared, changed after window 1 closed\n')
    await vi.waitFor(() => expect(changedFor(2, file)).toBeGreaterThan(0), { timeout: EVENT_BUDGET_MS })
    expect(changedFor(1, file)).toBe(0)
  })
})
