// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Generation counters of a project's signed profile files (spec 025, ADR 0009
 * decision 6).
 *
 * A signed file in `profile/Erfana/` carries the generation it was written
 * with, inside its HMAC. The current generation per kind lives at home, in
 * `~/.erfana/browser-profiles/<sha-256 of the canonical path>.generations.json`
 * (next to the marker's home copy), which neither the agent's project scripts
 * nor a cloned repository reach through the project folder. A file whose
 * generation is not the current one – an older signed copy put back – is
 * refused by its reader, so a revoked decision cannot be restored by replay.
 *
 * - **Fail closed.** A missing or malformed home record reads as empty: every
 *   existing signed file of the project is then refused, and the next write
 *   starts the kind again at 1.
 * - **Epoch.** Each record carries a random epoch, made when the record is
 *   (re)created and signed into every file with the generation. Deleting the
 *   record restarts the counters at 1, but under a new epoch, so an old
 *   generation-1 file put back still does not verify (security review S3).
 * - **Serialised per record.** Every read and write of one home file runs in
 *   order, across all the stores of the project, so {@link
 *   ProfileGenerations.next} is monotonic under concurrent writes.
 * - **Bump before write.** A writer takes `next(kind)` before it replaces the
 *   project file; if that replace then fails, the old file is refused too,
 *   and the store keeps working from memory until its next write.
 * - Never logs a path.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { atomicWriteJSON } from '../../utils/atomicWrite'
import { redactedLogError } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'
import { homeMarkerPath } from './browserProfileMarker'

const RECORD_VERSION = 1
/** A record holds a few counters; anything far larger is not ours. */
const RECORD_MAX_BYTES = 16 * 1024
/** A kind is a signing purpose such as `browser-certificate-trust`. */
const KIND_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const MARKER_SUFFIX = '.json'
const GENERATIONS_SUFFIX = '.generations.json'

const EPOCH_PATTERN = /^[0-9a-f]{32}$/

const RecordSchema = z
  .object({
    version: z.literal(RECORD_VERSION),
    project: z.string().min(1),
    epoch: z.string().regex(EPOCH_PATTERN),
    generations: z.record(z.string().regex(KIND_PATTERN), z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
  })
  .strict()

type Generations = Record<string, number>

/** A readable record's contents; a missing or malformed record has no epoch. */
interface RecordState {
  readonly epoch: string | null
  readonly generations: Generations
}

/** The current generation of each signed file kind of one project. */
export interface ProfileGenerations {
  /** The current generation of `kind`, or `undefined` when none is recorded (or the record is unreadable). Never rejects. */
  current(kind: string): Promise<number | undefined>
  /**
   * Increment the generation of `kind` and persist it at home before
   * resolving with the new value.
   *
   * @throws TypeError when `kind` is not a signing purpose name
   * @throws the file-system error when the home record cannot be read (other
   *   than missing) or written
   */
  next(kind: string): Promise<number>
  /**
   * The record's epoch, signed into every file with its generation; `undefined`
   * before the first write (or when the record is unreadable). Never rejects.
   */
  epoch(): Promise<string | undefined>
}

/** `~/.erfana/browser-profiles/<sha-256 hex of the canonical path>.generations.json`. */
export function homeGenerationsPath(homeDir: string, canonical: string): string {
  const marker = homeMarkerPath(homeDir, canonical)
  return `${marker.slice(0, -MARKER_SUFFIX.length)}${GENERATIONS_SUFFIX}`
}

/** Tails of the pending operations, per home record path. */
const queues = new Map<string, Promise<void>>()

/** Run `task` after every earlier task on `path`, whether they failed or not. */
function serialised<T>(path: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(path) ?? Promise.resolve()).then(task)
  const tail = run.then(
    () => undefined,
    () => undefined
  )
  queues.set(path, tail)
  void tail.then(() => {
    if (queues.get(path) === tail) queues.delete(path)
  })
  return run
}

/** The generations of `canonical` at home `homeDir`. */
export function profileGenerations(homeDir: string, canonical: string): ProfileGenerations {
  const path = homeGenerationsPath(homeDir, canonical)
  return {
    current: (kind) =>
      serialised(path, async () => {
        try {
          return (await readRecord(path, canonical)).generations[kind]
        } catch (error) {
          logger.warn('Browser profile generations: home record unreadable, no generation', {
            error: redactedLogError(error)?.message ?? String(error)
          })
          return undefined
        }
      }),
    next: (kind) => {
      if (!KIND_PATTERN.test(kind)) return Promise.reject(new TypeError('Not a profile file kind'))
      return serialised(path, async () => {
        const { epoch, generations } = await readRecord(path, canonical)
        const generation = (generations[kind] ?? 0) + 1
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        await atomicWriteJSON(path, {
          version: RECORD_VERSION,
          project: canonical,
          // A new record gets a new epoch: files signed under the last one never verify again.
          epoch: epoch ?? randomBytes(16).toString('hex'),
          generations: { ...generations, [kind]: generation }
        })
        return generation
      })
    },
    epoch: () =>
      serialised(path, async () => {
        try {
          return (await readRecord(path, canonical)).epoch ?? undefined
        } catch {
          // `current` logs an unreadable record; the reader asks it too.
          return undefined
        }
      })
  }
}

/**
 * The recorded epoch and generations; no epoch and `{}` when the record is
 * missing, malformed, too large or names another project.
 *
 * @throws the file-system error of any other failed read
 */
async function readRecord(path: string, canonical: string): Promise<RecordState> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { epoch: null, generations: {} }
    throw error
  }
  const record = parseRecord(text)
  if (record === null || record.project !== canonical) {
    logger.warn('Browser profile generations: home record malformed, treated as empty')
    return { epoch: null, generations: {} }
  }
  return { epoch: record.epoch, generations: record.generations }
}

function parseRecord(text: string): z.infer<typeof RecordSchema> | null {
  if (text.length > RECORD_MAX_BYTES) return null
  try {
    const parsed = RecordSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
