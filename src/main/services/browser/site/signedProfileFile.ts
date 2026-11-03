// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Erfana's signed list files in `profile/Erfana/` – `trust.json` and
 * `credentials.json` (spec 025, ADR 0009 decisions 6 and 7).
 *
 * A file is `{ version, entries, hmac }`. The HMAC (purpose-bound,
 * `utils/lockHmac.ts`) covers the version, the **kind** (the purpose), the
 * project's canonical path and the entries, so a file copied in from another
 * project, or one of another kind renamed, does not verify.
 *
 * - **Untrusted input.** The project folder is writable by the agent and by a
 *   cloned repository: a file that is too large, does not parse, does not
 *   match its schema or whose signature does not verify is ignored – nothing
 *   in it is used – logged (event only, never content or path) and replaced
 *   by the next write.
 * - **Never through a link.** Read without following a link
 *   (`readFileNoFollow`), replaced by a rename of a fresh exclusive temp file,
 *   so a link planted at the name is replaced, never written through.
 *
 * Not covered yet: the generation counter of ADR 0009 decision 6 (a replayed
 * older signed file of the same project still verifies) – the same gap as
 * `permissions.json`.
 */
import { randomUUID } from 'node:crypto'
import { rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { logger } from '../../LoggingService'
import { createFileExclusive, readFileNoFollow } from '../browserProfileGuards'
import type { PurposeSigner } from '../browserProfileMarker'
import { BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME, PROFILE_ERFANA_DIR_NAME } from '../browserProfilePaths'

const FILE_VERSION = 1

/** `.erfana/browser/profile/Erfana/<name>` as segments below the project root. */
export function profileErfanaSegments(name: string): readonly string[] {
  return Object.freeze([...BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME, PROFILE_ERFANA_DIR_NAME, name])
}

/** One signed list file: where it lives, what signs it and what an entry is. */
export interface SignedListFile<T> {
  readonly canonical: string
  readonly segments: readonly string[]
  /** The HMAC purpose; also the file's kind in the signed body. */
  readonly purpose: string
  readonly signer: PurposeSigner
  readonly entry: z.ZodType<T>
  readonly maxEntries: number
  readonly maxBytes: number
  /** For log lines only, e.g. "Browser trust". */
  readonly label: string
}

/** The signed bytes: the entries as the schema outputs them, with the kind and the project. */
function signedBody<T>(file: SignedListFile<T>, entries: readonly T[]): string {
  return JSON.stringify({ version: FILE_VERSION, kind: file.purpose, project: file.canonical, entries })
}

/**
 * The verified entries of `file`, or `[]` when it is missing, unreadable or
 * untrusted. Never rejects.
 */
export async function readSignedList<T>(file: SignedListFile<T>): Promise<T[]> {
  let text: string | null
  try {
    text = await readFileNoFollow(file.canonical, file.segments, file.maxBytes)
  } catch (error) {
    logger.warn(`${file.label}: file unreadable, starting empty`, { error: String(error) })
    return []
  }
  if (text === null) return []
  const schema = z
    .object({
      version: z.literal(FILE_VERSION),
      entries: z.array(file.entry).max(file.maxEntries),
      hmac: z.string().regex(/^[0-9a-f]{64}$/).optional()
    })
    .strict()
  let parsed: { entries: T[]; hmac?: string }
  try {
    const result = schema.safeParse(JSON.parse(text))
    if (!result.success) throw new Error('shape')
    parsed = result.data
  } catch {
    logger.warn(`${file.label}: file malformed, ignored`)
    return []
  }
  const verdict = file.signer.verify(file.purpose, signedBody(file, parsed.entries), parsed.hmac)
  if (verdict !== 'valid') {
    logger.warn(`${file.label}: file not signed by this account, ignored`, { verdict })
    return []
  }
  return parsed.entries
}

/**
 * Replace `file` with `entries`, signed. Does nothing without a signing key.
 * Never rejects: a failure is logged and the caller keeps its entries in memory.
 */
export async function writeSignedList<T>(file: SignedListFile<T>, entries: readonly T[]): Promise<void> {
  // Re-parse so the signed key order is the one a read produces.
  const normalized = entries.map((e) => file.entry.parse(e))
  const hmac = file.signer.sign(file.purpose, signedBody(file, normalized))
  if (hmac === undefined) return
  try {
    await replaceFile(file.canonical, file.segments, JSON.stringify({ version: FILE_VERSION, entries: normalized, hmac }))
  } catch (error) {
    logger.warn(`${file.label}: file not written, kept in memory`, { error: String(error) })
  }
}

/** A fresh exclusive temp file renamed over `<canonical>/<segments>`. */
async function replaceFile(canonical: string, segments: readonly string[], data: string): Promise<void> {
  const name = segments[segments.length - 1]
  const temp = [...segments.slice(0, -1), `${name}.${randomUUID()}.tmp`]
  await createFileExclusive(canonical, temp, data)
  try {
    await rename(join(canonical, ...temp), join(canonical, ...segments))
  } catch (error) {
    await unlink(join(canonical, ...temp)).catch(() => undefined)
    throw error
  }
}

/**
 * Serialises writes so the last save wins, each one the whole current list.
 * `persist` resolves when this save is written; it never rejects.
 */
export class SerialWriter {
  private writing: Promise<void> = Promise.resolve()

  persist(write: () => Promise<void>): Promise<void> {
    this.writing = this.writing.then(write, write)
    return this.writing
  }
}
