// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The stamp cost of a freshness check stays inside S1's bound (#478: "the
 * check finishes within 200 ms per tab"). A check probes the file once; the
 * worst probe is a fresh one (no cached hash) of the largest file that is
 * still hashed, `FRESHNESS_LIMITS.hashMaxBytes` (16 MiB). A real file on the
 * real disk, because the read is the cost. A timing budget, so it runs in the
 * `main-perf` project, one file at a time.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { FRESHNESS_LIMITS } from '../../../shared/freshness/timingProfiles'
import { FileStamper } from './fileStamp'
import { probeFile } from './probeFile'

/** S1: one tab's check, end to end. */
const CHECK_BUDGET_MS = 200
/** A small file that warms the hash and read paths before the timed probe. */
const WARM_UP_BYTES = 64 * 1024

let dir: string
let largest: string
let warmUp: string

/** Bytes that differ along the file, so nothing upstream can short-cut a run of zeros. */
function patterned(size: number): Buffer {
  const bytes = Buffer.alloc(size)
  for (let i = 0; i < size; i += 4) bytes.writeUInt32LE(i, i)
  return bytes
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'erfana-stamp-perf-'))
  largest = join(dir, 'largest.bin')
  warmUp = join(dir, 'warm-up.bin')
  writeFileSync(largest, patterned(FRESHNESS_LIMITS.hashMaxBytes))
  writeFileSync(warmUp, patterned(WARM_UP_BYTES))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('S1 check cost: a fresh probe of the largest hashed file', () => {
  it(`hashes a ${FRESHNESS_LIMITS.hashMaxBytes / (1024 * 1024)} MiB file in under ${CHECK_BUDGET_MS} ms`, async () => {
    await probeFile(warmUp, undefined, new FileStamper())
    // A new stamper: an empty hash cache, so the probe reads and hashes every byte
    const stamper = new FileStamper()

    const started = performance.now()
    const reply = await probeFile(largest, undefined, stamper)
    const elapsed = performance.now() - started

    expect(reply.status).toBe('changed')
    expect(reply.status === 'changed' ? reply.stamp.hash : undefined).toMatch(/^[0-9a-f]{64}$/)
    // About 125 ms on the Windows dev host: 256 reads of 64 KiB from the page cache plus SHA-256
    expect(elapsed).toBeLessThan(CHECK_BUDGET_MS)
  })
})
