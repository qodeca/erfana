// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The signed list file itself (ADR 0009 decision 6): the generation is taken
 * only when something is signed, a write that cannot take one or cannot be
 * signed leaves no file, failures are logged and never reject, and the
 * serial writer keeps going after one.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('../../LoggingService', () => ({ logger }))

import type { ProfileGenerations } from '../profileGenerations'
import { profileErfanaSegments, readSignedList, SerialWriter, writeSignedList, type SignedListFile } from './signedProfileFile'
import { tempProject, testSigner } from './__test-helpers__/siteFakes'

const PURPOSE = 'browser-test-list'
const SEGMENTS = profileErfanaSegments('list.json')

let root: string
let path: string
let generation: number | undefined
let epoch: string
let generations: ProfileGenerations & { next: ReturnType<typeof vi.fn> }

function listFile(overrides: Partial<SignedListFile<string>> = {}): SignedListFile<string> {
  return {
    canonical: root,
    segments: SEGMENTS,
    purpose: PURPOSE,
    signer: testSigner('k'),
    generations,
    entry: z.string(),
    maxEntries: 10,
    maxBytes: 4096,
    label: 'Browser test list',
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  root = tempProject('erfana-signed-')
  path = join(root, ...SEGMENTS)
  generation = undefined
  epoch = 'a'.repeat(32)
  generations = {
    current: async () => generation,
    epoch: async () => (generation === undefined ? undefined : epoch),
    next: vi.fn(async () => {
      generation = (generation ?? 0) + 1
      return generation
    })
  }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('signed list file', () => {
  it('reads back what it wrote, at the current generation only', async () => {
    await writeSignedList(listFile(), ['a', 'b'])
    expect(await readSignedList(listFile())).toEqual(['a', 'b'])
    generation = 2
    expect(await readSignedList(listFile())).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('Browser test list: file is not the latest one written (replayed), ignored')
  })

  it('refuses a file signed under an earlier epoch, at the same generation (the home record re-created, S3)', async () => {
    await writeSignedList(listFile(), ['a'])
    expect(await readSignedList(listFile())).toEqual(['a'])
    epoch = 'b'.repeat(32)
    expect(await readSignedList(listFile())).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('Browser test list: file not signed by this account, ignored', expect.any(Object))
  })

  it('writes nothing when the home record goes between taking the generation and reading the epoch', async () => {
    generations.next.mockImplementationOnce(async () => 1)
    await writeSignedList(listFile(), ['a'])
    expect(existsSync(path)).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith('Browser test list: file not written, kept in memory', expect.any(Object))
  })

  it('takes no generation and writes nothing without a signing key', async () => {
    await writeSignedList(listFile({ signer: testSigner(null) }), ['a'])
    expect(generations.next).not.toHaveBeenCalled()
    expect(existsSync(path)).toBe(false)
  })

  it('writes nothing when the signer yields no signature', async () => {
    await writeSignedList(listFile({ signer: { ...testSigner('k'), sign: () => undefined } }), ['a'])
    expect(existsSync(path)).toBe(false)
  })

  it('logs and keeps going when the generation cannot be taken, whatever was thrown', async () => {
    generations.next.mockRejectedValueOnce('home record locked')
    await expect(writeSignedList(listFile(), ['a'])).resolves.toBeUndefined()
    expect(existsSync(path)).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith('Browser test list: file not written, kept in memory', { error: 'home record locked' })
  })

  it('removes its temp file and logs when the rename fails', async () => {
    mkdirSync(join(path, 'occupied'), { recursive: true })
    await writeSignedList(listFile(), ['a'])
    expect(readdirSync(dirname(path)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('Browser test list: file not written, kept in memory', expect.any(Object))
  })

  it('starts empty when the name is not a file', async () => {
    mkdirSync(path)
    expect(await readSignedList(listFile())).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('Browser test list: file unreadable, starting empty', expect.any(Object))
  })

  it('ignores a file without a generation', async () => {
    writeFileSync(path, JSON.stringify({ version: 2, entries: ['a'], hmac: 'a'.repeat(64) }))
    expect(await readSignedList(listFile())).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith('Browser test list: file malformed, ignored')
  })

  it('the serial writer runs the next save after a failed one', async () => {
    const writer = new SerialWriter()
    const order: string[] = []
    void writer.persist(() => Promise.reject(new Error('first')))
    await writer.persist(async () => {
      order.push('second')
    })
    expect(order).toEqual(['second'])
  })
})
