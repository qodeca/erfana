// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * armWatch – the one place a watcher is (re-)created (#478, plan decision 12):
 * confinement and "a regular file" re-checked on every arm, the old watcher
 * closed before the new one, and one arm at a time per entry (F22, F46, N2).
 * A fake disk and fake watchers; no module mocks.
 */
import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import type { FSWatcher } from 'chokidar'
import { armWatch, checkTarget, inspectTarget, type ArmFs, type ArmWatchDeps } from './armWatch'
import type { WatchEntry } from './watchTypes'
import type { ProjectSessionSnapshot } from '../session/ProjectSession'

const ROOT = path.resolve(path.sep, 'proj')
const FILE = path.join(ROOT, 'a.md')
const SESSION: ProjectSessionSnapshot = { generation: 1, root: ROOT, realRoot: ROOT, caseSensitive: true, ownerWebContentsId: null }

interface Disk {
  links: Map<string, string>
  files: Map<string, { ino: number; dir?: boolean }>
}

function fsOver(disk: Disk): ArmFs {
  const missing = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  return {
    realpath: async p => {
      const target = disk.links.get(p) ?? p
      if (!disk.files.has(target)) throw missing()
      return target
    },
    stat: async p => {
      const file = disk.files.get(p)
      if (!file) throw missing()
      return { isFile: () => !file.dir, dev: 1, ino: file.ino, birthtimeMs: 0 }
    }
  }
}

function setup(entryPath = FILE) {
  const disk: Disk = { links: new Map(), files: new Map([[entryPath, { ino: 1 }]]) }
  const events: string[] = []
  const created: Array<{ close: ReturnType<typeof vi.fn> }> = []
  const entry: WatchEntry = {
    key: entryPath,
    filePath: entryPath,
    profile: 'editor',
    watcher: null,
    suspended: false,
    identity: null,
    arming: null,
    ready: null,
    subs: new Set()
  }
  let held = true
  const deps: ArmWatchDeps = {
    session: () => SESSION,
    isCurrent: e => held && e === entry,
    createWatcher: (_e, onReady) => {
      const n = created.length
      const watcher = {
        close: vi.fn(async () => {
          events.push(`close-${n}`)
        })
      }
      created.push(watcher)
      events.push(`create-${n}`)
      queueMicrotask(onReady)
      return watcher as unknown as FSWatcher
    },
    fs: fsOver(disk)
  }
  return { disk, events, created, entry, deps, drop: () => (held = false) }
}

describe('armWatch', () => {
  it('binds a watcher, records the identity and says ready', async () => {
    const { entry, deps } = setup()

    await expect(armWatch(entry, deps)).resolves.toBe('armed')

    expect(entry.watcher).not.toBeNull()
    expect(entry.identity).toEqual({ dev: 1, ino: 1, birthtimeMs: 0 })
    await expect(entry.ready).resolves.toBe(true)
  })

  it('closes the old watcher BEFORE creating its replacement', async () => {
    const { entry, deps, events } = setup()
    await armWatch(entry, deps)

    await armWatch(entry, deps)

    expect(events).toEqual(['create-0', 'close-0', 'create-1'])
  })

  it('ends a watch whose path now resolves outside the project, binding nothing (F22)', async () => {
    const { entry, deps, disk, created } = setup()
    await armWatch(entry, deps)
    const outside = path.resolve(path.sep, 'elsewhere', 'secret.md')
    disk.links.set(FILE, outside)
    disk.files.set(outside, { ino: 9 })

    await expect(armWatch(entry, deps)).resolves.toBe('outside-project')

    expect(created).toHaveLength(1)
    expect(created[0].close).not.toHaveBeenCalled()
  })

  it('keeps following an in-project link to an in-project file (N2)', async () => {
    const link = path.join(ROOT, 'link.md')
    const { entry, deps, disk } = setup(link)
    disk.links.set(link, FILE)
    disk.files.set(FILE, { ino: 5 })

    await expect(armWatch(entry, deps)).resolves.toBe('armed')
    // The link is replaced by an atomic save of its target: still in the project
    disk.files.set(FILE, { ino: 6 })
    await expect(armWatch(entry, deps)).resolves.toBe('armed')
    expect(entry.identity?.ino).toBe(6)
  })

  it('refuses a path that is now a folder, and reports a missing file', async () => {
    const { entry, deps, disk } = setup()
    disk.files.set(FILE, { ino: 1, dir: true })
    await expect(armWatch(entry, deps)).resolves.toBe('unsupported')

    disk.files.delete(FILE)
    await expect(armWatch(entry, deps)).resolves.toBe('missing')
  })

  it('refuses a path realpath cannot resolve as outside-project; only the re-check keeps it unresolved (R2-1)', async () => {
    const { entry, deps, created } = setup()
    const fs = deps.fs as ArmFs
    const realpath = fs.realpath
    // A Windows delete-pending file: `realpath` answers EPERM
    deps.fs = {
      ...fs,
      realpath: async p => (p === FILE ? Promise.reject(Object.assign(new Error('EPERM'), { code: 'EPERM' })) : realpath(p))
    }

    await expect(armWatch(entry, deps)).resolves.toBe('outside-project')
    await expect(checkTarget(FILE, SESSION, deps.fs)).resolves.toBe('outside-project')
    await expect(inspectTarget(FILE, SESSION, deps.fs)).resolves.toBe('unresolved')
    expect(created).toHaveLength(0)
    await expect(inspectTarget(path.join(ROOT, 'gone.md'), SESSION, fs)).resolves.toBe('missing')
  })

  it('folds a second request into the running arm: one close, one live watcher (F46)', async () => {
    const { entry, deps, events, created } = setup()
    await armWatch(entry, deps)

    // The unlink re-arm and the health round ask at the same moment
    const [first, second] = await Promise.all([armWatch(entry, deps), armWatch(entry, deps)])

    expect([first, second]).toEqual(['armed', 'armed'])
    expect(events).toEqual(['create-0', 'close-0', 'create-1'])
    expect(entry.watcher).toBe(created[1])
    expect(entry.arming).toBeNull()
  })

  it('binds nothing when the entry was dropped while it checked the disk', async () => {
    const { entry, deps, created, drop } = setup()
    const arming = armWatch(entry, deps)
    drop()

    await expect(arming).resolves.toBe('stale')
    expect(created).toHaveLength(0)
  })

  it('says failed when the watcher cannot be created', async () => {
    const { entry, deps } = setup()
    deps.createWatcher = () => {
      throw new Error('EMFILE: too many open files')
    }

    await expect(armWatch(entry, deps)).resolves.toBe('failed')
    await expect(entry.ready).resolves.toBe(false)
  })
})
