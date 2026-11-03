// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Open a file of a served folder, confined to that folder by its real path
 * (spec 025, 025-FR-005 rule 1; ADR 0012 decision 8, option 4).
 *
 * The order is the HTML Preview's (`preview/previewPathResolve.ts`, design
 * § 2.4) without its build-folder rule – a local site may load
 * `node_modules/x.js` from its own folder – and with a streamed body instead
 * of a buffered one, so media of any size play:
 *
 * 1. real path of the parent: inside the folder, or the folder itself;
 * 2. `O_NOFOLLOW` open (a final-component link is refused on POSIX);
 * 3. a regular file only (no folder listings, no devices or pipes);
 * 4. the opened file is the one the name names (device and inode, as bigints);
 * 5. the full real path is strictly inside the folder's real path – the exact
 *    prefix compare of {@link realPathWithin}, never `path.relative`, which
 *    folds case on Windows – and no resolved segment is a refused name
 *    (dot-prefixed or `.asar`), so a link or a short name cannot reach one;
 * 6. the caller's own veto on the resolved path (Erfana's resources folder
 *    and renderer entry).
 *
 * A link or junction inside the folder that stays inside is followed; one
 * that leads out fails step 1 or step 5. The returned handle is open and the
 * caller owns it; every refusal closes it first.
 */
import { constants as fsConstants } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import { dirname, extname, join, sep } from 'node:path'
import { realPathWithin } from '../../preview/previewPathResolve'
import { isRefusedName } from './localRequestPath'

/** POSIX only; on Windows the inode compare and the real-path re-check close the hole. */
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)

export type ConfinedFile =
  | {
      readonly ok: true
      readonly handle: FileHandle
      readonly size: number
      /** Lower-case extension with its dot, for the content type. */
      readonly ext: string
      readonly realPath: string
    }
  | { readonly ok: false; readonly status: 403 | 404 }

/** Whether `realPath` is `realRoot` itself or strictly inside it. */
function atOrWithin(realRoot: string, realPath: string): boolean {
  return realPath === realRoot || realPathWithin(realRoot, realPath) !== undefined
}

/**
 * Open `segments` (already checked by `parseLocalRequestPath`) below
 * `realRoot`, which MUST be a `realpath` result.
 *
 * @param refusesTarget - a veto on the resolved path; true refuses with 403
 */
export async function openConfinedFile(
  realRoot: string,
  segments: readonly string[],
  refusesTarget: (realPath: string) => boolean
): Promise<ConfinedFile> {
  const candidate = join(realRoot, ...segments)
  try {
    if (!atOrWithin(realRoot, await realpath(dirname(candidate)))) return { ok: false, status: 403 }
  } catch {
    return { ok: false, status: 404 }
  }
  let handle: FileHandle
  try {
    handle = await open(candidate, OPEN_FLAGS)
  } catch {
    return { ok: false, status: 404 }
  }
  try {
    const verdict = await checkOpened(realRoot, candidate, handle, refusesTarget)
    if (!verdict.ok) await handle.close()
    return verdict
  } catch {
    await handle.close().catch(() => undefined)
    return { ok: false, status: 404 }
  }
}

async function checkOpened(
  realRoot: string,
  candidate: string,
  handle: FileHandle,
  refusesTarget: (realPath: string) => boolean
): Promise<ConfinedFile> {
  const opened = await handle.stat({ bigint: true })
  if (!opened.isFile()) return { ok: false, status: 404 }
  const named = await lstat(candidate, { bigint: true })
  if (named.dev !== opened.dev || named.ino !== opened.ino) return { ok: false, status: 403 }
  const realTarget = await realpath(candidate)
  const rel = realPathWithin(realRoot, realTarget)
  if (rel === undefined || rel.split(sep).some(isRefusedName) || refusesTarget(realTarget)) {
    return { ok: false, status: 403 }
  }
  return { ok: true, handle, size: Number(opened.size), ext: extname(realTarget).toLowerCase(), realPath: realTarget }
}
