// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The address history of one project (spec 025, 025-FR-063; ADR 0009
 * decisions 1, 6 and 7).
 *
 * The last {@link MAX_HISTORY_ENTRIES} addresses the project's tabs committed
 * – from the address bar, a history row or a link – most recent first; an
 * address loaded again moves to the front. Suggestions come from this list
 * only, never from a remote service (025-FR-002).
 *
 * - **What is kept**: `http`, `https` and local `file` addresses, as the bar
 *   shows them, with any user name and password removed – a sign-in typed
 *   into an address is never written to disk.
 * - **Signed file** `profile/Erfana/history.json` with the kind's generation
 *   wherever a signing key exists (`site/signedProfileFile.ts`); on Linux
 *   `basic_text`, a plain file (`plainProfileFile.ts`, ADR 0009 decision 7).
 * - **Clear browsing data** with **Cookies and other site data** empties it
 *   (025-FR-023).
 */
import { z } from 'zod'
import { BROWSER_URL_MAX_CHARS } from '../../../../shared/ipc/browser-tab-schema'
import type { PurposeSigner } from '../browserProfileMarker'
import { profileGenerations } from '../profileGenerations'
import { profileErfanaSegments, readSignedList, SerialWriter, writeSignedList, type SignedListFile } from '../site/signedProfileFile'
import { readPlainList, writePlainList, type PlainListFile } from './plainProfileFile'

export const HISTORY_FILE_NAME = 'history.json'
export const HISTORY_PURPOSE = 'browser-address-history'
export const HISTORY_SEGMENTS = profileErfanaSegments(HISTORY_FILE_NAME)
/** 025-FR-063: the last 100 addresses. */
export const MAX_HISTORY_ENTRIES = 100

const HistoryEntrySchema = z.object({ url: z.string().min(1).max(BROWSER_URL_MAX_CHARS) }).strict()
type HistoryEntry = z.infer<typeof HistoryEntrySchema>

const KEPT_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'file:'])

/**
 * The address to keep for a committed `url`, or `null` when it is not kept
 * (another scheme, unparsable, or longer than the bar's cap).
 */
export function historyAddressOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!KEPT_PROTOCOLS.has(parsed.protocol)) return null
  parsed.username = ''
  parsed.password = ''
  const kept = parsed.href
  return kept.length > BROWSER_URL_MAX_CHARS ? null : kept
}

/** The forms of an address that typed text is matched against: whole, without the scheme, without `www.`. */
function matchForms(url: string): string[] {
  const lower = url.toLowerCase()
  const bare = lower.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  return [lower, bare, bare.replace(/^www\./, '')]
}

/**
 * The addresses of `history` (most recent first) that start with what the
 * user typed, in any of {@link matchForms}; every address for empty input.
 */
export function suggestAddresses(history: readonly string[], typed: string, max: number): string[] {
  const prefix = typed.trim().toLowerCase()
  const matches = prefix === '' ? history : history.filter((url) => matchForms(url).some((form) => form.startsWith(prefix)))
  return matches.slice(0, Math.max(0, max))
}

type HistoryFile =
  | { readonly kind: 'signed'; readonly file: SignedListFile<HistoryEntry> }
  | { readonly kind: 'plain'; readonly file: PlainListFile<HistoryEntry> }

export class BrowserHistoryStore {
  /** Most recent first. */
  private urls: string[] = []
  private readonly writer = new SerialWriter()

  private constructor(private readonly file: HistoryFile) {}

  /** Whether the file is signed (a key exists) or plain (Linux `basic_text`). */
  get format(): HistoryFile['kind'] {
    return this.file.kind
  }

  /** The history of the project at `canonical`; `homeDir` holds its generation record. Never rejects. */
  static async open(canonical: string, homeDir: string, signer: PurposeSigner): Promise<BrowserHistoryStore> {
    const common = {
      canonical,
      segments: HISTORY_SEGMENTS,
      entry: HistoryEntrySchema,
      maxEntries: MAX_HISTORY_ENTRIES,
      maxBytes: 1024 * 1024,
      label: 'Browser history'
    }
    const file: HistoryFile = signer.hasKey()
      ? {
          kind: 'signed',
          file: { ...common, purpose: HISTORY_PURPOSE, signer, generations: profileGenerations(homeDir, canonical) }
        }
      : { kind: 'plain', file: common }
    const store = new BrowserHistoryStore(file)
    const entries = file.kind === 'signed' ? await readSignedList(file.file) : await readPlainList(file.file)
    store.urls = [...new Set(entries.map((e) => historyAddressOf(e.url)).filter((u): u is string => u !== null))].slice(
      0,
      MAX_HISTORY_ENTRIES
    )
    return store
  }

  /** Every kept address, most recent first. */
  list(): readonly string[] {
    return this.urls
  }

  /** Record a committed address; one not kept is ignored. Resolves when written. Never rejects. */
  record(url: string): Promise<void> {
    const kept = historyAddressOf(url)
    if (kept === null) return Promise.resolve()
    if (this.urls[0] === kept) return Promise.resolve()
    this.urls = [kept, ...this.urls.filter((u) => u !== kept)].slice(0, MAX_HISTORY_ENTRIES)
    return this.persist()
  }

  /** Empty the history (Clear browsing data). Resolves when written. Never rejects. */
  clear(): Promise<void> {
    this.urls = []
    return this.persist()
  }

  /** Forget the history in memory without writing (Forget deletes the file itself). */
  forgetInMemory(): void {
    this.urls = []
  }

  private persist(): Promise<void> {
    const entries = this.urls.map((url) => ({ url }))
    const file = this.file
    return this.writer.persist(() =>
      file.kind === 'signed' ? writeSignedList(file.file, entries) : writePlainList(file.file, entries)
    )
  }
}
