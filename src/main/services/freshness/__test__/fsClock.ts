// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Test helper: wait until the file system's clock has moved past a file's
 * change time.
 *
 * File times are coarse (NTFS takes them from a clock that ticks every
 * 1–16 ms), so two writes inside one tick get the same ctime – a stat cannot
 * tell them apart, and neither can anything keyed on it. A real copy lands far
 * later than the read it follows; a test that writes twice in a row must wait
 * for the tick, or it tests the clock. This waits on the condition itself –
 * a scratch file's ctime passing the reference – not on a fixed delay.
 */
import { rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'

/** Give up after this many tries: a clock that never moves is a broken host, not a slow one. */
const MAX_TRIES = 100_000

/** Resolve once a file written now in `dir` gets a ctime later than `file`'s. */
export async function waitForFsClockPast(file: string, dir: string): Promise<void> {
  const reference = statSync(file, { bigint: true }).ctimeNs
  const scratch = join(dir, '.fs-clock-probe')
  try {
    for (let i = 0; i < MAX_TRIES; i++) {
      writeFileSync(scratch, String(i))
      if (statSync(scratch, { bigint: true }).ctimeNs > reference) return
      await nextTurn()
    }
    throw new Error('the file-system clock did not move')
  } finally {
    rmSync(scratch, { force: true })
  }
}
