// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * An in-memory disk for the freshness core tests: text files with stamps that
 * behave like main's (`ctime` moves on every write, `mtime` can be kept as a
 * copy tool does, a touch changes times only), scripted read failures, busy
 * reads, content refusals, and a change feed the fake source turns into watch
 * events.
 */
import type { Clock } from '../../clock'
import type { ContentUnavailableReason, FileStamp, ProbeReply, TextReadReply } from '../freshnessTypes'
import type { SettleProbe } from '../settleRead'

interface FakeFile {
  content: string
  mtimeMs: number
  ctimeMs: number
  ino: number
}

export type DiskChange = 'changed' | 'deleted'
export type DiskListener = (path: string, change: DiskChange) => void

/** FNV-1a over the text: a stand-in for SHA-256 (the core only compares hashes). */
export function fakeHash(content: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(16).padStart(8, '0')}:${content.length}`
}

export class FakeDisk {
  private readonly files = new Map<string, FakeFile>()
  private readonly listeners = new Set<DiskListener>()
  private nextIno = 1
  /** Bumps ctime within one clock instant, as the real clock would between writes. */
  private tick = 0
  private readonly failReads = new Map<string, number>()
  private readonly busyReads = new Map<string, number>()
  private readonly blocked = new Map<string, Exclude<ContentUnavailableReason, 'unreadable'>>()
  /** Text reads made, per path. */
  readonly reads = new Map<string, number>()

  constructor(private readonly clock: Clock) {}

  private now(): number {
    this.tick += 0.001
    return this.clock.now() + this.tick
  }

  private notify(path: string, change: DiskChange): void {
    for (const listener of [...this.listeners]) listener(path, change)
  }

  onChange(listener: DiskListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Write a file (create or replace in place). `keepMtime` = a copy tool that puts the old mtime back. */
  write(path: string, content: string, options: { keepMtime?: boolean; silent?: boolean } = {}): void {
    const existing = this.files.get(path)
    const now = this.now()
    this.files.set(path, {
      content,
      mtimeMs: options.keepMtime && existing ? existing.mtimeMs : now,
      ctimeMs: now,
      ino: existing?.ino ?? this.nextIno++,
    })
    if (!options.silent) this.notify(path, 'changed')
  }

  /** Append to a file (a streaming writer). */
  append(path: string, chunk: string, options: { silent?: boolean } = {}): void {
    this.write(path, (this.files.get(path)?.content ?? '') + chunk, options)
  }

  /** New times, same bytes. */
  touch(path: string): void {
    const file = this.files.get(path)
    if (!file) throw new Error(`fakeDisk: no file ${path}`)
    const now = this.now()
    file.mtimeMs = now
    file.ctimeMs = now
    this.notify(path, 'changed')
  }

  remove(path: string, options: { silent?: boolean } = {}): void {
    this.files.delete(path)
    if (!options.silent) this.notify(path, 'deleted')
  }

  exists(path: string): boolean {
    return this.files.has(path)
  }

  content(path: string): string | undefined {
    return this.files.get(path)?.content
  }

  /** The next `count` text reads of `path` fail (a lock). */
  failNextReads(path: string, count: number): void {
    this.failReads.set(path, count)
  }

  /** The next `count` text reads of `path` answer `busy` (the file moved mid-read). */
  busyNextReads(path: string, count: number): void {
    this.busyReads.set(path, count)
  }

  /** Text reads of `path` are refused with `reason` until cleared (`undefined`). */
  block(path: string, reason: Exclude<ContentUnavailableReason, 'unreadable'> | undefined): void {
    if (reason === undefined) this.blocked.delete(path)
    else this.blocked.set(path, reason)
  }

  stamp(path: string): FileStamp | undefined {
    const file = this.files.get(path)
    if (!file) return undefined
    return {
      size: file.content.length,
      mtimeMs: file.mtimeMs,
      ctimeMs: file.ctimeMs,
      ino: String(file.ino),
      hash: fakeHash(file.content),
    }
  }

  async probe(path: string, knownHash?: string): Promise<ProbeReply> {
    const stamp = this.stamp(path)
    if (!stamp) return { status: 'missing' }
    return { status: knownHash !== undefined && stamp.hash === knownHash ? 'same' : 'changed', stamp }
  }

  async settleProbe(path: string): Promise<SettleProbe> {
    const file = this.files.get(path)
    return file ? { status: 'present', size: file.content.length, mtimeMs: file.mtimeMs } : { status: 'missing' }
  }

  private takeScripted(map: Map<string, number>, path: string): boolean {
    const left = map.get(path) ?? 0
    if (left <= 0) return false
    map.set(path, left - 1)
    return true
  }

  async readText(path: string): Promise<TextReadReply> {
    this.reads.set(path, (this.reads.get(path) ?? 0) + 1)
    const file = this.files.get(path)
    if (!file) return { status: 'missing' }
    if (this.takeScripted(this.failReads, path)) return { status: 'unreadable' }
    if (this.takeScripted(this.busyReads, path)) return { status: 'busy' }
    const blocked = this.blocked.get(path)
    if (blocked === 'too-large') return { status: 'too-large', size: file.content.length }
    if (blocked) return { status: blocked }
    const stamp = this.stamp(path) as FileStamp
    return { status: 'ok', text: file.content, stamp, eol: file.content.includes('\r\n') ? 'crlf' : 'lf' }
  }
}
