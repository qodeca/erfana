// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * permissionDeniedFile - why a project path could not be verified, when the
 * reason is a permission and nothing else.
 *
 * With "Deny Read" on a file (Windows `icacls /deny <user>:(R)`), `realpath`
 * fails with EPERM while `lstat` still works, so the confinement walk cannot
 * canonicalise the file and refuses it as UNVERIFIABLE. That refusal is right,
 * but its message ("Cannot verify this path is inside the project directory")
 * hides the real reason. This check tells the two apart, so the refusal can
 * say "permission denied" instead. It only renames a refusal: the caller still
 * throws, and nothing here ever hands back a path to act on.
 *
 * The bar is high on purpose, so the new wording is never given for a path
 * whose place is in doubt:
 * - the path is lexically inside the project (as opened, or canonical),
 *   so nothing is probed for an outside path;
 * - `lstat` says it is a regular file, not a link (a link may lead outside;
 *   that keeps the "cannot verify" refusal);
 * - `realpath` of the file fails with EPERM or EACCES;
 * - `realpath` of its folder succeeds and lies inside the canonical root.
 *
 * Runs only after a refusal, so the hot path makes no extra call.
 *
 * @module ipc/confinement/permissionDeniedFile
 */
import { isInsideRoot, normaliseResolved } from '../../utils/pathCompare'
import type { ConfinementDeps, ConfinementSession } from './resolveConfinedPath'

const PERMISSION_CODES = new Set(['EPERM', 'EACCES'])

/**
 * Whether `lexical` is a regular in-project file the file system will not let
 * the app resolve, for lack of permission alone.
 *
 * @param lexical - `path.resolve` of the requested path
 * @param session - The open project
 * @param deps - File system and path flavour
 * @returns true only when every condition in the module comment holds; any
 *   other answer, or any error while checking, is false
 */
export async function isPermissionDeniedFile(
  lexical: string,
  session: ConfinementSession,
  deps: ConfinementDeps
): Promise<boolean> {
  const { path, fs } = deps
  const lexicallyInside =
    isInsideRoot(lexical, session.root, session.caseSensitive, deps) ||
    isInsideRoot(lexical, session.realRoot, session.caseSensitive, deps)
  if (!lexicallyInside) return false

  try {
    const own = await fs.lstat(lexical)
    if (!own.isFile() || own.isSymbolicLink()) return false
  } catch {
    return false
  }

  try {
    await fs.realpath(lexical)
    // It resolves now: whatever refused it, it was not this
    return false
  } catch (error) {
    if (!PERMISSION_CODES.has((error as NodeJS.ErrnoException | null)?.code ?? '')) return false
  }

  const folder = path.dirname(lexical)
  if (folder === lexical) return false
  try {
    const realFolder = normaliseResolved(await fs.realpath(folder), deps)
    return isInsideRoot(realFolder, session.realRoot, session.caseSensitive, deps)
  } catch {
    return false
  }
}
