// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * readStatStampOutcome (#478, P1): the HTML preview's read is one `stat` – no
 * bytes read, no hash – and still tells every real write from the last version.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileStamp } from '../../../shared/freshness/freshnessTypes'
import { isSameContent } from '../../../shared/freshness/stamp'
import { waitForFsClockPast } from './__test__/fsClock'
import { readStatStampOutcome, type BigIntStatFn } from './statStamp'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'erfana-statstamp-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function stampOf(path: string): Promise<FileStamp> {
  const outcome = await readStatStampOutcome(path)
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.status}`)
  return outcome.stamp
}

describe('readStatStampOutcome', () => {
  it('stamps a file by stat alone: no hash, the version is the stamp', async () => {
    const file = join(dir, 'page.html')
    writeFileSync(file, '<p>v1</p>')
    const outcome = await readStatStampOutcome(file)
    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(outcome.stamp.hash).toBeUndefined()
    expect(outcome.stamp.size).toBe(9)
    expect(outcome.version).toBe(outcome.stamp)
  })

  it('tells a same-size rewrite from the last version (no missed change), and an untouched file is the same', async () => {
    const file = join(dir, 'page.html')
    writeFileSync(file, '<p>v1</p>')
    const first = await stampOf(file)
    expect(isSameContent(await stampOf(file), first)).toBe(true)

    await waitForFsClockPast(file, dir)
    writeFileSync(file, '<p>v2</p>')
    expect(isSameContent(await stampOf(file), first)).toBe(false)
  })

  it('answers missing for a file that is gone, failed for a folder or another stat error', async () => {
    expect(await readStatStampOutcome(join(dir, 'gone.html'))).toEqual({ status: 'missing' })

    const folder = join(dir, 'folder')
    mkdirSync(folder)
    expect(await readStatStampOutcome(folder)).toEqual({ status: 'failed' })

    const denied: BigIntStatFn = vi.fn(async () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    })
    expect(await readStatStampOutcome(join(dir, 'x.html'), denied)).toEqual({ status: 'failed' })
  })

  it('reads no bytes: one stat call per read', async () => {
    const file = join(dir, 'page.html')
    writeFileSync(file, '<p>v1</p>')
    const { stat } = await import('node:fs/promises')
    const spy: BigIntStatFn = vi.fn((path: string, options: { bigint: true }) => stat(path, options))
    await readStatStampOutcome(file, spy)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
