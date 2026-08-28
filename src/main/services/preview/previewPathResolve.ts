// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview path confinement (Issue #74, work item 11) — the security core of the
 * `erfana-preview://` protocol.
 *
 * Implements design §2.4's request→response confinement EXACTLY:
 *   realpath the parent → build the parent-based relative path → escape check →
 *   exclusion check → `O_NOFOLLOW` open → stat isFile → lstat dev/ino compare →
 *   step 8h re-resolve + re-run the exclusion rules against the FULLY RESOLVED
 *   path → bounded `readExactly` (413 on overflow; the file size is NEVER
 *   trusted). Every path from the open onward runs inside `try/finally` so a
 *   404, 413, escape or any throw still closes the descriptor.
 *
 * `resolveConfined` returns a `Buffer`, not a handle, so no failure branch can
 * leak a file descriptor (a real concern under #146–#151).
 *
 * NOTE on realpath semantics: this module uses `fsPromises.realpath`, NOT
 * `fs.realpath.native`. `fs/promises.realpath` already has native semantics
 * (`@types/node` fs/promises.d.ts documents it as "using the same semantics as
 * `fs.realpath.native()`"), so it canonicalises Windows 8.3 short names. Do NOT
 * "fix" this to `.native` — it is already correct, and the residual short-name
 * bypass lives in the UNRESOLVED basename at step 8b, which step 8h closes.
 */

import { constants as fsConstants } from 'node:fs'
import { open, realpath, lstat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'
import { PREVIEW } from '../../../shared/constants'
import type { PreviewFailureType } from '../../../shared/ipc/preview-types'
import { hasDotSegment, hasShortNameAlias, isInExcludedDirectory } from './previewExclusion'

/**
 * Result of confining a candidate path to the project root (§2.4). Main-only:
 * it lives here (the producer), not in the renderer-shared `preview-types`, so a
 * Node `Buffer` and the confinement internals never enter the renderer's type
 * graph.
 */
export type ConfineVerdict =
  | { ok: true; realTarget: string; rel: string }
  | { ok: false; reason: 'escape' | 'excluded' | 'missing' }

/** Result of resolving an `erfana-preview://` request to a served body (§2.4). */
export type PreviewResolveResult =
  | { ok: true; body: Buffer; ext: string }
  | { ok: false; status: 400 | 403 | 404 | 413 | 500; reason: PreviewFailureType }

/**
 * `O_NOFOLLOW` refuses to open a final-component symlink (ELOOP). It is a POSIX
 * flag; on Windows `fs.constants.O_NOFOLLOW` is `undefined`, so fall back to `0`
 * (no-op) there — Windows protection then rests on the dev/ino compare and the
 * step 8h full re-resolve, which are platform-independent.
 */
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const OPEN_FLAGS = fsConstants.O_RDONLY | O_NOFOLLOW

/** Chunk size for the bounded read; keeps peak memory flat regardless of cap. */
const READ_CHUNK_BYTES = 64 * 1024

/**
 * True unless the segment is empty, `.`, `..`, or contains a NUL, `/` or `\`;
 * on win32 also rejects an 8.3 short-name alias (`/~[0-9]/`, NEW-1 layer 1).
 *
 * `platform` is threaded through to `hasShortNameAlias` so the win32 branch is
 * testable on any host.
 */
export function isSafeSegment(
  segment: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (segment === '' || segment === '.' || segment === '..') {
    return false
  }
  if (segment.includes('\0') || segment.includes('/') || segment.includes('\\')) {
    return false
  }
  if (hasShortNameAlias(segment, platform)) {
    return false
  }
  return true
}

/**
 * Realpath-confine a candidate absolute path to `realRoot` (design §2.4
 * steps 8a–8d + 8h, without opening a handle). Used by the watch coordinator to
 * drop out-of-root candidates before acquiring a watch, and as the shared
 * containment rule reused elsewhere.
 *
 * `realRoot` MUST already be the `fsPromises.realpath` of the project root.
 * Returns the fully-resolved target and its root-relative path on success.
 */
export async function confinePath(
  realRoot: string,
  candidate: string,
  options: { allowBuildDirs?: boolean } = {}
): Promise<ConfineVerdict> {
  // `allowBuildDirs` keeps every ESCAPE rule AND the dot-segment rule, and skips
  // ONLY the build-directory rule. It exists for link routing (sd-074b §3.2): a
  // link to `node_modules/x/demo.html` must not be SERVED to the page, but
  // clicking it should still open the file as source in the editor — which needs
  // the fully-resolved path, and must still refuse anything outside the root.
  //
  // It deliberately does NOT relax `hasDotSegment`. That predicate is what keeps
  // `.env`, `.git/`, `.erfana/` and friends unreachable, and it guards a
  // DIFFERENT threat from the build-directory rule: the build-directory rule is
  // about what is worth previewing, the dot-segment rule is about secrets. An
  // earlier revision gated both on one flag, which let an untrusted page open
  // `.env` in the editor by clicking a link (lens review F2).
  const { allowBuildDirs = false } = options
  // 8a: resolve the parent (native semantics). A missing parent is a 404-class
  // "missing", never an escape.
  let parentReal: string
  try {
    parentReal = await realpath(dirname(candidate))
  } catch {
    return { ok: false, reason: 'missing' }
  }

  // 8b–8c: parent-based relative path + escape check. The basename is left
  // UNRESOLVED here deliberately (the short-name bypass lives in it), so the
  // full re-resolve below is what actually closes the hole.
  const parentRel = relative(realRoot, join(parentReal, basename(candidate)))
  if (parentRel === '' || parentRel.startsWith('..') || isAbsolute(parentRel)) {
    return { ok: false, reason: 'escape' }
  }
  // 8d: exclusion against the parent-based path. The dot-segment rule is
  // unconditional; only the build-directory rule answers to the flag.
  if (hasDotSegment(parentRel) || (!allowBuildDirs && isInExcludedDirectory(parentRel))) {
    return { ok: false, reason: 'excluded' }
  }

  // 8h: re-resolve the FULL path and re-run every rule against the resolved
  // relative path — closes the Windows 8.3 short-name and symlinked-name
  // bypasses that survive the parent-only check above.
  let realTarget: string
  try {
    realTarget = await realpath(candidate)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  const rel = relative(realRoot, realTarget)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, reason: 'escape' }
  }
  if (hasDotSegment(rel) || (!allowBuildDirs && isInExcludedDirectory(rel))) {
    return { ok: false, reason: 'excluded' }
  }

  return { ok: true, realTarget, rel }
}

/**
 * Read at most `maxBytes` from `handle`, reporting overflow WITHOUT trusting the
 * file size (design §2.4 step 9, NEW-11). Reads up to one byte past the cap: if
 * anything remains beyond `maxBytes`, the caller returns 413. Peak memory is
 * bounded by the accumulated bytes (never more than `maxBytes + 1`).
 */
async function readExactly(
  handle: FileHandle,
  maxBytes: number
): Promise<{ overflow: true } | { overflow: false; buffer: Buffer }> {
  const chunks: Buffer[] = []
  let total = 0
  let position = 0

  // Read until EOF or until we have proven more than `maxBytes` exists. Each
  // chunk is read into its OWN buffer (not a reused scratch), so the bytes are
  // kept without a per-chunk copy; only the final `concat` copies, halving the
  // memory traffic on a large served asset.
  while (total <= maxBytes) {
    const toRead = Math.min(READ_CHUNK_BYTES, maxBytes + 1 - total)
    if (toRead <= 0) {
      break
    }
    const buffer = Buffer.allocUnsafe(toRead)
    const { bytesRead } = await handle.read(buffer, 0, toRead, position)
    if (bytesRead === 0) {
      break
    }
    position += bytesRead
    total += bytesRead
    chunks.push(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead))
  }

  if (total > maxBytes) {
    return { overflow: true }
  }
  // Avoid even the concat copy when the whole asset fit in one chunk.
  return { overflow: false, buffer: chunks.length === 1 ? chunks[0] : Buffer.concat(chunks) }
}

/**
 * Resolve already-decoded URL path segments to a served body, confined to
 * `realRoot`, implementing design §2.4 steps 6–9 exactly.
 *
 * `realRoot` MUST already be the `fsPromises.realpath` of the project root.
 * Returns a `Buffer` (never a handle); the descriptor is closed on every path.
 */
export async function resolveConfined(
  realRoot: string,
  segments: readonly string[]
): Promise<PreviewResolveResult> {
  // Step 6: every segment must be safe.
  for (const segment of segments) {
    if (!isSafeSegment(segment)) {
      return { ok: false, status: 400, reason: 'path-escape' }
    }
  }

  // Step 7: build the candidate path under the root.
  const candidate = join(realRoot, ...segments)

  // Step 8a: resolve the parent (native semantics via fs/promises).
  let parentReal: string
  try {
    parentReal = await realpath(dirname(candidate))
  } catch {
    return { ok: false, status: 404, reason: 'missing-local-file' }
  }

  // Step 8b–8c: parent-based relative path + escape check.
  const parentRel = relative(realRoot, join(parentReal, basename(candidate)))
  if (parentRel === '' || parentRel.startsWith('..') || isAbsolute(parentRel)) {
    return { ok: false, status: 403, reason: 'path-escape' }
  }
  // Step 8d: exclusion against the parent-based path.
  if (isInExcludedDirectory(parentRel) || hasDotSegment(parentRel)) {
    return { ok: false, status: 403, reason: 'excluded-path' }
  }

  // Steps 8e–9 hold an open descriptor: everything below runs inside
  // try/finally so 404, 413, escape and any throw still close it.
  let handle: FileHandle | undefined
  try {
    // Step 8e: O_NOFOLLOW open. ELOOP (final component is a symlink), ENOENT or
    // any other open failure ⇒ 404.
    try {
      handle = await open(candidate, OPEN_FLAGS)
    } catch {
      return { ok: false, status: 404, reason: 'missing-local-file' }
    }

    // Step 8f: must be a regular file.
    const st = await handle.stat()
    if (!st.isFile()) {
      return { ok: false, status: 404, reason: 'missing-local-file' }
    }

    // Step 8g: the opened inode must match the name's inode — pins the identity
    // of the OPENED handle against a swap between resolve and open.
    const lst = await lstat(candidate)
    if (lst.dev !== st.dev || lst.ino !== st.ino) {
      return { ok: false, status: 403, reason: 'path-escape' }
    }

    // Step 8h: re-resolve the full path and re-run the exclusion rules against
    // the resolved relative path (closes the short-name / symlinked-name bypass).
    const realTarget = await realpath(candidate)
    const relReal = relative(realRoot, realTarget)
    if (relReal === '' || relReal.startsWith('..') || isAbsolute(relReal)) {
      return { ok: false, status: 403, reason: 'path-escape' }
    }
    if (isInExcludedDirectory(relReal) || hasDotSegment(relReal)) {
      return { ok: false, status: 403, reason: 'excluded-path' }
    }

    // Step 9: bounded read; more bytes than the cap ⇒ 413. Never trusts st.size.
    const read = await readExactly(handle, PREVIEW.MAX_ASSET_BYTES)
    if (read.overflow) {
      return { ok: false, status: 413, reason: 'asset-too-large' }
    }

    return { ok: true, body: read.buffer, ext: extname(candidate).toLowerCase() }
  } finally {
    await handle?.close()
  }
}
