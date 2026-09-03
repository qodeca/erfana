// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The post-write re-read of the allowlist must not hold an approval hostage.
 *
 * `approveOrigin` re-reads the settings file it just wrote and re-validates it
 * before returning. That re-read is a plain `readFile`; on Windows the whole
 * approve path was seen to never settle (2026-09-03), and this await is one of
 * the two candidates. A re-read that does not come back in time now yields the
 * set that was just written — the grant is already on disk — and logs it.
 *
 * Split from `PreviewAllowlistStore.test.ts` because the `readFile` mock here
 * hoists to module scope (see docs/windows/contributing.md, test-file split
 * policy); the main suite reads the file back for real.
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW } from '../../../shared/constants'

const readFileGate = vi.hoisted(() => ({ hang: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    // Only the read of a file that EXISTS hangs: the pre-write read of a
    // missing settings file must still fail fast with ENOENT, so the store
    // gets as far as writing before the post-write re-read stalls.
    readFile: vi.fn((...args: Parameters<typeof actual.readFile>) =>
      readFileGate.hang && existsSync(String(args[0]))
        ? new Promise<never>(() => {})
        : actual.readFile(...args)
    )
  }
})

vi.mock('../LoggingService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { createPreviewAllowlistStore } from './PreviewAllowlistStore'

let root = ''

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'erfana-allowlist-timeout-')))
  await mkdir(join(root, '.erfana'), { recursive: true })
  readFileGate.hang = false
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('PreviewAllowlistStore — the post-write re-read is time-boxed', () => {
  it(
    'returns the just-written set when the re-read never completes',
    async () => {
      // Real time, on purpose: the store awaits several fs promises before it
      // reaches the bounded re-read, so a fake clock advanced up front would
      // run before the timer exists. The bound is 2 s; the test budget is 10 s.
      const store = createPreviewAllowlistStore({ getProjectRoot: () => root, onBadge: vi.fn() })
      await store.load()

      readFileGate.hang = true
      const started = Date.now()
      const origins = await store.approveOrigin('https://cdn.example.com')

      expect(origins).toEqual(['https://cdn.example.com'])
      expect([...store.getOrigins()]).toEqual(['https://cdn.example.com'])
      expect(Date.now() - started).toBeGreaterThanOrEqual(PREVIEW.ALLOWLIST_VERIFY_TIMEOUT_MS - 50)
    },
    10_000
  )
})
