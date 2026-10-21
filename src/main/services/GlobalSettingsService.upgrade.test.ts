// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Upgrade path: a settings file written by the old code (plain `writeFile`, no
 * trailing newline) still loads, and a save rewrites it atomically. Real fs,
 * with the home folder pointed at a temp directory.
 *
 * Recent projects live in electron-store, which this change does not touch, so
 * their on-disk format is unchanged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = vi.hoisted(() => ({ dir: '' }))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => home.dir }
})

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

import { GlobalSettingsService } from './GlobalSettingsService'
import { getDefaultGlobalSettings } from '../../shared/ipc/global-settings-schema'

describe('GlobalSettingsService upgrade from the old file format', () => {
  let settingsDir: string

  beforeEach(async () => {
    home.dir = await mkdtemp(join(tmpdir(), 'erfana-settings-upgrade-'))
    settingsDir = join(home.dir, '.erfana')
    await mkdir(settingsDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(home.dir, { recursive: true, force: true })
  })

  it('loads a file written by the old code (no trailing newline)', async () => {
    const defaults = getDefaultGlobalSettings()
    await writeFile(join(settingsDir, 'settings.json'), JSON.stringify(defaults, null, 2), 'utf-8')

    const service = new GlobalSettingsService()
    await service.initialize()

    expect(service.getSettings()).toEqual(defaults)
    expect(await readdir(settingsDir)).toEqual(['settings.json'])
  })

  it('a save is written atomically, leaves no temp file, and reloads', async () => {
    const service = new GlobalSettingsService()
    await service.initialize()
    await service.resetSettings()

    const raw = await readFile(join(settingsDir, 'settings.json'), 'utf-8')
    expect(JSON.parse(raw)).toEqual(getDefaultGlobalSettings())
    expect((await readdir(settingsDir)).filter((n) => n.endsWith('.tmp'))).toEqual([])

    const reloaded = new GlobalSettingsService()
    await reloaded.initialize()
    expect(reloaded.getSettings()).toEqual(getDefaultGlobalSettings())
  })
})
