// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Generation counters of the signed profile files (spec 025, ADR 0009
 * decision 6): kept at home per canonical project path and kind, monotonic
 * under concurrent writes, fail closed on a missing or malformed record,
 * never logging a path.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('../LoggingService', () => ({ logger }))

import { homeMarkerPath } from './browserProfileMarker'
import { homeGenerationsPath, profileGenerations } from './profileGenerations'

const itPosix = process.platform === 'win32' ? it.skip : it
const PROJECT = '/projects/garden'
const TRUST = 'browser-certificate-trust'
const PERMISSIONS = 'browser-site-permissions'

let home: string
let record: string

beforeEach(() => {
  vi.clearAllMocks()
  home = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-gen-')))
  record = homeGenerationsPath(home, PROJECT)
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function loggedText(): string {
  return JSON.stringify(logger.warn.mock.calls)
}

describe('homeGenerationsPath', () => {
  it('sits next to the marker home copy, under the same hash', () => {
    const marker = homeMarkerPath(home, PROJECT)
    expect(dirname(record)).toBe(dirname(marker))
    expect(record).toBe(marker.replace(/\.json$/, '.generations.json'))
  })
})

describe('profileGenerations', () => {
  it('has no generation before the first write, and logs nothing for a missing record', async () => {
    expect(await profileGenerations(home, PROJECT).current(TRUST)).toBeUndefined()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('next increments from 1, persists before resolving, and survives a new instance', async () => {
    const generations = profileGenerations(home, PROJECT)
    expect(await generations.next(TRUST)).toBe(1)
    expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual({ version: 1, project: PROJECT, epoch: expect.stringMatching(/^[0-9a-f]{32}$/), generations: { [TRUST]: 1 } })
    expect(await generations.next(TRUST)).toBe(2)
    expect(await profileGenerations(home, PROJECT).current(TRUST)).toBe(2)
  })

  it('makes an epoch with the record, keeps it across writes, and makes a new one when the record is re-created (S3)', async () => {
    const generations = profileGenerations(home, PROJECT)
    expect(await generations.epoch()).toBeUndefined()
    await generations.next(TRUST)
    const first = await generations.epoch()
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    await generations.next(PERMISSIONS)
    expect(await profileGenerations(home, PROJECT).epoch()).toBe(first)
    rmSync(record)
    expect(await generations.next(TRUST)).toBe(1)
    const second = await generations.epoch()
    expect(second).toMatch(/^[0-9a-f]{32}$/)
    expect(second).not.toBe(first)
  })

  it('treats a record without an epoch as malformed', async () => {
    mkdirSync(dirname(record), { recursive: true })
    writeFileSync(record, JSON.stringify({ version: 1, project: PROJECT, generations: { [TRUST]: 4 } }))
    expect(await profileGenerations(home, PROJECT).current(TRUST)).toBeUndefined()
    expect(await profileGenerations(home, PROJECT).epoch()).toBeUndefined()
  })

  it('counts each kind and each project on its own', async () => {
    const garden = profileGenerations(home, PROJECT)
    await garden.next(TRUST)
    await garden.next(TRUST)
    expect(await garden.next(PERMISSIONS)).toBe(1)
    expect(await garden.current(TRUST)).toBe(2)
    expect(await profileGenerations(home, '/projects/other').current(TRUST)).toBeUndefined()
  })

  it('keeps the generation monotonic under concurrent writes from separate instances', async () => {
    const writes = Array.from({ length: 25 }, (_, i) => profileGenerations(home, PROJECT).next(i % 2 === 0 ? TRUST : PERMISSIONS))
    const results = await Promise.all(writes)
    const trust = results.filter((_, i) => i % 2 === 0)
    const permissions = results.filter((_, i) => i % 2 === 1)
    expect(trust).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
    expect(permissions).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(await profileGenerations(home, PROJECT).current(TRUST)).toBe(13)
    expect(await profileGenerations(home, PROJECT).current(PERMISSIONS)).toBe(12)
  })

  it.each([
    ['not JSON', '{ nope'],
    ['a wrong shape', JSON.stringify({ version: 1, project: PROJECT, generations: { [TRUST]: 0 } })],
    ['another version', JSON.stringify({ version: 2, project: PROJECT, generations: { [TRUST]: 4 } })],
    ['another project', JSON.stringify({ version: 1, project: '/projects/other', generations: { [TRUST]: 4 } })],
    ['an oversized file', JSON.stringify({ version: 1, project: PROJECT, generations: { [TRUST]: 4 }, pad: 'x'.repeat(20_000) })]
  ])('treats %s as empty: no generation, logged without the path, and restarts at 1', async (_name, text) => {
    mkdirSync(dirname(record), { recursive: true })
    writeFileSync(record, text)
    const generations = profileGenerations(home, PROJECT)
    expect(await generations.current(TRUST)).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('Browser profile generations: home record malformed, treated as empty')
    expect(await generations.next(TRUST)).toBe(1)
    expect(await generations.current(TRUST)).toBe(1)
  })

  it('an unreadable record gives no generation, and next rejects without writing', async () => {
    mkdirSync(record, { recursive: true })
    const generations = profileGenerations(home, PROJECT)
    expect(await generations.current(TRUST)).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('Browser profile generations: home record unreadable, no generation', expect.any(Object))
    await expect(generations.next(TRUST)).rejects.toThrow()
    // A failed task does not stall the queue behind it.
    expect(await generations.current(TRUST)).toBeUndefined()
    expect(loggedText()).not.toContain(home)
  })

  it('refuses a kind that is not a signing purpose name', async () => {
    await expect(profileGenerations(home, PROJECT).next('../escape')).rejects.toThrow(TypeError)
  })

  itPosix('creates the home folder owner-only', async () => {
    await profileGenerations(home, PROJECT).next(TRUST)
    expect(statSync(dirname(record)).mode & 0o777).toBe(0o700)
  })
})
