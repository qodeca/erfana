// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The outside writers #478 follows a file through (plan § 5.3, C5): each one
 * changes a file on disk the way a real tool does.
 *
 * | Writer              | Like                                             |
 * |---------------------|--------------------------------------------------|
 * | `writeInPlace`      | an editor or `Add-Content` rewriting the file     |
 * | `writeTempRename`   | Claude Code and most agents (temp file + rename)  |
 * | `writeStream`       | a slow writer, several chunks into one open file  |
 * | `copyKeepingMtime`  | Explorer copy, `Copy-Item`, robocopy              |
 * | `gitCheckout`       | `git checkout -- <file>`                          |
 * | `startAppender`     | an agent appending a line every 50 ms             |
 * | `rebuildFolder`     | a generator's `rm -rf` and rebuild, `gapMs` apart  |
 * | `writeBurst`        | an agent rewriting one file every `everyMs`       |
 * | `writeHoldingLock`  | a writer or scanner holding the file (Windows)    |
 *
 * The pauses inside `writeStream`, `writeBurst` and `startAppender` pace the WRITER (they
 * are the scenario); they are never a test waiting for the app.
 */
import { appendFile, copyFile, mkdir, open, rename, rm, stat, utimes, writeFile } from 'fs/promises'
import { setTimeout as delay } from 'timers/promises'
import { dirname, join, basename } from 'path'
import { randomBytes } from 'crypto'
import { spawn } from 'child_process'
import { runGit } from './git-helpers'

/** Rewrites `filePath` in place (same inode). */
export async function writeInPlace(filePath: string, content: string | Buffer): Promise<void> {
  await writeFile(filePath, content)
}

/** Windows refuses a rename over a file another process has open for a moment (a reader, an antivirus scan). */
const RENAME_BUSY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_RETRY_MS = 20
const RENAME_GIVE_UP_MS = 2_000

/**
 * Writes a temp file next to `filePath`, then renames it over the target.
 * Like the atomic writers agents use (graceful-fs, write-file-atomic), a
 * rename Windows refuses because the target is open elsewhere – Erfana itself
 * reading the previous version – is tried again for up to 2 s.
 */
