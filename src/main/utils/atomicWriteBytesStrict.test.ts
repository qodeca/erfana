// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * atomicWriteBytesStrict and readFileNoFollow on a real temp directory (no fs
 * mocks – the mocked rename / handle failures live in
 * `atomicWriteBytesStrict.failure.test.ts`, split per the test-file policy).
 * Design: docs/designs/comments/html-preview-comments.md §7.6 step 9, M-061; security
 * review F2–F4 (deny-write ACL, mark of the web, file and folder identity).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import {
  atomicWriteBytesStrict,
  errnoOf,
  fileIdKey,
  fileIdOf,
  readFileNoFollow,
  sha256Hex,
  type FileId,
  type StrictWriteOptions
} from './atomicWriteBytesStrict'

const posixOnly = process.platform === 'win32' ? it.skip : it
const isWindows = process.platform === 'win32'
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const MAX = 1024 * 1024
/** The id passed for a file that does not exist; never compared, because the write stops first. */
const NO_FILE: FileId = { dev: 0n, ino: 0n }

/** True when the temp folder's disk treats `A` and `a` as one name. */
async function tempDiskIgnoresCase(): Promise<boolean> {
  const made = await mkdtemp(join(tmpdir(), 'erfana-case-'))
  try {
    await writeFile(join(made, 'probe.txt'), 'x')
    return await stat(join(made, 'PROBE.TXT')).then(
      () => true,
      () => false
    )
  } finally {
    await rm(made, { recursive: true, force: true })
  }
}

const CASE_INSENSITIVE = await tempDiskIgnoresCase()

async function idOf(path: string): Promise<FileId> {
  return fileIdOf(await stat(path, { bigint: true }))
}

interface Original {
  readonly path: string
  readonly hash: string
  readonly id: FileId
}

/** Options that expect exactly `file` as it was read. */
function expecting(file: Original, extra: Partial<StrictWriteOptions> = {}): StrictWriteOptions {
  return { expectedHash: file.hash, expectedId: file.id, maxBytes: MAX, ...extra }
}

