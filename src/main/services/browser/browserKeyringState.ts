// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Keyring state of a project's browser profile (spec 025, 025-FR-018;
 * ADR 0009 decisions 7 and 8; ADR 0010).
 *
 * With the `EnableCookieEncryption` fuse on, Chromium encrypts cookies with
 * the OS key store. Two things can go wrong, and the tab tells the user:
 *
 * - **Weak protection** – Linux with no keyring (`basic_text`): Chromium uses
 *   its built-in key. The first browser tab of the project after each start
 *   shows a notice until the user dismisses it; the dismissal is kept per
 *   project in `profile/Erfana/notices.json`.
 * - **Keyring changed** – the key that encrypted the stored cookies is gone
 *   (another keyring, a session without it). Chromium drops the cookies it
 *   cannot decrypt, so the tab says once "Logins were reset because the
 *   keyring changed". It is detected by:
 *   - the keyring canary `profile/Erfana/keyring-canary.bin` (other
 *     backends): a known text encrypted with `safeStorage`; when it no longer
 *     decrypts to that text, the key changed – the notice shows and a fresh
 *     canary is written, so it shows once;
 *   - on `basic_text`, where no canary is written, the backend name recorded
 *     in `notices.json`: a switch from a keyring backend to `basic_text`.
 *
 * Both files are Erfana's own, unsigned (ADR 0009 decision 7), read without
 * following a link, and replaced by a rename, never written through a link.
 * A link at either name refuses the tab (`BrowserProfileError`); any other
 * read or write failure is logged and the browser keeps working without the
 * notice.
 */
import { randomUUID } from 'node:crypto'
import { rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { logger } from '../LoggingService'
import { BrowserProfileError, createFileExclusive, readFileNoFollow } from './browserProfileGuards'
import { BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME, PROFILE_ERFANA_DIR_NAME } from './browserProfilePaths'

export const NOTICES_FILE_NAME = 'notices.json'
export const KEYRING_CANARY_FILE_NAME = 'keyring-canary.bin'
/** The text the canary must decrypt to. */
export const KEYRING_CANARY_TEXT = 'erfana-keyring-canary-v1'
/** Both files are a few hundred bytes; anything far larger is not ours. */
const MAX_BYTES = 16 * 1024
const NOTICES_VERSION = 1
/** The backend with no OS key (Linux without a keyring). */
export const WEAK_BACKEND = 'basic_text'

const ERFANA_SEGMENTS: readonly string[] = Object.freeze([
  ...BROWSER_DIR_SEGMENTS,
  PROFILE_DIR_NAME,
  PROFILE_ERFANA_DIR_NAME
])
export const NOTICES_SEGMENTS: readonly string[] = Object.freeze([...ERFANA_SEGMENTS, NOTICES_FILE_NAME])
export const CANARY_SEGMENTS: readonly string[] = Object.freeze([...ERFANA_SEGMENTS, KEYRING_CANARY_FILE_NAME])

const NoticesSchema = z
  .object({
    version: z.literal(NOTICES_VERSION),
    /** The storage backend of the last run that opened this profile. */
    backend: z.string().min(1).max(64).optional(),
    /** The weak-protection notice was dismissed for this project. */
    weakProtectionDismissed: z.boolean().optional()
  })
  .strict()

type Notices = z.infer<typeof NoticesSchema>

/** `safeStorage`'s string encryption, injected for tests. */
export interface KeyringCrypto {
  encryptString(text: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** What the project's first tab of this run shows (025-FR-018). */
export interface KeyringNotices {
  /** Linux `basic_text`, not yet dismissed: weak protection, no "Remember for this project". */
  readonly weakProtection: boolean
  /** "Logins were reset because the keyring changed", once. */
  readonly keyringReset: boolean
}

export const NO_KEYRING_NOTICES: KeyringNotices = Object.freeze({ weakProtection: false, keyringReset: false })

function parseNotices(text: string | null): Notices {
  if (text === null) return { version: NOTICES_VERSION }
  try {
    const parsed = NoticesSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : { version: NOTICES_VERSION }
  } catch {
    return { version: NOTICES_VERSION }
  }
}

/** A link or a folder at a name is hostile and refuses the tab; anything else is logged. */
function rethrowGuard(error: unknown): void {
  if (error instanceof BrowserProfileError && ['link', 'outside', 'wrong-type'].includes(error.code)) throw error
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

async function readNotices(canonical: string): Promise<Notices> {
  try {
    return parseNotices(await readFileNoFollow(canonical, NOTICES_SEGMENTS, MAX_BYTES))
  } catch (error) {
    rethrowGuard(error)
    logger.warn('Browser keyring: notices file unreadable', { error: String(error) })
    return { version: NOTICES_VERSION }
  }
}

async function writeNotices(canonical: string, notices: Notices): Promise<void> {
  try {
    await replaceFile(canonical, NOTICES_SEGMENTS, JSON.stringify(notices))
  } catch (error) {
    rethrowGuard(error)
    logger.warn('Browser keyring: notices file not written', { error: String(error) })
  }
}

/** Whether the canary still decrypts to its text; null when there is none (or it is unreadable as a file). */
async function canaryHolds(canonical: string, crypto: KeyringCrypto): Promise<boolean | null> {
  let text: string | null
  try {
    text = await readFileNoFollow(canonical, CANARY_SEGMENTS, MAX_BYTES)
  } catch (error) {
    rethrowGuard(error)
    logger.warn('Browser keyring: canary unreadable', { error: String(error) })
    return null
  }
  if (text === null) return null
  try {
    return crypto.decryptString(Buffer.from(text.trim(), 'base64')) === KEYRING_CANARY_TEXT
  } catch {
    return false
  }
}

async function writeCanary(canonical: string, crypto: KeyringCrypto): Promise<void> {
  try {
    await replaceFile(canonical, CANARY_SEGMENTS, crypto.encryptString(KEYRING_CANARY_TEXT).toString('base64'))
  } catch (error) {
    rethrowGuard(error)
    logger.warn('Browser keyring: canary not written', { error: String(error) })
  }
}

/**
 * Check the keyring at session creation (solution design § 3.3 step 5) and
 * record this run's backend. Call once per project per run, after the
 * profile tree exists.
 *
 * @throws BrowserProfileError when a link sits at `notices.json` or the canary
 */
export async function assessKeyring(
  canonical: string,
  backend: string,
  crypto: KeyringCrypto
): Promise<KeyringNotices> {
  const notices = await readNotices(canonical)
  let keyringReset: boolean
  if (backend === WEAK_BACKEND) {
    // No OS key: no canary is written (ADR 0009 decision 7)
    keyringReset = notices.backend !== undefined && notices.backend !== WEAK_BACKEND
  } else {
    const holds = await canaryHolds(canonical, crypto)
    keyringReset = holds === false
    if (holds !== true) await writeCanary(canonical, crypto)
  }
  if (notices.backend !== backend) await writeNotices(canonical, { ...notices, backend })
  const weakProtection = backend === WEAK_BACKEND && notices.weakProtectionDismissed !== true
  if (keyringReset) logger.warn('Browser keyring changed: stored logins were reset', { backend })
  return { weakProtection, keyringReset }
}

/**
 * The user dismissed the weak-protection notice: it does not show again for
 * this project.
 *
 * @throws BrowserProfileError when a link sits at `notices.json`
 */
export async function dismissWeakProtectionNotice(canonical: string): Promise<void> {
  const notices = await readNotices(canonical)
  if (notices.weakProtectionDismissed === true) return
  await writeNotices(canonical, { ...notices, weakProtectionDismissed: true })
}
