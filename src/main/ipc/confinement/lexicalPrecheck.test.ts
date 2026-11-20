// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The lexical precheck (#71, #478 F5 and G6): an outside, UNC or device path is
 * refused before any file-system call; a local Windows path that spells the
 * project folder with 8.3 short names is expanded with `realpath` and placed
 * like its long spelling. Windows rows run on every host with the fake file
 * system built from recorded Windows output.
 */
import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { z } from 'zod'
import type { IpcMainInvokeEvent } from 'electron'
import type { ProjectSession, ProjectSessionSnapshot } from '../../services/session/ProjectSession'
import { createFakeConfinementFs, type FakeEntry } from '../__test-helpers__/fakeConfinementFs'
import { refuseLexicallyOutside } from './lexicalPrecheck'
import { registerConfinedHandle } from './registerConfinedHandle'
import type { ConfinementDeps } from './resolveConfinedPath'

const listeners = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
)

vi.mock('../registry', () => ({
  registerHandle: (channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
    listeners.set(channel, listener)
  }
}))

vi.mock('../../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const win = path.win32
const TEMP = 'C:\\Users\\X\\AppData\\Local\\Temp'
const ROOT = `${TEMP}\\e2e-test-project`
const SESSION = { root: ROOT, realRoot: ROOT, caseSensitive: false }

const ENTRIES: Record<string, FakeEntry> = {
  'C:\\': 'dir',
  'C:\\Users': 'dir',
  'C:\\Users\\X': 'dir',
  'C:\\Users\\X\\AppData': 'dir',
  'C:\\Users\\X\\AppData\\Local': 'dir',
  [TEMP]: 'dir',
  [ROOT]: 'dir',
  [`${ROOT}\\notes`]: 'dir',
  [`${ROOT}\\notes\\long-file-name.md`]: 'file',
  [`${TEMP}\\E2E-TE~1`]: { alias: ROOT },
  [`${ROOT}\\notes\\LONG-F~1.MD`]: { alias: `${ROOT}\\notes\\long-file-name.md` },
  [`${TEMP}\\other-folder`]: 'dir',
  [`${TEMP}\\other-folder\\secret.md`]: 'file',
  [`${TEMP}\\OTHER-~1`]: { alias: `${TEMP}\\other-folder` }
}

/** Windows deps over the fake disk, recording every path the file system is asked about. */
function windowsDeps(): { deps: ConfinementDeps; asked: string[] } {
  const asked: string[] = []
  const fake = createFakeConfinementFs(win, ENTRIES, true)
  const deps: ConfinementDeps = {
    path: win,
    platform: 'win32',
    fs: {
      lstat: async (target) => (asked.push(target), fake.lstat(target)),
      stat: async (target) => (asked.push(target), fake.stat(target)),
      realpath: async (target) => (asked.push(target), fake.realpath(target))
    }
  }
  return { deps, asked }
}

describe('refuseLexicallyOutside', () => {
  it('lets a path under the root through without asking the file system', async () => {
    const { deps, asked } = windowsDeps()
    await expect(refuseLexicallyOutside(`${ROOT}\\notes\\long-file-name.md`, SESSION, deps)).resolves.toBeUndefined()
    // Letter case alone is still lexical (G6)
    await expect(refuseLexicallyOutside(`c:\\users\\x\\appdata\\local\\temp\\E2E-TEST-PROJECT\\a.md`, SESSION, deps)).resolves.toBeUndefined()
    expect(asked).toEqual([])
  })

  it('G6: lets a local path that shortens the project folder through, once expanded', async () => {
    const { deps, asked } = windowsDeps()
    await expect(
      refuseLexicallyOutside(`${TEMP}\\E2E-TE~1\\notes\\LONG-F~1.MD`, SESSION, deps)
    ).resolves.toBeUndefined()
    // Only the prefix up to the last short segment is resolved
    expect(asked).toEqual([`${TEMP}\\E2E-TE~1\\notes\\LONG-F~1.MD`])
  })

  it('G6: places a file that does not exist yet below a shortened project folder', async () => {
    const { deps, asked } = windowsDeps()
    await expect(refuseLexicallyOutside(`${TEMP}\\E2E-TE~1\\new\\draft.md`, SESSION, deps)).resolves.toBeUndefined()
    expect(asked).toEqual([`${TEMP}\\E2E-TE~1`])
  })

  it('refuses a local short-name path that expands outside the project', async () => {
    const { deps, asked } = windowsDeps()
    await expect(refuseLexicallyOutside(`${TEMP}\\OTHER-~1\\secret.md`, SESSION, deps)).rejects.toMatchObject({
      code: 'OUTSIDE_PROJECT'
    })
    expect(asked).toEqual([`${TEMP}\\OTHER-~1`])
  })

  it('refuses a local short-name path that does not resolve, as outside', async () => {
    const { deps } = windowsDeps()
    await expect(refuseLexicallyOutside(`${TEMP}\\MISSIN~1\\a.md`, SESSION, deps)).rejects.toMatchObject({
      code: 'OUTSIDE_PROJECT'
    })
  })

  it.each([
    ['a UNC path', '\\\\srv\\share\\E2E-TE~1\\a.md'],
    ['a UNC path written with slashes', '//srv/share/E2E-TE~1/a.md'],
    ['an extended-length device path', `\\\\?\\${TEMP}\\E2E-TE~1\\a.md`],
    ['a device-namespace path', `\\\\.\\${TEMP}\\E2E-TE~1\\a.md`],
    ['an extended-length UNC path', '\\\\?\\UNC\\srv\\share\\E2E-TE~1\\a.md'],
    ['a drive the project is not on', 'D:\\E2E-TE~1\\a.md'],
    ['a plain outside path', `${TEMP}\\other-folder\\secret.md`],
    ['an NT object path to a share', '\\??\\UNC\\srv\\share\\E2E-TE~1\\a.md'],
    ['a rootless path that only gains a drive from resolve', '\\Users\\X\\AppData\\Local\\Temp\\E2E-TE~1\\a.md']
  ])('F5: refuses %s with zero file-system calls', async (_label, value) => {
    const { deps, asked } = windowsDeps()
    await expect(refuseLexicallyOutside(value, SESSION, deps)).rejects.toMatchObject({ code: 'OUTSIDE_PROJECT' })
    expect(asked).toEqual([])
  })

  it('never expands when the project itself lives on a share', async () => {
    const { deps, asked } = windowsDeps()
    const shareSession = { root: 'Z:\\proj', realRoot: '\\\\srv\\share\\proj', caseSensitive: false }
    await expect(refuseLexicallyOutside('Z:\\OTHER-~1\\a.md', shareSession, deps)).rejects.toMatchObject({
      code: 'OUTSIDE_PROJECT'
    })
    expect(asked).toEqual([])
  })

  it('refuses a short-name candidate with a device or stream segment before realpath', async () => {
    const { deps, asked } = windowsDeps()
    for (const value of [`${TEMP}\\CON\\E2E-TE~1\\a.md`, `${TEMP}\\E2E-TE~1:stream\\a.md`]) {
      await expect(refuseLexicallyOutside(value, SESSION, deps)).rejects.toMatchObject({ code: 'INVALID_PATH' })
    }
    expect(asked).toEqual([])
  })

  it('never expands on a POSIX host: a tilde there is an ordinary character', async () => {
    const asked: string[] = []
    const deps: ConfinementDeps = {
      path: path.posix,
      platform: 'linux',
      fs: {
        lstat: async (target) => (asked.push(target), Promise.reject(new Error('unexpected'))),
        stat: async (target) => (asked.push(target), Promise.reject(new Error('unexpected'))),
        realpath: async (target) => (asked.push(target), target)
      }
    }
    const session = { root: '/home/x/proj', realRoot: '/home/x/proj', caseSensitive: true }
    await expect(refuseLexicallyOutside('/home/x/PROJ~1/a.md', session, deps)).rejects.toMatchObject({
      code: 'OUTSIDE_PROJECT'
    })
    expect(asked).toEqual([])
  })

  it('leaves a value that is not an absolute path, or no open project, to the full check', async () => {
    const { deps, asked } = windowsDeps()
    await expect(refuseLexicallyOutside(42, SESSION, deps)).resolves.toBeUndefined()
    await expect(refuseLexicallyOutside('E2E-TE~1\\a.md', SESSION, deps)).resolves.toBeUndefined()
    await expect(refuseLexicallyOutside(`${TEMP}\\OTHER-~1\\a.md`, null, deps)).resolves.toBeUndefined()
    expect(asked).toEqual([])
  })
})

describe('registerConfinedHandle with lexicalPrecheck (G6)', () => {
  it('acts on the long spelling of a path that shortens the project folder', async () => {
    const { deps } = windowsDeps()
    const snapshot: ProjectSessionSnapshot = { generation: 1, ...SESSION, ownerWebContentsId: null }
    const session = { current: () => snapshot, require: () => snapshot, onChange: () => () => undefined } as ProjectSession
    registerConfinedHandle(
      'test:short-names',
      {
        schema: z.tuple([z.string()]),
        paths: { filePath: { arg: 0, mode: 'project', mustExist: true, kind: 'file' } },
        lexicalPrecheck: true,
        confinementDeps: deps,
        onRefusal: (error) => error.code,
        handler: async (_ctx, _args, { filePath }) => filePath.real
      },
      session
    )
    const call = (value: string) =>
      listeners.get('test:short-names')!({ sender: { id: 1 } } as unknown as IpcMainInvokeEvent, value)
    const long = `${ROOT}\\notes\\long-file-name.md`
    // The short and the long spelling act on one file, so they share one watch key
    await expect(call(`${TEMP}\\E2E-TE~1\\notes\\LONG-F~1.MD`)).resolves.toBe(long)
    await expect(call(long)).resolves.toBe(long)
    await expect(call(`${TEMP}\\OTHER-~1\\secret.md`)).resolves.toBe('OUTSIDE_PROJECT')
  })
})