describe('atomicWriteBytesStrict', () => {
  let made: string
  let dir: string

  beforeEach(async () => {
    made = await mkdtemp(join(tmpdir(), 'erfana-strict-'))
    dir = await realpath(made)
  })

  afterEach(async () => {
    await rm(made, { recursive: true, force: true })
  })

  async function original(name: string, bytes: Uint8Array): Promise<Original> {
    const path = join(dir, name)
    await writeFile(path, bytes)
    return { path, hash: sha256Hex(bytes), id: await idOf(path) }
  }

  it('M-061 replaces the file byte for byte and leaves no .erfana-tmp- file behind', async () => {
    // A BOM, CRLF, a lone CR and a 4-byte character: bytes in, bytes out, never re-encoded
    const before = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x62, 0x0d, 0xf0, 0x9f, 0x98, 0x80])
    const after = Buffer.concat([before, Buffer.from([0x63, 0x0d, 0x0a])])
    const file = await original('page.html', before)

    const result = await atomicWriteBytesStrict(file.path, after, expecting(file, { expectedDir: dir }))

    expect(result).toEqual({ ok: true, path: file.path })
    expect((await readFile(file.path)).equals(after)).toBe(true)
    expect(await readdir(dir)).toEqual(['page.html'])
  })

  it('M-061 refuses when the file no longer holds the expected bytes (changed), and writes nothing', async () => {
    const file = await original('page.html', Buffer.from('agent edit'))

    const result = await atomicWriteBytesStrict(file.path, Buffer.from('mine'), {
      ...expecting(file),
      expectedHash: sha256Hex(Buffer.from('what I read'))
    })

    expect(result).toEqual({ ok: false, reason: 'changed' })
    expect(await readFile(file.path, 'utf8')).toBe('agent edit')
    expect(await readdir(dir)).toEqual(['page.html'])
  })

  it('M-061 with the bytes read given, compares them byte for byte: unchanged writes, changed is refused', async () => {
    const file = await original('page.html', Buffer.from('what I read'))

    const refusedWrite = await atomicWriteBytesStrict(file.path, Buffer.from('mine'), {
      ...expecting(file),
      expectedBytes: Buffer.from('what I reaD')
    })
    expect(refusedWrite).toEqual({ ok: false, reason: 'changed' })
    expect(await readFile(file.path, 'utf8')).toBe('what I read')

    const written = await atomicWriteBytesStrict(file.path, Buffer.from('mine'), {
      ...expecting(file),
      expectedBytes: Buffer.from('what I read')
    })
    expect(written).toEqual({ ok: true, path: file.path })
    expect(await readFile(file.path, 'utf8')).toBe('mine')
  })

  it('L4 the veto runs first, then the re-check, then the rename: an outside write during a slow veto is refused as changed', async () => {
    const file = await original('page.html', Buffer.from('what I read'))
    const order: string[] = []
    const result = await atomicWriteBytesStrict(file.path, Buffer.from('mine'), {
      ...expecting(file, { expectedDir: dir }),
      beforeRename: async () => {
        order.push('veto')
        // An agent writes while the veto is still deciding (the unsaved-files lookup is slow)
        await writeFile(file.path, 'agent edit')
        return true
      }
    })
    expect(order).toEqual(['veto'])
    // Had the re-check run before the veto, this write would have been replaced
    expect(result).toEqual({ ok: false, reason: 'changed' })
    expect(await readFile(file.path, 'utf8')).toBe('agent edit')
    expect(await readdir(dir)).toEqual(['page.html'])
  })

  it('L4 a veto writes nothing and is asked before the target is re-read', async () => {
    const file = await original('page.html', Buffer.from('what I read'))
    const result = await atomicWriteBytesStrict(file.path, Buffer.from('mine'), {
      ...expecting(file),
      // The target changed too: a veto still answers vetoed, since it is asked first
      expectedHash: sha256Hex(Buffer.from('something else')),
      beforeRename: async () => false
    })
    expect(result).toEqual({ ok: false, reason: 'vetoed' })
    expect(await readFile(file.path, 'utf8')).toBe('what I read')
    expect(await readdir(dir)).toEqual(['page.html'])
  })

  it('M-061 refuses another file under the same name holding the same bytes (changed): the dev/ino must match too', async () => {
    const file = await original('page.html', Buffer.from('same bytes'))
    // An editor's own atomic save: a new file renamed over the old one
    await writeFile(join(dir, 'replacement'), 'same bytes')
    await rename(join(dir, 'replacement'), file.path)
    const replacement = await idOf(file.path)

    const result = await atomicWriteBytesStrict(file.path, Buffer.from('mine'), expecting(file))

    expect(result).toEqual({ ok: false, reason: 'changed' })
    expect(await readFile(file.path, 'utf8')).toBe('same bytes')
    expect(await idOf(file.path)).toEqual(replacement)
    expect(await readdir(dir)).toEqual(['page.html'])
  })

  it('M-061 refuses when the folder was swapped for a link after the caller confined it (changed)', async () => {
    await mkdir(join(dir, 'pages'))
    const file = await original(join('pages', 'page.html'), Buffer.from('<p>x</p>'))
    // The very same file and bytes, now reached through a link where the folder was
    await rename(join(dir, 'pages'), join(dir, 'moved'))
    await symlink(join(dir, 'moved'), join(dir, 'pages'), 'junction')

    const result = await atomicWriteBytesStrict(
      file.path,
      Buffer.from('mine'),
      expecting(file, { expectedDir: join(dir, 'pages') })
    )

    expect(result).toEqual({ ok: false, reason: 'changed' })
    expect(await readFile(join(dir, 'moved', 'page.html'), 'utf8')).toBe('<p>x</p>')
    expect(await readdir(join(dir, 'moved'))).toEqual(['page.html'])
  })

  it('M-061 counts a file that grew past maxBytes as changed', async () => {
    const file = await original('page.html', Buffer.from('0123456789'))

    const result = await atomicWriteBytesStrict(file.path, Buffer.from('x'), { ...expecting(file), maxBytes: 4 })

    expect(result).toEqual({ ok: false, reason: 'changed' })
    expect(await readFile(file.path, 'utf8')).toBe('0123456789')
  })

  it('M-008 refuses a symlink: the link and its target stay untouched', async () => {
    const real = await original('real.html', Buffer.from('real'))
    const linkPath = join(dir, 'link.html')
    await symlink(real.path, linkPath, 'file')

    const result = await atomicWriteBytesStrict(linkPath, Buffer.from('x'), expecting(real))

    expect(result).toEqual({ ok: false, reason: 'link' })
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(linkPath)).toBe(real.path)
    expect(await readFile(real.path, 'utf8')).toBe('real')
    expect((await readdir(dir)).sort()).toEqual(['link.html', 'real.html'])
  })

  it('M-061 refuses a file with another hard link (nlink > 1), on every platform', async () => {
    const file = await original('a.html', Buffer.from('shared'))
    await link(file.path, join(dir, 'b.html'))

    const result = await atomicWriteBytesStrict(file.path, Buffer.from('x'), expecting(file))

    expect(result).toEqual({ ok: false, reason: 'link' })
    expect(await readFile(join(dir, 'b.html'), 'utf8')).toBe('shared')
    expect((await stat(file.path)).nlink).toBe(2)
  })

  // root writes through the missing permission
  it.skipIf(isRoot)('M-007 refuses a read-only file instead of replacing it', async () => {
    const file = await original('locked.html', Buffer.from('old'))
    await chmod(file.path, 0o444)
    try {
      const result = await atomicWriteBytesStrict(file.path, Buffer.from('new'), expecting(file))

      expect(result).toEqual({ ok: false, reason: 'read-only' })
      expect(await readFile(file.path, 'utf8')).toBe('old')
      expect(await readdir(dir)).toEqual(['locked.html'])
    } finally {
      await chmod(file.path, 0o666)
    }
  })

  posixOnly('M-007 keeps the permission bits of the original file', async () => {
    const file = await original('page.html', Buffer.from('old'))
    await chmod(file.path, 0o751)

    const result = await atomicWriteBytesStrict(file.path, Buffer.from('new'), expecting(file))

    expect(result.ok).toBe(true)
    expect((await stat(file.path)).mode & 0o777).toBe(0o751)
  })

  it('M-056 never creates a missing file (gone)', async () => {
    const path = join(dir, 'deleted.html')

    const result = await atomicWriteBytesStrict(path, Buffer.from('x'), {
      expectedHash: sha256Hex(Buffer.from('')),
      expectedId: NO_FILE,
      maxBytes: MAX
    })

    expect(result).toMatchObject({ ok: false, reason: 'gone', errno: 'ENOENT' })
    expect(await readdir(dir)).toEqual([])
  })

  it('refuses a folder in place of the file (gone)', async () => {
    await mkdir(join(dir, 'folder.html'))

    const result = await atomicWriteBytesStrict(join(dir, 'folder.html'), Buffer.from('x'), {
      expectedHash: sha256Hex(Buffer.from('')),
      expectedId: NO_FILE,
      maxBytes: MAX
    })

    expect(result).toEqual({ ok: false, reason: 'gone' })
  })

  it.skipIf(!CASE_INSENSITIVE)('M-009 on a case-insensitive disk writes to the on-disk spelling', async () => {
    const file = await original('index.html', Buffer.from('old'))

    const result = await atomicWriteBytesStrict(join(dir, 'Index.html'), Buffer.from('new'), expecting(file))

    expect(result).toEqual({ ok: true, path: join(dir, 'index.html') })
    expect(await readdir(dir)).toEqual(['index.html'])
    expect(await readFile(join(dir, 'index.html'), 'utf8')).toBe('new')
  })
})

