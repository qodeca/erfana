// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zoom levels of one project, per site (spec 025, 025-FR-008; ADR 0009
 * decisions 1, 6 and 7; spec change S-26).
 *
 * Zoom applies per site within the project, as in Chrome: the key is the
 * host name (no scheme, no port), and every local file shares one key. A
 * level of 100% is not stored.
 *
 * - **Signed file** `profile/Erfana/zoom.json` (`site/signedProfileFile.ts`)
 *   with the kind's generation, so a replayed older file is refused; a file
 *   that does not verify is ignored and replaced by the next save.
 * - **Memory only** when this run has no signing key (Linux `basic_text`,
 *   S-26): the file is neither read nor written; levels last until quit.
 * - At most {@link MAX_ZOOM_ENTRIES} sites are kept; the least recently set
 *   goes first.
 */
import { z } from 'zod'
import { ZOOM_DEFAULT_PERCENT, ZOOM_PERCENTS } from '../../../../shared/browser/zoomSteps'
import type { PurposeSigner } from '../browserProfileMarker'
import { profileGenerations } from '../profileGenerations'
import { profileErfanaSegments, readSignedList, SerialWriter, writeSignedList, type SignedListFile } from '../site/signedProfileFile'

export const ZOOM_FILE_NAME = 'zoom.json'
export const ZOOM_PURPOSE = 'browser-site-zoom'
export const ZOOM_SEGMENTS = profileErfanaSegments(ZOOM_FILE_NAME)
export const MAX_ZOOM_ENTRIES = 1000
/** The key every local file shares. */
export const LOCAL_FILE_ZOOM_KEY = 'file://'

const ZoomEntrySchema = z
  .object({
    site: z.string().min(1).max(255),
    percent: z.number().int().refine((p) => ZOOM_PERCENTS.includes(p), 'not a zoom step')
  })
  .strict()
type ZoomEntry = z.infer<typeof ZoomEntrySchema>

/**
 * The zoom key of the address the bar shows: the host name of an `http` or
 * `https` page, {@link LOCAL_FILE_ZOOM_KEY} for a local file, `null` for any
 * other (an empty tab, `about:blank`), which is zoomed but never stored.
 */
export function zoomKeyOf(url: string | null): string | null {
  if (url === null) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol === 'file:') return LOCAL_FILE_ZOOM_KEY
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.hostname === '' ? null : parsed.hostname.toLowerCase()
}

export class BrowserZoomStore {
  private readonly levels = new Map<string, number>()
  private readonly writer = new SerialWriter()

  private constructor(
    private readonly file: SignedListFile<ZoomEntry>,
    /** Whether levels reach the file (`saved`) or last for this run (`session`). */
    readonly persistence: 'saved' | 'session'
  ) {}

  /** The store of the project at `canonical`; `homeDir` holds its generation record. Never rejects. */
  static async open(canonical: string, homeDir: string, signer: PurposeSigner): Promise<BrowserZoomStore> {
    const file: SignedListFile<ZoomEntry> = {
      canonical,
      segments: ZOOM_SEGMENTS,
      purpose: ZOOM_PURPOSE,
      signer,
      generations: profileGenerations(homeDir, canonical),
      entry: ZoomEntrySchema,
      maxEntries: MAX_ZOOM_ENTRIES,
      maxBytes: 256 * 1024,
      label: 'Browser zoom'
    }
    const store = new BrowserZoomStore(file, signer.hasKey() ? 'saved' : 'session')
    if (store.persistence === 'saved') {
      for (const entry of await readSignedList(file)) {
        if (entry.percent !== ZOOM_DEFAULT_PERCENT) store.levels.set(entry.site, entry.percent)
      }
    }
    return store
  }

  /** The level of `site`, 100% when none is stored. */
  level(site: string): number {
    return this.levels.get(site) ?? ZOOM_DEFAULT_PERCENT
  }

  /** Set the level of `site`. Memory changes at once; resolves when written. Never rejects. */
  set(site: string, percent: number): Promise<void> {
    if (this.level(site) === percent) return Promise.resolve()
    this.levels.delete(site)
    if (percent !== ZOOM_DEFAULT_PERCENT) this.levels.set(site, percent)
    while (this.levels.size > MAX_ZOOM_ENTRIES) this.levels.delete(this.levels.keys().next().value as string)
    return this.persist()
  }

  /** Forget every level in memory without writing (Forget deletes the file itself). */
  forgetInMemory(): void {
    this.levels.clear()
  }

  private persist(): Promise<void> {
    if (this.persistence === 'session') return Promise.resolve()
    return this.writer.persist(() =>
      writeSignedList(this.file, [...this.levels].map(([site, percent]) => ({ site, percent })))
    )
  }
}
