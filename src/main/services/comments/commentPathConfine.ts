// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Realpath confinement of a comment file to the project root, with no folder
 * rule (comments-v2 OD-07, 2026-10-28: "if a file can be opened, it can be
 * commented" – the same rule for HTML and Markdown).
 *
 * The preview's `confinePath` (`previewPathResolve.ts`) is the serving gate:
 * it refuses dot-segments and build folders because a page must never be
 * SERVED from them. Comments are written only to a file the reader already
 * has open, and only to a name a comment file kind claims (`.html`, `.htm`,
 * `.md`, `.markdown` – `commentFileAccess.ts` rule 2), so a secret such as
 * `.env` stays unreachable by its name, not by its folder. This module keeps
 * every escape rule of `confinePath` (steps 8a–8c and 8h) and drops only its
 * two folder rules.
 *
 * It is an early answer, not the deciding one: `confineCommentFile` compares
 * the two realpaths exactly again (`realPathWithin`) whatever this says.
 *
 * @module services/comments/commentPathConfine
 */
import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { realPathWithin } from '../preview/previewPathResolve'

/** Where a candidate resolves, or why it is not inside the root. */
export type CommentPathVerdict =
  | { readonly ok: true; readonly realTarget: string; readonly rel: string }
  | { readonly ok: false; readonly reason: 'escape' | 'missing' }

/**
 * Confines `candidate` to `realRoot` by realpath.
 *
 * @param realRoot - The project root, already `fs.promises.realpath`-resolved.
 * @param candidate - An absolute path below the root.
 * @returns The fully resolved target and its path below the root, or
 *   `missing` when the parent or the file does not resolve, `escape` when
 *   either resolves outside the root.
 */
export async function confineCommentPath(realRoot: string, candidate: string): Promise<CommentPathVerdict> {
  // 8a: the parent, natively resolved. A missing parent is "missing", never an escape.
  let parentReal: string
  try {
    parentReal = await realpath(dirname(candidate))
  } catch {
    return { ok: false, reason: 'missing' }
  }
  // 8b–8c: an early reject only – `relative` folds case on win32; 8h decides.
  const parentRel = relative(realRoot, join(parentReal, basename(candidate)))
  if (parentRel === '' || parentRel.startsWith('..') || isAbsolute(parentRel)) {
    return { ok: false, reason: 'escape' }
  }
  // 8h: the full path resolved (closes the 8.3 and symlinked-name bypasses), compared exactly.
  let realTarget: string
  try {
    realTarget = await realpath(candidate)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  const rel = realPathWithin(realRoot, realTarget)
  return rel === undefined ? { ok: false, reason: 'escape' } : { ok: true, realTarget, rel }
}
