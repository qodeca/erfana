// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Lenient Zod schema for the `files.exclude` section, shared by
 * `~/.erfana/settings.json` and `<project>/.erfana/settings.json`.
 *
 * The parse never fails: a non-array list becomes `[]`, a non-string entry
 * becomes `''` (kept, so a rejection index still points at the user's line),
 * and a malformed section falls back to `{ exclude: [] }`. A bad `files` block
 * therefore never trips the global file's corruption reset (which replaces
 * every setting and writes a backup) and never blocks a project from opening
 * (`ProjectSettingsService` throws on any other schema failure).
 *
 * Entry validation (normalisation, caps, rejected shapes) is not done here –
 * it lives with the matcher in the main process, and the merged result is
 * resolved by `ProjectSettingsService`.
 *
 * @see Issue #211 – design D7 (docs/designs/211-large-project-windows-watcher.md)
 */
import { z } from 'zod'

/**
 * The exclude list itself. Factory fallbacks (not a shared literal) so every
 * parse returns a fresh array that callers may safely mutate.
 */
export const ExcludeListSchema = z.array(z.string().catch('')).catch(() => [])
export type ExcludeList = z.infer<typeof ExcludeListSchema>

/**
 * The `files` section. Unknown keys are stripped; anything that is not an
 * object with a usable `exclude` list resolves to the empty default.
 */
export const FilesSettingsSchema = z
  .object({ exclude: ExcludeListSchema })
  .catch(() => ({ exclude: [] }))
export type FilesSettings = z.infer<typeof FilesSettingsSchema>

/** Which settings file an exclude entry came from. */
export type ExcludeSource = 'global' | 'project'

/**
 * One rejected exclude entry. Identified by its source file and its index in
 * that file's list – never by its value, so the record is safe to log.
 */
export interface ExcludeRejection {
  source: ExcludeSource
  /** Zero-based index into the source's `files.exclude` array. */
  index: number
  /** Fixed reason code from the entry validator (never the entry text). */
  reason: string
}
