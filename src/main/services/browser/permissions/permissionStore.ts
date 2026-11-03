// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Saved site-permission decisions of one project (spec 025, 025-FR-019;
 * ADR 0009 decisions 6 and 7; spec change S-26).
 *
 * A decision is **Allow** or **Block**, kept per pair of requesting origin and
 * top-level origin and per permission, so allowing a map inside one site does
 * not allow it inside another. Screen sharing is never saved.
 *
 * - **Signed file.** `profile/Erfana/permissions.json` holds the decisions and
 *   an HMAC over them (purpose-bound, `utils/lockHmac.ts`). The project
 *   folder is writable by the agent and by a cloned repository, so a file
 *   whose signature is missing or does not verify is ignored – nothing in it
 *   is trusted – and replaced by the next save.
 * - **Memory only** when this run has no signing key (Linux `basic_text`,
 *   ADR 0009 decision 7): the file is neither read nor written, and the
 *   decisions last until Erfana quits.
 * - **Never through a link.** The file is read without following a link and
 *   replaced by a rename of a fresh exclusive temp file. A link or folder at
 *   the name, or any read or write failure, is logged and the store keeps
 *   working in memory; the browser never stops over it.
 * - Writes are serialised, each one the whole current set, so the last save
 *   wins. At most {@link MAX_DECISIONS} are kept; the oldest go first.
 */