/** Windows' own `whoami`; Git for Windows puts a coreutils `whoami` without `/priv` first on PATH. */
const WHOAMI = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe')
const BYPASS_PRIVILEGES = ['SeBackupPrivilege', 'SeRestorePrivilege']

/**
 * Why a deny-write ACE on `path` cannot stop this process, or `undefined` when nothing explains it.
 *
 * libuv opens every file with `FILE_FLAG_BACKUP_SEMANTICS`, and Windows then skips the file's
 * access check for a process whose token has SeBackupPrivilege and SeRestorePrivilege enabled.
 * An elevated administrator holds both, disabled; the MSYS2 runtime (a Cygwin fork) behind Git for
 * Windows bash enables them at startup, and every child inherits them. That is the GitHub `Windows checks` job:
 * `npm run test:main` under `shell: bash`, as the elevated `runneradmin`. No ACL can deny such a
 * process a write, so the case cannot be staged there. A write-open that got past the deny for any
 * other reason returns `undefined`, and the test then fails as it should. Registered in
 * docs/windows/known-flakes.md, row `atomicWriteBytesStrict.test.ts`.
 */
async function aclBypassNote(path: string): Promise<string | undefined> {
  try {
    await (await open(path, 'r+')).close()
  } catch (error) {
    if (errnoOf(error) === 'EPERM' || errnoOf(error) === 'EACCES') return undefined
    throw error
  }
  const held = execFileSync(WHOAMI, ['/priv'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split(/\r?\n/)
    .filter(line => BYPASS_PRIVILEGES.some(name => line.includes(name)))
    .map(line => line.replace(/\s+/g, ' ').trim())
  if (!BYPASS_PRIVILEGES.every(name => held.some(line => line.includes(name)))) return undefined
  return `a write-open got past the deny ACE: this process overrides file ACLs (${held.join('; ')})`
}

describe.runIf(isWindows)('atomicWriteBytesStrict on Windows', () => {
  let made: string
  let dir: string
  const user = userInfo().username

  beforeEach(async () => {
    made = await mkdtemp(join(tmpdir(), 'erfana-strict-win-'))
    dir = await realpath(made)
  })

  afterEach(async () => {
    await rm(made, { recursive: true, force: true })
  })

  async function original(bytes: string): Promise<Original> {
    const path = join(dir, 'page.html')
    await writeFile(path, bytes)
    return { path, hash: sha256Hex(Buffer.from(bytes)), id: await idOf(path) }
  }

  it('M-007 refuses a file whose ACL denies writing, though its read-only attribute is clear', async ({ skip }) => {
    const file = await original('old')
    // Deny writing the data, not reading it: the read checks still pass, and a plain rename would replace it
    execFileSync('icacls', [file.path, '/deny', `${user}:(WD,AD)`], { stdio: 'pipe' })
    try {
      const bypass = await aclBypassNote(file.path)
      if (bypass !== undefined) {
        // The reporter shows a skip note only for a failed file; stderr always reaches the log
        console.warn(`M-007 deny-write ACL case skipped: ${bypass}`)
        skip(bypass)
      }
      const result = await atomicWriteBytesStrict(file.path, Buffer.from('new'), expecting(file))

      expect(result).toEqual({ ok: false, reason: 'read-only', errno: 'EPERM' })
      expect(await readFile(file.path, 'utf8')).toBe('old')
      expect(await readdir(dir)).toEqual(['page.html'])
    } finally {
      execFileSync('icacls', [file.path, '/remove:d', user], { stdio: 'pipe' })
    }
  })

  it('keeps the Zone.Identifier mark of the web across the rename', async () => {
    const file = await original('old')
    const mark = '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.com/\r\n'
    await writeFile(`${file.path}:Zone.Identifier`, mark)

    const result = await atomicWriteBytesStrict(file.path, Buffer.from('new'), expecting(file))

    expect(result.ok).toBe(true)
    expect(await readFile(file.path, 'utf8')).toBe('new')
    expect(await readFile(`${file.path}:Zone.Identifier`, 'utf8')).toBe(mark)
  })

  it('adds no mark to a file that had none', async () => {
    const file = await original('old')

    expect((await atomicWriteBytesStrict(file.path, Buffer.from('new'), expecting(file))).ok).toBe(true)

    await expect(readFile(`${file.path}:Zone.Identifier`)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('readFileNoFollow', () => {
  let made: string
  let dir: string

  beforeEach(async () => {
    made = await mkdtemp(join(tmpdir(), 'erfana-nofollow-'))
    dir = await realpath(made)
  })

  afterEach(async () => {
    await rm(made, { recursive: true, force: true })
  })

  it('reads a regular file exactly, also at exactly maxBytes, with the dev/ino it was read from', async () => {
    await writeFile(join(dir, 'a.html'), 'abcd')
    const id = await idOf(join(dir, 'a.html'))

    expect(await readFileNoFollow(join(dir, 'a.html'), 4)).toEqual({ ok: true, bytes: Buffer.from('abcd'), id })
    expect(await readFileNoFollow(join(dir, 'a.html'), MAX)).toEqual({ ok: true, bytes: Buffer.from('abcd'), id })
  })

  it('reads an empty file and a file larger than one read chunk', async () => {
    await writeFile(join(dir, 'empty.html'), '')
    const big = Buffer.alloc(200 * 1024, 0x61)
    await writeFile(join(dir, 'big.html'), big)

    expect(await readFileNoFollow(join(dir, 'empty.html'), MAX)).toMatchObject({ ok: true, bytes: Buffer.alloc(0) })
    const read = await readFileNoFollow(join(dir, 'big.html'), MAX)
    expect(read.ok && read.bytes.equals(big)).toBe(true)
  })

  it('reports a file over maxBytes as too-large from its size (a size that admits is never trusted: see the failure suite)', async () => {
    await writeFile(join(dir, 'a.html'), 'abcde')

    expect(await readFileNoFollow(join(dir, 'a.html'), 4)).toEqual({ ok: false, reason: 'too-large' })
  })

  it('refuses a symlink and a hard-linked file (link)', async () => {
    await writeFile(join(dir, 'real.html'), 'x')
    await symlink(join(dir, 'real.html'), join(dir, 'soft.html'), 'file')

    expect(await readFileNoFollow(join(dir, 'soft.html'), MAX)).toMatchObject({ ok: false, reason: 'link' })

    await link(join(dir, 'real.html'), join(dir, 'hard.html'))
    expect(await readFileNoFollow(join(dir, 'real.html'), MAX)).toEqual({ ok: false, reason: 'link' })
  })

  it('reports a missing file, a missing folder and a folder as gone', async () => {
    await mkdir(join(dir, 'folder.html'))

    expect(await readFileNoFollow(join(dir, 'nope.html'), MAX)).toMatchObject({ ok: false, reason: 'gone' })
    expect(await readFileNoFollow(join(dir, 'nope', 'a.html'), MAX)).toMatchObject({ ok: false, reason: 'gone' })
    expect(await readFileNoFollow(join(dir, 'folder.html'), MAX)).toMatchObject({ ok: false, reason: 'gone' })
  })
})

describe('fileIdKey', () => {
  it('spells dev and ino in full decimal, so ids past 2^53 stay apart', () => {
    const big = 2n ** 63n + 1n
    expect(fileIdKey({ dev: 7n, ino: big })).toBe(`7:${big.toString()}`)
    expect(fileIdKey({ dev: 7n, ino: big })).not.toBe(fileIdKey({ dev: 7n, ino: big + 1n }))
  })
})

describe('errnoOf', () => {
  it('reads a string errno code and nothing else', () => {
    expect(errnoOf(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT')
    expect(errnoOf(Object.assign(new Error('x'), { code: 42 }))).toBeUndefined()
    expect(errnoOf(new Error('x'))).toBeUndefined()
    expect(errnoOf(null)).toBeUndefined()
    expect(errnoOf('ENOENT')).toBeUndefined()
  })
})

describe('sha256Hex', () => {
  it('is lowercase hex SHA-256 of the bytes', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})
