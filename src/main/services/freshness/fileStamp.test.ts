// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * `FileStamper` (#478 plan step S3): stamps against real temp files (the
 * subject is how it reads the disk), with the `open` wrapped to count opens
 * and reads, and faked only where a real file cannot show the case (a FIFO on
 * Windows, a file that moves mid-read).
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync, type BigIntStats } from 'node:fs'
import { constants } from 'node:fs'
import { open as realOpen, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isSameContent } from '../../../shared/freshness/stamp'
import { waitForFsClockPast } from './__test__/fsClock'
import { FileStamper, freshnessOpenFlags, sha256Hex, type OpenFn, type StampResult } from './fileStamp'

const KEPT_MTIME_S = 1_700_000_000

/** A real `open` that counts opens and `read` calls. */
function countingOpen(): { open: OpenFn; opens: () => number; reads: () => number } {
  let opens = 0
  let reads = 0
  const open: OpenFn = async (path, flags) => {
    opens += 1
    const handle = await realOpen(path, flags)
    const read = handle.read.bind(handle) as (...args: unknown[]) => Promise<unknown>
    ;(handle as unknown as { read: unknown }).read = (...args: unknown[]) => {
      reads += 1
      return read(...args)
    }
    return handle
  }
  return { open, opens: () => opens, reads: () => reads }
}

/** A fake handle whose `stat` answers come from `stats`, one per call (the last repeats). */
function fakeHandle(stats: Partial<BigIntStats>[], content = Buffer.alloc(0)): FileHandle {
  let call = 0
  return {
    stat: async () => {
      const s = stats[Math.min(call++, stats.length - 1)]
      return { isFile: () => true, size: 0n, mtimeNs: 0n, ctimeNs: 0n, ino: 1n, ...s } as BigIntStats
    },
    read: async (buffer: Buffer, offset: number, length: number, position: number) => {
      const bytesRead = content.copy(buffer, offset, position, Math.min(position + length, content.length))
      return { bytesRead, buffer }
    },
    close: async () => undefined,
  } as unknown as FileHandle
}

function okStamp(result: StampResult) {
  if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
  return result.stamp
}

