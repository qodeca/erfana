// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pop-up exceptions of one project (spec 025, 025-FR-011 rule 3,
 * 025-FR-023; ADR 0009 decisions 6 and 7; spec change S-26).
 *
 * **Always allow for this site** on a "Pop-up blocked" row saves the site's
 * origin here; that site's later opens skip the popup blocker. The list is
 * cleared with the other site decisions by **Clear browsing data**
 * (**Site permissions, certificate exceptions and pop-up exceptions**) and
 * by **Forget**.
 *
 * - **Signed file** `profile/Erfana/popups.json` (`site/signedProfileFile.ts`,
 *   with the kind's generation): a file that does not verify, or an older
 *   signed copy put back, is ignored and replaced by the next save.
 * - **Memory only** when this run has no signing key (Linux `basic_text`,
 *   S-26): the file is neither read nor written; exceptions last until quit.
 * - At most {@link MAX_POPUP_EXCEPTIONS} sites are kept, the oldest go first.
 */
import { z } from 'zod'
import type { PurposeSigner } from '../browserProfileMarker'
import { profileGenerations } from '../profileGenerations'
import { profileErfanaSegments, readSignedList, SerialWriter, writeSignedList, type SignedListFile } from '../site/signedProfileFile'

export const POPUPS_FILE_NAME = 'popups.json'
export const POPUPS_PURPOSE = 'browser-popup-exceptions'
export const POPUPS_SEGMENTS = profileErfanaSegments(POPUPS_FILE_NAME)
export const MAX_POPUP_EXCEPTIONS = 500

const ExceptionSchema = z
  .object({
    /** The site's origin: scheme, host and port (`http://app.test:8080`). */
    origin: z.string().min(1).max(300)
  })
  .strict()
type PopupException = z.infer<typeof ExceptionSchema>

export class PopupExceptionStore {
  private readonly origins = new Set<string>()
  private readonly writer = new SerialWriter()

  private constructor(
    private readonly file: SignedListFile<PopupException>,
    /** Whether exceptions reach the file (`saved`) or last for this run (`session`). */
    readonly persistence: 'saved' | 'session'
  ) {}

  /**
   * The store of the project at `canonical`; `homeDir` holds its generation
   * record (ADR 0009 decision 6). Never rejects.
   */
  static async open(canonical: string, homeDir: string, signer: PurposeSigner): Promise<PopupExceptionStore> {
    const file: SignedListFile<PopupException> = {
      canonical,
      segments: POPUPS_SEGMENTS,
      purpose: POPUPS_PURPOSE,
      signer,
      generations: profileGenerations(homeDir, canonical),
      entry: ExceptionSchema,
      maxEntries: MAX_POPUP_EXCEPTIONS,
      maxBytes: 128 * 1024,
      label: 'Browser pop-up exceptions'
    }
    const store = new PopupExceptionStore(file, signer.hasKey() ? 'saved' : 'session')
    if (store.persistence === 'saved') {
      for (const entry of await readSignedList(file)) store.origins.add(entry.origin)
    }
    return store
  }

  /** Whether the site `origin` may open tabs and windows without the blocker. */
  allows(origin: string): boolean {
    return this.origins.has(origin)
  }

  /** **Always allow for this site**. Memory changes at once; resolves when written. */
  add(origin: string): Promise<void> {
    this.origins.delete(origin)
    this.origins.add(origin)
    while (this.origins.size > MAX_POPUP_EXCEPTIONS) {
      this.origins.delete(this.origins.values().next().value as string)
    }
    return this.persist()
  }

  /** Forget every exception (Clear browsing data, Forget – 025-FR-023). Never rejects. */
  clear(): Promise<void> {
    this.origins.clear()
    return this.persist()
  }

  size(): number {
    return this.origins.size
  }

  private persist(): Promise<void> {
    if (this.persistence === 'session') return Promise.resolve()
    return this.writer.persist(() => writeSignedList(this.file, [...this.origins].map((origin) => ({ origin }))))
  }
}
