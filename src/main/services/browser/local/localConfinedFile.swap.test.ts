// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `openConfinedFile`'s second regular-file check, on the open handle: a name
 * that passed the check before the open (step 2) but names something else by
 * the time it is opened is still refused (step 4). The pre-open `stat` is
 * mocked to always say "a regular file", so this file is split from
 * `localConfinedFile.test.ts` (the mock hoists to module scope).
 */
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, stat: vi.fn(async () => ({ isFile: () => true })) }
})

import { openConfinedFile } from './localConfinedFile'

let base: string

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'erfana-local-swap-')))
  await mkdir(join(base, 'swapped'))
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('openConfinedFile – the open handle is checked again', () => {
  it('refuses a folder that passed the pre-open check', async () => {
    expect(await openConfinedFile(base, ['swapped'], () => false)).toEqual({ ok: false, status: 404 })
  })
})
