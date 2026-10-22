// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ExternalSourceGrants - which files the user picked in the native dialog.
 *
 * The picker records each chosen file, per window, with the identity of the
 * file on disk (device and inode) and the other files chosen with it. A later
 * move can then show that the file came from the dialog and name the whole pick
 * in one confirmation box. A record is not consent to delete anything: the move
 * still waits for the user's answer. A record is used once and lapses after a
 * few minutes, and it matches only the same path pointing at the same file.
 */
import nodePath, { type PlatformPath } from 'path'
import { lstat } from 'fs/promises'

/** How long a picked file stays recorded (covers a conflict prompt in between) */
export const SOURCE_GRANT_TTL_MS = 10 * 60 * 1000

/** Most records kept for one window; the oldest go first */
export const MAX_GRANTS_PER_SENDER = 500

/** Key for a call that carries no window id */
const NO_SENDER = -1

export interface GrantDeps {
  now: () => number
  path: PlatformPath
  /** `lstat` with bigint numbers; only `dev` and `ino` are read */
  lstat: (target: string) => Promise<{ dev: bigint; ino: bigint }>
}

const defaultDeps: GrantDeps = {
  now: () => Date.now(),
  path: nodePath,
  lstat: (target) => lstat(target, { bigint: true })
}

interface Grant {
  identity: string
  expires: number
  /** Every path picked in the same dialog, in order */
  batch: readonly string[]
}

export class ExternalSourceGrants {
  // window id -> exact path -> record
  private readonly grants = new Map<number, Map<string, Grant>>()

  constructor(private readonly deps: GrantDeps = defaultDeps) {}

  private async identityOf(sourcePath: string): Promise<string | null> {
    try {
      const { dev, ino } = await this.deps.lstat(sourcePath)
      return `${dev}:${ino}`
    } catch {
      return null
    }
  }

  /** Record the files the user just picked. */
  async issue(senderId: number | null, sourcePaths: readonly string[]): Promise<void> {
    const id = senderId ?? NO_SENDER
    const resolved = sourcePaths.map((p) => this.deps.path.resolve(p))
    const identities = await Promise.all(resolved.map((p) => this.identityOf(p)))

    let entries = this.grants.get(id)
    if (!entries) {
      entries = new Map()
      this.grants.set(id, entries)
    }
    const now = this.deps.now()
    for (const [key, grant] of entries) {
      if (grant.expires <= now) entries.delete(key)
    }
    resolved.forEach((key, index) => {
      const identity = identities[index]
      if (identity === null) return
      entries.delete(key)
      entries.set(key, { identity, expires: now + SOURCE_GRANT_TTL_MS, batch: resolved })
    })
    while (entries.size > MAX_GRANTS_PER_SENDER) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  /**
   * The pick this file came from, or null when this window did not pick it, the
   * record lapsed, or the path now points at a different file.
   */
  async batchOf(senderId: number | null, sourcePath: string): Promise<readonly string[] | null> {
    const key = this.deps.path.resolve(sourcePath)
    const grant = this.grants.get(senderId ?? NO_SENDER)?.get(key)
    if (!grant || grant.expires <= this.deps.now()) return null
    if ((await this.identityOf(key)) !== grant.identity) return null
    return grant.batch
  }

  /** Forget the record of one file, once its move was decided. */
  forget(senderId: number | null, sourcePath: string): void {
    this.grants.get(senderId ?? NO_SENDER)?.delete(this.deps.path.resolve(sourcePath))
  }

  /** Forget every record. */
  clear(): void {
    this.grants.clear()
  }
}

/** The grants the app's handlers share. */
export const externalSourceGrants = new ExternalSourceGrants()
