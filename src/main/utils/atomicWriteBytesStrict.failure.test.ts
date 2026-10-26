// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * atomicWriteBytesStrict failure paths. Split from
 * `atomicWriteBytesStrict.test.ts` because the module-scope `rename` / `open`
 * mock hoists (docs/windows/contributing.md, test-file split policy).
 * Everything else is the real fs on a temp directory. Design:
 * docs/designs/html-preview-comments.md §7.6 step 9 (M-005, M-006, M-061).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const hooks = vi.hoisted(() => ({ rename: vi.fn(), open: vi.fn(), lstat: vi.fn() }))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: hooks.rename, open: hooks.open, lstat: hooks.lstat }
})

import { ATOMIC_TEMP_PREFIX } from './atomicWrite'
import {
  atomicWriteBytesStrict,
  fileIdOf,
  readFileNoFollow,
  sha256Hex,
  type FileId,
  type StrictWriteOptions
} from './atomicWriteBytesStrict'

type FsPromises = typeof import('node:fs/promises')

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated, rename '/secret/user/page.html'`), { code })
}

const ORIGINAL = Buffer.from('<p>ORIGINAL</p>\r\n')
const NEW = Buffer.from('<p>NEW</p>\r\n')
const ZONE_STREAM = ':Zone.Identifier'
const MARK = '[ZoneTransfer]\r\nZoneId=3\r\n'

describe('atomicWriteBytesStrict failure paths', () => {
  let made: string
  let dir: string
  let target: string
  let targetId: FileId
  let actual: FsPromises

  beforeEach(async () => {
    actual = await vi.importActual<FsPromises>('node:fs/promises')
    made = await mkdtemp(join(tmpdir(), 'erfana-strict-fail-'))
    dir = await realpath(made)
    target = join(dir, 'page.html')
    await writeFile(target, ORIGINAL)
    targetId = fileIdOf(await actual.stat(target, { bigint: true }))
    hooks.rename.mockReset()
    hooks.rename.mockImplementation(actual.rename)
    hooks.open.mockReset()
    hooks.open.mockImplementation(actual.open)
    hooks.lstat.mockReset()
    hooks.lstat.mockImplementation(actual.lstat)
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(made, { recursive: true, force: true })
  })

  const write = (extra: Partial<StrictWriteOptions> = {}) =>
    atomicWriteBytesStrict(target, NEW, {
      expectedHash: sha256Hex(ORIGINAL),
      expectedId: targetId,
      maxBytes: 1024,
      ...extra
    })

  /** Alternate data streams are an NTFS feature: give each `<file>:Zone.Identifier` a `<file>.zone` sibling, on every host. */
  function redirectZoneStreams(fail: { read?: boolean; create?: boolean } = {}): void {
    hooks.open.mockImplementation(async (...args: Parameters<FsPromises['open']>) => {
      const [path, flags, mode] = args
      const name = String(path)
      if (!name.endsWith(ZONE_STREAM)) return actual.open(...args)
      if (fail.create && flags === 'wx') throw errno('EACCES')
      const handle = await actual.open(`${name.slice(0, -ZONE_STREAM.length)}.zone`, flags, mode)
      if (fail.read) {
        ;(handle as unknown as Record<string, unknown>).read = async () => {
          throw errno('EIO')
        }
      }
      return handle
    })
  }

  /** The `.zone` sibling a temp file's mark went to, if any. */
  async function tempMark(): Promise<string | undefined> {
    const name = (await readdir(dir)).find(n => n.startsWith(ATOMIC_TEMP_PREFIX) && n.endsWith('.zone'))
    return name === undefined ? undefined : readFile(join(dir, name), 'utf8')
  }

  /** Make the temp file's handle fail one operation (the target's own reads stay real). */
  function failTempHandle(op: 'writeFile' | 'sync' | 'chmod', code: string): void {
    hooks.open.mockImplementation(async (...args: Parameters<FsPromises['open']>) => {
      const handle = await actual.open(...args)
      if (String(args[0]).includes(ATOMIC_TEMP_PREFIX)) {
        ;(handle as unknown as Record<string, unknown>)[op] = async () => {
          throw errno(code)
        }
      }
      return handle
    })
  }

  async function expectOriginalOnly(): Promise<void> {
    expect((await readFile(target)).equals(ORIGINAL)).toBe(true)
    expect(await readdir(dir)).toEqual(['page.html'])
  }

  it('M-005 a failure mid-write leaves the original intact and removes the temp file', async () => {
    failTempHandle('writeFile', 'ENOSPC')

    expect(await write()).toEqual({ ok: false, reason: 'io', errno: 'ENOSPC' })

    await expectOriginalOnly()
    expect(hooks.rename).not.toHaveBeenCalled()
  })

  it('M-061 the temp file is a .erfana-tmp- file next to the target, and a crash before the rename leaves the original intact', async () => {
    // The kill: the rename never completes, so neither does the cleanup
    hooks.rename.mockImplementation(() => new Promise(() => {}))
    void write()
    await vi.waitFor(() => expect(hooks.rename).toHaveBeenCalledTimes(1))

    const [from, to] = hooks.rename.mock.calls[0] as [string, string]
    expect(to).toBe(target)
    expect(join(from, '..')).toBe(dir)
    const temp = (await readdir(dir)).find(name => name !== 'page.html')!
    expect(temp.startsWith(ATOMIC_TEMP_PREFIX)).toBe(true)
    expect((await readFile(join(dir, temp))).equals(NEW)).toBe(true)
    expect((await readFile(target)).equals(ORIGINAL)).toBe(true)
  })

  it.each(['EPERM', 'EBUSY'])(
    'M-006 a persistent %s on rename is retried with backoff, then reported as busy; no in-place write',
    async code => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      hooks.rename.mockRejectedValue(errno(code))

      const pending = write()
      // vi.waitFor advances the fake clock between its checks, so each backoff elapses
      await vi.waitFor(() => expect(hooks.rename).toHaveBeenCalledTimes(4))

      expect(await pending).toEqual({ ok: false, reason: 'busy', errno: code })
      expect(hooks.rename).toHaveBeenCalledTimes(4) // first try + 3 retries
      await expectOriginalOnly()
    }
  )

  it('M-006 a transient EBUSY clears on a retry and the write goes through', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    hooks.rename.mockRejectedValueOnce(errno('EBUSY')).mockImplementation(actual.rename)

    const pending = write()
    await vi.waitFor(() => expect(hooks.rename).toHaveBeenCalledTimes(2))

    expect(await pending).toEqual({ ok: true, path: target })
    expect((await readFile(target)).equals(NEW)).toBe(true)
    expect(await readdir(dir)).toEqual(['page.html'])
  })

  it.each(['EXDEV', 'ENOTSUP', 'EINVAL', 'ENOSYS'])(
    'M-061 a rename failing with %s is unsupported-fs: not retried, never written in place',
    async code => {
      hooks.rename.mockRejectedValue(errno(code))

      expect(await write()).toEqual({ ok: false, reason: 'unsupported-fs', errno: code })

      expect(hooks.rename).toHaveBeenCalledTimes(1)
      await expectOriginalOnly()
    }
  )

  it.each(['EXDEV', 'ENOTSUP'])('M-061 an fsync failing with %s is unsupported-fs and nothing is renamed', async code => {
    failTempHandle('sync', code)

    expect(await write()).toEqual({ ok: false, reason: 'unsupported-fs', errno: code })

    expect(hooks.rename).not.toHaveBeenCalled()
    await expectOriginalOnly()
  })

  it.each([
    ['EACCES', 'read-only'],
    ['EPERM', 'read-only'],
    ['ENOENT', 'gone'],
    ['EMFILE', 'io']
  ])('a temp file that cannot be created (%s) is %s', async (code, reason) => {
    hooks.open.mockImplementation(async (...args: Parameters<FsPromises['open']>) => {
      if (String(args[0]).includes(ATOMIC_TEMP_PREFIX)) throw errno(code)
      return actual.open(...args)
    })

    expect(await write()).toEqual({ ok: false, reason, errno: code })

    await expectOriginalOnly()
  })

  it('a failing chmod is not fatal: the bytes are still written atomically', async () => {
    failTempHandle('chmod', 'EPERM')

    expect(await write()).toEqual({ ok: true, path: target })

    expect((await readFile(target)).equals(NEW)).toBe(true)
    expect(hooks.rename).toHaveBeenCalledTimes(1)
  })

  it('a re-read that fails with an I/O error is reported, and the temp file is removed', async () => {
    hooks.open.mockImplementation(async (...args: Parameters<FsPromises['open']>) => {
      // The re-read before the rename opens the target itself, read-only
      if (args[0] === target) throw errno('EIO')
      return actual.open(...args)
    })

    expect(await write()).toEqual({ ok: false, reason: 'io', errno: 'EIO' })

    await expectOriginalOnly()
    expect(hooks.rename).not.toHaveBeenCalled()
  })

  it('SEC-11 a file swapped between the open and the name check (dev/ino differ) is changed, and nothing is renamed', async () => {
    let lstatCalls = 0
    hooks.lstat.mockImplementation(async (...args: Parameters<FsPromises['lstat']>) => {
      const info = await actual.lstat(...args)
      // The first lstat is the pre-write check; the next one pins the re-read's identity
      lstatCalls += 1
      if (lstatCalls !== 2) return info
      // A clearly different id (`ino + 1` can round back to `ino` for a 64-bit NTFS id)
      return Object.assign(info, { ino: typeof info.ino === 'bigint' ? info.ino ^ 1n : info.ino === 7 ? 8 : 7 })
    })

    expect(await write()).toEqual({ ok: false, reason: 'changed' })

    expect(hooks.rename).not.toHaveBeenCalled()
    await expectOriginalOnly()
  })

  it('readFileNoFollow reports an open that fails for another reason as io, with its errno', async () => {
    hooks.open.mockRejectedValue(errno('EACCES'))

    expect(await readFileNoFollow(target, 1024)).toEqual({ ok: false, reason: 'io', errno: 'EACCES' })
  })

  it('readFileNoFollow reports a read that fails after the open as io, and closes the handle', async () => {
    let closed = false
    hooks.open.mockImplementation(async (...args: Parameters<FsPromises['open']>) => {
      const handle = await actual.open(...args)
      const close = handle.close.bind(handle)
      ;(handle as unknown as Record<string, unknown>).read = async () => {
        throw errno('EIO')
      }
      ;(handle as unknown as Record<string, unknown>).close = async () => {
        closed = true
        await close()
      }
      return handle
    })

    expect(await readFileNoFollow(target, 1024)).toEqual({ ok: false, reason: 'io', errno: 'EIO' })
    expect(closed).toBe(true)
  })

  it('readFileNoFollow: a file deleted between the open and the name check is gone', async () => {
    hooks.lstat.mockRejectedValue(errno('ENOENT'))

    expect(await readFileNoFollow(target, 1024)).toEqual({ ok: false, reason: 'gone', errno: 'ENOENT' })
  })

  it('readFileNoFollow: a handle that fails to close after a good read does not fail the read', async () => {
    hooks.open.mockImplementation(async (...args: Parameters<FsPromises['open']>) => {
      const handle = await actual.open(...args)
      const close = handle.close.bind(handle)
      ;(handle as unknown as Record<string, unknown>).close = async () => {
        await close()
        throw errno('EIO')
      }
      return handle
    })

    expect(await readFileNoFollow(target, 1024)).toEqual({ ok: true, bytes: ORIGINAL, id: targetId })
  })

  it('a pre-write lstat that fails for another reason is io', async () => {
    hooks.lstat.mockRejectedValue(errno('EACCES'))

    expect(await write()).toEqual({ ok: false, reason: 'io', errno: 'EACCES' })
    await expectOriginalOnly()
  })

  it.each(['EPERM', 'EACCES'])(
    'M-007 Windows rules: an open for writing refused with %s (a deny-write ACL) is read-only, and no temp file is made',
    async code => {
      hooks.open.mockImplementation(async (...args: Parameters<FsPromises['open']>) => {
        if (args[0] === target && args[1] === 'r+') throw errno(code)
        return actual.open(...args)
      })

      expect(await write({ platform: 'win32' })).toEqual({ ok: false, reason: 'read-only', errno: code })

      await expectOriginalOnly()
      expect(hooks.open.mock.calls.some(([path]) => String(path).includes(ATOMIC_TEMP_PREFIX))).toBe(false)
    }
  )

  it('Windows rules: a sharing violation on the write probe is left to the rename and its retries', async () => {
    hooks.open.mockImplementation(async (...args: Parameters<FsPromises['open']>) => {
      if (args[0] === target && args[1] === 'r+') throw errno('EBUSY')
      return actual.open(...args)
    })

    expect(await write({ platform: 'win32' })).toEqual({ ok: true, path: target })
    expect((await readFile(target)).equals(NEW)).toBe(true)
  })

  it('the write probe is Windows-only: no open for writing on other platforms', async () => {
    expect(await write({ platform: 'linux' })).toEqual({ ok: true, path: target })

    expect(hooks.open.mock.calls.some(([, flags]) => flags === 'r+')).toBe(false)
  })

  it('Windows rules: the Zone.Identifier mark is copied onto the temp file before the rename', async () => {
    redirectZoneStreams()
    await writeFile(`${target}.zone`, MARK)

    expect(await write({ platform: 'win32' })).toEqual({ ok: true, path: target })

    expect(await tempMark()).toBe(MARK)
    expect((await readFile(target)).equals(NEW)).toBe(true)
  })

  it.each([
    ['no mark', {}, undefined],
    ['a mark too big to be one', {}, 'x'.repeat(5 * 1024)],
    ['a mark that cannot be read', { read: true }, MARK],
    ['a mark that cannot be written', { create: true }, MARK]
  ] as const)('Windows rules: %s – nothing is copied and the write goes through', async (_name, fail, mark) => {
    redirectZoneStreams(fail)
    if (mark !== undefined) await writeFile(`${target}.zone`, mark)

    expect(await write({ platform: 'win32' })).toEqual({ ok: true, path: target })

    expect(await tempMark()).toBeUndefined()
    expect((await readFile(target)).equals(NEW)).toBe(true)
  })

  it('error results carry an errno code only – never the message, which quotes the path', async () => {
    hooks.rename.mockRejectedValue(errno('EXDEV'))

    const result = await write()

    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
