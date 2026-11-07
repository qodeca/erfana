// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Real-path confinement of a served local folder (spec 025, 025-FR-005
 * rule 1; ADR 0012 decision 8) when the name changes between the open and the
 * checks after it: a file swapped under the name, or one removed. The real
 * file system cannot hit that window on demand, so `lstat`, `realpath` and
 * the opened handle are wrapped here; the rest is a real temporary folder.
 * Split from `localConfinedFile.test.ts` because the module mock hoists.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  lstat: undefined as undefined | ((...args: unknown[]) => Promise<unknown>),
  realpath: undefined as undefined | ((...args: unknown[]) => Promise<unknown>),
  open: undefined as undefined | ((...args: unknown[]) => Promise<unknown>)
}))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: (...args: unknown[]) =>
      (fsMocks.lstat ?? actual.lstat)(...(args as Parameters<typeof actual.lstat>)),
    realpath: (...args: unknown[]) =>
      (fsMocks.realpath ?? actual.realpath)(...(args as Parameters<typeof actual.realpath>)),
    open: (...args: unknown[]) =>
      (fsMocks.open ?? actual.open)(...(args as Parameters<typeof actual.open>))
  }
})

import type { FileHandle } from 'node:fs/promises'
import { openConfinedFile } from './localConfinedFile'

// The unwrapped functions: the test's own file work, and the wrappers' delegates.
const {
  lstat: actualLstat,
  mkdir,
  mkdtemp,
  open: actualOpen,
  realpath: realRealpath,
  rm,
  writeFile
} = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

let base: string
let root: string
const never = (): boolean => false

beforeAll(async () => {
  base = await realRealpath(await mkdtemp(join(tmpdir(), 'erfana-local-race-')))
  root = join(base, 'site')
  await mkdir(root)
  await writeFile(join(root, 'index.html'), '<p>hi</p>')
  await writeFile(join(root, 'other.html'), '<p>other</p>')
})

afterEach(() => {
  fsMocks.lstat = undefined
  fsMocks.realpath = undefined
  fsMocks.open = undefined
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

/** Track the handles `openConfinedFile` opens, so a test can see each one closed. */
function trackOpens(wrap: (handle: FileHandle) => FileHandle = h => h): {
  closed: () => boolean[]
} {
  const handles: { closed: boolean }[] = []
  fsMocks.open = async (...args: unknown[]) => {
    const handle = await actualOpen(...(args as Parameters<typeof actualOpen>))
    const entry = { closed: false }
    handles.push(entry)
    const realClose = handle.close.bind(handle)
    handle.close = async () => {
      entry.closed = true
      await realClose()
    }
    return wrap(handle)
  }
  return { closed: () => handles.map(h => h.closed) }
}

describe('openConfinedFile, when the name changes after the open', () => {
  it('refuses with 403 and closes the handle when the name now names another file', async () => {
    const opens = trackOpens()
    fsMocks.lstat = (path: unknown, options: unknown) =>
      actualLstat(
        path === join(root, 'index.html') ? join(root, 'other.html') : (path as string),
        options as { bigint: true }
      )
    expect(await openConfinedFile(root, ['index.html'], never)).toEqual({ ok: false, status: 403 })
    expect(opens.closed()).toEqual([true])
  })

  it('answers 404 and closes the handle when the name is gone before its real path is read', async () => {
    const opens = trackOpens()
    let calls = 0
    fsMocks.realpath = async (path: unknown) => {
      calls += 1
      // The first call resolves the parent folder; the second, after the open, finds the name removed.
      if (calls === 2) throw Object.assign(new Error('ENOENT: gone'), { code: 'ENOENT' })
      return realRealpath(path as string)
    }
    const veto = vi.fn(never)
    expect(await openConfinedFile(root, ['index.html'], veto)).toEqual({ ok: false, status: 404 })
    expect(calls).toBe(2)
    expect(veto).not.toHaveBeenCalled()
    expect(opens.closed()).toEqual([true])
  })

  it('still answers 404 when closing the handle after a failed check fails too', async () => {
    trackOpens(handle => {
      handle.stat = () =>
        Promise.reject(Object.assign(new Error('EIO: stat failed'), { code: 'EIO' }))
      const realClose = handle.close.bind(handle)
      handle.close = async () => {
        await realClose()
        throw Object.assign(new Error('EBADF: close failed'), { code: 'EBADF' })
      }
      return handle
    })
    expect(await openConfinedFile(root, ['index.html'], never)).toEqual({ ok: false, status: 404 })
  })

  it('answers 404 and closes the handle when the veto itself throws', async () => {
    const opens = trackOpens()
    const veto = (): boolean => {
      throw new Error('veto failed')
    }
    expect(await openConfinedFile(root, ['index.html'], veto)).toEqual({ ok: false, status: 404 })
    expect(opens.closed()).toEqual([true])
  })

  it('leaves the handle open for the caller when every check passes', async () => {
    const opens = trackOpens()
    const result = await openConfinedFile(root, ['index.html'], never)
    expect(result).toMatchObject({ ok: true, ext: '.html', realPath: join(root, 'index.html') })
    expect(opens.closed()).toEqual([false])
    if (result.ok) await result.handle.close()
    expect(opens.closed()).toEqual([true])
  })
})
