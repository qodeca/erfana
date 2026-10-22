// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `readDocumentImage` (#71): one handle, `fstat` on it, regular files only, and
 * a cap that holds for the bytes actually read. The file handle is faked so a
 * file that grows after the check can be shown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { constants } from 'fs'

interface FakeFile {
  isFile: boolean
  statSize: number
  content: Buffer
}

const state = vi.hoisted(() => ({
  file: null as unknown as FakeFile,
  flags: [] as number[],
  closed: 0
}))

vi.mock('fs/promises', () => ({
  open: vi.fn(async (_path: string, flags: number) => {
    state.flags.push(flags)
    const file = state.file
    return {
      stat: async () => ({
        isFile: () => file.isFile,
        size: BigInt(file.statSize),
        mtimeNs: 1n,
        ino: 2n
      }),
      read: async (buffer: Buffer, offset: number, length: number, position: number) => {
        const bytesRead = file.content.copy(buffer, offset, position, Math.min(position + length, file.content.length))
        return { bytesRead, buffer }
      },
      close: async () => {
        state.closed += 1
      }
    }
  })
}))

import { readDocumentImage, documentImageOpenFlags, NotARegularFileError } from './readDocumentImage'
import { ImageTooLargeError } from './imageRead'

beforeEach(() => {
  state.flags = []
  state.closed = 0
})

describe('readDocumentImage', () => {
  it('returns the bytes as an image data URL with a version minted from fstat', async () => {
    state.file = { isFile: true, statSize: 3, content: Buffer.from('abc') }
    await expect(readDocumentImage('/p/a.png', undefined, 10)).resolves.toEqual({
      status: 'ok',
      dataUrl: `data:image/png;base64,${Buffer.from('abc').toString('base64')}`,
      version: '3:1:2'
    })
    expect(state.closed).toBe(1)
  })

  it('answers unchanged for the version the caller holds, without reading', async () => {
    state.file = { isFile: true, statSize: 3, content: Buffer.from('abc') }
    await expect(readDocumentImage('/p/a.png', '3:1:2', 10)).resolves.toEqual({ status: 'unchanged', version: '3:1:2' })
  })

  it('refuses anything that is not a regular file, and closes the handle', async () => {
    state.file = { isFile: false, statSize: 0, content: Buffer.alloc(0) }
    await expect(readDocumentImage('/p/pipe.png', undefined, 10)).rejects.toBeInstanceOf(NotARegularFileError)
    expect(state.closed).toBe(1)
  })

  it('refuses a file over the cap by its fstat size', async () => {
    state.file = { isFile: true, statSize: 11, content: Buffer.alloc(11) }
    await expect(readDocumentImage('/p/a.png', undefined, 10)).rejects.toBeInstanceOf(ImageTooLargeError)
  })

  it('refuses a file that grew past the cap after the check, reading at most cap + 1 bytes', async () => {
    state.file = { isFile: true, statSize: 4, content: Buffer.alloc(1_000_000, 1) }
    await expect(readDocumentImage('/p/a.png', undefined, 10)).rejects.toBeInstanceOf(ImageTooLargeError)
    expect(state.closed).toBe(1)
  })

  it('accepts a file that grew but stayed within the cap', async () => {
    state.file = { isFile: true, statSize: 2, content: Buffer.from('abcdef') }
    const result = await readDocumentImage('/p/a.png', undefined, 10)
    expect(result).toMatchObject({ status: 'ok', dataUrl: `data:image/png;base64,${Buffer.from('abcdef').toString('base64')}` })
  })

  it('opens non-blocking and without following a last-segment link on POSIX, read-only on Windows', () => {
    const posix = documentImageOpenFlags('darwin')
    expect(posix & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK)
    expect(posix & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW)
    expect(documentImageOpenFlags('win32')).toBe(constants.O_RDONLY)
  })
})
