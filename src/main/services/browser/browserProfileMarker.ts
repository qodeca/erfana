// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The profile marker (spec 025, ADR 0009 decision 3; spec change S-12; panel
 * finding S3).
 *
 * A browser profile in the project folder can arrive by `git clone`, a copied
 * folder or an archive, carrying a service worker, cache or local storage that
 * would run on the user's first visit. A profile is trusted only when Erfana
 * created it, for this canonical project path, on this account:
 *
 * - `profile/Erfana/marker.json` holds `{ version, projectPath, createdAt }`
 *   and an HMAC over it (purpose-bound, `utils/lockHmac.ts`);
 * - a copy of the same marker lives in
 *   `~/.erfana/browser-profiles/<sha-256 of the canonical path>.json`, which a
 *   repository cannot ship;
 * - both must parse, name this canonical path and be identical, and – when
 *   this run has a signing key – the signature must verify.
 *
 * Linux `basic_text` has no key (ADR 0009 decision 7): the marker is written
 * unsigned and trusted on the two-copies rule alone; a cloned profile still
 * lacks the home copy and is set aside.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteJSON } from '../../utils/atomicWrite'
import { createFileExclusive, readFileNoFollow } from './browserProfileGuards'
import {
  BROWSER_DIR_SEGMENTS,
  MARKER_FILE_NAME,
  PROFILE_DIR_NAME,
  PROFILE_ERFANA_DIR_NAME
} from './browserProfilePaths'

/** Signs and verifies with a purpose-bound key; `lockHmac`'s functions in production. */
export interface PurposeSigner {
  hasKey(): boolean
  sign(purpose: string, body: string): string | undefined
  verify(purpose: string, body: string, digest: string | undefined): 'valid' | 'missing' | 'invalid' | 'no-key'
}

export const MARKER_PURPOSE = 'browser-profile-marker'
const MARKER_VERSION = 1
/** A marker is a few hundred bytes; anything far larger is not ours. */
const MARKER_MAX_BYTES = 16 * 1024
/** Folder under `~/.erfana` holding the home copies. */
export const HOME_MARKER_DIR = 'browser-profiles'

const MarkerSchema = z
  .object({
    version: z.literal(MARKER_VERSION),
    projectPath: z.string().min(1),
    createdAt: z.string().min(1),
    hmac: z.string().regex(/^[0-9a-f]{64}$/).optional()
  })
  .strict()

export type ProfileMarker = z.infer<typeof MarkerSchema>

/** Why a profile is not trusted; logged, and drives the set-aside. */
export type MarkerVerdict =
  | { trusted: true }
  | {
      trusted: false
      reason: 'missing-marker' | 'missing-home-copy' | 'unreadable' | 'path-mismatch' | 'copies-differ' | 'bad-signature'
    }

export const MARKER_SEGMENTS: readonly string[] = Object.freeze([
  ...BROWSER_DIR_SEGMENTS,
  PROFILE_DIR_NAME,
  PROFILE_ERFANA_DIR_NAME,
  MARKER_FILE_NAME
])

/** The signed bytes: fixed field order, no `hmac`. */
function markerBody(marker: Omit<ProfileMarker, 'hmac'>): string {
  return JSON.stringify({ version: marker.version, projectPath: marker.projectPath, createdAt: marker.createdAt })
}

/** `~/.erfana/browser-profiles/<sha-256 hex of the canonical path>.json`. */
export function homeMarkerPath(homeDir: string, canonical: string): string {
  const hash = createHash('sha256').update(canonical, 'utf8').digest('hex')
  return join(homeDir, '.erfana', HOME_MARKER_DIR, `${hash}.json`)
}

function parseMarker(text: string | null): ProfileMarker | null | 'unreadable' {
  if (text === null) return null
  try {
    const parsed = MarkerSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : 'unreadable'
  } catch {
    return 'unreadable'
  }
}

async function readHomeCopy(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, 'utf8')
    return text.length > MARKER_MAX_BYTES ? '' : text
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Decide whether the existing profile of `canonical` is trusted.
 *
 * @throws BrowserProfileError when the marker's own folder levels are links
 *   or leave the project (the caller refuses the tab)
 */
export async function verifyProfileMarker(
  canonical: string,
  homeDir: string,
  signer: PurposeSigner
): Promise<MarkerVerdict> {
  const inProject = parseMarker(await readFileNoFollow(canonical, MARKER_SEGMENTS, MARKER_MAX_BYTES))
  if (inProject === null) return { trusted: false, reason: 'missing-marker' }
  const atHome = parseMarker(await readHomeCopy(homeMarkerPath(homeDir, canonical)))
  if (atHome === null) return { trusted: false, reason: 'missing-home-copy' }
  if (inProject === 'unreadable' || atHome === 'unreadable') return { trusted: false, reason: 'unreadable' }
  if (inProject.projectPath !== canonical || atHome.projectPath !== canonical) {
    return { trusted: false, reason: 'path-mismatch' }
  }
  if (markerBody(inProject) !== markerBody(atHome) || inProject.hmac !== atHome.hmac) {
    return { trusted: false, reason: 'copies-differ' }
  }
  if (signer.hasKey() && signer.verify(MARKER_PURPOSE, markerBody(inProject), inProject.hmac) !== 'valid') {
    return { trusted: false, reason: 'bad-signature' }
  }
  return { trusted: true }
}

/**
 * Write a new marker for a fresh profile: in the project (exclusive create,
 * never replacing), then the home copy (atomic).
 *
 * @throws BrowserProfileError when the in-project marker cannot be created;
 *   the file-system error when the home copy cannot be written
 */
export async function writeProfileMarker(
  canonical: string,
  homeDir: string,
  signer: PurposeSigner,
  createdAt: string
): Promise<ProfileMarker> {
  const body = { version: MARKER_VERSION, projectPath: canonical, createdAt } as const
  const hmac = signer.sign(MARKER_PURPOSE, markerBody(body))
  const marker: ProfileMarker = hmac === undefined ? { ...body } : { ...body, hmac }
  await createFileExclusive(canonical, MARKER_SEGMENTS, JSON.stringify(marker))
  const homePath = homeMarkerPath(homeDir, canonical)
  await mkdir(join(homeDir, '.erfana', HOME_MARKER_DIR), { recursive: true, mode: 0o700 })
  await atomicWriteJSON(homePath, marker)
  return marker
}
