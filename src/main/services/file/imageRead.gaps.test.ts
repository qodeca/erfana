// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * #478 L4 (plan step S0, converted in S3 – the T1 proof): a copy that rewrites
 * the file in place with the same size and keeps the original modified time
 * (Explorer copy, `Copy-Item`, robocopy) used to answer "unchanged", so the
 * image tab kept the old picture. The version now carries the change time,
 * which every write moves, so the copy reads as a new version.
 *
 * Real temp files, as in `imageRead.test.ts`: the module's subject is how it
 * reads `stat`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { waitForFsClockPast } from '../freshness/__test__/fsClock'
import { readImage } from './imageRead'

/** Same length, different bytes. */
const FIRST = Buffer.from('first-revision!')
const COPIED = Buffer.from('copied-revision')
/** A whole-second time, so writing it back reproduces the stamp to the nanosecond. */
const KEPT_MTIME_S = 1_700_000_000

describe('#478 L4: readImage sees a same-size, mtime-keeping copy', () => {
  let dir: string
  let imagePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'erfana-imageread-gap-'))
    imagePath = join(dir, 'shot.png')
    writeFileSync(imagePath, FIRST)
    utimesSync(imagePath, KEPT_MTIME_S, KEPT_MTIME_S)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('L4: a same-size, mtime-keeping in-place copy reads as a new version', async () => {
    const first = await readImage(imagePath)
    const inode = statSync(imagePath).ino

    // A real copy lands well after the read; inside one file-system clock tick no stat could tell
    await waitForFsClockPast(imagePath, dir)
    // The copy: new bytes into the same file, then the source's time put back
    writeFileSync(imagePath, COPIED)
    utimesSync(imagePath, KEPT_MTIME_S, KEPT_MTIME_S)
    // Setup check: the bytes changed and nothing else did
    expect(statSync(imagePath).ino).toBe(inode)
    expect(statSync(imagePath).size).toBe(FIRST.length)

    const again = await readImage(imagePath, first.version)

    expect(again.status, 'L4: the copied bytes are read').toBe('ok')
    expect(again.version).not.toBe(first.version)
    if (again.status === 'ok') expect(again.dataUrl).toContain(COPIED.toString('base64'))
  })
})
