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
 * - **Signed file.** `profile/Erfana/permissions.json`, read and written by
 *   `../site/signedProfileFile.ts`: an HMAC (purpose-bound,
 *   `utils/lockHmac.ts`) over the decisions, the project's canonical path
 *   and the generation recorded at home (ADR 0009 decision 6). The project
 *   folder is writable by the agent and by a cloned repository, so a file
 *   whose signature is missing or does not verify, that was signed for
 *   another project, or that is an older signed copy put back (a revoked
 *   Allow restored) is ignored – nothing in it is trusted – and replaced by
 *   the next save.
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
import { z } from 'zod'
import type { SitePermission } from '../../../../shared/ipc/browser-tab-schema'
import type { PurposeSigner } from '../browserProfileMarker'
import { profileGenerations } from '../profileGenerations'
import { profileErfanaSegments, readSignedList, writeSignedList, type SignedListFile } from '../site/signedProfileFile'
import { NEVER_SAVED } from './sitePermissions'

export const PERMISSIONS_FILE_NAME = 'permissions.json'
export const PERMISSIONS_PURPOSE = 'browser-site-permissions'
export const PERMISSIONS_SEGMENTS: readonly string[] = profileErfanaSegments(PERMISSIONS_FILE_NAME)
/** The most decisions kept per project. */
export const MAX_DECISIONS = 2000
const MAX_FILE_BYTES = 1024 * 1024
const MAX_ORIGIN_CHARS = 2048

export type SavedDecision = 'allow' | 'block'

const SavedPermissionSchema = z.enum(['camera', 'microphone', 'location', 'notifications', 'clipboardRead'])
const origin = z.string().min(1).max(MAX_ORIGIN_CHARS)
const EntrySchema = z
  .object({ requesting: origin, top: origin, permission: SavedPermissionSchema, decision: z.enum(['allow', 'block']) })
  .strict()

type Entry = z.infer<typeof EntrySchema>

function keyOf(requesting: string, top: string, permission: SitePermission): string {
  return JSON.stringify([requesting, top, permission])
}

export class BrowserPermissionStore {
  private readonly decisions = new Map<string, Entry>()
  private writing: Promise<void> = Promise.resolve()

  private constructor(
    private readonly file: SignedListFile<Entry>,
    /** Whether decisions reach the file (`saved`) or last for this run only (`session`). */
    readonly persistence: 'saved' | 'session'
  ) {}

  /**
   * The store of the project at `canonical`, with the decisions of its signed
   * file; `homeDir` holds the project's generation record (ADR 0009 decision
   * 6). Never rejects: an unreadable or untrusted file gives an empty store.
   */
  static async open(canonical: string, homeDir: string, signer: PurposeSigner): Promise<BrowserPermissionStore> {
    const file: SignedListFile<Entry> = {
      canonical,
      segments: PERMISSIONS_SEGMENTS,
      purpose: PERMISSIONS_PURPOSE,
      signer,
      generations: profileGenerations(homeDir, canonical),
      entry: EntrySchema,
      maxEntries: MAX_DECISIONS,
      maxBytes: MAX_FILE_BYTES,
      label: 'Browser permissions'
    }
    const store = new BrowserPermissionStore(file, signer.hasKey() ? 'saved' : 'session')
    if (store.persistence === 'saved') {
      for (const entry of await readSignedList(file)) {
        store.decisions.set(keyOf(entry.requesting, entry.top, entry.permission), entry)
      }
    }
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

  private persist(): Promise<void> {
    if (this.persistence === 'session') return Promise.resolve()
    this.writing = this.writing.then(() => writeSignedList(this.file, [...this.decisions.values()]))
    return this.writing
  }
}
