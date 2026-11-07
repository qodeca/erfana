// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { logger } = vi.hoisted(() => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../LoggingService', () => ({ logger }))

import { createManualClock } from '../../../../shared/clock'
import { CAPTURES_REL, CaptureExpiry, CaptureStore, CaptureWriteError, EXPIRY_PERIOD_MS } from './CaptureStore'

const NAME = '20261102-210509Z-a1b2c3d4'
const files = [
  { name: `${NAME}.md`, data: '# capture' },
  { name: `${NAME}.png`, data: new Uint8Array([1, 2, 3]) },
  { name: `${NAME}-crop.png`, data: new Uint8Array([4]) }
]
const DAY = 24 * 60 * 60 * 1000
const IS_WINDOWS = process.platform === 'win32'

describe('CaptureStore', () => {
  let root: string
  let captures: string

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'erfana-captures-')))
    captures = path.join(root, ...CAPTURES_REL.split('/'))
  })

  afterEach(async () => {
    await chmod(captures, 0o700).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  })

  it('writes every file of a capture under .erfana/browser/captures and answers their project-relative paths', async () => {
    const store = new CaptureStore()
    expect(await store.write(root, files)).toEqual(files.map((f) => `${CAPTURES_REL}/${f.name}`))
    expect((await readdir(captures)).sort()).toEqual(files.map((f) => f.name).sort())
    expect(await readFile(path.join(captures, `${NAME}.md`), 'utf8')).toBe('# capture')
    if (!IS_WINDOWS) expect((await lstat(path.join(captures, `${NAME}.png`))).mode & 0o777).toBe(0o600)
  })

  it('never overwrites: a file of the same name fails the write and removes only what this write created', async () => {
    const store = new CaptureStore()
    await mkdir(captures, { recursive: true })
    await store.write(root, files.slice(0, 1))
    await expect(store.write(root, [{ name: `${NAME}-crop.png`, data: 'a' }, files[0]])).rejects.toBeInstanceOf(CaptureWriteError)
    // The earlier file stays; the crop this write created is gone.
    expect(await readdir(captures)).toEqual([`${NAME}.md`])
  })

  it('refuses a name that is not a capture file name, leaving nothing behind', async () => {
    const store = new CaptureStore()
    await expect(store.write(root, [files[0], { name: '../escape.md', data: 'x' }])).rejects.toBeInstanceOf(CaptureWriteError)
    expect(await readdir(captures)).toEqual([])
  })

  it('names the reason for a forced failure and removes the partial files (025-AC-060)', async () => {
    let count = 0
    const store = new CaptureStore(() => () => (++count === 2 ? Object.assign(new Error('no space'), { code: 'ENOSPC' }) : null))
    await expect(store.write(root, files)).rejects.toThrow('The disk is full')
    expect(await readdir(captures)).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('Browser capture write failed', { reason: 'ENOSPC' })
  })

  it.skipIf(IS_WINDOWS || process.getuid?.() === 0)('names a read-only captures folder (025-AC-060)', async () => {
    const store = new CaptureStore()
    await store.write(root, files.slice(0, 1))
    await chmod(captures, 0o500)
    await expect(store.write(root, [{ name: '20261102-210510Z-a1b2c3d4.md', data: 'x' }])).rejects.toThrow(`${CAPTURES_REL} is read-only`)
  })

  it.skipIf(IS_WINDOWS)('refuses a planted link in place of the captures folder (025-AC-069)', async () => {
    const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'erfana-captures-out-')))
    try {
      await mkdir(path.dirname(captures), { recursive: true })
      await symlink(outside, captures)
      await expect(new CaptureStore().write(root, files)).rejects.toBeInstanceOf(CaptureWriteError)
      expect(await readdir(outside)).toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('removes named capture files, ignoring other names and missing files; never rejects', async () => {
    const store = new CaptureStore()
    await store.write(root, files)
    await writeFile(path.join(captures, 'notes.txt'), 'keep')
    await store.remove(root, [`${NAME}.md`, `${NAME}.png`, 'notes.txt', '20200101-000000Z-00000000.md'])
    expect((await readdir(captures)).sort()).toEqual([`${NAME}-crop.png`, 'notes.txt'])
    await expect(store.remove(path.join(root, 'missing'), [`${NAME}.md`])).resolves.toBeUndefined()
  })

  describe('expire (025-FR-039)', () => {
    const now = new Date(Date.UTC(2026, 10, 10, 12, 0, 0))

    it.skipIf(IS_WINDOWS)('deletes captures older than 7 days only; not 6-day-old ones, other names, folders or links', async () => {
      await mkdir(captures, { recursive: true })
      const old = '20261102-110000Z-0000aaaa.md'
      const young = '20261104-120000Z-0000bbbb.png'
      await writeFile(path.join(captures, old), 'old')
      await writeFile(path.join(captures, young), 'young')
      await writeFile(path.join(captures, 'notes.txt'), 'other')
      await mkdir(path.join(captures, '20200101-000000Z-0000cccc.png'))
      await writeFile(path.join(root, 'target.png'), 'outside')
      await symlink(path.join(root, 'target.png'), path.join(captures, '20200101-000000Z-0000dddd.png'))
      expect(await new CaptureStore().expire(root, now)).toEqual([old])
      expect((await readdir(captures)).sort()).toEqual(['20200101-000000Z-0000cccc.png', '20200101-000000Z-0000dddd.png', young, 'notes.txt'].sort())
      expect(await readFile(path.join(root, 'target.png'), 'utf8')).toBe('outside')
    })

    it('answers nothing when there is no captures folder, and logs an unreadable project', async () => {
      expect(await new CaptureStore().expire(root, now)).toEqual([])
      expect(await new CaptureStore().expire(path.join(root, 'missing'), now)).toEqual([])
      expect(logger.warn).toHaveBeenCalledWith('Browser capture expiry could not read the captures folder', expect.any(Object))
    })
  })
})

