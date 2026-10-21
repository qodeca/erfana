// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ExternalSourceGrants - which files the user picked in the native dialog.
 *
 * Moving an external file into the project deletes the original. The main
 * process only does that for a file it saw the user choose: the picker records
 * each chosen path here, per window, and the move takes the record out before
 * it deletes anything. A record is used once and lapses after a few minutes.
 */
import nodePath, { type PlatformPath } from 'path'

/** How long a picked file stays movable (covers a conflict prompt in between) */
export const SOURCE_GRANT_TTL_MS = 10 * 60 * 1000

/** Most records kept for one window; the oldest go first */
export const MAX_GRANTS_PER_SENDER = 500

/** Key for a call that carries no window id */
const NO_SENDER = -1

export interface GrantDeps {
  now: () => number
  path: PlatformPath
  platform: NodeJS.Platform
}

const defaultDeps: GrantDeps = {
  now: () => Date.now(),
  path: nodePath,
  platform: process.platform
}

export class ExternalSourceGrants {
  // window id -> path key -> expiry time
  private readonly grants = new Map<number, Map<string, number>>()

  constructor(private readonly deps: GrantDeps = defaultDeps) {}

  private keyOf(sourcePath: string): string {
    const resolved = this.deps.path.resolve(sourcePath)
    // Windows and macOS volumes are case-insensitive by default
    return this.deps.platform === 'linux' ? resolved : resolved.toLowerCase()
  }

  /** Record the files the user just picked. */
  issue(senderId: number | null, sourcePaths: readonly string[]): void {
    const id = senderId ?? NO_SENDER
    let entries = this.grants.get(id)
    if (!entries) {
      entries = new Map()
      this.grants.set(id, entries)
    }
    const now = this.deps.now()
    for (const [key, expires] of entries) {
      if (expires <= now) entries.delete(key)
    }
    for (const sourcePath of sourcePaths) {
      const key = this.keyOf(sourcePath)
      entries.delete(key)
      entries.set(key, now + SOURCE_GRANT_TTL_MS)
    }
    while (entries.size > MAX_GRANTS_PER_SENDER) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  /**
   * Take the record for a file out. True only when this window picked the file
   * and the record has not lapsed; a second call for it answers false.
   */
  consume(senderId: number | null, sourcePath: string): boolean {
    const entries = this.grants.get(senderId ?? NO_SENDER)
    if (!entries) return false
    const key = this.keyOf(sourcePath)
    const expires = entries.get(key)
    if (expires === undefined) return false
    entries.delete(key)
    return expires > this.deps.now()
  }

  /** Forget every record. */
  clear(): void {
    this.grants.clear()
  }
}

/** The grants the app's handlers share. */
export const externalSourceGrants = new ExternalSourceGrants()