describe('FileStamper', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'erfana-filestamp-'))
    file = join(dir, 'a.md')
    writeFileSync(file, 'first-revision!')
    utimesSync(file, KEPT_MTIME_S, KEPT_MTIME_S)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('stamps size, times, file id and the SHA-256 of the bytes', async () => {
    const stamp = okStamp(await new FileStamper().stamp(file))
    expect(stamp.size).toBe(15)
    expect(stamp.mtimeMs).toBe(KEPT_MTIME_S * 1000)
    expect(stamp.hash).toBe(sha256Hex('first-revision!'))
    expect(stamp.ino).toMatch(/^\d+$/)
  })

  it('L4: a same-size copy that keeps the mtime is different content', async () => {
    const stamper = new FileStamper()
    const before = okStamp(await stamper.stamp(file))

    await waitForFsClockPast(file, dir)
    writeFileSync(file, 'copied-revision')
    utimesSync(file, KEPT_MTIME_S, KEPT_MTIME_S)
    const after = okStamp(await stamper.stamp(file))

    expect(after.size).toBe(before.size)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(isSameContent(before, after)).toBe(false)
  })

  it('N3: a touch-only write (new mtime, same bytes) is the same content', async () => {
    const stamper = new FileStamper()
    const before = okStamp(await stamper.stamp(file))

    utimesSync(file, KEPT_MTIME_S + 60, KEPT_MTIME_S + 60)
    const after = okStamp(await stamper.stamp(file))

    expect(after.mtimeMs).not.toBe(before.mtimeMs)
    expect(isSameContent(before, after)).toBe(true)
  })

  it('a cache hit does not read the file again', async () => {
    const counter = countingOpen()
    const stamper = new FileStamper({ open: counter.open })

    await stamper.stamp(file)
    const readsAfterFirst = counter.reads()
    expect(readsAfterFirst).toBeGreaterThan(0)

    const again = okStamp(await stamper.stamp(file))
    expect(counter.reads()).toBe(readsAfterFirst)
    expect(counter.opens()).toBe(2)
    expect(again.hash).toBe(sha256Hex('first-revision!'))
  })

  it('two concurrent stamps of one path share one hash', async () => {
    const counter = countingOpen()
    const stamper = new FileStamper({ open: counter.open })

    const [a, b] = await Promise.all([stamper.stamp(file), stamper.stamp(file)])

    expect(counter.opens()).toBe(1)
    expect(a).toEqual(b)
  })

  it('evicts the least recently used hash past the cache size', async () => {
    const counter = countingOpen()
    const stamper = new FileStamper({ open: counter.open, cacheEntries: 2 })
    const files = ['x.md', 'y.md', 'z.md'].map((name) => {
      const path = join(dir, name)
      writeFileSync(path, name)
      return path
    })

    for (const path of files) await stamper.stamp(path)
    expect(stamper.cacheSize).toBe(2)

    // y and z are cached: no read. x was evicted: read again.
    const reads = counter.reads()
    await stamper.stamp(files[2])
    await stamper.stamp(files[1])
    expect(counter.reads()).toBe(reads)
    await stamper.stamp(files[0])
    expect(counter.reads()).toBeGreaterThan(reads)
  })

  it('stamps a file above the hash limit by stat only', async () => {
    const stamper = new FileStamper({ hashMaxBytes: 4 })
    const stamp = okStamp(await stamper.stamp(file))
    expect(stamp.hash).toBeUndefined()
    expect(stamp.size).toBe(15)
  })

  it('answers missing for a file that is not there', async () => {
    await expect(new FileStamper().stamp(join(dir, 'gone.md'))).resolves.toEqual({ status: 'missing' })
  })

  it('answers unsupported for a folder', async () => {
    await expect(new FileStamper().stamp(dir)).resolves.toMatchObject({ status: 'unsupported' })
  })

  it('answers unsupported for a FIFO or socket without reading (fstat says not a file)', async () => {
    let reads = 0
    const handle = fakeHandle([{ isFile: () => false }])
    ;(handle as unknown as { read: () => never }).read = () => {
      reads += 1
      throw new Error('a FIFO read would block')
    }
    const stamper = new FileStamper({ open: async () => handle })

    await expect(stamper.stamp('/p/fifo')).resolves.toEqual({ status: 'unsupported', code: 'ENOTFILE' })
    expect(reads).toBe(0)
  })

  it('answers unsupported when opening a socket fails with ENXIO', async () => {
    const stamper = new FileStamper({
      open: async () => {
        throw Object.assign(new Error('ENXIO'), { code: 'ENXIO' })
      },
    })
    await expect(stamper.stamp('/p/sock')).resolves.toEqual({ status: 'unsupported', code: 'ENXIO' })
  })

  it('answers unreadable for a locked or denied file', async () => {
    for (const code of ['EACCES', 'EPERM', 'EBUSY']) {
      const stamper = new FileStamper({
        open: async () => {
          throw Object.assign(new Error(code), { code })
        },
      })
      await expect(stamper.stamp('/p/a.md')).resolves.toEqual({ status: 'unreadable', code })
    }
  })

  it('answers busy when the file moves during the hash, and caches nothing', async () => {
    const content = Buffer.from('abc')
    const handle = fakeHandle([{ size: 3n, mtimeNs: 1n }, { size: 3n, mtimeNs: 2n }], content)
    const stamper = new FileStamper({ open: async () => handle })

    await expect(stamper.stamp('/p/a.md')).resolves.toEqual({ status: 'busy' })
    expect(stamper.cacheSize).toBe(0)
  })

  it('answers busy when more bytes than fstat counted are there (a writer appending)', async () => {
    const handle = fakeHandle([{ size: 2n }], Buffer.from('abcdef'))
    const stamper = new FileStamper({ open: async () => handle })
    await expect(stamper.stamp('/p/a.md')).resolves.toEqual({ status: 'busy' })
  })

  it('opens read-only on Windows', () => {
    expect(freshnessOpenFlags('win32')).toBe(constants.O_RDONLY)
  })

  // The POSIX flags are host constants: a Windows host's Node does not define O_NONBLOCK
  it.skipIf(process.platform === 'win32')('opens non-blocking on POSIX, so a FIFO cannot hold the open', () => {
    expect(freshnessOpenFlags('linux') & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK)
  })
})