describe('CaptureExpiry', () => {
  function session(initial: string | null) {
    let listener: ((prev: unknown, next: { realRoot: string } | null) => void) | null = null
    let current = initial === null ? null : { realRoot: initial }
    return {
      onChange: vi.fn((l: typeof listener) => {
        listener = l
        return () => {
          listener = null
        }
      }),
      current: () => current,
      change(next: string | null) {
        const prev = current
        current = next === null ? null : { realRoot: next }
        listener?.(prev, current)
      },
      get listening() {
        return listener !== null
      }
    }
  }

  it('sweeps the open project at once and every 24 hours, follows a project change, stops on close and on dispose', async () => {
    const clock = createManualClock(Date.UTC(2026, 10, 10))
    const expire = vi.fn(async () => [])
    const expiry = new CaptureExpiry({ expire }, clock)
    const s = session('/p/a')
    expiry.attach(s as never)
    await expiry.whenIdle()
    expect(expire).toHaveBeenCalledWith('/p/a', new Date(Date.UTC(2026, 10, 10)))
    clock.advance(EXPIRY_PERIOD_MS)
    await expiry.whenIdle()
    expect(expire).toHaveBeenCalledTimes(2)
    s.change('/p/b')
    await expiry.whenIdle()
    expect(expire).toHaveBeenLastCalledWith('/p/b', expect.any(Date))
    s.change(null)
    clock.advance(2 * DAY)
    await expiry.whenIdle()
    expect(expire).toHaveBeenCalledTimes(3)
    s.change('/p/c')
    expiry.dispose()
    expect(s.listening).toBe(false)
    clock.advance(2 * DAY)
    await expiry.whenIdle()
    expect(expire).toHaveBeenCalledTimes(4)
  })

  it('runs sweeps one after another, and a failed sweep does not stop the next', async () => {
    const clock = createManualClock()
    const expire = vi.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue([])
    const expiry = new CaptureExpiry({ expire }, clock)
    await expect(expiry.sweep('/p')).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('Browser capture expiry sweep failed', { error: 'other' })
    await expect(expiry.sweep('/p')).resolves.toBeUndefined()
    expect(expire).toHaveBeenCalledTimes(2)
  })
})
