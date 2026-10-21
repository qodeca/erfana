// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * file-handlers.session.test.ts
 *
 * The session-facing channels: `file:getSession` shows the renderer only the
 * root and the generation, and `file:closeProject` hands the close to the
 * project service, ignoring a stale close from a renderer that has not yet
 * seen a newer project.
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

vi.mock('../utils/pathSecurity', () => ({ validatePath: vi.fn(async () => {}) }))

vi.mock('../services/FileWatcherService', () => ({
  fileWatcherService: { stopAll: vi.fn(async () => {}), setProjectPath: vi.fn() }
}))
vi.mock('../services/DirectoryWatcherService', () => ({
  directoryWatcherService: {
    stopAll: vi.fn(async () => {}),
    setProjectPath: vi.fn(),
    setPathFilter: vi.fn()
  }
}))
vi.mock('../services/FileService', () => ({
  fileService: {
    getProjectPath: () => null,
    setProjectPath: vi.fn(),
    setHiddenPatterns: vi.fn(),
    setPathFilter: vi.fn()
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
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'erfana-session-')))
  roots.push(dir)
  return dir
}

const event = { sender: { id: 3 } }

describe('session channels', () => {
  beforeEach(async () => {
    await projectService.close({ senderId: null, reason: 'user' })
    registerFileHandlers()
  })

  afterAll(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true })
  })

  it('file:getSession is null while nothing is open', async () => {
    expect(await handlers['file:getSession'](event)).toBeNull()
  })

  it('file:getSession returns only the root and the generation', async () => {
    const dir = makeProject()
    await handlers['file:openProjectByPath'](event, dir)

    const session = await handlers['file:getSession'](event)

    expect(Object.keys(session).sort()).toEqual(['generation', 'root'])
    expect(session).toEqual({ root: dir, generation: projectService.session.require().generation })
  })

  it('file:closeProject closes the project through the service', async () => {
    await handlers['file:openProjectByPath'](event, makeProject())

    expect(await handlers['file:closeProject'](event)).toBe(true)

    expect(projectService.session.current()).toBeNull()
  })

  it('file:closeProject with a stale generation leaves a newer project open', async () => {
    const first = makeProject()
    const second = makeProject()
    await handlers['file:openProjectByPath'](event, first)
    const seenByRenderer = projectService.session.require().generation
    await handlers['file:openProjectByPath'](event, second)

    // The renderer saw the first project vanish, but main has moved on
    expect(await handlers['file:closeProject'](event, seenByRenderer)).toBe(true)
    expect(projectService.session.current()?.root).toBe(second)

    await handlers['file:closeProject'](event, projectService.session.require().generation)
    expect(projectService.session.current()).toBeNull()
  })

  it('file:closeProject treats a non-numeric argument as a plain close', async () => {
    await handlers['file:openProjectByPath'](event, makeProject())

    await handlers['file:closeProject'](event, 'not-a-number')

    expect(projectService.session.current()).toBeNull()
  })
})
