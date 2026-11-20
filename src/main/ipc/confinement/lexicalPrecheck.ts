// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * lexicalPrecheck - the cheap half of the project check, run before
 * {@link resolveConfinedPath} on channels where a refusal is routine (#71) or
 * where asking the file system about an outside path would leak (#478 F5).
 *
 * A `project`-mode path that does not name a place under the project root (as
 * opened, or canonical) is refused without a single file-system call: a UNC
 * path would otherwise send the user's NTLM credentials to its server, and a
 * `stat` of an outside path would answer whether it exists.
 *
 * One exception (#478 G6): on Windows, a local drive-letter path can spell the
 * project folder with an 8.3 short name (`C:\Users\X\AppData\Local\Temp\
 * E2E-TE~1\…` for `…\e2e-test-project\…`), and a terminal prints such paths.
 * Only such a path – a drive letter the project already lives on, and a
 * segment that looks like a short name – is expanded with the native
 * `realpath` and checked again. UNC and device paths never get this far.
 */
import type { ProjectSessionSnapshot } from '../../services/session/ProjectSession'
import { ConfinementError } from './ConfinementError'
import {
  checkForm,
  isInsideRoot,
  normaliseResolved,
  type ConfinementDeps
} from './resolveConfinedPath'

/** A drive-letter path; UNC (`\\srv\share`) and device (`\\?\`, `\\.\`) paths do not match. */
const WIN_DRIVE_PATH = /^([A-Za-z]):[\\/]/
/** An 8.3 short-name candidate: a `~` followed by a digit (`PROGRA~1`, `LONG-F~1.MD`). */
const SHORT_NAME_SEGMENT = /~\d/
const PATH_SEPARATORS = /[\\/]+/

type PrecheckSession = Pick<ProjectSessionSnapshot, 'root' | 'realRoot' | 'caseSensitive'>

function isUnderProject(candidate: string, session: PrecheckSession, deps: ConfinementDeps): boolean {
  return (
    isInsideRoot(candidate, session.root, session.caseSensitive, deps) ||
    isInsideRoot(candidate, session.realRoot, session.caseSensitive, deps)
  )
}

function driveOf(value: string): string | null {
  return WIN_DRIVE_PATH.exec(value)?.[1].toUpperCase() ?? null
}

/**
 * `lexical` with its short-name segments expanded, or `null` when it is not a
 * candidate or cannot be expanded. Only the prefix up to the last short-name
 * segment is resolved, so a file that does not exist yet below a shortened
 * folder is still placed; that prefix must exist.
 */
async function expandShortNames(
  raw: string,
  lexical: string,
  session: PrecheckSession,
  deps: ConfinementDeps
): Promise<string | null> {
  if (deps.platform !== 'win32') return null
  // The renderer's own value must already be a drive-letter path: a rootless
  // `\a~1\x` or an NT path such as `\??\UNC\…` only looks like one after
  // `resolve` and is never expanded
  const drive = driveOf(raw)
  // Only the drive the project's real root lives on is asked, and only when
  // that real root is itself a drive-letter path (not a share): no new disk
  // or share is reached
  const realDrive = driveOf(session.realRoot)
  if (drive === null || realDrive === null || drive !== realDrive || driveOf(lexical) !== drive) return null
  const segments = lexical.split(PATH_SEPARATORS).filter(Boolean)
  const lastShort = segments.findLastIndex((segment) => SHORT_NAME_SEGMENT.test(segment))
  if (lastShort < 1) return null
  // The form of both the sent value and its resolved spelling is checked
  // before the file system is asked, so a device or a stream name never
  // reaches `realpath`
  checkForm(raw, deps)
  checkForm(lexical, deps)
  const prefix = deps.path.join(`${segments[0]}${deps.path.sep}`, ...segments.slice(1, lastShort + 1))
  let real: string
  try {
    real = normaliseResolved(await deps.fs.realpath(prefix), deps)
  } catch {
    return null
  }
  const rest = segments.slice(lastShort + 1)
  return rest.length > 0 ? deps.path.join(real, ...rest) : real
}

/**
 * Refuse `value` unless it names a place under the project root, lexically or
 * (Windows) once its 8.3 short-name segments are expanded. A value that is not
 * an absolute string is left to {@link resolveConfinedPath}, which refuses it
 * as invalid; with no project open the full check answers `NO_PROJECT`.
 *
 * @throws ConfinementError `OUTSIDE_PROJECT` for a path outside the project,
 *   `INVALID_PATH` for a short-name candidate whose form is not acceptable
 */
export async function refuseLexicallyOutside(
  value: unknown,
  session: PrecheckSession | null,
  deps: ConfinementDeps
): Promise<void> {
  if (!session || typeof value !== 'string' || value.includes('\0') || !deps.path.isAbsolute(value)) return
  const lexical = deps.path.resolve(value)
  if (isUnderProject(lexical, session, deps)) return
  const expanded = await expandShortNames(value, lexical, session, deps)
  if (expanded !== null && isUnderProject(expanded, session, deps)) return
  throw new ConfinementError('OUTSIDE_PROJECT')
}