import { randomUUID } from 'node:crypto'
import { rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { SitePermission } from '../../../../shared/ipc/browser-tab-schema'
import { logger } from '../../LoggingService'
import { createFileExclusive, readFileNoFollow } from '../browserProfileGuards'
import type { PurposeSigner } from '../browserProfileMarker'
import { BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME, PROFILE_ERFANA_DIR_NAME } from '../browserProfilePaths'
import { NEVER_SAVED } from './sitePermissions'

export const PERMISSIONS_FILE_NAME = 'permissions.json'
export const PERMISSIONS_PURPOSE = 'browser-site-permissions'
export const PERMISSIONS_SEGMENTS: readonly string[] = Object.freeze([
  ...BROWSER_DIR_SEGMENTS,
  PROFILE_DIR_NAME,
  PROFILE_ERFANA_DIR_NAME,
  PERMISSIONS_FILE_NAME
])
/** The most decisions kept per project. */
export const MAX_DECISIONS = 2000
const MAX_FILE_BYTES = 1024 * 1024
const FILE_VERSION = 1
const MAX_ORIGIN_CHARS = 2048

export type SavedDecision = 'allow' | 'block'

const SavedPermissionSchema = z.enum(['camera', 'microphone', 'location', 'notifications', 'clipboardRead'])
const origin = z.string().min(1).max(MAX_ORIGIN_CHARS)
const EntrySchema = z
  .object({ requesting: origin, top: origin, permission: SavedPermissionSchema, decision: z.enum(['allow', 'block']) })
  .strict()
const FileSchema = z
  .object({
    version: z.literal(FILE_VERSION),
    decisions: z.array(EntrySchema).max(MAX_DECISIONS),
    hmac: z.string().regex(/^[0-9a-f]{64}$/).optional()
  })
  .strict()

type Entry = z.infer<typeof EntrySchema>

/** The signed bytes: fixed field order, no `hmac`. */
function signedBody(decisions: readonly Entry[]): string {
  return JSON.stringify({
    version: FILE_VERSION,
    decisions: decisions.map((d) => ({ requesting: d.requesting, top: d.top, permission: d.permission, decision: d.decision }))
  })
}

function keyOf(requesting: string, top: string, permission: SitePermission): string {
  return JSON.stringify([requesting, top, permission])
}

export class BrowserPermissionStore {
  private readonly decisions = new Map<string, Entry>()
  private writing: Promise<void> = Promise.resolve()

  private constructor(
    private readonly canonical: string,
    private readonly signer: PurposeSigner,
    /** Whether decisions reach the file (`saved`) or last for this run only (`session`). */
    readonly persistence: 'saved' | 'session'
  ) {}

  /**
   * The store of the project at `canonical`, with the decisions of its signed
   * file. Never rejects: an unreadable or untrusted file gives an empty store.
   */
  static async open(canonical: string, signer: PurposeSigner): Promise<BrowserPermissionStore> {
    const persistence = signer.hasKey() ? 'saved' : 'session'
    const store = new BrowserPermissionStore(canonical, signer, persistence)
    if (persistence === 'saved') await store.load()
    return store
  }

  /** The saved decision for `permission` asked by `requesting` inside `top`. */
  get(requesting: string, top: string, permission: SitePermission): SavedDecision | undefined {
    return this.decisions.get(keyOf(requesting, top, permission))?.decision
  }

  /**
   * Save `decision` for each of `permissions` (screen sharing is skipped).
   * Memory changes at once; the file follows. Resolves when written; never rejects.
   */
  set(requesting: string, top: string, permissions: readonly SitePermission[], decision: SavedDecision): Promise<void> {
    let changed = false
    for (const permission of permissions) {
      if (NEVER_SAVED.has(permission)) continue
      const parsed = SavedPermissionSchema.safeParse(permission)
      if (!parsed.success) continue
      const key = keyOf(requesting, top, permission)
      this.decisions.delete(key)
      this.decisions.set(key, { requesting, top, permission: parsed.data, decision })
      changed = true
    }
    if (!changed) return this.writing
    this.trim()
    return this.persist()
  }

  /** Forget every decision (Clear browsing data, 025-FR-023). Never rejects. */
  clear(): Promise<void> {
    this.decisions.clear()
    return this.persist()
  }

  /** How many decisions are kept. */
  size(): number {
    return this.decisions.size
  }

  private trim(): void {
    while (this.decisions.size > MAX_DECISIONS) {
      const oldest = this.decisions.keys().next().value as string
      this.decisions.delete(oldest)
    }
  }

  private async load(): Promise<void> {
    let text: string | null
    try {
      text = await readFileNoFollow(this.canonical, PERMISSIONS_SEGMENTS, MAX_FILE_BYTES)
    } catch (error) {
      logger.warn('Browser permissions: file unreadable, starting empty', { error: String(error) })
      return
    }
    if (text === null) return
    let parsed: z.infer<typeof FileSchema>
    try {
      const result = FileSchema.safeParse(JSON.parse(text))
      if (!result.success) throw new Error('shape')
      parsed = result.data
    } catch {
      logger.warn('Browser permissions: file malformed, ignored')
      return
    }
    const verdict = this.signer.verify(PERMISSIONS_PURPOSE, signedBody(parsed.decisions), parsed.hmac)
    if (verdict !== 'valid') {
      logger.warn('Browser permissions: file not signed by this account, ignored', { verdict })
      return
    }
    for (const entry of parsed.decisions) {
      this.decisions.set(keyOf(entry.requesting, entry.top, entry.permission), entry)
    }
  }

  private persist(): Promise<void> {
    if (this.persistence === 'session') return Promise.resolve()
    this.writing = this.writing.then(() => this.write())
    return this.writing
  }

  private async write(): Promise<void> {
    const decisions = [...this.decisions.values()]
    const body = signedBody(decisions)
    const hmac = this.signer.sign(PERMISSIONS_PURPOSE, body)
    if (hmac === undefined) return
    try {
      await replaceFile(this.canonical, PERMISSIONS_SEGMENTS, JSON.stringify({ version: FILE_VERSION, decisions, hmac }))
    } catch (error) {
      logger.warn('Browser permissions: file not written, kept in memory', { error: String(error) })
    }
  }
}

/**
 * Replace `<canonical>/<segments>` whole: a fresh exclusive temp file renamed
 * over it. A rename replaces a link planted at the name; it never writes
 * through one.
 */
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
