// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Spec 025 (025-FR-015): the browser profile under .erfana/browser/ never shows
// as a project change, even when its self-ignore file has been deleted.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFile, spawnSync } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const execFileAsync = promisify(execFile)
const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' })
const GIT_PATH = probe.status === 0 ? probe.stdout.trim().split(/\r?\n/)[0] || null : null

vi.mock('worker_threads', () => ({ parentPort: { on: vi.fn(), postMessage: vi.fn() } }))
vi.mock('isomorphic-git', () => ({ currentBranch: vi.fn(), resolveRef: vi.fn(), statusMatrix: vi.fn() }))

import { executeNativeGit, isBrowserProfilePath } from './git-status.worker'

describe('isBrowserProfilePath', () => {
  it('matches the folder and everything under it, nothing else', () => {
    expect(isBrowserProfilePath('.erfana/browser')).toBe(true)
    expect(isBrowserProfilePath('.erfana/browser/profile/Cookies')).toBe(true)
    expect(isBrowserProfilePath('.erfana/browser-notes.md')).toBe(false)
    expect(isBrowserProfilePath('.erfana/config.json')).toBe(false)
    expect(isBrowserProfilePath('src/.erfana/browser/x')).toBe(false)
  })
})

describe.skipIf(GIT_PATH === null)('git-status native path – browser profile exclusion', () => {
  let repo: string

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'erfana-git-browser-'))
    const git = (args: string[]): Promise<unknown> => execFileAsync(GIT_PATH as string, args, { cwd: repo })
    await git(['init', '-q'])
    await mkdir(join(repo, '.erfana', 'browser', 'profile', 'Local Storage'), { recursive: true })
    await writeFile(join(repo, '.erfana', 'browser', 'profile', 'Cookies'), 'x')
    await writeFile(join(repo, '.erfana', 'browser', 'profile', 'Local Storage', 'leveldb.log'), 'x')
    await writeFile(join(repo, '.erfana', 'notes.md'), 'kept')
    await writeFile(join(repo, 'index.html'), '<p>hi</p>')
  })

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true })
  })

  it('lists project files but no file under .erfana/browser when its .gitignore is missing', async () => {
    const status = await executeNativeGit(repo, GIT_PATH as string)
    const paths = status.files.map((f) => f.path.replace(/\\/g, '/'))
    expect(paths.some((p) => p.endsWith('/index.html'))).toBe(true)
    expect(paths.some((p) => p.endsWith('/.erfana/notes.md'))).toBe(true)
    expect(paths.filter((p) => p.includes('/.erfana/browser/'))).toEqual([])
  })
})
