// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Step 8g of `resolveConfined` compares 64-bit file IDs without losing bits.
 * A Windows file ID is 64-bit; as a Number, two IDs that differ only past 2^53
 * compare equal, so a file swapped between the open and the `lstat` could pass
 * the identity check. The opened handle and the name each report a large ID
 * here (`node:fs/promises` is mocked; module-scope mock, hence its own file).
 */
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A file ID past 2^53: `Number(HIGH_ID)` and `Number(HIGH_ID + 1n)` are equal. */
const HIGH_ID = 2n ** 60n

/** The IDs the opened handle and the name report, or `null` for the real ones. */
let fakeIds: { handle: bigint; name: bigint } | null = null

/** Overwrite `ino` with `id`, in the same type the caller asked for. */
function withIno<T extends { ino: number | bigint }>(stats: T, id: bigint): T {
  ;(stats as { ino: number | bigint }).ino = typeof stats.ino === 'bigint' ? id : Number(id)
  return stats
}

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    default: actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      const realStat = handle.stat.bind(handle) as (options?: unknown) => Promise<{ ino: bigint }>
      ;(handle as unknown as { stat: typeof realStat }).stat = async options => {
        const stats = await realStat(options)
        return fakeIds ? withIno(stats, fakeIds.handle) : stats
      }
      return handle
    },
    lstat: (async (path: string, options?: unknown) => {
      const stats = await (actual.lstat as (p: string, o?: unknown) => Promise<{ ino: bigint }>)(
        path,
        options
      )
      return fakeIds ? withIno(stats, fakeIds.name) : stats
    }) as typeof actual.lstat
  }
})

import { resolveConfined } from './previewPathResolve'

let realRoot: string

beforeEach(async () => {
  fakeIds = null
  realRoot = await realpath(await mkdtemp(join(tmpdir(), 'preview-fileid-')))
  await writeFile(join(realRoot, 'index.html'), '<h1>hi</h1>')
})

afterEach(async () => {
  await rm(realRoot, { recursive: true, force: true })
})

describe('resolveConfined – 64-bit file IDs (step 8g)', () => {
  it('refuses a name whose file ID differs from the opened file only past 2^53', async () => {
    expect(Number(HIGH_ID + 1n)).toBe(Number(HIGH_ID))
    fakeIds = { handle: HIGH_ID + 1n, name: HIGH_ID }
    expect(await resolveConfined(realRoot, ['index.html'])).toEqual({
      ok: false,
      status: 403,
      reason: 'path-escape'
    })
  })

  it('serves the file when both report the same 64-bit ID', async () => {
    fakeIds = { handle: HIGH_ID + 1n, name: HIGH_ID + 1n }
    const result = await resolveConfined(realRoot, ['index.html'])
    expect(result.ok && result.body.toString()).toBe('<h1>hi</h1>')
  })
})
