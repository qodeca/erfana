// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Erfana's unsigned list files in `profile/Erfana/` (spec 025, ADR 0009
 * decision 7): on Linux `basic_text` there is no OS-protected key, so the
 * address history is kept in a plain file there. Every other file kind, and
 * the history wherever a key exists, is signed (`site/signedProfileFile.ts`).
 *
 * A file is `{ version, entries }`. It is untrusted input like a signed one:
 * a file that is too large, does not parse or does not match its schema – a
 * signed file included – is ignored, logged (event only) and replaced by the
 * next write. Read without following a link, replaced by a rename of a fresh
 * exclusive temp file, so a link planted at the name is never written
 * through.
 */
import { randomUUID } from 'node:crypto'
import { rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { redactedLogError } from '../../../utils/redactUserInput'
import { logger } from '../../LoggingService'
import { createFileExclusive, readFileNoFollow } from '../browserProfileGuards'

/** The plain format's version; a signed file (version 2, with `hmac`) does not match it. */
const PLAIN_VERSION = 1

/** One plain list file: where it lives and what an entry is. */
export interface PlainListFile<T> {
  readonly canonical: string
  readonly segments: readonly string[]
  readonly entry: z.ZodType<T>
  readonly maxEntries: number
  readonly maxBytes: number
  /** For log lines only, e.g. "Browser history". */
  readonly label: string
}

/** The entries of `file`, or `[]` when it is missing, unreadable or malformed. Never rejects. */
export async function readPlainList<T>(file: PlainListFile<T>): Promise<T[]> {
  let text: string | null
  try {
    text = await readFileNoFollow(file.canonical, file.segments, file.maxBytes)
  } catch (error) {
    logger.warn(`${file.label}: file unreadable, starting empty`, { error: redactedLogError(error)?.message ?? String(error) })
    return []
  }
  if (text === null) return []
  const schema = z.object({ version: z.literal(PLAIN_VERSION), entries: z.array(file.entry).max(file.maxEntries) }).strict()
  try {
    const result = schema.safeParse(JSON.parse(text))
    if (result.success) return result.data.entries
  } catch {
    // Falls through to the malformed-file log below.
  }
  logger.warn(`${file.label}: file malformed, ignored`)
  return []
}

/** Replace `file` with `entries`. Never rejects: a failure is logged and the caller keeps its entries in memory. */
export async function writePlainList<T>(file: PlainListFile<T>, entries: readonly T[]): Promise<void> {
  const name = file.segments[file.segments.length - 1]
  const temp = [...file.segments.slice(0, -1), `${name}.${randomUUID()}.tmp`]
  const data = JSON.stringify({ version: PLAIN_VERSION, entries: entries.map((e) => file.entry.parse(e)) })
  try {
    await createFileExclusive(file.canonical, temp, data)
    try {
      await rename(join(file.canonical, ...temp), join(file.canonical, ...file.segments))
    } catch (error) {
      await unlink(join(file.canonical, ...temp)).catch(() => undefined)
      throw error
    }
  } catch (error) {
    logger.warn(`${file.label}: file not written, kept in memory`, { error: redactedLogError(error)?.message ?? String(error) })
  }
}
