// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'

import { createFakeClock } from './__test__/fakeClock'
import { FakeDisk } from './__test__/fakeDisk'
import type { ReadOutcome } from './freshnessTypes'
import { settleRead } from './settleRead'
import { TIMING_PROFILES } from './timingProfiles'

const FILE = '/p/a.md'
const SETTLE_MS = 75
/** The editor profile's gate cap: the longest a settle waits (QG-11a K1/V1). */
const CAP_MS = TIMING_PROFILES.editor.gateCapMs

function setup() {
  const clock = createFakeClock()
  const disk = new FakeDisk(clock)
  const reads: string[] = []
  const read = async (): Promise<ReadOutcome<string>> => {
    const reply = await disk.readText(FILE)
    if (reply.status === 'ok') {
      reads.push(reply.text)
      return { status: 'ok', version: reply.text, stamp: reply.stamp }
    }
    if (reply.status === 'missing' || reply.status === 'busy') return { status: reply.status }
    return { status: 'failed' }
  }
  const run = (isCancelled?: () => boolean) =>
    settleRead({ clock, settleMs: SETTLE_MS, capMs: CAP_MS, probe: () => disk.settleProbe(FILE), read, isCancelled })
  return { clock, disk, reads, run }
}

describe('settleRead', () => {
  it('reads once the file holds still for one settle window', async () => {
    const { clock, disk, run } = setup()
    disk.write(FILE, 'hello')
    let outcome: Awaited<ReturnType<typeof run>> | undefined
    void run().then((o) => (outcome = o))

    await clock.run(SETTLE_MS - 5)
    expect(outcome).toBeUndefined()
    await clock.run(10)
    expect(outcome).toMatchObject({ status: 'ok', version: 'hello' })
  })

  it('P3: never reads while the size moves', async () => {
    const { clock, disk, reads, run } = setup()
    disk.write(FILE, 'header|')
    let done = false
    void run().then(() => (done = true))

    // A writer appending every 20 ms for 1 s
    for (let i = 0; i < 50; i++) {
      await clock.run(20)
      disk.append(FILE, 'x', { silent: true })
    }
    expect(reads).toEqual([])
    expect(done).toBe(false)

    disk.append(FILE, '|footer', { silent: true })
    await clock.run(SETTLE_MS * 3)
    expect(done).toBe(true)
    expect(reads).toHaveLength(1)
    expect(reads[0]).toMatch(/^header\|x{50}\|footer$/)
  })

  it('P3: a stream that stops inside the cap (3 s) reads once, complete', async () => {
    const { clock, disk, reads, run } = setup()
    disk.write(FILE, 'HEAD')
    let outcome: Awaited<ReturnType<typeof run>> | undefined
    void run().then((o) => (outcome = o))
    for (let t = 0; t < 3_000; t += 50) {
      await clock.run(50, 10)
      disk.append(FILE, '.', { silent: true })
    }
    disk.append(FILE, 'FOOT', { silent: true })
    await clock.run(SETTLE_MS * 3)
    expect(reads).toHaveLength(1)
    expect(reads[0]).toMatch(/^HEAD\.+FOOT$/)
    expect(outcome).toMatchObject({ status: 'ok' })
  })

  it('K1/V1: a file that never holds still (append every 20 ms) answers failed at the cap, never read', async () => {
    const { clock, disk, reads, run } = setup()
    disk.write(FILE, 'HEAD')
    const start = clock.now()
    let outcome: Awaited<ReturnType<typeof run>> | undefined
    let doneAt: number | undefined
    void run().then((o) => {
      outcome = o
      doneAt = clock.now()
    })
    for (let t = 0; t < CAP_MS + 1_000; t += 20) {
      await clock.run(20)
      disk.append(FILE, '.', { silent: true })
    }
    expect(reads).toEqual([])
    expect(outcome).toEqual({ status: 'failed' })
    expect((doneAt as number) - start).toBeGreaterThanOrEqual(CAP_MS)
    expect((doneAt as number) - start).toBeLessThanOrEqual(CAP_MS + SETTLE_MS)
  })

  it('K1: a probe that cannot tell and a read that is always busy (a dead share) answer failed at the cap', async () => {
    const clock = createFakeClock()
    const start = clock.now()
    let readCalls = 0
    let outcome: Awaited<ReturnType<typeof settleRead<string>>> | undefined
    let doneAt: number | undefined
    void settleRead<string>({
      clock,
      settleMs: SETTLE_MS,
      capMs: CAP_MS,
      probe: async () => ({ status: 'unknown' }),
      read: async () => {
        readCalls += 1
        return { status: 'busy' }
      },
    }).then((o) => {
      outcome = o
      doneAt = clock.now()
    })

    await clock.run(CAP_MS - SETTLE_MS)
    expect(outcome).toBeUndefined()
    await clock.run(SETTLE_MS * 2)
    expect(outcome).toEqual({ status: 'failed' })
    expect((doneAt as number) - start).toBeLessThanOrEqual(CAP_MS + SETTLE_MS)
    expect(readCalls).toBeGreaterThan(0)
    // Nothing runs after the answer: the loop has ended
    const calls = readCalls
    await clock.run(1_000)
    expect(readCalls).toBe(calls)
  })

  it('a busy read goes back to settling and reads again, without counting as a failure', async () => {
    const { clock, disk, run } = setup()
    disk.write(FILE, 'v1')
    disk.busyNextReads(FILE, 2)
    let outcome: Awaited<ReturnType<typeof run>> | undefined
    void run().then((o) => (outcome = o))
    await clock.run(SETTLE_MS * 4)
    expect(outcome).toMatchObject({ status: 'ok', version: 'v1' })
    expect(disk.reads.get(FILE)).toBe(3)
  })

  it('P3: a writer that starts between the last probe and the read is not shown – the settle goes on', async () => {
    const clock = createFakeClock()
    const disk = new FakeDisk(clock)
    disk.write(FILE, 'v1 END')
    const reads: string[] = []
    let probes = 0
    let outcome: Awaited<ReturnType<typeof settleRead<string>>> | undefined
    void settleRead<string>({
      clock,
      settleMs: SETTLE_MS,
      capMs: CAP_MS,
      probe: async () => {
        const snapshot = await disk.settleProbe(FILE)
        // The second probe agrees with the first; right after it a new writer
        // truncates the file and writes its first chunk, before the read opens it
        if (++probes === 2) disk.write(FILE, 'v2 head', { silent: true })
        return snapshot
      },
      read: async () => {
        const reply = await disk.readText(FILE)
        if (reply.status !== 'ok') return { status: 'failed' }
        reads.push(reply.text)
        return { status: 'ok', version: reply.text, stamp: reply.stamp }
      },
    }).then((o) => (outcome = o))

    await clock.run(SETTLE_MS + 5)
    // The writer is still writing: its next chunk lands inside the next settle window
    disk.append(FILE, ' body', { silent: true })
    await clock.run(SETTLE_MS - 20)
    disk.append(FILE, ' END', { silent: true })
    await clock.run(SETTLE_MS * 4)

    expect(outcome).toMatchObject({ status: 'ok', version: 'v2 head body END' })
    expect(reads[reads.length - 1]).toBe('v2 head body END')
  })

  it('answers missing at once when the file is gone', async () => {
    const { clock, run } = setup()
    let outcome: Awaited<ReturnType<typeof run>> | undefined
    void run().then((o) => (outcome = o))
    await clock.flush()
    expect(outcome).toEqual({ status: 'missing' })
  })

  it('answers missing when the file goes during the settle', async () => {
    const { clock, disk, run } = setup()
    disk.write(FILE, 'v1')
    let outcome: Awaited<ReturnType<typeof run>> | undefined
    void run().then((o) => (outcome = o))
    await clock.run(10)
    disk.remove(FILE, { silent: true })
    await clock.run(SETTLE_MS)
    expect(outcome).toEqual({ status: 'missing' })
  })

  it('stops with null when cancelled, without reading', async () => {
    const { clock, disk, reads, run } = setup()
    disk.write(FILE, 'v1')
    let cancelled = false
    let outcome: Awaited<ReturnType<typeof run>> | undefined = undefined
    void run(() => cancelled).then((o) => (outcome = o))
    cancelled = true
    await clock.run(SETTLE_MS * 2)
    expect(outcome).toBeNull()
    expect(reads).toEqual([])
  })
})