export async function writeTempRename(filePath: string, content: string | Buffer): Promise<void> {
  const temp = join(dirname(filePath), `.${basename(filePath)}.${randomBytes(4).toString('hex')}.tmp`)
  await writeFile(temp, content)
  const giveUpAt = Date.now() + RENAME_GIVE_UP_MS
  for (;;) {
    try {
      await rename(temp, filePath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (!RENAME_BUSY_CODES.has(code) || Date.now() >= giveUpAt) throw error
      await delay(RENAME_RETRY_MS)
    }
  }
}

/**
 * Writes `chunks` into one open handle of `filePath`, `gapMs` apart (truncates
 * first). Resolves the `Date.now()` after each chunk, so a test can tell a
 * writer that stalled (a pause longer than the app's settle time is a
 * documented limit, not a defect) from a tab that read too early.
 */
export async function writeStream(filePath: string, chunks: readonly (string | Buffer)[], gapMs: number): Promise<number[]> {
  const writtenAt: number[] = []
  const handle = await open(filePath, 'w')
  try {
    for (const [index, chunk] of chunks.entries()) {
      if (index > 0) await delay(gapMs)
      await handle.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      writtenAt.push(Date.now())
    }
  } finally {
    await handle.close()
  }
  return writtenAt
}

/** The longest pause between two consecutive times (ms); 0 for fewer than two. */
export function longestPause(times: readonly number[]): number {
  let longest = 0
  for (let i = 1; i < times.length; i++) longest = Math.max(longest, times[i] - times[i - 1])
  return longest
}

/** Removes `folder` with everything in it, then after `gapMs` creates it again with `files` (name → content). */
export async function rebuildFolder(folder: string, files: Record<string, string>, gapMs: number): Promise<void> {
  await rm(folder, { recursive: true, force: true })
  await delay(gapMs)
  await mkdir(folder, { recursive: true })
  for (const [name, content] of Object.entries(files)) await writeFile(join(folder, name), content)
}

/** Copies `source` over `target` and gives the target the source's times, as Explorer does. */
export async function copyKeepingMtime(source: string, target: string): Promise<void> {
  const times = await stat(source)
  await copyFile(source, target)
  await utimes(target, times.atime, times.mtime)
}

/** `git checkout -- <relPath>` in the repository at `repoDir`. */
export function gitCheckout(repoDir: string, relPath: string): void {
  runGit(repoDir, 'checkout', '--', relPath)
}

/** A running appender; `stop` ends it and resolves the lines it wrote. */
export interface Appender {
  stop(): Promise<string[]>
  /** Resolves the lines once the appender ends by itself. */
  readonly done: Promise<string[]>
}

/**
 * Appends one numbered line to `filePath` every `everyMs` until `forMs` has
 * passed or `stop` is called.
 */
export function startAppender(filePath: string, everyMs = 50, forMs = 3_000, prefix = 'line'): Appender {
  const lines: string[] = []
  let stopped = false
  const run = async (): Promise<string[]> => {
    const endAt = Date.now() + forMs
    while (!stopped && Date.now() < endAt) {
      const line = `${prefix} ${lines.length + 1}`
      await appendFile(filePath, `${line}\n`)
      lines.push(line)
      await delay(everyMs)
    }
    return lines
  }
  const done = run()
  return {
    done,
    stop: async () => {
      stopped = true
      return done
    }
  }
}

/**
 * Writes `count` versions of `filePath` with `write(filePath, contentFor(i))`,
 * one every `everyMs`, and resolves the `Date.now()` right after each write
 * returned (index = version).
 */
export async function writeBurst(
  filePath: string,
  count: number,
  everyMs: number,
  contentFor: (index: number) => string,
  write: (filePath: string, content: string) => Promise<void> = writeInPlace
): Promise<number[]> {
  const writtenAt: number[] = []
  const start = Date.now()
  for (let index = 0; index < count; index++) {
    // Paced against the start, so a slow write does not stretch the burst
    const wait = start + index * everyMs - Date.now()
    if (wait > 0) await delay(wait)
    await write(filePath, contentFor(index))
    writtenAt.push(Date.now())
  }
  return writtenAt
}

/** A locked write in progress; `released` resolves once the lock is gone. */
export interface LockedWrite {
  /** Resolves when the writer holds the file (the content is written, the lock still on). */
  readonly locked: Promise<void>
  /** Resolves when the writer released the file. */
  readonly released: Promise<void>
}

/**
 * Windows only: PowerShell opens `filePath` with no sharing (no one else may
 * read it), writes `content` through that handle, holds it `holdMs`, then
 * closes it – an antivirus scan or an editor holding the file during a change
 * (#478 L2). The content is passed through the environment, never the command
 * line.
 */
export function writeHoldingLock(filePath: string, content: string, holdMs: number): LockedWrite {
  const script = [
    "$f = [IO.File]::Open($env:LOCK_PATH, 'Open', 'ReadWrite', 'None')",
    '$b = [Text.Encoding]::UTF8.GetBytes($env:LOCK_TEXT)',
    '$f.SetLength(0); $f.Write($b, 0, $b.Length); $f.Flush()',
    "[Console]::Out.WriteLine('locked'); [Console]::Out.Flush()",
    'Start-Sleep -Milliseconds ([int]$env:LOCK_MS)',
    '$f.Close()'
  ].join('; ')
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, LOCK_PATH: filePath, LOCK_TEXT: content, LOCK_MS: String(holdMs) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (data: Buffer) => (stderr += data.toString()))
  const released = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`locked writer exited ${code}: ${stderr}`))))
  })
  const locked = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (data: Buffer) => {
      if (data.toString().includes('locked')) resolve()
    })
    released.then(() => reject(new Error('locked writer ended before it held the file')), reject)
  })
  return { locked, released }
}
