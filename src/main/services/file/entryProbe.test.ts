// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The in-use probe (#486): gone, in use, free, and a rename-back that fails.
 * The first block drives it with stand-in file-system calls; the second runs
 * it on a real temp tree – on Windows that includes the locks the probe exists
 * for (a process's working folder) and the handles Erfana's own directory
 * watcher holds, which must never make a folder look in use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { logger } from '../LoggingService'
import {
  PROBE_NAME_PREFIX,
  ProbeRestoreError,
  RESTORE_RETRY_DELAYS_MS,
  isProbeName,
  probeEntryAccess,
  type ProbeFs
} from './entryProbe'

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: boom`), { code })

/**
 * Stand-in calls with a little state: a path renamed away is missing to the
 * default `lstat` until something is renamed onto it again, as on disk.
 */
function fakeFs(overrides: Partial<ProbeFs> = {}): ProbeFs & { calls: string[][] } {
  const calls: string[][] = []
  const missing = new Set<string>()
  return {
    calls,
    lstat:
      overrides.lstat ??
      (async (entryPath) => {
        if (missing.has(entryPath)) throw errno('ENOENT')
        return {}
      }),
    rename: async (from, to) => {
      calls.push([from, to])
      await overrides.rename?.(from, to)
      missing.add(from)
      missing.delete(to)
    }
  }
}

const isProbePath = (from: string): boolean => path.basename(from).startsWith(PROBE_NAME_PREFIX)

describe('probeEntryAccess with stand-in calls', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it.each(['ENOENT', 'ENOTDIR'])('answers gone when lstat fails with %s, and never renames', async (code) => {
    const fs = fakeFs({ lstat: async () => Promise.reject(errno(code)) })
    await expect(probeEntryAccess('/p/a.md', fs)).resolves.toBe('gone')
    expect(fs.calls).toEqual([])
  })

  it.each(['EBUSY', 'EPERM', 'EACCES'])('answers in-use when the rename fails with %s, and moved nothing', async (code) => {
    const fs = fakeFs({ rename: async () => Promise.reject(errno(code)) })
    await expect(probeEntryAccess('/p/docs', fs)).resolves.toBe('in-use')
    expect(fs.calls).toHaveLength(1)
  })

  it('answers gone when the entry vanishes between lstat and the rename', async () => {
    const fs = fakeFs({ rename: async () => Promise.reject(errno('ENOENT')) })
    await expect(probeEntryAccess('/p/docs', fs)).resolves.toBe('gone')
  })

  it('answers free after renaming to a hidden sibling and straight back', async () => {
    const fs = fakeFs()
    await expect(probeEntryAccess(path.join('/p', 'docs'), fs)).resolves.toBe('free')
    const [[from, probe], [back, to]] = fs.calls as [[string, string], [string, string]]
    expect(from).toBe(path.join('/p', 'docs'))
    expect(path.dirname(probe)).toBe(path.join('/p'))
    expect(path.basename(probe)).toMatch(/^\.erfana-check-[0-9a-f-]{36}$/)
    expect([back, to]).toEqual([probe, from])
  })

  it('rethrows an error that is neither gone nor in use', async () => {
    const fs = fakeFs({ rename: async () => Promise.reject(errno('EROFS')) })
    await expect(probeEntryAccess('/p/docs', fs)).rejects.toMatchObject({ code: 'EROFS' })
  })

  it('retries the rename back, so a brief hold on the new name does not strand the item', async () => {
    let backAttempts = 0
    const fs = fakeFs({
      rename: async (from) => {
        if (isProbePath(from) && ++backAttempts < 3) throw errno('EBUSY')
      }
    })
    await expect(probeEntryAccess('/p/docs', fs, [0, 0])).resolves.toBe('free')
    expect(backAttempts).toBe(3)
  })

  it('throws ProbeRestoreError naming the temporary name when the rename back keeps failing', async () => {
    const fs = fakeFs({
      rename: async (from) => {
        if (isProbePath(from)) throw errno('EBUSY')
      }
    })
    const error = await probeEntryAccess(path.join('/home/alice/secret', 'docs'), fs, [0, 0]).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProbeRestoreError)
    const { probeName } = error as ProbeRestoreError
    expect((error as Error).message).toContain(probeName)
    expect((error as Error).message).toContain('rename it back')
    expect(fs.calls).toHaveLength(4) // away, then three tries back
    // Logged with the entry redacted and the temporary name, never the path
    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls)
    expect(logged).toContain(probeName)
    expect(logged).toContain('EBUSY')
    expect(logged).not.toContain('alice')
  })
})

describe('probeEntryAccess rename back: never over a new file, retried only while in use', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('retries for about two seconds in all', () => {
    expect(RESTORE_RETRY_DELAYS_MS).toEqual([50, 100, 250, 500, 1000])
  })

  // An agent's atomic save landed on the original name while the probe held the item
  it('throws ProbeRestoreError without renaming back when something took the name meanwhile', async () => {
    const fs = fakeFs({ lstat: async () => ({}) }) // the first lstat is the probe's own; the 2nd finds the new file
    const error = await probeEntryAccess(path.join('/p', 'docs'), fs, [0, 0, 0, 0, 0]).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProbeRestoreError)
    expect(fs.calls).toHaveLength(1) // the probe's own rename away, never one back
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).toContain('name-taken')
  })

  it('checks the name before every attempt, so a file arriving during the retries is not overwritten', async () => {
    let lstats = 0
    const fs = fakeFs({
      lstat: async () => {
        // 1: the probe's own; 2: before the first try back (free); 3: a file arrived
        if (++lstats === 2) throw errno('ENOENT')
        return {}
      },
      rename: async (from) => {
        if (isProbePath(from)) throw errno('EBUSY')
      }
    })
    await expect(probeEntryAccess('/p/docs', fs, [0, 0, 0, 0, 0])).rejects.toBeInstanceOf(ProbeRestoreError)
    expect(fs.calls).toHaveLength(2) // away, one failed try back, then stopped at the check
  })

  it.each(['EBUSY', 'EPERM', 'EACCES', 'ETXTBSY'])('keeps retrying while the rename back fails with %s', async (code) => {
    let backAttempts = 0
    const fs = fakeFs({
      rename: async (from) => {
        if (isProbePath(from) && ++backAttempts <= 4) throw errno(code)
      }
    })
    await expect(probeEntryAccess('/p/docs', fs, [0, 0, 0, 0, 0])).resolves.toBe('free')
    expect(backAttempts).toBe(5)
  })

  it('stops after one attempt when the rename back fails other than in use', async () => {
    const fs = fakeFs({
      rename: async (from) => {
        if (isProbePath(from)) throw errno('EROFS')
      }
    })
    const error = await probeEntryAccess('/p/docs', fs, [0, 0, 0, 0, 0]).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProbeRestoreError)
    expect((error as Error).cause).toMatchObject({ code: 'EROFS' })
    expect(fs.calls).toHaveLength(2) // away, one try back
  })
})

describe('isProbeName', () => {
  it.each([
    ['.erfana-check-1b4e28ba-2fa1-11d2-883f-0016d3cca427', true],
    ['docs/.erfana-check-1b4e28ba', true],
    ['docs/.erfana-check-1b4e28ba/sub/a.md', true],
    ['docs\\.erfana-check-1b4e28ba\\a.md', true],
    ['docs/erfana-check.md', false],
    ['docs/.erfana-checker/a.md', false],
    ['', false]
  ])('%s → %s', (relPath, expected) => {
    expect(isProbeName(relPath)).toBe(expected)
  })
})

describe('probeEntryAccess on a real tree', () => {
  let base: string
  const closers: Array<() => void> = []

  beforeEach(() => {
    base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'erfana-probe-')))
    mkdirSync(path.join(base, 'docs', 'deep'), { recursive: true })
    writeFileSync(path.join(base, 'docs', 'deep', 'a.md'), 'a')
    writeFileSync(path.join(base, 'note.md'), 'n')
  })

  afterEach(async () => {
    for (const close of closers.splice(0)) close()
    // A killed child can hold its working folder for a moment on Windows
    await vi.waitFor(() => rmSync(base, { recursive: true, force: true }), { timeout: 5000, interval: 100 })
  })

  /** The folder's entries are back as they were: nothing renamed, nothing left behind. */
  const expectUntouched = (): void => expect(readdirSync(base).sort()).toEqual(['docs', 'note.md'])

  it('a free file and a free folder probe as free and are left in place', async () => {
    await expect(probeEntryAccess(path.join(base, 'note.md'))).resolves.toBe('free')
    await expect(probeEntryAccess(path.join(base, 'docs'))).resolves.toBe('free')
    expectUntouched()
    expect(existsSync(path.join(base, 'docs', 'deep', 'a.md'))).toBe(true)
  })

  it('a missing entry probes as gone', async () => {
    await expect(probeEntryAccess(path.join(base, 'missing.md'))).resolves.toBe('gone')
  })

  // Erfana's watchers hold fs.watch handles (one per watched folder in the
  // native directory watcher; one on a watched file's folder, libuv's way), and
  // a watcher pause releases none of them. On the folder itself they allow the
  // rename that the probe – and the Recycle Bin – makes
  it('a folder with a watch handle on itself, or a watched file directly in it, probes as free', async () => {
    const onFolder: FSWatcher = watch(path.join(base, 'docs'), { recursive: true }, () => {})
    closers.push(() => onFolder.close())
    await expect(probeEntryAccess(path.join(base, 'docs'))).resolves.toBe('free')
    onFolder.close()

    const onFile: FSWatcher = watch(path.join(base, 'docs', 'deep', 'a.md'), () => {})
    closers.push(() => onFile.close())
    await expect(probeEntryAccess(path.join(base, 'docs', 'deep'))).resolves.toBe('free')
    expectUntouched()
  })

  // The platform fact, pinned on purpose: on Windows a handle anywhere BELOW
  // the folder blocks renaming it, so the Recycle Bin and the probe both
  // refuse, although a recursive rm would succeed (the handles allow delete
  // sharing). Erfana holds such handles for a tab open on a file in a
  // subfolder, and for the native watcher's split folders, so the project
  // tree's Delete releases its own around the trash and the probe
  // (`releaseWatchesAround.ts`); with them released the same folder trashes –
  // `releaseWatchesAround.win32.test.ts`. A handle another program holds is
  // not released, and still answers in use.
  it.runIf(process.platform === 'win32').each([
    ['folder watch', ['docs', 'deep']],
    ['file watch', ['docs', 'deep', 'a.md']]
  ])('Windows: an unreleased %s below the folder makes it probe as in use, and leaves it in place', async (_label, segments) => {
    const watcher = watch(path.join(base, ...segments), () => {})
    closers.push(() => watcher.close())

    await expect(probeEntryAccess(path.join(base, 'docs'))).resolves.toBe('in-use')
    expectUntouched()
  })

  it.runIf(process.platform === 'win32')(
    'a folder that is a running process’s working folder probes as in use, and stays where it was',
    async () => {
      const child: ChildProcess = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
        cwd: path.join(base, 'docs', 'deep'),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'ignore'
      })
      closers.push(() => child.kill())
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve())
        child.once('error', reject)
      })

      await expect(probeEntryAccess(path.join(base, 'docs'))).resolves.toBe('in-use')
      expectUntouched()
    }
  )
})
