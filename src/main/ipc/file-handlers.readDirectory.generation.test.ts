// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * file-handlers.readDirectory.generation.test.ts
 *
 * `file:readDirectory` with a `generation`: the first load after a project
 * switch names the session it belongs to. A read left over from an earlier
 * project is refused as PROJECT_CHANGED (checked before the path is, so it
 * never surfaces as an OUTSIDE_PROJECT confinement error); the current
 * generation, or none, reads as before.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const handlers: Record<string, (...args: any[]) => any> = {}

vi.mock('./senderValidation', () => ({ isTrustedSender: () => true, isTrustedAppSender: () => true }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((ch: string, cb: any) => {
      handlers[ch] = cb
    })
  },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

vi.mock('../utils/pathSecurity', () => ({
  validatePath: vi.fn(async () => {}),
  assertAcceptableProjectRoot: vi.fn()
}))

vi.mock('../services/FileWatcherService', () => ({
  fileWatcherService: { stopAll: vi.fn(async () => {}), setProjectPath: vi.fn() }
}))
vi.mock('../services/DirectoryWatcherService', () => ({
  directoryWatcherService: {
    stopAll: vi.fn(async () => {}),
    setProjectPath: vi.fn(),
    setPathFilter: vi.fn(),
    beginTreeRead: vi.fn(() => () => {}),
    beginKnownEntriesRead: vi.fn(() => ({ commit: vi.fn(), cancel: vi.fn() }))
  }
}))
vi.mock('../services/FileService', () => ({
  fileService: {
    getProjectPath: () => null,
    setProjectPath: vi.fn(),
    setHiddenPatterns: vi.fn(),
    setPathFilter: vi.fn(),
    readDirectory: vi.fn(async () => [])
  }
}))
vi.mock('../services/SettingsService', () => ({
  settingsService: {
    setLastProjectPath: vi.fn(async () => {}),
    addRecentProject: vi.fn(async () => {}),
    clearLastProjectPath: vi.fn(async () => {})
  }
}))
vi.mock('../services/ProjectLockService', () => ({
  projectLockService: {
    acquireLock: vi.fn(async () => ({ status: 'acquired' })),
    releaseLock: vi.fn(async () => {}),
    requestFocus: vi.fn(async () => true)
  }
}))

import { registerFileHandlers, projectService } from './file-handlers'

const roots: string[] = []
function makeProject(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-readdir-gen-')))
  roots.push(dir)
  return dir
}

const event = { sender: { id: 3 } }

describe('file:readDirectory generation', () => {
  beforeEach(async () => {
    await projectService.close({ senderId: null, reason: 'user' })
    registerFileHandlers()
  })

  afterAll(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a read from an earlier project with PROJECT_CHANGED, not a confinement error', async () => {
    const first = makeProject()
    const second = makeProject()
    await handlers['file:openProjectByPath'](event, { projectPath: first })
    const firstGeneration = projectService.session.require().generation
    await handlers['file:openProjectByPath'](event, { projectPath: second })

    const refused = handlers['file:readDirectory'](event, { dirPath: first, generation: firstGeneration })
    await expect(refused).rejects.toThrow(/project changed/i)
  })

  it('reads with the current generation and with none', async () => {
    const root = makeProject()
    await handlers['file:openProjectByPath'](event, { projectPath: root })
    const { generation } = projectService.session.require()

    await expect(handlers['file:readDirectory'](event, { dirPath: root, generation })).resolves.toEqual([])
    await expect(handlers['file:readDirectory'](event, { dirPath: root })).resolves.toEqual([])
  })
})
