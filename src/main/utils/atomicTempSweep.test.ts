// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, utimes, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../services/LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { sweepStaleAtomicTemps, STALE_TEMP_AGE_MS } from './atomicTempSweep'
import { ATOMIC_TEMP_PREFIX } from './atomicWrite'

const OLD_SECONDS = (Date.now() - 2 * STALE_TEMP_AGE_MS) / 1000

describe('sweepStaleAtomicTemps', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'erfana-sweep-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function makeTemp(path: string, old: boolean): Promise<void> {
    await writeFile(path, 'x')
    if (old) await utimes(path, OLD_SECONDS, OLD_SECONDS)
  }

  it('removes stale temp files at any depth, keeping fresh ones and documents', async () => {
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await makeTemp(join(root, `${ATOMIC_TEMP_PREFIX}old`), true)
    await makeTemp(join(root, 'a', 'b', `${ATOMIC_TEMP_PREFIX}old2`), true)
    await makeTemp(join(root, 'a', `${ATOMIC_TEMP_PREFIX}fresh`), false)
    await makeTemp(join(root, 'a', 'doc.md'), true)

    const removed = await sweepStaleAtomicTemps(root)

    expect(removed).toBe(2)
    expect((await readdir(join(root, 'a'))).sort()).toEqual([`${ATOMIC_TEMP_PREFIX}fresh`, 'b', 'doc.md'])
    expect(await readdir(join(root, 'a', 'b'))).toEqual([])
  })

  it('does not enter node_modules or .git', async () => {
    await mkdir(join(root, 'node_modules'))
    await mkdir(join(root, '.git'))
    await makeTemp(join(root, 'node_modules', `${ATOMIC_TEMP_PREFIX}old`), true)
    await makeTemp(join(root, '.git', `${ATOMIC_TEMP_PREFIX}old`), true)

    expect(await sweepStaleAtomicTemps(root)).toBe(0)
    expect(await readdir(join(root, 'node_modules'))).toHaveLength(1)
    expect(await readdir(join(root, '.git'))).toHaveLength(1)
  })

  it('never throws for a project folder that is gone', async () => {
    expect(await sweepStaleAtomicTemps(join(root, 'missing'))).toBe(0)
  })
})
